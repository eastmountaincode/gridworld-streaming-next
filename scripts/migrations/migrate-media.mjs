#!/usr/bin/env node

import { MongoClient } from "mongodb";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { access, mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";

const DEFAULT_LEGACY_ENV = path.resolve(process.cwd(), "../react_app/gridworld_streaming_10_30_2024/.env");
const DEFAULT_OBJECT_ROOT = path.resolve(process.cwd(), "../object_storage_files");
const DEFAULT_OUT_DIR = path.resolve(process.cwd(), "migration-output/media");
const DEFAULT_BUCKET = "gridworld-streaming-media";

const args = parseArgs(process.argv.slice(2));

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

async function main() {
  const options = {
    inspect: Boolean(args.inspect),
    download: Boolean(args.download),
    upload: Boolean(args.upload),
    dbName: String(args["db-name"] ?? "main_db"),
    bucket: String(args.bucket ?? DEFAULT_BUCKET),
    legacyEnvPath: path.resolve(String(args["legacy-env"] ?? DEFAULT_LEGACY_ENV)),
    objectRoot: path.resolve(String(args["object-root"] ?? DEFAULT_OBJECT_ROOT)),
    outDir: path.resolve(String(args["out-dir"] ?? DEFAULT_OUT_DIR)),
  };

  const legacyEnv = await readEnvFile(options.legacyEnvPath);
  const mongoUri = String(process.env.MONGODB_URI ?? legacyEnv.MONGODB_URI ?? "");

  if (!mongoUri) {
    throw new Error(`Missing MONGODB_URI. Set it in the environment or ${options.legacyEnvPath}.`);
  }

  await mkdir(options.outDir, { recursive: true });
  const localFiles = await listLocalFiles(options.objectRoot);
  const manifest = await buildManifest({ mongoUri, dbName: options.dbName, objectRoot: options.objectRoot, localFiles });

  await writeJson(path.join(options.outDir, "manifest.json"), manifest);
  printSummary(manifest, "inventory");

  if (options.inspect && !options.download && !options.upload) {
    return;
  }

  if (options.download) {
    const downloadedManifest = await ensureCachedFiles(manifest, options.outDir);
    await writeJson(path.join(options.outDir, "manifest.json"), downloadedManifest);
    printSummary(downloadedManifest, "download");
  }

  if (options.upload) {
    const manifestPath = path.join(options.outDir, "manifest.json");
    const currentManifest = JSON.parse(await readFile(manifestPath, "utf8"));
    const uploadManifest = await ensureCachedFiles(currentManifest, options.outDir);
    const uploadedManifest = await uploadAssets(uploadManifest, options.bucket);
    await writeJson(manifestPath, uploadedManifest);
    await writeJson(path.join(options.outDir, "r2-upload-report.json"), uploadReport(uploadedManifest));
    printSummary(uploadedManifest, "upload");
  }
}

async function buildManifest({ mongoUri, dbName, objectRoot, localFiles }) {
  const assets = new Map();
  const client = new MongoClient(mongoUri);
  await client.connect();

  try {
    const db = client.db(dbName);
    const tracks = await db.collection("tracks").find({}).sort({ trackTitle: 1 }).toArray();
    const artworks = await db.collection("album_artworks").find({}).sort({ albumTitle: 1 }).toArray();
    const downloadables = await db.collection("downloadables").find({}).sort({ albumTitle: 1 }).toArray();

    for (const track of tracks) {
      const source = parseFirebaseUrl(track.firebaseURL);

      if (!source) {
        continue;
      }

      addAsset(assets, {
        key: source.key,
        kind: "track",
        sourceUrl: track.firebaseURL,
        contentType: contentTypeForKey(source.key),
        references: [{
          collection: "tracks",
          id: track._id.toString(),
          title: track.trackTitle,
        }],
      });
    }

    for (const artwork of artworks) {
      const source = parseFirebaseUrl(artwork.firebaseUrl);

      if (!source) {
        continue;
      }

      addAsset(assets, {
        key: source.key,
        kind: "album_artwork",
        sourceUrl: artwork.firebaseUrl,
        contentType: contentTypeForKey(source.key),
        references: [{
          collection: "album_artworks",
          id: artwork._id.toString(),
          albumTitle: artwork.albumTitle,
        }],
      });
    }

    for (const downloadable of downloadables) {
      for (const format of downloadable.formats ?? []) {
        const source = parseFirebaseUrl(format.formatLink);
        const key = source?.key ?? normalizeObjectKey(format.formatLink);

        if (!key) {
          continue;
        }

        addAsset(assets, {
          key,
          kind: "downloadable",
          sourceUrl: source?.url ?? null,
          contentType: contentTypeForKey(key),
          contentDisposition: `attachment; filename="${path.basename(key).replaceAll('"', "")}"`,
          references: [{
            collection: "downloadables",
            id: downloadable._id.toString(),
            albumTitle: downloadable.albumTitle,
            formatName: format.formatName,
          }],
        });
      }
    }
  } finally {
    await client.close();
  }

  for (const relativePath of localFiles.keys()) {
    if (relativePath === ".firebaserc" || relativePath === ".gitignore") {
      continue;
    }

    if (!assets.has(relativePath)) {
      addAsset(assets, {
        key: relativePath,
        kind: "local_only",
        sourceUrl: null,
        contentType: contentTypeForKey(relativePath),
        contentDisposition: isDownloadable(relativePath) ? `attachment; filename="${path.basename(relativePath).replaceAll('"', "")}"` : null,
        references: [],
      });
    }
  }

  const localLookup = localFileLookup(localFiles);
  const normalizedAssets = [];

  for (const asset of assets.values()) {
    const localPath = resolveLocalPath(asset.key, localLookup);
    normalizedAssets.push({
      ...asset,
      localPath,
      cachePath: null,
      sizeBytes: localPath ? (await stat(localPath)).size : null,
      sha256: localPath ? await sha256File(localPath) : null,
      uploaded: false,
      uploadError: null,
    });
  }

  normalizedAssets.sort((a, b) => a.key.localeCompare(b.key));

  return {
    generatedAt: new Date().toISOString(),
    objectRoot,
    assets: normalizedAssets,
  };
}

async function ensureCachedFiles(manifest, outDir) {
  const cacheRoot = path.join(outDir, "cache");

  for (const asset of manifest.assets) {
    if (asset.localPath) {
      asset.sizeBytes = asset.sizeBytes ?? (await stat(asset.localPath)).size;
      asset.sha256 = asset.sha256 ?? await sha256File(asset.localPath);
      continue;
    }

    if (!asset.sourceUrl) {
      asset.downloadError = "missing_source";
      continue;
    }

    const cachePath = path.join(cacheRoot, asset.key);
    await mkdir(path.dirname(cachePath), { recursive: true });

    if (!(await exists(cachePath))) {
      const response = await fetch(asset.sourceUrl);

      if (!response.ok) {
        asset.downloadError = `HTTP ${response.status}`;
        continue;
      }

      const buffer = Buffer.from(await response.arrayBuffer());
      await writeFile(cachePath, buffer);
    }

    asset.cachePath = cachePath;
    asset.sizeBytes = (await stat(cachePath)).size;
    asset.sha256 = await sha256File(cachePath);
    asset.downloadError = null;
  }

  return manifest;
}

async function uploadAssets(manifest, bucket) {
  for (const asset of manifest.assets) {
    const sourcePath = asset.localPath ?? asset.cachePath;

    if (!sourcePath) {
      asset.uploaded = false;
      asset.uploadError = "missing_local_or_cached_file";
      continue;
    }

    const args = [
      "wrangler",
      "r2",
      "object",
      "put",
      `${bucket}/${asset.key}`,
      "--remote",
      "--file",
      sourcePath,
      "--content-type",
      asset.contentType,
      "--cache-control",
      isDownloadable(asset.key) ? "private, max-age=0" : "public, max-age=31536000, immutable",
    ];

    if (asset.contentDisposition) {
      args.push("--content-disposition", asset.contentDisposition);
    }

    try {
      await runCommand("npx", args);
      asset.uploaded = true;
      asset.uploadError = null;
    } catch (error) {
      asset.uploaded = false;
      asset.uploadError = error instanceof Error ? error.message : String(error);
    }
  }

  return manifest;
}

function addAsset(assets, asset) {
  const existing = assets.get(asset.key);

  if (!existing) {
    assets.set(asset.key, {
      key: asset.key,
      kind: asset.kind,
      sourceUrl: asset.sourceUrl,
      contentType: asset.contentType,
      contentDisposition: asset.contentDisposition ?? null,
      references: asset.references ?? [],
    });
    return;
  }

  existing.references.push(...(asset.references ?? []));

  if (!existing.sourceUrl && asset.sourceUrl) {
    existing.sourceUrl = asset.sourceUrl;
  }

  if (existing.kind !== asset.kind) {
    existing.kind = "mixed";
  }
}

function parseFirebaseUrl(value) {
  if (typeof value !== "string" || !value.includes("firebasestorage.googleapis.com")) {
    return null;
  }

  const url = new URL(value);
  const key = decodeURIComponent(url.pathname).replace(/^\/v0\/b\/[^/]+\/o\//, "");

  return {
    url: value,
    key: normalizeObjectKey(key),
  };
}

function normalizeObjectKey(value) {
  if (typeof value !== "string") {
    return null;
  }

  const key = value.trim().replace(/^\/+/, "");

  return key.length > 0 ? key : null;
}

async function listLocalFiles(root) {
  const files = new Map();

  async function walk(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (entry.name.startsWith("._")) {
        continue;
      }

      const absolutePath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        await walk(absolutePath);
      } else if (entry.isFile()) {
        files.set(path.relative(root, absolutePath).split(path.sep).join("/"), absolutePath);
      }
    }
  }

  await walk(root);
  return files;
}

