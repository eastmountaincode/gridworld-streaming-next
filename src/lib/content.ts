import { getDb } from "@/lib/cloudflare";

export type AlbumSummary = {
  id: string;
  slug: string;
  title: string;
  blurbHtml: string | null;
  artworkUrl: string | null;
  isPremium: boolean;
  tracks: TrackSummary[];
  downloadable: DownloadableSummary | null;
};

export type TrackSummary = {
  id: string;
  trackNumber: number;
  title: string;
  durationSeconds: number;
  audioUrl: string;
};

export type DownloadableSummary = {
  label: string;
  description: string | null;
  formats: {
    format: string;
    url: string;
    byteSize: number | null;
  }[];
};

type AlbumRow = {
  id: string;
  slug: string;
  title: string;
  blurb_html: string | null;
  artwork_key: string | null;
  is_premium: number;
};

type TrackRow = {
  id: string;
  track_number: number;
  title: string;
  duration_seconds: number;
  audio_key: string;
};

type DownloadableRow = {
  id: string;
  label: string;
  description: string | null;
};

type DownloadableFormatRow = {
  format: string;
  object_key: string;
  byte_size: number | null;
};

export async function listAlbums(options: { includePremium: boolean }): Promise<AlbumSummary[]> {
  const db = getDb();
  const { results = [] } = await db
    .prepare(
      `SELECT id, slug, title, blurb_html, artwork_key, is_premium
       FROM albums
       WHERE is_premium = 0 OR ? = 1
       ORDER BY sort_order, title`,
    )
    .bind(options.includePremium ? 1 : 0)
    .all<AlbumRow>();

  const albums: AlbumSummary[] = [];

  for (const album of results) {
    albums.push(await hydrateAlbum(album));
  }

  return albums;
}

export async function getObjectAccessLevel(key: string): Promise<"public" | "premium" | "missing"> {
  const db = getDb();

  const row = await db
    .prepare(
      `SELECT MAX(is_premium) AS is_premium
       FROM (
         SELECT a.is_premium
         FROM albums a
         WHERE a.artwork_key = ?
         UNION ALL
         SELECT a.is_premium
         FROM tracks t
         JOIN album_tracks at ON at.track_id = t.id
         JOIN albums a ON a.id = at.album_id
         WHERE t.audio_key = ?
         UNION ALL
         SELECT a.is_premium
         FROM downloadable_formats df
         JOIN downloadables d ON d.id = df.downloadable_id
         JOIN albums a ON a.id = d.album_id
         WHERE df.object_key = ?
       )`,
    )
    .bind(key, key, key)
    .first<{ is_premium: number | null }>();

  if (!row || row.is_premium === null) {
    return "missing";
  }

  return row.is_premium === 1 ? "premium" : "public";
}

function mediaUrl(key: string) {
  return `/api/media/${key.split("/").map(encodeURIComponent).join("/")}`;
}

async function hydrateAlbum(album: AlbumRow): Promise<AlbumSummary> {
  const db = getDb();
  const { results: tracks = [] } = await db
    .prepare(
      `SELECT t.id, at.track_number, t.title, t.duration_seconds, t.audio_key
       FROM album_tracks at
       JOIN tracks t ON t.id = at.track_id
       WHERE at.album_id = ?
       ORDER BY at.track_number`,
    )
    .bind(album.id)
    .all<TrackRow>();

  const downloadable = await db
    .prepare(
      `SELECT id, label, description
       FROM downloadables
       WHERE album_id = ?`,
    )
    .bind(album.id)
    .first<DownloadableRow>();

  let downloadableSummary: DownloadableSummary | null = null;

  if (downloadable) {
    const { results: formats = [] } = await db
      .prepare(
        `SELECT format, object_key, byte_size
         FROM downloadable_formats
         WHERE downloadable_id = ?
         ORDER BY format`,
      )
      .bind(downloadable.id)
      .all<DownloadableFormatRow>();

    downloadableSummary = {
      label: downloadable.label,
      description: downloadable.description,
      formats: formats.map((format) => ({
        format: format.format,
        url: mediaUrl(format.object_key),
        byteSize: format.byte_size,
      })),
    };
  }

  return {
    id: album.id,
    slug: album.slug,
    title: album.title,
    blurbHtml: album.blurb_html,
    artworkUrl: album.artwork_key ? mediaUrl(album.artwork_key) : null,
    isPremium: album.is_premium === 1,
    tracks: tracks.map((track) => ({
      id: track.id,
      trackNumber: track.track_number,
      title: track.title,
      durationSeconds: track.duration_seconds,
      audioUrl: mediaUrl(track.audio_key),
    })),
    downloadable: downloadableSummary,
  };
}
