import Image from "next/image";
import Link from "next/link";
import {
  fitnessPreviewLayers,
  getFitnessPreviewStats,
  type FitnessPreviewSlot,
} from "@/data/fitness-preview-board";

type FitnessPreviewBoardProps = {
  variant?: "inline" | "page";
};

function SlotFrame({ slot }: { slot: FitnessPreviewSlot }) {
  return (
    <a
      className="group flex min-w-0 flex-col rounded-[1.35rem] border border-stroke/30 bg-card/80 p-2.5 shadow-[0_18px_44px_rgba(0,0,0,0.28)] transition hover:border-accent/45 hover:bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
      data-frame-ref={slot.frameRef}
      data-screen-key={slot.screenKey}
      href={slot.referenceHref}
      rel="noreferrer"
      target="_blank"
    >
      <div className="flex items-start justify-between gap-2 px-1 pb-2">
        <div className="min-w-0">
          <p className="truncate text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-accent">
            {slot.family}
          </p>
          <h3 className="truncate text-sm font-semibold leading-tight text-text">{slot.title}</h3>
        </div>
        <span className="shrink-0 rounded-full border border-accent/15 bg-accent/10 px-2 py-1 text-[0.66rem] font-semibold text-muted">
          {slot.layerLabel}
        </span>
      </div>

      <div className="relative isolate aspect-[9/16] overflow-hidden rounded-[1.1rem] border border-stroke/25 bg-panel-strong/75">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_8%,rgba(207,216,208,0.12),transparent_36%),linear-gradient(180deg,rgba(127,151,124,0.08),rgba(0,0,0,0.18))]" />
        {slot.imageSrc ? (
          <Image
            alt={slot.imageAlt}
            className="relative z-10 h-full w-full object-contain p-1"
            fill
            sizes="(min-width: 1280px) 20vw, (min-width: 900px) 25vw, 50vw"
            src={slot.imageSrc}
            unoptimized
          />
        ) : (
          <div className="relative z-10 flex h-full flex-col items-center justify-center gap-3 px-3 text-center">
            <div className="grid h-14 w-14 place-items-center rounded-2xl border border-dashed border-accent/35 bg-accent/10 text-2xl text-accent/90">
              +
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted">Waiting frame</p>
              <p className="mt-1 text-[0.7rem] leading-snug text-subtle">Drop in a screenshot at the path below.</p>
            </div>
          </div>
        )}
      </div>

      <div className="mt-2 min-w-0 space-y-1 px-1 pb-1 text-[0.68rem] leading-snug text-subtle">
        <p className="truncate text-muted">ref: {slot.referencePath}</p>
        <p className="break-all">asset: {slot.assetPath}</p>
        <p className="truncate">frame: {slot.frameRef}</p>
      </div>
    </a>
  );
}

export function FitnessPreviewBoard({ variant = "page" }: FitnessPreviewBoardProps) {
  const isInline = variant === "inline";
  const visibleLayers = isInline ? fitnessPreviewLayers.slice(0, 2) : fitnessPreviewLayers;
  const stats = getFitnessPreviewStats(visibleLayers);

  return (
    <section className={isInline ? "space-y-4" : "space-y-6"} aria-labelledby="fitness-preview-board-title">
      <div className="rounded-[1.75rem] border border-stroke/25 bg-panel-strong/55 p-4 shadow-[0_18px_54px_rgba(0,0,0,0.24)]">
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div className="min-w-0 space-y-2">
            <p className="eyebrow">Fitness UI reference board</p>
            <h2 id="fitness-preview-board-title" className="text-2xl font-semibold leading-none tracking-[-0.045em] text-text md:text-4xl">
              Layered screen slots
            </h2>
            <p className="max-w-3xl text-sm leading-6 text-muted">
              A single grid page for base screens, sub screens, and repeating UI variation layers. Every frame links back to the screen reference and exposes the replacement asset path.
            </p>
          </div>
          <div className="flex flex-wrap gap-2 text-[0.72rem] font-semibold text-muted">
            <span className="meta-chip">{stats.layerCount} layers</span>
            <span className="meta-chip">{stats.screenCount} screens</span>
            <span className="meta-chip">{stats.slotCount} frames</span>
            <span className="meta-chip">{stats.filledSlotCount} filled</span>
          </div>
        </div>

        {isInline ? (
          <div className="mt-4 flex flex-wrap gap-3">
            <Link className="catalog-button catalog-button--secondary" href="/apps/fitness/preview">
              Open full board
            </Link>
          </div>
        ) : null}
      </div>

      {visibleLayers.map((layer) => (
        <section className="space-y-3" key={layer.id} aria-labelledby={`${layer.id}-title`}>
          <div className="flex flex-col gap-1 px-1 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="field-label">{layer.iterationLabel}</p>
              <h3 id={`${layer.id}-title`} className="text-xl font-semibold tracking-[-0.035em] text-text">
                {layer.title}
              </h3>
            </div>
            <p className="max-w-2xl text-sm leading-6 text-muted">{layer.description}</p>
          </div>

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-4">
            {layer.slots.map((slot) => (
              <SlotFrame key={slot.id} slot={slot} />
            ))}
          </div>
        </section>
      ))}
    </section>
  );
}
