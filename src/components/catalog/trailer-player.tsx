"use client";

import { forwardRef, useImperativeHandle, useRef, useState } from "react";
import type { CatalogTrailer } from "@/data/apps";

type TrailerPlayerProps = {
  appName: string;
  appSlug: string;
  trailer: CatalogTrailer;
};

export type TrailerPlayerHandle = {
  pauseForDisclosure: () => void;
};

type PlaybackState = "idle" | "loading" | "playing" | "paused" | "ended" | "error";

function isPlaybackInterruption(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    error.name === "AbortError"
  );
}

function interruptedPlaybackState(video: HTMLVideoElement): PlaybackState {
  return video.currentTime > 0 ? "paused" : "idle";
}

export const TrailerPlayer = forwardRef<TrailerPlayerHandle, TrailerPlayerProps>(
  function TrailerPlayer({ appName, appSlug, trailer }, ref) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const disclosurePausedRef = useRef(false);
  const playAttemptRef = useRef(0);
  const [playbackState, setPlaybackState] = useState<PlaybackState>("idle");
  const descriptionId = `${appSlug}-trailer-description`;
  const statusId = `${appSlug}-trailer-status`;

  useImperativeHandle(
    ref,
    () => ({
      pauseForDisclosure() {
        const video = videoRef.current;

        disclosurePausedRef.current = true;
        playAttemptRef.current += 1;
        video?.pause();
        setPlaybackState((currentState) =>
          currentState === "ended" || currentState === "error" || !video
            ? currentState
            : interruptedPlaybackState(video),
        );
      },
    }),
    [],
  );

  async function playTrailer() {
    const video = videoRef.current;

    if (!video) {
      return;
    }

    disclosurePausedRef.current = false;

    if (playbackState === "ended") {
      video.currentTime = 0;
    }

    if (video.networkState === HTMLMediaElement.NETWORK_NO_SOURCE || video.error !== null) {
      video.load();
    }

    const playAttempt = playAttemptRef.current + 1;
    playAttemptRef.current = playAttempt;
    setPlaybackState("loading");

    try {
      await video.play();

      if (playAttempt === playAttemptRef.current) {
        setPlaybackState("playing");
      }
    } catch (error) {
      if (playAttempt !== playAttemptRef.current) {
        return;
      }

      setPlaybackState(
        isPlaybackInterruption(error) ? interruptedPlaybackState(video) : "error",
      );
    }
  }

  const actionLabel =
    playbackState === "error"
      ? `Retry ${appName} trailer`
      : playbackState === "paused"
      ? `Resume ${appName} trailer`
      : playbackState === "ended"
        ? `Replay ${appName} trailer`
        : `Play ${appName} trailer`;
  const showPlayAction = ["idle", "paused", "ended", "error"].includes(playbackState);

  return (
    <div className="trailer-player" data-playback-state={playbackState}>
      <video
        aria-describedby={`${descriptionId} ${statusId}`}
        aria-label={`${appName} trailer`}
        className="trailer-player__video"
        controls
        onEnded={() => {
          playAttemptRef.current += 1;
          setPlaybackState("ended");
        }}
        onError={(event) => {
          if (event.currentTarget.error) {
            playAttemptRef.current += 1;
            setPlaybackState("error");
          }
        }}
        onPause={(event) => {
          const video = event.currentTarget;

          playAttemptRef.current += 1;
          setPlaybackState((currentState) =>
            currentState === "ended" || currentState === "error"
              ? currentState
              : interruptedPlaybackState(video),
          );
        }}
        onPlaying={(event) => {
          if (!event.currentTarget.paused) {
            disclosurePausedRef.current = false;
            setPlaybackState("playing");
          }
        }}
        onWaiting={(event) => {
          if (!disclosurePausedRef.current && !event.currentTarget.paused) {
            setPlaybackState((currentState) =>
              currentState === "error" ? currentState : "loading",
            );
          }
        }}
        playsInline
        poster={trailer.poster.src}
        preload="metadata"
        ref={videoRef}
      >
        <source src={trailer.video.src} type="video/mp4" />
        <track
          default
          kind="captions"
          label="English"
          src={trailer.captionsSrc}
          srcLang="en"
        />
        Your browser does not support embedded video.
      </video>

      {showPlayAction ? (
        <button
          aria-describedby={descriptionId}
          className="trailer-player__play"
          onClick={playTrailer}
          type="button"
        >
          <span aria-hidden="true">▶</span>
          {actionLabel}
        </button>
      ) : null}

      {playbackState === "loading" ? (
        <div aria-hidden="true" className="trailer-player__loading">
          Loading trailer…
        </div>
      ) : null}

      <p className="sr-only" id={descriptionId}>
        {trailer.description}
      </p>
      <p aria-live="polite" className="trailer-player__status" id={statusId}>
        {playbackState === "error" ? (
          <>
            This trailer could not play here. <a href={trailer.video.src}>Open the video file directly.</a>
          </>
        ) : playbackState === "loading" ? (
          "Loading trailer."
        ) : playbackState === "playing" ? (
          "Trailer playing."
        ) : playbackState === "paused" ? (
          "Trailer paused."
        ) : playbackState === "ended" ? (
          "Trailer ended."
        ) : (
          "Trailer ready to play."
        )}
      </p>
    </div>
  );
});
