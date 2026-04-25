import { getCloudflareContext } from "@opennextjs/cloudflare";
import { execFile } from "node:child_process";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

export type AppEnv = CloudflareEnv;

const execFileAsync = promisify(execFile);
const LOCAL_D1_DIR = path.join(
  process.cwd(),
  ".wrangler/state/v3/d1/miniflare-D1DatabaseObject",
);

export function getEnv(): AppEnv {
  return getOpenNextEnv();
}

export function getDb(): D1Database {
  if (process.env.NODE_ENV === "development") {
    return localD1Database() as D1Database;
  }

  return getEnv().DB;
}

export function getMediaBucket(): R2Bucket {
  return getEnv().MEDIA_BUCKET;
}

export function getRequiredEnv(name: keyof AppEnv): string {
  let value: unknown = process.env[name as string];

  if (typeof value !== "string" || value.length === 0) {
    value = getEnv()[name];
  }

  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Missing required Cloudflare env var: ${String(name)}`);
  }

  return value;
}

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

async function runLocalSql<T>(sql: string, readRows = true): Promise<T[]> {
  const databasePath = await localD1Path();
  const args = readRows ? ["-json", databasePath, sql] : [databasePath, sql];
  const { stdout } = await execFileAsync("sqlite3", args, {
    maxBuffer: 1024 * 1024 * 10,
  });

  if (!readRows || stdout.trim().length === 0) {
    return [];
  }

  return JSON.parse(stdout) as T[];
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

function getOpenNextEnv(): AppEnv {
  return getCloudflareContext().env as AppEnv;
}
