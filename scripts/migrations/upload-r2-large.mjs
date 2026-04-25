#!/usr/bin/env node

import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const DEFAULT_MANIFEST = path.resolve(process.cwd(), "migration-output/media/manifest.json");
const DEFAULT_BUCKET = "gridworld-streaming-media";
const DEFAULT_THRESHOLD_MIB = 300;

const args = parseArgs(process.argv.slice(2));

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

async function main() {
  loadEnvFile(path.resolve(process.cwd(), ".env.local"));

  const manifestPath = path.resolve(String(args.manifest ?? DEFAULT_MANIFEST));
  const bucket = String(args.bucket ?? process.env.R2_BUCKET ?? DEFAULT_BUCKET);
  const thresholdBytes = Number(args["threshold-mib"] ?? DEFAULT_THRESHOLD_MIB) * 1024 * 1024;
  const credentials = await resolveCredentials();
  const endpoint = credentials.endpoint;

  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const requestedKeys = arrayArg(args.key);
  const assets = manifest.assets.filter((asset) => {
    if (requestedKeys.length > 0) {
      return requestedKeys.includes(asset.key);
    }

    return !asset.uploaded && Number(asset.sizeBytes ?? 0) > thresholdBytes;
  });

  if (assets.length === 0) {
    console.log("No large failed assets matched the upload criteria.");
    return;
  }

  console.log(JSON.stringify({
    bucket,
    endpoint,
    candidates: assets.map((asset) => ({
      key: asset.key,
      sizeBytes: asset.sizeBytes,
      sourcePath: asset.localPath ?? asset.cachePath ?? null,
    })),
  }, null, 2));

  for (const asset of assets) {
    const sourcePath = asset.localPath ?? asset.cachePath;

    if (!sourcePath) {
      asset.uploaded = false;
      asset.uploadError = "missing_local_or_cached_file";
      continue;
    }

    const fileSize = (await stat(sourcePath)).size;
    const cpArgs = [
      "s3",
      "cp",
      sourcePath,
      `s3://${bucket}/${asset.key}`,
      "--endpoint-url",
      endpoint,
      "--content-type",
      asset.contentType ?? "application/octet-stream",
      "--cache-control",
      isDownloadable(asset.key) ? "private, max-age=0" : "public, max-age=31536000, immutable",
      "--no-progress",
    ];

    if (asset.contentDisposition) {
      cpArgs.push("--content-disposition", asset.contentDisposition);
    }

    console.log(`Uploading ${asset.key} (${fileSize} bytes) via S3 multipart...`);
    await runAws(cpArgs, credentials);

    const headObject = await runAwsJson([
      "s3api",
      "head-object",
      "--bucket",
      bucket,
      "--key",
      asset.key,
      "--endpoint-url",
      endpoint,
    ], credentials);

    if (headObject.ContentLength !== fileSize) {
      throw new Error(
        `Uploaded size mismatch for ${asset.key}: remote ${headObject.ContentLength}, local ${fileSize}`,
      );
    }

    asset.uploaded = true;
    asset.uploadError = null;
    asset.r2 = {
      etag: headObject.ETag ?? null,
      lastModified: headObject.LastModified ?? null,
      contentLength: headObject.ContentLength,
      contentType: headObject.ContentType ?? null,
    };
  }

  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`Updated ${manifestPath}`);
}

