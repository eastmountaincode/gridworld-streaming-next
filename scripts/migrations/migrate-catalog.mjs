#!/usr/bin/env node

import { MongoClient, ObjectId } from "mongodb";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";

const DEFAULT_LEGACY_ENV = path.resolve(process.cwd(), "../react_app/gridworld_streaming_10_30_2024/.env");
const DEFAULT_OUT_DIR = path.resolve(process.cwd(), "migration-output/catalog");
const DEFAULT_DB_BINDING = "DB";

const ALBUM_ORDER = new Map([
  ["Gridworld Lite", 0],
  ["Gridworld", 10],
  ["Gridworld Instrumentals", 20],
  ["Windy Gridworld", 30],
]);

const ALBUM_TRACK_AUDIO_KEY_OVERRIDES = new Map([
  [
    "Gridworld Lite",
    new Map([
      ["April 9", "audio_files/gridworld_lite/mp3_tracks/GridworldLite_April_9.mp3"],
      ["Heaven", "audio_files/gridworld_lite/mp3_tracks/GridworldLite_Heaven.mp3"],
    ]),
  ],
]);

const args = parseArgs(process.argv.slice(2));

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

async function main() {
  const options = {
    apply: Boolean(args.apply),
    remote: Boolean(args.remote),
    dbName: String(args["db-name"] ?? "main_db"),
    dbBinding: String(args.binding ?? DEFAULT_DB_BINDING),
    legacyEnvPath: path.resolve(String(args["legacy-env"] ?? DEFAULT_LEGACY_ENV)),
    outDir: path.resolve(String(args["out-dir"] ?? DEFAULT_OUT_DIR)),
  };

  const legacyEnv = await readEnvFile(options.legacyEnvPath);
  const mongoUri = String(process.env.MONGODB_URI ?? legacyEnv.MONGODB_URI ?? "");

  if (!mongoUri) {
    throw new Error(`Missing MONGODB_URI. Set it in the environment or ${options.legacyEnvPath}.`);
  }

  await mkdir(options.outDir, { recursive: true });

  const catalog = await buildCatalog({ mongoUri, dbName: options.dbName });
  const sql = catalogSql(catalog);
  const sqlPath = path.join(options.outDir, "catalog.sql");

  await writeFile(sqlPath, sql);
  await writeJson(path.join(options.outDir, "catalog.json"), catalog);

  printSummary(catalog, sqlPath);

  if (options.apply) {
    const wranglerArgs = ["wrangler", "d1", "execute", options.dbBinding, "--file", sqlPath];

    if (options.remote) {
      wranglerArgs.push("--remote");
    } else {
      wranglerArgs.push("--local");
    }

    await runCommand("npx", wranglerArgs);
  }
}

async function buildCatalog({ mongoUri, dbName }) {
  const client = new MongoClient(mongoUri);
  await client.connect();

  try {
    const db = client.db(dbName);
    const albums = await db.collection("albums").find({}).toArray();
    const tracklists = await db.collection("tracklists").find({}).toArray();
    const tracks = await db.collection("tracks").find({}).toArray();
    const artworks = await db.collection("album_artworks").find({}).toArray();
    const downloadables = await db.collection("downloadables").find({}).toArray();

    const tracklistsById = byId(tracklists);
    const tracksById = byId(tracks);
    const artworksById = byId(artworks);
    const downloadablesById = byId(downloadables);

    const normalizedAlbums = [];
    const normalizedTracks = new Map();
    const albumTracks = [];
    const normalizedDownloadables = [];
    const downloadableFormats = [];

    for (const album of albums) {
      const albumId = idString(album._id);
      const artwork = album.albumArtworkId ? artworksById.get(album.albumArtworkId) : null;
      const tracklist = album.tracklistId ? tracklistsById.get(album.tracklistId) : null;
      const downloadable = album.downloadableId ? downloadablesById.get(album.downloadableId) : null;

      normalizedAlbums.push({
        id: albumId,
        slug: slugify(album.albumTitle),
        title: album.albumTitle,
        blurbHtml: album.albumBlurb ?? null,
        artworkKey: artwork?.firebaseUrl ? objectKeyFromStorageUrl(artwork.firebaseUrl) : null,
        isPremium: Boolean(album.isPremium),
        sortOrder: ALBUM_ORDER.get(album.albumTitle) ?? 100,
      });

      for (const trackRef of tracklist?.tracks ?? []) {
        const track = tracksById.get(trackRef.trackId);

        if (!track) {
          continue;
        }

        const sourceTrackId = idString(track._id);
        const audioKey = audioKeyForAlbumTrack(album, track);
        const trackId = audioKey === objectKeyFromStorageUrl(track.firebaseURL)
          ? sourceTrackId
          : `${sourceTrackId}-${slugify(album.albumTitle)}`;

        normalizedTracks.set(trackId, {
          id: trackId,
          title: track.trackTitle,
          durationSeconds: Number(track.trackDuration ?? 0),
          audioKey,
        });
        albumTracks.push({
          albumId,
          trackId,
          trackNumber: Number(trackRef.trackNumber),
        });
      }

      if (downloadable) {
        const downloadableId = idString(downloadable._id);
        normalizedDownloadables.push({
          id: downloadableId,
          albumId,
          label: downloadable.albumTitle ?? `${album.albumTitle} downloads`,
          description: null,
        });

        for (const format of downloadable.formats ?? []) {
          const objectKey = objectKeyFromStorageUrl(format.formatLink);

          if (!objectKey) {
            continue;
          }

          downloadableFormats.push({
            id: `${downloadableId}-${slugify(format.formatName)}`,
            downloadableId,
            format: format.formatName,
            objectKey,
            byteSize: null,
          });
        }
      }
    }

    normalizedAlbums.sort((a, b) => a.sortOrder - b.sortOrder || a.title.localeCompare(b.title));
    albumTracks.sort((a, b) => a.albumId.localeCompare(b.albumId) || a.trackNumber - b.trackNumber);
    normalizedDownloadables.sort((a, b) => a.albumId.localeCompare(b.albumId));
    downloadableFormats.sort((a, b) => a.downloadableId.localeCompare(b.downloadableId) || a.format.localeCompare(b.format));

    return {
      generatedAt: new Date().toISOString(),
      albums: normalizedAlbums,
      tracks: [...normalizedTracks.values()].sort((a, b) => a.title.localeCompare(b.title)),
      albumTracks,
      downloadables: normalizedDownloadables,
      downloadableFormats,
    };
  } finally {
    await client.close();
  }
}

