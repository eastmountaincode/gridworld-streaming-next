import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

import { getMediaBucket } from "@/lib/cloudflare";
import { getObjectAccessLevel } from "@/lib/content";
import { getProfileByClerkId } from "@/lib/profiles";

type RouteContext = {
  params: Promise<{
    key: string[];
  }>;
};

export async function GET(request: Request, context: RouteContext) {
  const { key: parts } = await context.params;
  const key = parts.map(decodeURIComponent).join("/");
  const accessLevel = await getObjectAccessLevel(key);

  if (accessLevel === "missing") {
    return NextResponse.json({ error: "Media object is not registered." }, { status: 404 });
  }

  if (accessLevel === "premium") {
    const { userId } = await auth();
    const profile = userId ? await getProfileByClerkId(userId) : null;

    if (!profile?.has_access_token) {
      return NextResponse.json({ error: "Access token required." }, { status: 403 });
    }
  }

  const range = request.headers.get("range");
  const requestedRange = range ? parseRange(range) : undefined;

  if (process.env.NODE_ENV === "development") {
    const { localMediaResponse } = await import("@/lib/local-media");

    return localMediaResponse(key, accessLevel, requestedRange);
  }

  const object = await getMediaBucket().get(key, {
    range: requestedRange,
  });

  if (!object) {
    return NextResponse.json({ error: "Media object not found." }, { status: 404 });
  }

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  headers.set("accept-ranges", "bytes");
  headers.set("cache-control", accessLevel === "public" ? "public, max-age=3600" : "private, max-age=0");

  if (requestedRange) {
    const start = requestedRange.offset;
    const end = Math.min(object.size - 1, requestedRange.length ? start + requestedRange.length - 1 : object.size - 1);
    headers.set("content-range", `bytes ${start}-${end}/${object.size}`);
    return new Response(object.body, { status: 206, headers });
  }

  return new Response(object.body, { headers });
}

type ByteRange = { offset: number; length?: number };

function parseRange(range: string): ByteRange | undefined {
  const match = range.match(/^bytes=(\d+)-(\d+)?$/);

  if (!match) {
    return undefined;
  }

  const offset = Number(match[1]);
  const end = match[2] ? Number(match[2]) : undefined;

  if (!Number.isFinite(offset) || (end !== undefined && (!Number.isFinite(end) || end < offset))) {
    return undefined;
  }

  return {
    offset,
    length: end === undefined ? undefined : end - offset + 1,
  };
}
