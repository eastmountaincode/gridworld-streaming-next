import { readFile, stat } from "node:fs/promises";
import path from "node:path";

type ByteRange = { offset: number; length?: number };

type AccessLevel = "public" | "premium";

const LOCAL_OBJECT_ROOT = path.join(
  /*turbopackIgnore: true*/ process.cwd(),
  "..",
  "object_storage_files",
);
const LOCAL_MEDIA_CACHE_ROOT = path.join(
  /*turbopackIgnore: true*/ process.cwd(),
  "migration-output",
  "media",
  "cache",
);

export async function localMediaResponse(
  key: string,
  accessLevel: AccessLevel,
  requestedRange?: ByteRange,
) {
  const localPath = await findLocalMediaPath(key);

  if (!localPath) {
    return Response.json({ error: "Local media object not found." }, { status: 404 });
  }

  const file = await stat(localPath);
  const start = requestedRange?.offset ?? 0;
  const end = requestedRange?.length ? Math.min(file.size - 1, start + requestedRange.length - 1) : file.size - 1;
  const bytes = await readFile(localPath);
  const body = requestedRange ? bytes.subarray(start, end + 1) : bytes;
  const headers = new Headers({
    "accept-ranges": "bytes",
    "cache-control": accessLevel === "public" ? "public, max-age=3600" : "private, max-age=0",
    "content-length": String(body.byteLength),
    "content-type": contentTypeForKey(key),
  });

  if (requestedRange) {
    headers.set("content-range", `bytes ${start}-${end}/${file.size}`);
  }

  return new Response(body, { status: requestedRange ? 206 : 200, headers });
}

async function findLocalMediaPath(key: string) {
  const candidates = [path.resolve(LOCAL_OBJECT_ROOT, key), path.resolve(LOCAL_MEDIA_CACHE_ROOT, key)];

  for (const candidate of candidates) {
    try {
      const file = await stat(candidate);

      if (file.isFile()) {
        return candidate;
      }
    } catch {
      // Try the next local media root.
    }
  }

  return null;
}

function contentTypeForKey(key: string) {
  const extension = path.extname(key).toLowerCase();

  switch (extension) {
    case ".gif":
      return "image/gif";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".mp3":
      return "audio/mpeg";
    case ".png":
      return "image/png";
    case ".wav":
      return "audio/wav";
    case ".zip":
      return "application/zip";
    default:
      return "application/octet-stream";
  }
}
