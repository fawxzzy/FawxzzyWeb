import type { ReactNode } from "react";

export const systemStateVariants = [
  "loading",
  "pending",
  "success",
  "empty",
  "unavailable",
  "unauthorized",
  "invalid",
  "expired",
  "recoverable-error",
  "terminal-error",
] as const;

export type SystemStateVariant = (typeof systemStateVariants)[number];

type SystemStateProps = {
  actions?: ReactNode;
  className?: string;
  compact?: boolean;
  description: ReactNode;
  details?: ReactNode;
  eyebrow?: string;
  framed?: boolean;
  headingLevel?: 1 | 2 | 3;
  title: string;
  variant: SystemStateVariant;
};

const assertiveVariants = new Set<SystemStateVariant>([
  "unauthorized",
  "invalid",
  "expired",
  "recoverable-error",
  "terminal-error",
]);

const busyVariants = new Set<SystemStateVariant>(["loading", "pending"]);

export function resolveSystemStateSemantics(variant: SystemStateVariant) {
  const assertive = assertiveVariants.has(variant);

  return {
    busy: busyVariants.has(variant),
    live: assertive ? ("assertive" as const) : ("polite" as const),
    role: assertive ? ("alert" as const) : ("status" as const),
  };
}

function variantLabel(variant: SystemStateVariant) {
  switch (variant) {
    case "recoverable-error":
      return "Try again";
    case "terminal-error":
      return "Unavailable";
    default:
      return variant.charAt(0).toUpperCase() + variant.slice(1);
  }
}

export function SystemState({
  actions,
  className,
  compact = false,
  description,
  details,
  eyebrow,
  framed = true,
  headingLevel = 2,
  title,
  variant,
}: SystemStateProps) {
  const Heading: "h1" | "h2" | "h3" =
    headingLevel === 1 ? "h1" : headingLevel === 3 ? "h3" : "h2";
  const semantics = resolveSystemStateSemantics(variant);
  const classes = [
    "system-state",
    framed ? "surface-panel" : null,
    compact ? "system-state--compact" : null,
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <section
      aria-busy={semantics.busy || undefined}
      aria-label={title}
      aria-live={semantics.live}
      aria-atomic="true"
      className={classes}
      data-system-state={variant}
      role={semantics.role}
    >
      <div className="system-state__copy">
        <p className="field-label">{eyebrow ?? variantLabel(variant)}</p>
        <Heading>{title}</Heading>
        <div className="system-state__description">{description}</div>
      </div>
      {actions ? <div className="system-state__actions">{actions}</div> : null}
      {details ? (
        <details className="system-state__details">
          <summary>Technical details</summary>
          <div>{details}</div>
        </details>
      ) : null}
    </section>
  );
}