async function resolveCredentials() {
  const accessKeyId = process.env.R2_ACCESS_KEY_ID ?? process.env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY ?? process.env.AWS_SECRET_ACCESS_KEY;

  if (!accessKeyId || !secretAccessKey) {
    throw new Error([
      "Missing R2 S3 credentials.",
      "Create an R2 API token with Object Read & Write for gridworld-streaming-media, then set:",
      "  R2_ACCESS_KEY_ID=<Access Key ID>",
      "  R2_SECRET_ACCESS_KEY=<Secret Access Key>",
      "  R2_ACCOUNT_ID=073abd4ee247f9cf77d6a08d9fa12f12",
    ].join("\n"));
  }

  const accountId = process.env.R2_ACCOUNT_ID ?? process.env.CLOUDFLARE_ACCOUNT_ID ?? await getWranglerAccountId();
  const endpoint = process.env.R2_ENDPOINT ?? `https://${accountId}.r2.cloudflarestorage.com`;

  return {
    accessKeyId,
    secretAccessKey,
    sessionToken: process.env.R2_SESSION_TOKEN ?? process.env.AWS_SESSION_TOKEN,
    endpoint,
    region: process.env.R2_REGION ?? process.env.AWS_DEFAULT_REGION ?? "auto",
  };
}

async function getWranglerAccountId() {
  const output = await runCommand("npx", ["wrangler", "whoami", "--json"], { ...process.env });
  const parsed = JSON.parse(output);
  const accountId = parsed.accounts?.[0]?.id;

  if (!accountId) {
    throw new Error("Unable to determine Cloudflare account ID from Wrangler. Set R2_ACCOUNT_ID.");
  }

  return accountId;
}

async function runAwsJson(args, credentials) {
  const output = await runAws(args, credentials);
  return JSON.parse(output);
}

function runAws(args, credentials) {
  return runCommand("aws", args, awsEnv(credentials));
}

function awsEnv(credentials) {
  const env = {
    ...process.env,
    AWS_ACCESS_KEY_ID: credentials.accessKeyId,
    AWS_SECRET_ACCESS_KEY: credentials.secretAccessKey,
    AWS_DEFAULT_REGION: credentials.region,
    AWS_REGION: credentials.region,
    AWS_EC2_METADATA_DISABLED: "true",
    AWS_REQUEST_CHECKSUM_CALCULATION: "WHEN_REQUIRED",
    AWS_RESPONSE_CHECKSUM_VALIDATION: "WHEN_REQUIRED",
    AWS_SHARED_CREDENTIALS_FILE: "/dev/null",
    AWS_CONFIG_FILE: "/dev/null",
  };

  if (credentials.sessionToken) {
    env.AWS_SESSION_TOKEN = credentials.sessionToken;
  } else {
    delete env.AWS_SESSION_TOKEN;
  }

  return env;
}

function runCommand(command, args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        if (stdout.trim()) {
          console.log(stdout.trim());
        }
        resolve(stdout);
        return;
      }

      reject(new Error(stderr.trim() || `${command} ${args.join(" ")} exited with code ${code}`));
    });
  });
}

function isDownloadable(key) {
  return key.toLowerCase().endsWith(".zip");
}

function loadEnvFile(filePath) {
  let text;

  try {
    text = readFileSync(filePath, "utf8");
  } catch {
    return;
  }

  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const index = trimmed.indexOf("=");

    if (index === -1) {
      continue;
    }

    const key = trimmed.slice(0, index);
    const value = stripQuotes(trimmed.slice(index + 1));

    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

function stripQuotes(value) {
  return value.replace(/^['"]|['"]$/g, "");
}

function arrayArg(value) {
  if (!value) {
    return [];
  }

  return Array.isArray(value) ? value : [String(value)];
}

function parseArgs(rawArgs) {
  const parsed = {};

  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];

    if (!arg.startsWith("--")) {
      continue;
    }

    const [key, inlineValue] = arg.slice(2).split("=", 2);
    let value;

    if (inlineValue !== undefined) {
      value = inlineValue;
    } else if (rawArgs[index + 1] && !rawArgs[index + 1].startsWith("--")) {
      value = rawArgs[index + 1];
      index += 1;
    } else {
      value = true;
    }

    if (parsed[key] === undefined) {
      parsed[key] = value;
    } else if (Array.isArray(parsed[key])) {
      parsed[key].push(value);
    } else {
      parsed[key] = [parsed[key], value];
    }
  }

  return parsed;
}
