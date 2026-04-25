import { getCloudflareContext } from "@opennextjs/cloudflare";
import { AwsClient } from "aws4fetch";
import { execFile } from "node:child_process";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

export type AppEnv = Partial<CloudflareEnv> & NodeJS.ProcessEnv;

const execFileAsync = promisify(execFile);
const LOCAL_D1_DIR = path.join(
  process.cwd(),
  ".wrangler/state/v3/d1/miniflare-D1DatabaseObject",
);
const LOCAL_SQLITE_BUSY_TIMEOUT_MS = 5000;
const LOCAL_SQLITE_MAX_ATTEMPTS = 3;
const REMOTE_D1_DATABASE_ID = "0c8a6447-e7bd-40c0-bb1a-1f7feac90020";

export function getEnv(): AppEnv {
  return getOpenNextEnv();
}

export function getDb(): D1Database {
  if (process.env.NODE_ENV === "development") {
    return localD1Database() as D1Database;
  }

  const env = getEnv();

  if (env.DB) {
    return env.DB;
  }

  return remoteD1Database() as D1Database;
}

export function getMediaBucket(): R2Bucket {
  const bucket = getEnv().MEDIA_BUCKET;

  if (!bucket) {
    throw new Error("Missing Cloudflare R2 binding MEDIA_BUCKET.");
  }

  return bucket;
}

export async function getMediaObject(key: string, range?: ByteRange): Promise<MediaObject | null> {
  if (process.env.NODE_ENV !== "development") {
    const bucket = getEnv().MEDIA_BUCKET;

    if (bucket) {
      const object = await bucket.get(key, { range });
      return object ? r2BindingObject(object) : null;
    }

    return remoteR2Object(key, range);
  }

  return null;
}

export function getRequiredEnv(name: string): string {
  let value: unknown = process.env[name as string];

  if (typeof value !== "string" || value.length === 0) {
    value = getEnv()[name];
  }

  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Missing required Cloudflare env var: ${String(name)}`);
  }

  return value;
}

export type ByteRange = { offset: number; length?: number };

export type MediaObject = {
  body: ReadableStream | null;
  httpEtag: string;
  size: number;
  writeHttpMetadata(headers: Headers): void;
};

type LocalD1Result<T> = {
  results: T[];
  success: true;
  meta: Record<string, never>;
};

function localD1Database() {
  return {
    prepare(sql: string) {
      let bindings: unknown[] = [];

      return {
        bind(...values: unknown[]) {
          bindings = values;
          return this;
        },
        async all<T>() {
          const results = await runLocalSql<T>(applyBindings(sql, bindings));
          return {
            results,
            success: true,
            meta: {},
          } satisfies LocalD1Result<T>;
        },
        async first<T>() {
          const results = await runLocalSql<T>(`${applyBindings(sql, bindings)} LIMIT 1`);
          return results[0] ?? null;
        },
        async run() {
          await runLocalSql(applyBindings(sql, bindings), false);
          return {
            success: true,
            meta: {},
          };
        },
      };
    },
  };
}

function remoteD1Database() {
  return {
    prepare(sql: string) {
      let bindings: unknown[] = [];

      return {
        bind(...values: unknown[]) {
          bindings = values;
          return this;
        },
        async all<T>() {
          const result = await runRemoteD1<T>(sql, bindings);
          return {
            results: result.results,
            success: true,
            meta: result.meta,
          };
        },
        async first<T>() {
          const result = await runRemoteD1<T>(`${sql} LIMIT 1`, bindings);
          return result.results[0] ?? null;
        },
        async run() {
          const result = await runRemoteD1(sql, bindings);
          return {
            success: true,
            meta: result.meta,
          };
        },
      };
    },
  };
}

type RemoteD1Result<T> = {
  results: T[];
  meta: Record<string, unknown>;
};

type CloudflareD1Response<T> = {
  success: boolean;
  errors?: { message?: string }[];
  result?: {
    success: boolean;
    results?: T[];
    meta?: Record<string, unknown>;
    error?: string;
  }[];
};

async function runRemoteD1<T>(sql: string, params: unknown[]): Promise<RemoteD1Result<T>> {
  const accountId = getCloudflareAccountId();
  const apiToken = getRequiredEnv("CLOUDFLARE_API_TOKEN");
  const databaseId = process.env.CLOUDFLARE_D1_DATABASE_ID || REMOTE_D1_DATABASE_ID;
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${databaseId}/query`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ sql, params }),
    },
  );

  const payload = (await response.json()) as CloudflareD1Response<T>;
  const queryResult = payload.result?.[0];

  if (!response.ok || !payload.success || !queryResult?.success) {
    const message =
      queryResult?.error ??
      payload.errors?.map((error) => error.message).filter(Boolean).join("; ") ??
      `Cloudflare D1 query failed with HTTP ${response.status}`;
    throw new Error(message);
  }

  return {
    results: queryResult.results ?? [],
    meta: queryResult.meta ?? {},
  };
}

