export const analyticsEvents = [
  "page_view",
  "tiktok_open",
  "catalog_app_view",
  "app_launch",
  "compatibility_visit",
] as const;

export const compatibilitySources = [
  "discover",
  "trove",
  "fitness_legacy_origin",
  "mazer_legacy_origin",
] as const;
export const analyticsApps = ["fitness", "mazer"] as const;
export const analyticsProducts = ["web", "fitness", "mazer"] as const;

export type AnalyticsEvent = (typeof analyticsEvents)[number];
export type AnalyticsApp = (typeof analyticsApps)[number];
export type AnalyticsProduct = (typeof analyticsProducts)[number];
export type CompatibilitySource = (typeof compatibilitySources)[number];

export type AnalyticsEnvelope = {
  app?: AnalyticsApp;
  compatibility?: CompatibilitySource;
  event: AnalyticsEvent;
  product: AnalyticsProduct;
  route: string;
};

const allowedRoutes = new Set(["/", "/apps"]);
const retiredDetailRoutes = new Set(["/apps/fitness", "/apps/mazer"]);

export function normalizeAnalyticsRoute(pathname: string) {
  if (allowedRoutes.has(pathname)) return pathname;
  if (retiredDetailRoutes.has(pathname)) return "/apps";
  return "/";
}

export function parseCompatibilitySource(value: string | null): CompatibilitySource | undefined {
  return compatibilitySources.find((candidate) => candidate === value);
}

export function parseAnalyticsApp(value: string | null): AnalyticsApp | undefined {
  return analyticsApps.find((candidate) => candidate === value);
}

export function isAnalyticsEvent(value: string | null): value is AnalyticsEvent {
  return analyticsEvents.some((candidate) => candidate === value);
}
