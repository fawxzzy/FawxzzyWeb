export type CatalogAsset = {
  sha256: string;
  source: string;
  src: string;
};

export type CatalogTrailer = {
  captionsSrc: string;
  description: string;
  durationLabel: string;
  poster: CatalogAsset;
  video: CatalogAsset;
};

export type CatalogOriginContract = {
  current: string;
  plannedCanonical: string;
  preserveOnCutover: string[];
};

type Accent = {
  from: string;
  glow: string;
  panel: string;
  to: string;
};

export type CatalogApp = {
  accent: Accent;
  category: string;
  description: string;
  features: string[];
  icon: CatalogAsset;
  name: string;
  origin: CatalogOriginContract;
  slug: string;
  status: string;
  tagline: string;
  trailer: CatalogTrailer;
};

export const apps: CatalogApp[] = [
  {
    name: "Fitness",
    slug: "fitness",
    category: "Health & Fitness",
    status: "Available now",
    tagline: "Training plans, workout logging, and session history in one mobile-first shell.",
    description:
      "Fawxzzy Fitness brings planning, daily training, workout logging, and session history into one focused mobile-first experience. Build a routine, see what is due today, record a session, and return to a clear history of the work.",
    features: [
      "Plan repeatable routines around the way you actually train.",
      "Keep today’s workout and session logging close at hand.",
      "Review completed sessions and exercise history over time.",
    ],
    origin: {
      current: "https://fawxzzy-fitness-local.vercel.app",
      plannedCanonical: "https://fitness.fawxzzy.com",
      preserveOnCutover: ["https://fawxzzy-fitness-local.vercel.app"],
    },
    icon: {
      src: "/apps/fitness/icon.png",
      sha256: "5F1011EF2DB7A4725E991D5FB6347F3E589028669F74BC35F273E6E800F11F03",
      source:
        "Exact public readback of the current Fawxzzy Fitness production PWA icon at /app/icon-512.png on July 16, 2026",
    },
    accent: {
      from: "#7F977C",
      glow: "rgba(127, 151, 124, 0.2)",
      panel: "rgba(8, 14, 10, 0.92)",
      to: "#5C725D",
    },
    trailer: {
      durationLabel: "0:20",
      description:
        "A branded live production walkthrough: navigate the plan, review history, resume a session, and open the next exercise.",
      captionsSrc: "/apps/fitness/trailer-captions.vtt",
      video: {
        src: "/apps/fitness/trailer.mp4",
        sha256: "CB26D96E72C6ABCAB9A57F4C4774291E89D1DDA1C0634902F7C667F5D4EB07E5",
        source:
          "July 19, 2026 live production walkthrough using the dedicated sanitized Fitness QA account",
      },
      poster: {
        src: "/apps/fitness/trailer-poster.png",
        sha256: "391CC4B80246BA41F12CBA8D3A6FD132D4711BE8AA9F37B56911F1CA62E2E3D0",
        source: "July 19, 2026 live production walkthrough poster derivative",
      },
    },
  },
  {
    name: "Mazer",
    slug: "mazer",
    category: "Games",
    status: "Available now",
    tagline: "An atmospheric maze experience tuned for watch mode, play mode, and ambient runs.",
    description:
      "Mazer is an atmospheric maze experience built for active play and ambient watch modes. Enter a run when you want to navigate it yourself, or let the maze unfold as a calm visual experience across desktop and mobile screens.",
    features: [
      "Move through atmospheric maze runs in a focused play mode.",
      "Switch to watch mode for an ambient, hands-off experience.",
      "Carry the same visual world across desktop and mobile layouts.",
    ],
    origin: {
      current: "https://fawxzzy-mazer.vercel.app",
      plannedCanonical: "https://mazer.fawxzzy.com",
      preserveOnCutover: ["https://fawxzzy-mazer.vercel.app"],
    },
    icon: {
      src: "/apps/mazer/icon.png",
      sha256: "91764E546B8C1488B3D48BAEDA927AE18600B088178E190244FB9D8CE35E2440",
      source:
        "Exact public readback of the current Mazer production app icon at /icons/mazer-app-icon.png on July 16, 2026",
    },
    accent: {
      from: "#6C836D",
      glow: "rgba(164, 181, 163, 0.18)",
      panel: "rgba(8, 14, 10, 0.92)",
      to: "#A4B5A3",
    },
    trailer: {
      durationLabel: "0:14",
      description:
        "A branded live production walkthrough: enter the maze, move through a run, pause, and return to play.",
      captionsSrc: "/apps/mazer/trailer-captions.vtt",
      video: {
        src: "/apps/mazer/trailer.mp4",
        sha256: "0F04162F9E9C9FA8AD7203245BEAA78B4A3967D23D8E7035AA65F6949008B297",
        source:
          "July 19, 2026 live production guest walkthrough with visible keyboard and cursor interaction",
      },
      poster: {
        src: "/apps/mazer/trailer-poster.png",
        sha256: "9999A84AE09894A5900A12581A0FCBD486A852C9EE9F191052CAC09F2F9DD6A0",
        source: "July 19, 2026 live Mazer production walkthrough poster derivative",
      },
    },
  },
];

export function getAppBySlug(slug: string) {
  return apps.find((app) => app.slug === slug);
}

export function getAppDetailPath(app: Pick<CatalogApp, "slug">) {
  return `/apps/${app.slug}`;
}