function getCloudflareAccountId() {
  return process.env.CLOUDFLARE_ACCOUNT_ID || process.env.R2_ACCOUNT_ID || getRequiredEnv("CLOUDFLARE_ACCOUNT_ID");
}

function r2BindingObject(object: R2ObjectBody): MediaObject {
  return {
    body: object.body,
    httpEtag: object.httpEtag,
    size: object.size,
    writeHttpMetadata(headers) {
      object.writeHttpMetadata(headers);
    },
  };
}

let r2Client: AwsClient | undefined;

async function remoteR2Object(key: string, range?: ByteRange): Promise<MediaObject | null> {
  const endpoint = getRequiredEnv("R2_ENDPOINT").replace(/\/$/, "");
  const bucketName = getRequiredEnv("R2_BUCKET_NAME");
  const url = `${endpoint}/${encodeURIComponent(bucketName)}/${key.split("/").map(encodeURIComponent).join("/")}`;
  const headers = new Headers();

  if (range) {
    const start = range.offset;
    const end = range.length === undefined ? "" : String(start + range.length - 1);
    headers.set("range", `bytes=${start}-${end}`);
  }

  const response = await getR2Client().fetch(url, { headers });

  if (response.status === 404) {
    return null;
  }

  if (!response.ok && response.status !== 206) {
    throw new Error(`Cloudflare R2 object fetch failed with HTTP ${response.status}`);
  }

  return {
    body: response.body,
    httpEtag: response.headers.get("etag") ?? "",
    size: getObjectSize(response.headers),
    writeHttpMetadata(targetHeaders) {
      for (const header of ["content-type", "content-language", "content-disposition", "content-encoding"]) {
        const value = response.headers.get(header);

        if (value) {
          targetHeaders.set(header, value);
        }
      }
    },
  };
}

function getR2Client() {
  r2Client ??= new AwsClient({
    accessKeyId: getRequiredEnv("R2_ACCESS_KEY_ID"),
    secretAccessKey: getRequiredEnv("R2_SECRET_ACCESS_KEY"),
    region: "auto",
    service: "s3",
  });

  return r2Client;
}

function getObjectSize(headers: Headers) {
  const contentRange = headers.get("content-range");
  const totalSize = contentRange?.match(/\/(\d+)$/)?.[1];

  if (totalSize) {
    return Number(totalSize);
  }

  return Number(headers.get("content-length") ?? 0);
}

async function runLocalSql<T>(sql: string, readRows = true): Promise<T[]> {
  const databasePath = await localD1Path();
  const args = readRows
    ? ["-json", "-cmd", `.timeout ${LOCAL_SQLITE_BUSY_TIMEOUT_MS}`, databasePath, sql]
    : ["-cmd", `.timeout ${LOCAL_SQLITE_BUSY_TIMEOUT_MS}`, databasePath, sql];
  const { stdout } = await execLocalSqlite(args);

  if (!readRows || stdout.trim().length === 0) {
    return [];
  }

  return JSON.parse(stdout) as T[];
}

async function execLocalSqlite(args: string[]) {
  let lastError: unknown;

  for (let attempt = 1; attempt <= LOCAL_SQLITE_MAX_ATTEMPTS; attempt += 1) {
    try {
      return await execFileAsync("sqlite3", args, {
        maxBuffer: 1024 * 1024 * 10,
      });
    } catch (error) {
      lastError = error;

      if (!isSqliteBusyError(error) || attempt === LOCAL_SQLITE_MAX_ATTEMPTS) {
        throw error;
      }

      await wait(attempt * 150);
    }
  }

  throw lastError;
}

async function localD1Path() {
  const files = await readdir(LOCAL_D1_DIR);
  const databaseFile = files.find(
    (file) => file.endsWith(".sqlite") && file !== "metadata.sqlite" && !file.startsWith("._"),
  );

  if (!databaseFile) {
    throw new Error("Local D1 sqlite database not found. Run `npm run db:migrate:local` first.");
  }

  return path.join(LOCAL_D1_DIR, databaseFile);
}

function applyBindings(sql: string, bindings: unknown[]) {
  let index = 0;

  return sql.replaceAll("?", () => {
    if (index >= bindings.length) {
      throw new Error("Missing SQL binding for local D1 query.");
    }

    const value = bindings[index];
    index += 1;
    return sqlValue(value);
  });
}

function sqlValue(value: unknown) {
  if (value === null || value === undefined) {
    return "NULL";
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? String(value) : "NULL";
  }

  if (typeof value === "boolean") {
    return value ? "1" : "0";
  }

  return `'${String(value).replaceAll("'", "''")}'`;
}

function isSqliteBusyError(error: unknown) {
  if (!error || typeof error !== "object") {
    return false;
  }

  const stderr = "stderr" in error ? String(error.stderr) : "";
  const message = "message" in error ? String(error.message) : "";

  return `${message}\n${stderr}`.includes("database is locked");
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getOpenNextEnv(): AppEnv {
  try {
    return getCloudflareContext().env as AppEnv;
  } catch {
    return process.env;
  }
}
