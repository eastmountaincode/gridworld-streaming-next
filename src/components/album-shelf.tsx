"use client";

/* eslint-disable @next/next/no-img-element */

import { type CSSProperties, useMemo, useRef, useState } from "react";
import { ChevronDown, Pause, Play, SkipBack, SkipForward } from "lucide-react";

import { useAudioPlayer } from "@/components/audio-player-context";
import type { AlbumSummary, TrackSummary } from "@/lib/content";

type AlbumShelfProps = {
  album: AlbumSummary;
  shelfcolor: string;
  startExpanded?: boolean;
};

export function AlbumShelf({ album, shelfcolor, startExpanded = false }: AlbumShelfProps) {
  const [isExpanded, setIsExpanded] = useState(startExpanded);
  const sortedTracks = useMemo(
    () => album.tracks.slice().sort((a, b) => a.trackNumber - b.trackNumber),
    [album.tracks],
  );
  const { activeShelfId, isPlaying } = useAudioPlayer();
  const isActiveAndPlaying = activeShelfId === album.id && isPlaying;
  const shelfStyle = { "--shelf-color": shelfcolor } as CSSProperties;

  return (
    <div className="audio-shelf-container">
      <section className="legacy-collapse audio-shelf-collapse" style={shelfStyle}>
        <button
          type="button"
          className="legacy-collapse-header"
          aria-expanded={isExpanded}
          onClick={() => setIsExpanded((value) => !value)}
        >
          <span className="album-title-container">
            <span className="album-title">{album.title}</span>
            {isActiveAndPlaying ? (
              <img src="/images/music-0130.gif" alt="" className="album-icon" />
            ) : album.artworkUrl ? (
              <img src={album.artworkUrl} alt="Album artwork" className="album-icon" />
            ) : null}
          </span>
          <ChevronDown className={`collapse-chevron ${isExpanded ? "is-expanded" : ""}`} aria-hidden="true" />
        </button>

        <div
          className={`legacy-collapse-panel ${isExpanded ? "is-expanded" : ""}`}
          aria-hidden={!isExpanded}
          inert={isExpanded ? undefined : true}
        >
          <div className="legacy-collapse-content audio-shelf-content">
            <AudioPlayer album={album} shelfcolor={shelfcolor} sortedTracks={sortedTracks} />
            {album.downloadable ? <DownloadArea album={album} shelfcolor={shelfcolor} /> : null}
          </div>
        </div>
      </section>
    </div>
  );
}

