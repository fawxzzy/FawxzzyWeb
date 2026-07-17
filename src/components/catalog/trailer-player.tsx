"use client";

import { useRef, useState } from "react";
import type { CatalogTrailer } from "@/data/apps";

type TrailerPlayerProps = {
  appName: string;
  appSlug: string;
  trailer: CatalogTrailer;
};

type PlaybackState = "idle" | "loading" | "playing" | "paused" | "ended" | "error";

export function TrailerPlayer({ appName, appSlug, trailer }: TrailerPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playbackState, setPlaybackState] = useState<PlaybackState>("idle");
  const descriptionId = `${appSlug}-trailer-description`;
  const statusId = `${appSlug}-trailer-status`;

  async function playTrailer() {
    const video = videoRef.current;

    if (!video) {
      return;
    }

    if (playbackState === "ended") {
      video.currentTime = 0;
    }

    if (
      video.networkState === HTMLMediaElement.NETWORK_NO_SOURCE &&
      video.error === null
    ) {
      video.load();
    }

    setPlaybackState("loading");

    try {
      await video.play();
    } catch {
      setPlaybackState("error");
    }
  }

  const actionLabel =
    playbackState === "paused"
      ? `Resume ${appName} trailer`
      : playbackState === "ended"
        ? `Replay ${appName} trailer`
        : `Play ${appName} trailer`;
  const showPlayAction = ["idle", "paused", "ended"].includes(playbackState);

  return (
    <div className="trailer-player" data-playback-state={playbackState}>
      <video
        aria-describedby={`${descriptionId} ${statusId}`}
        aria-label={`${appName} trailer`}
        className="trailer-player__video"
        controls
        onEnded={() => setPlaybackState("ended")}
        onError={(event) => {
          if (event.currentTarget.error) {
            setPlaybackState("error");
          }
        }}
        onPause={() => {
          if (playbackState === "playing") {
            setPlaybackState("paused");
          }
        }}
        onPlaying={() => setPlaybackState("playing")}
        onWaiting={() => setPlaybackState("loading")}
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
}
