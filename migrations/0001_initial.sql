PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS profiles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  clerk_user_id TEXT NOT NULL UNIQUE,
  legacy_user_id TEXT UNIQUE,
  email TEXT,
  has_access_token INTEGER NOT NULL DEFAULT 0 CHECK (has_access_token IN (0, 1)),
  stripe_customer_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
) STRICT;

CREATE TABLE IF NOT EXISTS albums (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  blurb_html TEXT,
  artwork_key TEXT,
  is_premium INTEGER NOT NULL DEFAULT 0 CHECK (is_premium IN (0, 1)),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
) STRICT;

CREATE TABLE IF NOT EXISTS tracks (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  duration_seconds INTEGER NOT NULL DEFAULT 0,
  audio_key TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
) STRICT;

CREATE TABLE IF NOT EXISTS album_tracks (
  album_id TEXT NOT NULL REFERENCES albums(id) ON DELETE CASCADE,
  track_id TEXT NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
  track_number INTEGER NOT NULL,
  PRIMARY KEY (album_id, track_id),
  UNIQUE (album_id, track_number)
) STRICT;

CREATE TABLE IF NOT EXISTS downloadables (
  id TEXT PRIMARY KEY,
  album_id TEXT NOT NULL UNIQUE REFERENCES albums(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  description TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
) STRICT;

CREATE TABLE IF NOT EXISTS downloadable_formats (
  id TEXT PRIMARY KEY,
  downloadable_id TEXT NOT NULL REFERENCES downloadables(id) ON DELETE CASCADE,
  format TEXT NOT NULL,
  object_key TEXT NOT NULL UNIQUE,
  byte_size INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (downloadable_id, format)
) STRICT;

CREATE TABLE IF NOT EXISTS stripe_events (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  processed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
) STRICT;

CREATE INDEX IF NOT EXISTS idx_albums_access_order ON albums(is_premium, sort_order);
CREATE INDEX IF NOT EXISTS idx_album_tracks_album_order ON album_tracks(album_id, track_number);
CREATE INDEX IF NOT EXISTS idx_profiles_clerk_user_id ON profiles(clerk_user_id);
CREATE INDEX IF NOT EXISTS idx_profiles_legacy_user_id ON profiles(legacy_user_id);
