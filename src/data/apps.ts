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

export type CatalogScreenshot = {
  alt: string;
  height: number;
  src: string;
  width: number;
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
  screenshots: CatalogScreenshot[];
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
    screenshots: [
      {
        src: "/apps/fitness/screenshots/today-dashboard.png",
        alt: "Fawxzzy Fitness today dashboard",
        width: 430,
        height: 932,
      },
      {
        src: "/apps/fitness/screenshots/routine-planner.png",
        alt: "Fawxzzy Fitness routine planner",
        width: 430,
        height: 932,
      },
      {
        src: "/apps/fitness/screenshots/session-history.png",
        alt: "Fawxzzy Fitness session history",
        width: 430,
        height: 932,
      },
    ],
    accent: {
      from: "#7F977C",
      glow: "rgba(127, 151, 124, 0.2)",
      panel: "rgba(8, 14, 10, 0.92)",
      to: "#5C725D",
    },
    trailer: {
      durationLabel: "0:30",
      description:
        "The approved launch trailer pairs real product proof with the Fawxzzy Fitness visual system.",
      captionsSrc: "/apps/fitness/trailer-captions.vtt",
      video: {
        src: "/apps/fitness/trailer.mp4",
        sha256: "B89E8562D9FEC17A2746963187EB3EAB5B1CFF9D7AF3F3194A24F49007A627B6",
        source:
          "Socials OS FITNESS-LAUNCH-TRAILER-V1 approved public master, rendered from deterministic synthetic fixtures",
      },
      poster: {
        src: "/apps/fitness/trailer-poster.png",
        sha256: "9249FC0D44D1B026E646A8787E05C7E0E9DE581D402C3C4438757576B3F86226",
        source: "Socials OS FITNESS-LAUNCH-TRAILER-V1 deterministic cover derivative",
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
    screenshots: [
      {
        src: "/apps/mazer/screenshots/play.png",
        alt: "Mazer play mode",
        width: 1440,
        height: 1024,
      },
      {
        src: "/apps/mazer/screenshots/watch.png",
        alt: "Mazer watch mode",
        width: 1440,
        height: 1024,
      },
      {
        src: "/apps/mazer/screenshots/mobile-watch.png",
        alt: "Mazer mobile watch mode",
        width: 390,
        height: 844,
      },
    ],
    accent: {
      from: "#6C836D",
      glow: "rgba(164, 181, 163, 0.18)",
      panel: "rgba(8, 14, 10, 0.92)",
      to: "#A4B5A3",
    },
    trailer: {
      durationLabel: "0:23",
      description:
        "A Fawxzzy-owned montage turns the established Mazer catalog captures into one compact watch, play, and mobile story.",
      captionsSrc: "/apps/mazer/trailer-captions.vtt",
      video: {
        src: "/apps/mazer/trailer.mp4",
        sha256: "B2852D2E8E755D3B3FC219A906C625B10A1292A6AC42B78B3311E66B7D938AA3",
        source:
          "Fawxzzy catalog montage rendered from the existing owned Mazer watch, play, mobile, and theme captures",
      },
      poster: {
        src: "/apps/mazer/trailer-poster.png",
        sha256: "3974B6F08A19A380DD9795C7E781FDB80C45D53F60D961465E4473A4EF9B2D54",
        source:
          "Fawxzzy catalog poster rendered from the Mazer montage with the Socials OS Fawxzzy wolf master",
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
