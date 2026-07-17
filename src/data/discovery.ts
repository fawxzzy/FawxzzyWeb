import type { CatalogAsset } from "@/data/apps";
import { getAppBySlug } from "@/data/apps";

export type DiscoveryDestination = {
  action: string;
  description: string;
  eyebrow: string;
  href: string;
  icon: CatalogAsset | null;
  id: "fitness-app" | "custom-workout" | "discord" | "tiktok" | "youtube";
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
    eyebrow: "Train / live app",
    title: "FawxzzyFitness App",
    description:
      "Plan the work, log every set, and keep the full training history in the real Fitness product.",
    action: "Open Fitness",
    href: fitness.origin.current,
    icon: fitness.icon,
    owner: "Fitness",
  },
  {
    id: "custom-workout",
    eyebrow: "Train / current $25 offer",
    title: "Custom Workout Setup",
    description:
      "Start a custom plan through the current secure offer while Fitness brings intake into its canonical product flow.",
    action: "Start custom setup",
    href: "https://buy.stripe.com/cNi9AL4a02Qf3T4dA02cg02",
    icon: fitness.icon,
    owner: "Fitness",
    temporaryBridge: {
      futureOwner: "Fitness",
      replacementContract:
        "Replace this external offer URL with the canonical Fitness-owned public intake route after Fitness ships and verifies it. Fawxzzy must not own intake, authentication, training data, or payment state.",
    },
  },
  {
    id: "discord",
    eyebrow: "Community / Discord",
    title: "Join the Discord",
    description: "Step into the shared community for builds, training, experiments, and what comes next.",
    action: "Open Discord",
    href: "https://discord.gg/tnnV7BNJ7h",
    icon: null,
    owner: "Fawxzzy community",
  },
  {
    id: "tiktok",
    eyebrow: "Social / main account",
    title: "Fawxzzy on TikTok",
    description: "Follow the main Fitness + Tech account for product proof, training, and the build in motion.",
    action: "Open TikTok",
    href: "https://www.tiktok.com/@fukitzzzzz",
    icon: null,
    owner: "Socials OS",
  },
  {
    id: "youtube",
    eyebrow: "Watch / YouTube",
    title: "Fawxzzy on YouTube",
    description: "Keep YouTube as its own home for trailers, walkthroughs, and longer product stories.",
    action: "Open YouTube",
    href: "https://www.youtube.com/@fawxzzy",
    icon: null,
    owner: "Socials OS",
  },
];