function localFileLookup(localFiles) {
  const byExact = new Map(localFiles);
  const byLowercase = new Map();

  for (const [relativePath, absolutePath] of localFiles) {
    byLowercase.set(relativePath.toLowerCase(), absolutePath);
  }

  return { byExact, byLowercase };
}

function resolveLocalPath(key, lookup) {
  return lookup.byExact.get(key) ?? lookup.byLowercase.get(key.toLowerCase()) ?? null;
}

function contentTypeForKey(key) {
  const lower = key.toLowerCase();

  if (lower.endsWith(".mp3")) {
    return "audio/mpeg";
  }

  if (lower.endsWith(".wav")) {
    return "audio/wav";
  }

  if (lower.endsWith(".png")) {
    return "image/png";
  }

  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) {
    return "image/jpeg";
  }

  if (lower.endsWith(".zip")) {
    return "application/zip";
  }

  return "application/octet-stream";
}

function isDownloadable(key) {
  return key.toLowerCase().endsWith(".zip");
}

async function sha256File(filePath) {
  const hash = createHash("sha256");
  await new Promise((resolve, reject) => {
    createReadStream(filePath)
      .on("data", (chunk) => hash.update(chunk))
      .on("error", reject)
      .on("end", resolve);
  });
  return hash.digest("hex");
}

