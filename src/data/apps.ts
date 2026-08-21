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

export type CatalogDetailMedia = CatalogAsset & {
  alt: string;
  caption: string;
  height: number;
  width: number;
};

export type CatalogProductStory = {
  description: string;
  eyebrow: string;
  id: string;
  media: CatalogDetailMedia[];
  points?: string[];
  title: string;
};

export type CatalogPlannedDirection = CatalogProductStory & {
  statusLabel: string;
};

export type CatalogAppDetail = {
  headline: string;
  plannedDirection?: CatalogPlannedDirection;
  statusSummary: string;
  stories: CatalogProductStory[];
};

export type CatalogDisplayAssets = {
  icon: CatalogAsset;
  poster: CatalogAsset;
};

export type CatalogApp = {
  accent: Accent;
  category: string;
  description: string;
  detail: CatalogAppDetail;
  display: CatalogDisplayAssets;
  icon: CatalogAsset;
  latestUpdate: string;
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
    tagline: "Plan workouts, log sessions, and see your progress.",
    description:
      "Build a routine, train from today's plan, log the session, and keep your history close.",
    detail: {
      headline: "Plan the work. Log the session. See the progress.",
      stories: [
        {
          id: "today",
          eyebrow: "Your training day",
          title: "Know what you are doing when you arrive.",
          description:
            "Today brings the active routine, exercise order, training details, and next action into one calm view.",
          media: [
            {
              src: "/apps/fitness/detail/today.webp",
              width: 430,
              height: 932,
              alt: "Fitness Today screen showing a lower-body workout and Start action",
              caption: "Current app · Today",
              sha256: "996781D14AD85EDA0B94C0A38D931044B33CAAF4957C854183DF20A6F70F7422",
              source:
                "Responsive WebP derivative of the tracked Fitness today.png preview fixture at source commit 223982fb7ef93e760d7b0845378f5b05e196456b",
            },
          ],
        },
        {
          id: "session",
          eyebrow: "Inside the workout",
          title: "Log the set without losing the session.",
          description:
            "Exercises, targets, completed work, the session timer, and the finish action stay together while you train.",
          media: [
            {
              src: "/apps/fitness/detail/session.webp",
              width: 430,
              height: 932,
              alt: "Fitness active session screen with exercises, set logging, timer, and Finish action",
              caption: "Current app · Active session",
              sha256: "96DCD09FAB065E9342C7EBB134DCA504F40AB11A50D48AAE033F60121604A332",
              source:
                "Responsive WebP derivative of the tracked Fitness session.png preview fixture at source commit 223982fb7ef93e760d7b0845378f5b05e196456b",
            },
          ],
        },
        {
          id: "routine-history",
          eyebrow: "The longer view",
          title: "Shape the week. Read the work back.",
          description:
            "Routine structure keeps training days understandable, while history turns completed sessions into a useful record.",
          media: [
            {
              src: "/apps/fitness/detail/routines.webp",
              width: 430,
              height: 932,
              alt: "Fitness routine screen showing training and recovery days",
              caption: "Current app · Routine",
              sha256: "A348559817BD0808103DF12F95CEA1E4A62010F25E6BBA8DD6BAAC50E9B0DEBC",
              source:
                "Responsive WebP derivative of the tracked Fitness routines.png preview fixture at source commit 223982fb7ef93e760d7b0845378f5b05e196456b",
            },
            {
              src: "/apps/fitness/detail/history.webp",
              width: 430,
              height: 932,
              alt: "Fitness history screen summarizing three completed sessions",
              caption: "Current app · History",
              sha256: "174DE3AEE192F56B85F0028952E7708ED417ADEF4EA669AA94B5110483AF728F",
              source:
                "Responsive WebP derivative of the tracked Fitness history.png preview fixture at source commit 223982fb7ef93e760d7b0845378f5b05e196456b",
            },
          ],
        },
      ],
      statusSummary:
        "Available now at its current product home. Fawxzzy opens Fitness there without copying training data into this site.",
    },
    origin: {
      current: "https://fitness.fawxzzy.com",
      plannedCanonical: "https://fitness.fawxzzy.com",
      preserveOnCutover: ["https://fawxzzy-fitness-local.vercel.app"],
    },
    icon: {
      src: "/apps/fitness/icon.png",
      sha256: "5F1011EF2DB7A4725E991D5FB6347F3E589028669F74BC35F273E6E800F11F03",
      source:
        "Exact public readback of the current Fawxzzy Fitness production PWA icon at /app/icon-512.png on July 16, 2026",
    },
    display: {
      icon: {
        src: "/apps/fitness/storefront-icon.webp",
        sha256: "68EA981E132B52B38A8CF56A9C931361881A52B19CB302EEDC7502448F82A23E",
        source: "Responsive WebP derivative of the canonical Fitness icon for storefront display",
      },
      poster: {
        src: "/apps/fitness/storefront-poster.webp",
        sha256: "E12316F496C1216D0EF564DECC1CDCB0DA64403FDD057F002F1347C5EFECF225",
        source: "Responsive WebP derivative of the grounded Fitness walkthrough poster",
      },
    },
    latestUpdate: "New 60-second live product walkthrough",
    accent: {
      from: "#9BAF61",
      glow: "rgba(155, 175, 97, 0.2)",
      panel: "rgba(12, 16, 8, 0.92)",
      to: "#C4D37A",
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
    tagline: "Play an atmospheric maze or watch it unfold.",
    description:
      "Take control of a maze run, or switch to watch mode and let the atmosphere carry the screen.",
    detail: {
      headline: "Play the maze—or let it run.",
      stories: [
        {
          id: "current-play",
          eyebrow: "Playable now",
          title: "The maze stays at the center.",
          description:
            "The current game keeps the route, player position, score, rank, pause action, and movement control in one focused play surface.",
          media: [
            {
              src: "/apps/mazer/detail/current-play.webp",
              width: 444,
              height: 460,
              alt: "Current Mazer play screen with maze, score, rank, pause, and movement control",
              caption: "Current app · Play",
              sha256: "4C7C07D4BD4126C9A541F93B54D7A203291BB08FB497B03C2F013DB66268935A",
              source:
                "Purpose-built crop of the implemented Mazer current-core-runtime catalog captured at source commit 462030ac942e4ffecd442fe0ceeb22584dcda931",
            },
          ],
        },
        {
          id: "current-control",
          eyebrow: "Ways to enter",
          title: "Start simply. Tune only when you want to.",
          description:
            "The current menu keeps the decision short, while Options exposes the player guide and visual or control preferences without crowding the maze.",
          media: [
            {
              src: "/apps/mazer/detail/current-menu.webp",
              width: 444,
              height: 460,
              alt: "Current Mazer guest menu with maze preview and Login action",
              caption: "Current app · Guest menu",
              sha256: "9F484AF9301A942919DDA345A2B9AA8E59FEFA02F8821939FE3FDADE94DC912B",
              source:
                "Purpose-built crop of the implemented Mazer current-core-runtime catalog captured at source commit 462030ac942e4ffecd442fe0ceeb22584dcda931",
            },
            {
              src: "/apps/mazer/detail/current-options.webp",
              width: 444,
              height: 460,
              alt: "Current Mazer Options screen with player guide and display preferences",
              caption: "Current app · Options",
              sha256: "A553CF8D530029205F17C12C8E7A24E8ADB6DED2258BA7379729FFA9869887CD",
              source:
                "Purpose-built crop of the implemented Mazer current-core-runtime catalog captured at source commit 462030ac942e4ffecd442fe0ceeb22584dcda931",
            },
          ],
        },
      ],
      plannedDirection: {
        id: "precision-arcade",
        eyebrow: "Upcoming direction",
        statusLabel: "Preview · In development",
        title: "Precision Arcade is the planned visual language.",
        description:
          "This is a design direction—not the current game. It keeps maze play direct while exploring clearer topology, stronger score hierarchy, modern controls, and tighter feedback.",
        points: [
          "Retro arcade directness with modern clarity",
          "The maze and player state remain the visual priority",
          "Color communicates energy, information, reward, and danger",
        ],
        media: [
          {
            src: "/apps/mazer/detail/planned-precision-arcade.webp",
            width: 870,
            height: 578,
            alt: "Planned Mazer Precision Arcade concept board with topology, gameplay, and interface studies",
            caption: "Planned concept · Not current gameplay",
            sha256: "EBDA0E36667ADE6EB7217ADF48C0E3D93643F98C720082FD621CCE4D9D2D726A",
            source:
              "Purpose-built crop of the planned Precision Arcade direction catalog governed by visual-direction.md and explicitly not implemented",
          },
        ],
      },
      statusSummary:
        "Available now at its current product home. Fawxzzy opens Mazer there without copying game state into this site.",
    },
    origin: {
      current: "https://mazer.fawxzzy.com",
      plannedCanonical: "https://mazer.fawxzzy.com",
      preserveOnCutover: ["https://fawxzzy-mazer.vercel.app"],
    },
    icon: {
      src: "/apps/mazer/icon.png",
      sha256: "91764E546B8C1488B3D48BAEDA927AE18600B088178E190244FB9D8CE35E2440",
      source:
        "Exact public readback of the current Mazer production app icon at /icons/mazer-app-icon.png on July 16, 2026",
    },
    display: {
      icon: {
        src: "/apps/mazer/storefront-icon.webp",
        sha256: "D369527A7CF096CC16DC701EF8986B70875A78EFF17A3E5016D27E0BEEC00826",
        source: "Responsive WebP derivative of the canonical Mazer icon for storefront display",
      },
      poster: {
        src: "/apps/mazer/storefront-poster.webp",
        sha256: "45AAF61D982F7FE144E021C958ECB40A5F98E5A97B2CD6D10D36C2CD389D40AC",
        source:
          "Responsive WebP derivative of the current Mazer production installed-app view captured from https://mazer.fawxzzy.com on August 21, 2026",
      },
    },
    latestUpdate: "New 60-second live product walkthrough",
    accent: {
      from: "#4A99A8",
      glow: "rgba(74, 153, 168, 0.2)",
      panel: "rgba(6, 15, 18, 0.92)",
      to: "#82D5DC",
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
