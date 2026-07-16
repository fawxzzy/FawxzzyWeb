export type CatalogActionLabel = "Open app";

export type CatalogAsset = {
  src: string;
  source: string;
};

export type CatalogScreenshot = {
  alt: string;
  caption: string;
  src: string;
  source: string;
};

type Accent = {
  from: string;
  glow: string;
  panel: string;
  to: string;
};

export type CatalogApp = {
  name: string;
  slug: string;
  tagline: string;
  liveUrl: string;
  installUrl: string | null;
  icon: CatalogAsset;
  tags: string[];
  accent: Accent;
  screenshots: CatalogScreenshot[];
};

export const apps: CatalogApp[] = [
  {
    name: "Fitness",
    slug: "fitness",
    tagline: "Training plans, workout logging, and session history in one mobile-first shell.",
    liveUrl: "https://fawxzzy-fitness-local.vercel.app",
    installUrl: "https://fawxzzy-fitness-local.vercel.app",
    icon: {
      src: "/apps/fitness/icon-192.png",
      source: "Vendored copy of fawxzzy-fitness public/app/icon-192.png stored in FawxzzyWeb catalog assets",
    },
    tags: ["PWA", "Workouts", "History"],
    accent: {
      from: "#7F977C",
      glow: "rgba(127, 151, 124, 0.2)",
      panel: "rgba(8, 14, 10, 0.92)",
      to: "#5C725D",
    },
    screenshots: [
      {
        alt: "Fitness today dashboard",
        caption: "Today dashboard",
        src: "/apps/fitness/screenshots/today-dashboard.png",
        source:
          "Authenticated local capture from http://127.0.0.1:3010/today using existing Fitness runtime session data on April 24, 2026",
      },
      {
        alt: "Fitness session history",
        caption: "Session history",
        src: "/apps/fitness/screenshots/session-history.png",
        source:
          "Authenticated local capture from http://127.0.0.1:3010/history using existing Fitness runtime session data on April 24, 2026",
      },
      {
        alt: "Fitness routine planner",
        caption: "Routine planner",
        src: "/apps/fitness/screenshots/routine-planner.png",
        source:
          "Authenticated local capture from http://127.0.0.1:3010/routines using existing Fitness runtime session data on April 24, 2026",
      },
      {
        alt: "Fitness exercise history",
        caption: "Exercise history",
        src: "/apps/fitness/screenshots/exercise-history.png",
        source:
          "Authenticated local capture from http://127.0.0.1:3010/exercises using existing Fitness runtime session data on April 24, 2026",
      },
    ],
  },
  {
    name: "Mazer",
    slug: "mazer",
    tagline: "An atmospheric maze experience tuned for watch mode, play mode, and installable ambient play.",
    liveUrl: "https://fawxzzy-mazer.vercel.app",
    installUrl: "https://fawxzzy-mazer.vercel.app",
    icon: {
      src: "/apps/mazer/icon.svg",
      source: "Vendored copy of fawxzzy-mazer public/icons/mazer-emblem.svg stored in FawxzzyWeb catalog assets",
    },
    tags: ["Game", "Installable", "Ambient"],
    accent: {
      from: "#6C836D",
      glow: "rgba(164, 181, 163, 0.18)",
      panel: "rgba(8, 14, 10, 0.92)",
      to: "#A4B5A3",
    },
    screenshots: [
      {
        alt: "Mazer core watch mode",
        caption: "Core watch mode",
        src: "/apps/mazer/screenshots/core-watch.png",
        source:
          "Repo-owned Edge live capture from http://127.0.0.1:4173/?content=core-only via the core-only-watch run on April 24, 2026",
      },
      {
        alt: "Mazer mobile watch shell",
        caption: "Mobile watch shell",
        src: "/apps/mazer/screenshots/mobile-watch.png",
        source:
          "Repo-owned Edge live capture from http://127.0.0.1:4173/?content=core-only via the phone-portrait core-only-watch run on April 24, 2026",
      },
      {
        alt: "Mazer Watch Pass preview shell",
        caption: "Watch Pass preview",
        src: "/apps/mazer/screenshots/watch-pass-preview.png",
        source: "Repo-owned Edge live capture from the local watch-pass-preview shell on April 24, 2026",
      },
      {
        alt: "Mazer Watch Pass setup shell",
        caption: "Watch Pass setup",
        src: "/apps/mazer/screenshots/watch-pass-setup.png",
        source: "Repo-owned Edge live capture from the local watch-pass-setup shell on April 24, 2026",
      },
    ],
  },
];

export function getAppBySlug(slug: string) {
  return apps.find((app) => app.slug === slug);
}
