export type DiscoveryDestination = {
  action: string;
  description: string;
  displayValue: string;
  href: string;
  id: "tiktok";
  mark: string;
  title: string;
};

export const tiktokDestination: DiscoveryDestination = {
  id: "tiktok",
  title: "TikTok",
  description: "Fitness, software, product proof, and the public build in motion.",
  displayValue: "@fawxzzy",
  action: "Open TikTok",
  href: "https://www.tiktok.com/@fawxzzy",
  mark: "TT",
};

export const discoveryDestinations: DiscoveryDestination[] = [tiktokDestination];
