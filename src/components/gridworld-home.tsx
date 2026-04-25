"use client";

import { AboutShelf } from "@/components/about-shelf";
import { AlbumShelf } from "@/components/album-shelf";
import { AudioPlayerProvider } from "@/components/audio-player-context";
import { BuyAccessButton } from "@/components/buy-access-button";
import type { AlbumSummary } from "@/lib/content";

type GridworldHomeProps = {
  albums: AlbumSummary[];
  hasAccessToken: boolean;
};

const PAID_ALBUM_ORDER = ["Gridworld", "Gridworld Instrumentals", "Windy Gridworld"];

export function GridworldHome({ albums, hasAccessToken }: GridworldHomeProps) {
  const visibleAlbums = hasAccessToken ? paidAlbums(albums) : liteAlbums(albums);

  return (
    <main className="default-home">
      <AudioPlayerProvider>
        {!hasAccessToken ? <BuyAccessButton /> : null}

        <div className={hasAccessToken ? "paid-view" : "free-view"}>
          {visibleAlbums.map((album, index) => (
            <AlbumShelf
              key={album.id}
              album={album}
              shelfcolor={albumShelfColor(album.title)}
              startExpanded={index === 0}
            />
          ))}
        </div>

        {visibleAlbums.length === 0 ? (
          <div className="catalog-empty">
            Catalog not seeded yet. Albums will appear here after the D1 catalog is available.
          </div>
        ) : null}

        <AboutShelf />
      </AudioPlayerProvider>
    </main>
  );
}

function liteAlbums(albums: AlbumSummary[]) {
  const lite = albums.find((album) => album.title === "Gridworld Lite");
  return lite ? [lite] : albums.filter((album) => !album.isPremium);
}

function paidAlbums(albums: AlbumSummary[]) {
  const byTitle = new Map(albums.map((album) => [album.title, album]));
  const ordered = PAID_ALBUM_ORDER.map((title) => byTitle.get(title)).filter(
    (album): album is AlbumSummary => Boolean(album),
  );

  return ordered.length > 0 ? ordered : albums.filter((album) => album.isPremium);
}

function albumShelfColor(title: string) {
  switch (title) {
    case "Gridworld":
      return "#85b021";
    case "Gridworld Instrumentals":
      return "#b13a4c";
    case "Windy Gridworld":
      return "#bbbcb6";
    case "Gridworld Lite":
      return "#b5b4db";
    default:
      return "slategray";
  }
}
