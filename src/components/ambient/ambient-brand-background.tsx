import type { CSSProperties } from "react";

type AmbientPalette = {
  base: string;
  glow: string;
  glowStrong: string;
  wisp: string;
  particle: string;
  warm: string;
};

export type AmbientBrandBackgroundProps = {
  intensity?: "soft" | "medium" | "high" | number;
  particleCount?: number;
  palette?: Partial<AmbientPalette>;
  pulseEnabled?: boolean;
};

const DEFAULT_PALETTE: AmbientPalette = {
  base: "#080E0A",
  glow: "#8AB888",
  glowStrong: "#B8D6B5",
  wisp: "#689166",
  particle: "#D5E3D3",
  warm: "#2F281E",
};

function resolveIntensity(intensity: AmbientBrandBackgroundProps["intensity"]) {
  if (typeof intensity === "number") {
    return Math.min(Math.max(intensity, 0.45), 2.2);
  }

  switch (intensity) {
    case "soft":
      return 0.7;
    case "high":
      return 1.35;
    case "medium":
    default:
      return 1;
  }
}

function createParticles(count: number) {
  const total = Math.min(Math.max(count, 0), 28);

  return Array.from({ length: total }, (_, index) => ({
    key: `particle-${index}`,
    left: `${(index * 17) % 100}%`,
    top: `${(index * 29 + 11) % 100}%`,
    size: `${2 + ((index * 7) % 5)}px`,
    duration: `${14 + ((index * 5) % 11)}s`,
    delay: `-${(index * 1.7).toFixed(2)}s`,
    opacity: `${0.2 + ((index % 6) * 0.08)}`,
  }));
}

export function AmbientBrandBackground({
  intensity = "high",
  particleCount = 18,
  palette,
  pulseEnabled = true,
}: AmbientBrandBackgroundProps) {
  const resolvedPalette = {
    ...DEFAULT_PALETTE,
    ...palette,
  };
  const motion = resolveIntensity(intensity);
  const particles = createParticles(particleCount);

  const style = {
    "--ambient-base": resolvedPalette.base,
    "--ambient-glow": resolvedPalette.glow,
    "--ambient-glow-strong": resolvedPalette.glowStrong,
    "--ambient-wisp": resolvedPalette.wisp,
    "--ambient-particle": resolvedPalette.particle,
    "--ambient-warm": resolvedPalette.warm,
    "--ambient-intensity": String(motion),
  } as CSSProperties;

  return (
    <div
      aria-hidden="true"
      className="ambient-brand-background"
      data-brand="fawxzzy"
      data-pulse-enabled={pulseEnabled ? "true" : "false"}
      style={style}
    >
      <div className="ambient-brand-background__base" />
      <div className="ambient-brand-background__blob ambient-brand-background__blob--one" />
      <div className="ambient-brand-background__blob ambient-brand-background__blob--two" />
      <div className="ambient-brand-background__blob ambient-brand-background__blob--three" />
      <div className="ambient-brand-background__wisp ambient-brand-background__wisp--one" />
      <div className="ambient-brand-background__wisp ambient-brand-background__wisp--two" />
      <div className="ambient-brand-background__wisp ambient-brand-background__wisp--three" />
      {pulseEnabled ? <div className="ambient-brand-background__pulse" /> : null}
      <div className="ambient-brand-background__particles">
        {particles.map((particle) => (
          <span
            className="ambient-brand-background__particle"
            key={particle.key}
            style={
              {
                "--particle-left": particle.left,
                "--particle-top": particle.top,
                "--particle-size": particle.size,
                "--particle-duration": particle.duration,
                "--particle-delay": particle.delay,
                "--particle-opacity": particle.opacity,
              } as CSSProperties
            }
          />
        ))}
      </div>
    </div>
  );
}
