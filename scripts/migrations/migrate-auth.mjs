#!/usr/bin/env node

import { createClerkClient } from "@clerk/backend";
import { MongoClient } from "mongodb";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const DEFAULT_LEGACY_ENV = path.resolve(
  process.cwd(),
  "../react_app/gridworld_streaming_10_30_2024/.env",
);
const DEFAULT_CLERK_ENV = path.resolve(process.cwd(), ".env.local");
const DEFAULT_OUT_DIR = path.resolve(process.cwd(), "migration-output/auth");

const args = parseArgs(process.argv.slice(2));

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

async function main() {
  const options = {
    apply: Boolean(args.apply),
    inspect: Boolean(args.inspect),
    dbName: String(args["db-name"] ?? "main_db"),
    legacyEnvPath: path.resolve(String(args["legacy-env"] ?? DEFAULT_LEGACY_ENV)),
    clerkEnvPath: path.resolve(String(args["clerk-env"] ?? DEFAULT_CLERK_ENV)),
    outDir: path.resolve(String(args["out-dir"] ?? DEFAULT_OUT_DIR)),
    limit: args.limit === undefined ? undefined : Number(args.limit),
    delayMs: Number(args["delay-ms"] ?? 250),
    requireLive: Boolean(args["require-live"]),
  };

  if (options.limit !== undefined && (!Number.isInteger(options.limit) || options.limit < 1)) {
    throw new Error("--limit must be a positive integer.");
  }

  const legacyEnv = await readEnvFile(options.legacyEnvPath);
  const mongoUri = String(process.env.MONGODB_URI ?? legacyEnv.MONGODB_URI ?? "");

  if (!mongoUri) {
    throw new Error(`Missing MONGODB_URI. Set it in the environment or ${options.legacyEnvPath}.`);
  }

  const { users, skippedUsers } = await readLegacyUsers(mongoUri, options.dbName, options.limit);
  const report = summarizeUsers(users, skippedUsers);

  if (options.inspect || !options.apply) {
    printSummary(report, options.apply);
  }

  if (options.inspect) {
    return;
  }

  if (!options.apply) {
    console.log("Dry run only. Re-run with npm run auth:migrate:apply -- --apply to create/update Clerk users.");
    return;
  }

  const clerkEnv = await readEnvFile(options.clerkEnvPath);
  const secretKey = String(process.env.CLERK_SECRET_KEY ?? clerkEnv.CLERK_SECRET_KEY ?? "");

  if (!secretKey || secretKey.includes("replace_me")) {
    throw new Error(`Missing CLERK_SECRET_KEY. Set it in the environment or ${options.clerkEnvPath}.`);
  }

  if (options.requireLive && !secretKey.startsWith("sk_live_")) {
    throw new Error("This migration requires a live Clerk secret key. Set CLERK_SECRET_KEY=sk_live_... in the shell.");
  }

  await mkdir(options.outDir, { recursive: true });

  const clerk = createClerkClient({ secretKey });
  const resultPath = path.join(options.outDir, "clerk-users.jsonl");
  const sqlPath = path.join(options.outDir, "profiles.sql");
  const errorPath = path.join(options.outDir, "errors.jsonl");
  const skippedPath = path.join(options.outDir, "skipped-users.jsonl");
  const resultLines = [];
  const sqlStatements = [
    "PRAGMA foreign_keys = ON;",
    "BEGIN TRANSACTION;",
  ];
  const errorLines = [];
  let imported = 0;
  let reused = 0;
  let failed = 0;

  if (skippedUsers.length > 0) {
    await writeFile(skippedPath, `${skippedUsers.map((user) => JSON.stringify(user)).join("\n")}\n`);
  }

  for (const legacyUser of users) {
    try {
      const clerkUser = await upsertClerkUser(clerk, legacyUser);
      const mode = clerkUser.wasExisting ? "reused" : "created";

      if (clerkUser.wasExisting) {
        reused += 1;
      } else {
        imported += 1;
      }

      resultLines.push(JSON.stringify({
        legacyUserId: legacyUser.legacyUserId,
        clerkUserId: clerkUser.id,
        email: legacyUser.email,
        mode,
        hasAccessToken: legacyUser.hasAccessToken,
      }));
      sqlStatements.push(profileSql({
        clerkUserId: clerkUser.id,
        legacyUserId: legacyUser.legacyUserId,
        email: legacyUser.email,
        hasAccessToken: legacyUser.hasAccessToken,
        createdAt: legacyUser.dateCreated,
      }));

      await wait(options.delayMs);
    } catch (error) {
      failed += 1;
      errorLines.push(JSON.stringify({
        legacyUserId: legacyUser.legacyUserId,
        email: legacyUser.email,
        error: error instanceof Error ? error.message : String(error),
      }));
    }
  }

  sqlStatements.push("COMMIT;");

  await writeFile(resultPath, `${resultLines.join("\n")}\n`);
  await writeFile(sqlPath, `${sqlStatements.join("\n")}\n`);

  if (errorLines.length > 0) {
    await writeFile(errorPath, `${errorLines.join("\n")}\n`);
  }

  console.log(JSON.stringify({
    total: users.length,
    skipped: skippedUsers.length,
    created: imported,
    reused,
    failed,
    resultPath,
    sqlPath,
    skippedPath: skippedUsers.length > 0 ? skippedPath : null,
    errorPath: errorLines.length > 0 ? errorPath : null,
  }, null, 2));
}

