import type { CatalogAsset } from "@/data/apps";
import { getAppBySlug } from "@/data/apps";

export type DiscoveryDestinationId =
  | "fitness-app"
  | "custom-workout"
  | "discord"
  | "tiktok"
  | "youtube"
  | "x"
  | "instagram"
  | "snapchat"
  | "twitch"
  | "cash-app"
  | "playstation";

export type DiscoveryDestination = {
  action: string | null;
  category: "featured" | "social" | "support";
  description: string;
  displayValue: string;
  eyebrow: string;
  href: string | null;
  icon: CatalogAsset | null;
  id: DiscoveryDestinationId;
  mark: string;
  owner: "Fitness" | "Fawxzzy community" | "Socials OS";
  title: string;
  temporaryBridge?: {
    futureOwner: "Fitness";
    replacementContract: string;
  };
};

const fitness = getAppBySlug("fitness");

if (!fitness) {
  throw new Error("The discovery contract requires the Fitness catalog entry.");
}

export const discoveryDestinations: DiscoveryDestination[] = [
  {
    id: "fitness-app",
    category: "featured",
    eyebrow: "Train / live app",
    title: "FawxzzyFitness App",
    description:
      "Plan the work, log every set, and keep the full training history in the real Fitness product.",
    displayValue: "Live app",
    action: "Open Fitness",
    href: fitness.origin.current,
    icon: fitness.icon,
    mark: "FF",
    owner: "Fitness",
  },
  {
    id: "custom-workout",
    category: "featured",
    eyebrow: "Train / current $25 offer",
    title: "Custom Workout Setup",
    description:
      "Start a custom plan through the current secure offer while Fitness brings intake into its canonical product flow.",
    displayValue: "Personalized setup",
    action: "Start custom setup",
    href: "https://buy.stripe.com/cNi9AL4a02Qf3T4dA02cg02",
    icon: fitness.icon,
    mark: "CW",
    owner: "Fitness",
    temporaryBridge: {
      futureOwner: "Fitness",
      replacementContract:
        "Replace this external offer URL with the canonical Fitness-owned public intake route after Fitness ships and verifies it. Fawxzzy must not own intake, authentication, training data, or payment state.",
    },
  },
  {
    id: "discord",
    category: "featured",
    eyebrow: "Community / Discord",
    title: "Join the Discord",
    description: "Join the community around the builds, training, experiments, and what comes next.",
    displayValue: "Fawxzzy community",
    action: "Open Discord",
    href: "https://discord.gg/tnnV7BNJ7h",
    icon: null,
    mark: "DC",
    owner: "Fawxzzy community",
  },
  {
    id: "tiktok",
    category: "social",
    eyebrow: "Main account",
    title: "TikTok",
    description: "Fitness, tech, product proof, and the build in motion.",
    displayValue: "@fukitzzzzz",
    action: "Open TikTok",
    href: "https://www.tiktok.com/@fukitzzzzz",
    icon: null,
    mark: "TT",
    owner: "Socials OS",
  },
  {
    id: "youtube",
    category: "social",
    eyebrow: "Video",
    title: "YouTube",
    description: "Shorts, walkthroughs, trailers, and longer Foxxy stories.",
    displayValue: "@fawxzzy",
    action: "Open YouTube",
    href: "https://www.youtube.com/@fawxzzy",
    icon: null,
    mark: "YT",
    owner: "Socials OS",
  },
  {
    id: "x",
    category: "social",
    eyebrow: "Build in public",
    title: "X",
    description: "Engineering notes, product progress, and the thoughts behind the work.",
    displayValue: "@Fawxzzy",
    action: "Open X",
    href: "https://x.com/Fawxzzy",
    icon: null,
    mark: "X",
    owner: "Socials OS",
  },
  {
    id: "instagram",
    category: "social",
    eyebrow: "Photos and Reels",
    title: "Instagram",
    description: "Training, physique, personal moments, and selected project updates.",
    displayValue: "@fawx.zzy",
    action: "Open Instagram",
    href: "https://www.instagram.com/fawx.zzy/",
    icon: null,
    mark: "IG",
    owner: "Socials OS",
  },
  {
    id: "snapchat",
    category: "social",
    eyebrow: "Daily life",
    title: "Snapchat",
    description: "The less-polished day-to-day layer behind training, building, and real life.",
    displayValue: "@fawx.zzy",
    action: "Open Snapchat",
    href: "https://www.snapchat.com/add/fawx.zzy",
    icon: null,
    mark: "SC",
    owner: "Socials OS",
  },
  {
    id: "twitch",
    category: "social",
    eyebrow: "Live",
    title: "Twitch",
    description: "The live channel for future builds, games, and community sessions.",
    displayValue: "@fawxzzy",
    action: "Open Twitch",
    href: "https://www.twitch.tv/fawxzzy",
    icon: null,
    mark: "TV",
    owner: "Socials OS",
  },
  {
    id: "cash-app",
    category: "support",
    eyebrow: "Support",
    title: "Cash App",
    description: "A direct support option preserved from the former public link hub.",
    displayValue: "$fawxzzy",
    action: "Open Cash App",
    href: "https://cash.app/$fawxzzy",
    icon: null,
    mark: "$",
    owner: "Socials OS",
  },
  {
    id: "playstation",
    category: "support",
    eyebrow: "Gaming",
    title: "PlayStation",
    description:
      "Search this exact PSN online ID in PlayStation. No verified public profile URL is available.",
    displayValue: "PSN: fawxzzy",
    action: null,
    href: null,
    icon: null,
    mark: "PS",
    owner: "Socials OS",
  },
];