function uploadReport(manifest) {
  return {
    generatedAt: new Date().toISOString(),
    total: manifest.assets.length,
    uploaded: manifest.assets.filter((asset) => asset.uploaded).length,
    failed: manifest.assets.filter((asset) => !asset.uploaded).length,
    failedAssets: manifest.assets
      .filter((asset) => !asset.uploaded)
      .map((asset) => ({ key: asset.key, reason: asset.uploadError ?? asset.downloadError ?? "unknown" })),
  };
}

function printSummary(manifest, phase) {
  const byKind = {};
  let local = 0;
  let needsDownload = 0;
  let missingSource = 0;
  let uploaded = 0;
  let failedUpload = 0;
  let totalBytes = 0;

  for (const asset of manifest.assets) {
    byKind[asset.kind] = (byKind[asset.kind] ?? 0) + 1;

    if (asset.localPath) {
      local += 1;
    } else if (asset.sourceUrl) {
      needsDownload += 1;
    } else {
      missingSource += 1;
    }

    if (asset.uploaded) {
      uploaded += 1;
    }

    if (asset.uploadError) {
      failedUpload += 1;
    }

    totalBytes += asset.sizeBytes ?? 0;
  }

  console.log(JSON.stringify({
    phase,
    total: manifest.assets.length,
    byKind,
    local,
    needsDownload,
    missingSource,
    uploaded,
    failedUpload,
    knownBytes: totalBytes,
  }, null, 2));
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

function stripQuotes(value) {
  return value.replace(/^['"]|['"]$/g, "");
}

async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function runCommand(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(stderr.trim() || `${command} ${args.join(" ")} exited with code ${code}`));
    });
  });
}