async function readLegacyUsers(mongoUri, dbName, limit) {
  const client = new MongoClient(mongoUri);
  await client.connect();

  try {
    const cursor = client
      .db(dbName)
      .collection("users")
      .find({}, {
        projection: {
          _id: 1,
          email: 1,
          password: 1,
          date_created: 1,
          has_access_token: 1,
        },
        sort: { date_created: 1, _id: 1 },
      });

    if (limit) {
      cursor.limit(limit);
    }

    const records = await cursor.toArray();
    const users = [];
    const skippedUsers = [];

    for (const record of records) {
      const email = normalizeEmail(record.email);
      const passwordDigest = typeof record.password === "string" ? record.password : "";

      if (!email) {
        skippedUsers.push({
          legacyUserId: record._id?.toString() ?? null,
          reason: "missing_email",
        });
        continue;
      }

      if (!passwordDigest.startsWith("$2")) {
        skippedUsers.push({
          legacyUserId: record._id?.toString() ?? null,
          email,
          reason: "non_bcrypt_password",
          passwordLength: passwordDigest.length,
          hasAccessToken: Boolean(record.has_access_token),
        });
        continue;
      }

      users.push({
        legacyUserId: record._id.toString(),
        email,
        passwordDigest,
        dateCreated: record.date_created instanceof Date ? record.date_created : new Date(),
        hasAccessToken: Boolean(record.has_access_token),
      });
    }

    return { users, skippedUsers };
  } finally {
    await client.close();
  }
}

async function upsertClerkUser(clerk, legacyUser) {
  const byExternalId = await clerk.users.getUserList({
    externalId: [legacyUser.legacyUserId],
    limit: 1,
  });
  const existingByExternalId = byExternalId.data[0];

  if (existingByExternalId) {
    return { ...existingByExternalId, wasExisting: true };
  }

  const byEmail = await clerk.users.getUserList({
    emailAddress: [legacyUser.email],
    limit: 1,
  });
  const existingByEmail = byEmail.data[0];
  const metadata = legacyPrivateMetadata(legacyUser);

  if (existingByEmail) {
    const updated = await clerk.users.updateUser(existingByEmail.id, {
      externalId: legacyUser.legacyUserId,
      privateMetadata: {
        ...existingByEmail.privateMetadata,
        ...metadata,
      },
    });

    return { ...updated, wasExisting: true };
  }

  const created = await clerk.users.createUser({
    externalId: legacyUser.legacyUserId,
    emailAddress: [legacyUser.email],
    passwordDigest: legacyUser.passwordDigest,
    passwordHasher: "bcrypt",
    createdAt: legacyUser.dateCreated,
    legalAcceptedAt: legacyUser.dateCreated,
    skipLegalChecks: true,
    privateMetadata: metadata,
  });

  return { ...created, wasExisting: false };
}

function summarizeUsers(users, skippedUsers) {
  const emails = new Map();

  for (const user of users) {
    emails.set(user.email, (emails.get(user.email) ?? 0) + 1);
  }

  return {
    total: users.length,
    skipped: skippedUsers.length,
    accessTokenUsers: users.filter((user) => user.hasAccessToken).length,
    skippedAccessTokenUsers: skippedUsers.filter((user) => user.hasAccessToken).length,
    duplicateEmails: Array.from(emails.values()).filter((count) => count > 1).length,
    bcryptHashes: users.filter((user) => user.passwordDigest.startsWith("$2")).length,
  };
}

function printSummary(report, apply) {
  console.log(JSON.stringify({
    mode: apply ? "apply" : "dry-run",
    ...report,
  }, null, 2));
}

function legacyPrivateMetadata(legacyUser) {
  return {
    legacyUserId: legacyUser.legacyUserId,
    legacyAuthSource: "gridworld_streaming_mongo",
    legacyHasAccessToken: legacyUser.hasAccessToken,
    migratedAt: new Date().toISOString(),
  };
}

function profileSql(profile) {
  return [
    "INSERT INTO profiles (clerk_user_id, legacy_user_id, email, has_access_token, created_at, updated_at)",
    `VALUES (${sql(profile.clerkUserId)}, ${sql(profile.legacyUserId)}, ${sql(profile.email)}, ${profile.hasAccessToken ? 1 : 0}, ${sql(profile.createdAt.toISOString())}, CURRENT_TIMESTAMP)`,
    "ON CONFLICT(clerk_user_id) DO UPDATE SET",
    "  legacy_user_id = excluded.legacy_user_id,",
    "  email = excluded.email,",
    "  has_access_token = excluded.has_access_token,",
    "  updated_at = CURRENT_TIMESTAMP;",
  ].join("\n");
}

async function readEnvFile(filePath) {
  try {
    const text = await readFile(filePath, "utf8");
    return Object.fromEntries(
      text
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith("#"))
        .map((line) => {
          const index = line.indexOf("=");
          return [line.slice(0, index), stripQuotes(line.slice(index + 1))];
        }),
    );
  } catch {
    return {};
  }
}

function parseArgs(rawArgs) {
  const parsed = {};

  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];

    if (!arg.startsWith("--")) {
      continue;
    }

    const [key, inlineValue] = arg.slice(2).split("=", 2);

    if (inlineValue !== undefined) {
      parsed[key] = inlineValue;
    } else if (rawArgs[index + 1] && !rawArgs[index + 1].startsWith("--")) {
      parsed[key] = rawArgs[index + 1];
      index += 1;
    } else {
      parsed[key] = true;
    }
  }

  return parsed;
}

function normalizeEmail(value) {
  if (typeof value !== "string") {
    return null;
  }

  const email = value.trim().toLowerCase();
  const [localPart, domain] = email.split("@");

  if (
    email.length > 254 ||
    !localPart ||
    localPart.length > 64 ||
    !domain ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  ) {
    return null;
  }

  return email;
}

function stripQuotes(value) {
  return value.replace(/^['"]|['"]$/g, "");
}

function sql(value) {
  if (value === null || value === undefined) {
    return "NULL";
  }

  return `'${String(value).replaceAll("'", "''")}'`;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