function AudioPlayer({
  album,
  shelfcolor,
  sortedTracks,
}: {
  album: AlbumSummary;
  shelfcolor: string;
  sortedTracks: TrackSummary[];
}) {
  const {
    activeShelfId,
    currentTime,
    currentTrack,
    currentTracklist,
    isPlaying,
    pause,
    play,
    playNextTrack,
    playPrevTrack,
    setAudioTime,
    totalDuration,
  } = useAudioPlayer();
  const progressRef = useRef<HTMLDivElement | null>(null);
  const isActiveShelf = activeShelfId === album.id;
  const activeTrackIndex = currentTracklist.findIndex((track) => track.id === currentTrack?.id);
  const hasPreviousTrack = isActiveShelf && activeTrackIndex > 0;
  const hasNextTrack = isActiveShelf && activeTrackIndex >= 0 && activeTrackIndex < currentTracklist.length - 1;

  const handlePlayPause = (track: TrackSummary) => {
    if (currentTrack?.id === track.id && isPlaying) {
      pause();
      return;
    }

    void play(track, sortedTracks, album.id, {
      artworkUrl: album.artworkUrl,
      title: album.title,
    });
  };

  const handleHeaderPlayPause = () => {
    if (currentTrack && isActiveShelf) {
      if (isPlaying) {
        pause();
      } else {
        void play(currentTrack, sortedTracks, album.id, {
          artworkUrl: album.artworkUrl,
          title: album.title,
        });
      }
      return;
    }

    if (sortedTracks[0]) {
      handlePlayPause(sortedTracks[0]);
    }
  };

  const updateProgressFromPointer = (clientX: number) => {
    if (!isActiveShelf || !progressRef.current || totalDuration <= 0) {
      return;
    }

    const rect = progressRef.current.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    setAudioTime(ratio * totalDuration);
  };

  const progress = isActiveShelf && totalDuration > 0 ? (currentTime / totalDuration) * 100 : 0;

  return (
    <div className="audio-player">
      <div className="player-header">
        {album.blurbHtml ? (
          <div className="album-blurb" dangerouslySetInnerHTML={{ __html: album.blurbHtml }} />
        ) : null}
        {album.artworkUrl ? <img className="album-artwork" src={album.artworkUrl} alt="Album artwork" /> : null}

        <div className="player-header-content">
          <div className="play-button-container">
            <button
              type="button"
              className="legacy-icon-button header-play-button"
              style={{ backgroundColor: shelfcolor }}
              onClick={handleHeaderPlayPause}
              disabled={sortedTracks.length === 0}
              aria-label={isActiveShelf && isPlaying ? "Pause" : "Play"}
            >
              {isActiveShelf && isPlaying ? (
                <Pause className="player-icon pause-icon" aria-hidden="true" fill="currentColor" strokeWidth={1.8} />
              ) : (
                <Play className="player-icon play-icon" aria-hidden="true" fill="currentColor" strokeWidth={1.8} />
              )}
            </button>
          </div>
          <div className="current-track-info">
            {isActiveShelf && currentTrack ? <h4>{currentTrack.title}</h4> : null}
          </div>
        </div>
      </div>

      <div className="progress-controls-container">
        <div className="progress-bar-wrapper">
          <div className="progress-bar-container">
            <div
              ref={progressRef}
              className={`progress-bar ${isActiveShelf ? "" : "progress-bar-inactive"}`}
              onClick={(event) => updateProgressFromPointer(event.clientX)}
            >
              <div className="progress-bar-fill" style={{ width: `${progress}%`, backgroundColor: shelfcolor }} />
              <div className="progress-bar-thumb" style={{ left: `${progress}%`, backgroundColor: shelfcolor }} />
            </div>
            <div className="progress-bar-timestamps">
              <span>{formatDuration(isActiveShelf ? currentTime : 0)}</span>
              <span>{formatDuration(isActiveShelf ? totalDuration : 0)}</span>
            </div>
          </div>
        </div>
        <div className="controls">
          <button
            type="button"
            className="legacy-icon-button"
            style={{ backgroundColor: shelfcolor }}
            onClick={playPrevTrack}
            disabled={!hasPreviousTrack}
            aria-label="Previous track"
          >
            <SkipBack className="track-skip-icon" aria-hidden="true" strokeWidth={2.3} />
          </button>
          <button
            type="button"
            className="legacy-icon-button"
            style={{ backgroundColor: shelfcolor }}
            onClick={playNextTrack}
            disabled={!hasNextTrack}
            aria-label="Next track"
          >
            <SkipForward className="track-skip-icon" aria-hidden="true" strokeWidth={2.3} />
          </button>
        </div>
      </div>

      <div className="playlist">
        {sortedTracks.map((track) => {
          const isCurrentTrack = currentTrack?.id === track.id;

          return (
            <div key={track.id} className={`playlist-item ${isCurrentTrack ? "active" : ""}`}>
              <div className="playlist-item-content">
                <div className="playlist-track-start">
                  <button
                    type="button"
                    className="legacy-icon-button playlist-play-button"
                    style={{ backgroundColor: shelfcolor }}
                    onClick={() => handlePlayPause(track)}
                    aria-label={isCurrentTrack && isPlaying ? "Pause track" : "Play track"}
                  >
                    {isCurrentTrack && isPlaying ? (
                      <Pause
                        className="player-icon pause-icon"
                        aria-hidden="true"
                        fill="currentColor"
                        strokeWidth={1.8}
                      />
                    ) : (
                      <Play
                        className="player-icon play-icon"
                        aria-hidden="true"
                        fill="currentColor"
                        strokeWidth={1.8}
                      />
                    )}
                  </button>
                  <span className="track-number">{track.trackNumber}</span>
                </div>
                <span className="track-title">{track.title}</span>
                <span className="track-duration">{formatDuration(track.durationSeconds)}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function DownloadArea({ album, shelfcolor }: { album: AlbumSummary; shelfcolor: string }) {
  if (!album.downloadable) {
    return null;
  }

  return (
    <div className="download-area">
      <p>{album.downloadable.label}</p>
      {album.downloadable.description ? <span>{album.downloadable.description}</span> : null}
      <div className="download-format-list">
        {album.downloadable.formats.map((format) => (
          <a key={format.format} href={format.url} style={{ backgroundColor: shelfcolor }}>
            {format.format}
          </a>
        ))}
      </div>
    </div>
  );
}

function formatDuration(seconds: number) {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return "0:00";
  }

  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.floor(seconds % 60);
  return `${minutes}:${remainingSeconds.toString().padStart(2, "0")}`;
}
