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
  displayValue: "@fukitzzzzz",
  action: "Open TikTok",
  href: "https://www.tiktok.com/@fukitzzzzz",
  mark: "TT",
};

export const discoveryDestinations: DiscoveryDestination[] = [tiktokDestination];
