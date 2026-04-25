"use client";

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from "react";

import type { TrackSummary } from "@/lib/content";

type ActiveAlbum = {
  artworkUrl: string | null;
  title: string;
};

type AudioPlayerContextValue = {
  activeShelfId: string | null;
  currentTime: number;
  currentTrack: TrackSummary | null;
  currentTracklist: TrackSummary[];
  isPlaying: boolean;
  pause: () => void;
  play: (
    track: TrackSummary,
    tracklist: TrackSummary[],
    shelfId: string,
    album: ActiveAlbum,
  ) => Promise<void>;
  playNextTrack: () => void;
  playPrevTrack: () => void;
  setAudioTime: (time: number) => void;
  totalDuration: number;
};

const AudioPlayerContext = createContext<AudioPlayerContextValue | null>(null);

export function AudioPlayerProvider({ children }: { children: ReactNode }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const activeAlbumRef = useRef<ActiveAlbum | null>(null);

  const [activeShelfId, setActiveShelfId] = useState<string | null>(null);
  const [currentTrack, setCurrentTrack] = useState<TrackSummary | null>(null);
  const [currentTracklist, setCurrentTracklist] = useState<TrackSummary[]>([]);
  const [currentTime, setCurrentTime] = useState(0);
  const [totalDuration, setTotalDuration] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);

  const updateMediaSession = useCallback((track: TrackSummary, album: ActiveAlbum) => {
    if (!("mediaSession" in navigator)) {
      return;
    }

    navigator.mediaSession.metadata = new MediaMetadata({
      title: track.title,
      artist: "Andrew Boylan",
      album: album.title,
      artwork: album.artworkUrl
        ? [{ src: album.artworkUrl, sizes: "512x512", type: "image/jpeg" }]
        : undefined,
    });
  }, []);

  const play = useCallback(
    async (track: TrackSummary, tracklist: TrackSummary[], shelfId: string, album: ActiveAlbum) => {
      const audio = audioRef.current;

      if (!audio) {
        return;
      }

      if (currentTrack?.id !== track.id) {
        audio.src = track.audioUrl;
        audio.load();
        setCurrentTime(0);
        setTotalDuration(track.durationSeconds);
      }

      activeAlbumRef.current = album;
      setCurrentTrack(track);
      setCurrentTracklist(tracklist);
      setActiveShelfId(shelfId);
      updateMediaSession(track, album);

      await audio.play();
      setIsPlaying(true);
    },
    [currentTrack?.id, updateMediaSession],
  );

  const pause = useCallback(() => {
    audioRef.current?.pause();
    setIsPlaying(false);
  }, []);

  const playTrackByOffset = useCallback(
    (offset: number) => {
      if (!currentTrack || currentTracklist.length === 0 || !activeShelfId || !activeAlbumRef.current) {
        return;
      }

      const currentIndex = currentTracklist.findIndex((track) => track.id === currentTrack.id);
      const nextTrack = currentTracklist[currentIndex + offset];

      if (!nextTrack) {
        if (offset > 0) {
          setIsPlaying(false);
          setCurrentTime(0);
        }
        return;
      }

      void play(nextTrack, currentTracklist, activeShelfId, activeAlbumRef.current);
    },
    [activeShelfId, currentTrack, currentTracklist, play],
  );

  const playNextTrack = useCallback(() => playTrackByOffset(1), [playTrackByOffset]);
  const playPrevTrack = useCallback(() => playTrackByOffset(-1), [playTrackByOffset]);

  const setAudioTime = useCallback((time: number) => {
    if (!audioRef.current) {
      return;
    }

    audioRef.current.currentTime = time;
    setCurrentTime(time);
  }, []);

  const value = useMemo(
    () => ({
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
    }),
    [
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
    ],
  );

  return (
    <AudioPlayerContext.Provider value={value}>
      {children}
      <audio
        ref={audioRef}
        preload="metadata"
        onDurationChange={(event) => setTotalDuration(event.currentTarget.duration || 0)}
        onEnded={playNextTrack}
        onPause={() => setIsPlaying(false)}
        onPlay={() => setIsPlaying(true)}
        onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
      />
    </AudioPlayerContext.Provider>
  );
}

export function useAudioPlayer() {
  const context = useContext(AudioPlayerContext);

  if (!context) {
    throw new Error("useAudioPlayer must be used inside AudioPlayerProvider.");
  }

  return context;
}
