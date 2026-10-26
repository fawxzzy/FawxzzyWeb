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

export type AnalyticsAggregateRow = {
  event: AnalyticsEvent;
  product: AnalyticsProduct;
  count: number;
};

/** A complete aggregate for one closed UTC window, supplied by an approved source. */
export type AnalyticsAggregateSnapshot = {
  asOf: string;
  windowStart: string;
  windowEnd: string;
  counts: readonly AnalyticsAggregateRow[];
};

type UnavailableMetric = {
  status: "unavailable";
  reason: "source_missing" | "source_stale" | "identifier_contract_unavailable" | "presence_contract_unavailable";
};

export type AnalyticsProjection = {
  source:
    | { status: "missing" }
    | { status: "stale"; asOf: string; windowStart: string; windowEnd: string }
    | { status: "fresh"; asOf: string; windowStart: string; windowEnd: string };
  pageViews:
    | UnavailableMetric
    | { status: "available"; total: number; byProduct: Record<AnalyticsProduct, number> };
  uniqueVisitors: UnavailableMetric;
  sessions: UnavailableMetric;
  activeNow: UnavailableMetric;
};

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function parseUtcTimestamp(value: unknown, field: string): number {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) {
    throw new TypeError(`${field} must be a UTC ISO timestamp`);
  }
  const time = Date.parse(value);
  const normalized = Number.isFinite(time) ? new Date(time).toISOString() : "";
  if (value !== normalized && value !== normalized.replace(".000Z", "Z")) {
    throw new TypeError(`${field} must be a valid UTC ISO timestamp`);
  }
  return time;
}

/** Pure projection. Missing or stale source never becomes a reported zero. */
export function projectAnalyticsSnapshot(
  source: unknown,
  options: { now: string; maxAgeMs: number },
): AnalyticsProjection {
  const now = parseUtcTimestamp(options.now, "now");
  if (!Number.isSafeInteger(options.maxAgeMs) || options.maxAgeMs <= 0) {
    throw new TypeError("maxAgeMs must be a positive safe integer");
  }
  const uniqueVisitors: UnavailableMetric = { status: "unavailable", reason: "identifier_contract_unavailable" };
  const sessions: UnavailableMetric = { status: "unavailable", reason: "identifier_contract_unavailable" };
  const activeNow: UnavailableMetric = { status: "unavailable", reason: "presence_contract_unavailable" };
  if (source === null || source === undefined) {
    return {
      source: { status: "missing" },
      pageViews: { status: "unavailable", reason: "source_missing" },
      uniqueVisitors, sessions, activeNow,
    };
  }
  if (!isPlainRecord(source) || !hasExactKeys(source, ["asOf", "windowStart", "windowEnd", "counts"])
      || !Array.isArray(source.counts)) {
    throw new TypeError("aggregate snapshot shape is invalid");
  }
  const asOf = parseUtcTimestamp(source.asOf, "asOf");
  const windowStart = parseUtcTimestamp(source.windowStart, "windowStart");
  const windowEnd = parseUtcTimestamp(source.windowEnd, "windowEnd");
  if (windowStart > windowEnd || windowEnd > asOf || asOf > now) {
    throw new TypeError("aggregate snapshot time order is invalid");
  }
  const byProduct: Record<AnalyticsProduct, number> = { web: 0, fitness: 0, mazer: 0 };
  const seen = new Set<string>();
  for (const row of source.counts) {
    if (!isPlainRecord(row) || !hasExactKeys(row, ["event", "product", "count"])
        || typeof row.event !== "string" || !analyticsEvents.some((event) => event === row.event)
        || typeof row.product !== "string" || !analyticsProducts.some((product) => product === row.product)
        || typeof row.count !== "number" || !Number.isSafeInteger(row.count) || row.count < 0) {
      throw new TypeError("aggregate row is invalid");
    }
    const key = `${row.event}:${row.product}`;
    if (seen.has(key)) throw new TypeError("aggregate row is duplicated");
    seen.add(key);
    if (row.event === "page_view") {
      const product = row.product as AnalyticsProduct;
      const count = row.count as number;
      if (!Number.isSafeInteger(byProduct[product] + count)) {
        throw new TypeError("page view count exceeds safe integer range");
      }
      byProduct[product] += count;
    }
  }
  const total = Object.values(byProduct).reduce((sum, count) => sum + count, 0);
  if (!Number.isSafeInteger(total)) throw new TypeError("page view total exceeds safe integer range");
  const sourceWindow = {
    asOf: source.asOf as string,
    windowStart: source.windowStart as string,
    windowEnd: source.windowEnd as string,
  };
  if (now - asOf > options.maxAgeMs) {
    return {
      source: { status: "stale", ...sourceWindow },
      pageViews: { status: "unavailable", reason: "source_stale" },
      uniqueVisitors, sessions, activeNow,
    };
  }
  return {
    source: { status: "fresh", ...sourceWindow },
    pageViews: { status: "available", total, byProduct },
    uniqueVisitors, sessions, activeNow,
  };
}
