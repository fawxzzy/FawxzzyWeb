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
      durationLabel: "1:00",
      description:
        "A 60-second branded live walkthrough: review today's plan, inspect exercise detail, move through routines and history, then return to the next training step.",
      captionsSrc: "/apps/fitness/trailer-captions.vtt",
      video: {
        src: "/apps/fitness/trailer.mp4",
        sha256: "31747F9B62A7D55E549FE0B15F8AE56840FBE172D0871027366097EED8AF982E",
        source:
          "July 20, 2026 60-second live production walkthrough using the dedicated sanitized Fitness QA account",
      },
      poster: {
        src: "/apps/fitness/trailer-poster.png",
        sha256: "D2228EDB36BBDA1EB1D32EA1EF8D643E1C18CEE5C7600CEC3D9B21E308223FDC",
        source: "July 20, 2026 60-second live production walkthrough poster derivative",
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
      durationLabel: "1:00",
      description:
        "A 60-second branded live walkthrough: enter the maze, make deliberate moves through a run, pause for the player guide, and return to play.",
      captionsSrc: "/apps/mazer/trailer-captions.vtt",
      video: {
        src: "/apps/mazer/trailer.mp4",
        sha256: "711A5ED95B3527648F69BCF0A0E69761B4B84D87CE1C919FF34C88D880E28623",
        source:
          "July 20, 2026 60-second live production guest walkthrough with visible keyboard and cursor interaction",
      },
      poster: {
        src: "/apps/mazer/trailer-poster.png",
        sha256: "EB092F948FA617C8906BBF59795CD17FC9839CF873A440B8589E3223CAC8FD5F",
        source: "July 20, 2026 60-second live Mazer production walkthrough poster derivative",
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