function audioKeyForAlbumTrack(album, track) {
  return ALBUM_TRACK_AUDIO_KEY_OVERRIDES.get(album.albumTitle)?.get(track.trackTitle)
    ?? objectKeyFromStorageUrl(track.firebaseURL);
}

function catalogSql(catalog) {
  const lines = [
    "PRAGMA foreign_keys = ON;",
    "BEGIN TRANSACTION;",
    "DELETE FROM downloadable_formats;",
    "DELETE FROM downloadables;",
    "DELETE FROM album_tracks;",
    "DELETE FROM tracks;",
    "DELETE FROM albums;",
  ];

  for (const album of catalog.albums) {
    lines.push(
      `INSERT INTO albums (id, slug, title, blurb_html, artwork_key, is_premium, sort_order) VALUES (${values([
        album.id,
        album.slug,
        album.title,
        album.blurbHtml,
        album.artworkKey,
        album.isPremium ? 1 : 0,
        album.sortOrder,
      ])});`,
    );
  }

  for (const track of catalog.tracks) {
    lines.push(
      `INSERT INTO tracks (id, title, duration_seconds, audio_key) VALUES (${values([
        track.id,
        track.title,
        track.durationSeconds,
        track.audioKey,
      ])});`,
    );
  }

  for (const albumTrack of catalog.albumTracks) {
    lines.push(
      `INSERT INTO album_tracks (album_id, track_id, track_number) VALUES (${values([
        albumTrack.albumId,
        albumTrack.trackId,
        albumTrack.trackNumber,
      ])});`,
    );
  }

  for (const downloadable of catalog.downloadables) {
    lines.push(
      `INSERT INTO downloadables (id, album_id, label, description) VALUES (${values([
        downloadable.id,
        downloadable.albumId,
        downloadable.label,
        downloadable.description,
      ])});`,
    );
  }

  for (const format of catalog.downloadableFormats) {
    lines.push(
      `INSERT INTO downloadable_formats (id, downloadable_id, format, object_key, byte_size) VALUES (${values([
        format.id,
        format.downloadableId,
        format.format,
        format.objectKey,
        format.byteSize,
      ])});`,
    );
  }

  lines.push("COMMIT;");
  lines.push("");

  return lines.join("\n");
}

function values(items) {
  return items.map(sqlValue).join(", ");
}

function sqlValue(value) {
  if (value === null || value === undefined) {
    return "NULL";
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? String(value) : "NULL";
  }

  return `'${String(value).replaceAll("'", "''")}'`;
}

function byId(items) {
  return new Map(items.map((item) => [idString(item._id), item]));
}

function idString(value) {
  if (value instanceof ObjectId) {
    return value.toHexString();
  }

  return String(value);
}

function objectKeyFromStorageUrl(value) {
  if (!value) {
    return null;
  }

  const normalized = normalizeObjectKey(value);

  if (normalized) {
    return normalized;
  }

  try {
    const url = new URL(value);
    const marker = "/o/";
    const index = url.pathname.indexOf(marker);

    if (index === -1) {
      return null;
    }

    return decodeURIComponent(url.pathname.slice(index + marker.length)).replace(/^\/+/, "");
  } catch {
    return null;
  }
}

function normalizeObjectKey(value) {
  if (!value || typeof value !== "string") {
    return null;
  }

  if (!value.startsWith("http")) {
    return value.replace(/^\/+/, "");
  }

  return null;
}

function slugify(value) {
  return String(value)
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

async function readEnvFile(filePath) {
  const env = {};

  try {
    const contents = await readFile(filePath, "utf8");

    for (const line of contents.split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);

      if (!match) {
        continue;
      }

      let value = match[2].trim();

      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }

      env[match[1]] = value;
    }
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw error;
    }
  }

  return env;
}

async function writeJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function printSummary(catalog, sqlPath) {
  console.log(`Wrote ${sqlPath}`);
  console.log(`Albums: ${catalog.albums.length}`);
  console.log(`Tracks: ${catalog.tracks.length}`);
  console.log(`Album tracks: ${catalog.albumTracks.length}`);
  console.log(`Downloadables: ${catalog.downloadables.length}`);
  console.log(`Downloadable formats: ${catalog.downloadableFormats.length}`);
}

function parseArgs(argv) {
  const parsed = {};

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (!arg.startsWith("--")) {
      continue;
    }

    const key = arg.slice(2);
    const next = argv[index + 1];

    if (!next || next.startsWith("--")) {
      parsed[key] = true;
    } else {
      parsed[key] = next;
      index += 1;
    }
  }

  return parsed;
}

function runCommand(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: "inherit",
      env: process.env,
      shell: false,
    });

    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${command} ${args.join(" ")} exited with code ${code}`));
      }
    });
  });
}
