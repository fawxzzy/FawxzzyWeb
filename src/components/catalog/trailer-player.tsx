import type { CatalogTrailer } from "@/data/apps";

type TrailerPlayerProps = {
  appName: string;
  trailer: CatalogTrailer;
};

export function TrailerPlayer({ appName, trailer }: TrailerPlayerProps) {
  const descriptionId = `${appName.toLowerCase()}-trailer-description`;

  return (
    <section className="trailer-card" id={`${appName.toLowerCase()}-trailer`}>
      <div className="trailer-card__copy">
        <p className="field-label">Trailer / {trailer.durationLabel}</p>
        <h3>See {appName} in motion.</h3>
        <p id={descriptionId}>{trailer.description}</p>
      </div>

      <div className="trailer-card__player-shell">
        <video
          aria-describedby={descriptionId}
          aria-label={`${appName} trailer`}
          className="trailer-card__player"
          controls
          playsInline
          poster={trailer.poster.src}
          preload="none"
        >
          <source src={trailer.video.src} type="video/mp4" />
          <track
            default
            kind="captions"
            label="English"
            src={trailer.captionsSrc}
            srcLang="en"
          />
          Your browser does not support embedded video. You can open the trailer directly at{" "}
          <a href={trailer.video.src}>{trailer.video.src}</a>.
        </video>
      </div>
    </section>
  );
}
