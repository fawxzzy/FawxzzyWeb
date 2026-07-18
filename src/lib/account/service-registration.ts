import {
  accountContract,
  isLocalAuthTestOrigin,
} from "@/config/account";

export const serviceRegistrationDispositions = [
  "unavailable",
  "not_registered",
  "active",
  "action_required",
  "unknown",
] as const;

export type ServiceRegistrationDisposition =
  (typeof serviceRegistrationDispositions)[number];
export type HumanAccountServiceId = "fitness" | "mazer";

export type HumanAccountService = {
  availability: "available";
  canonicalDestination: string;
  currentDestination: string;
  id: HumanAccountServiceId;
  name: string;
  summary: string;
};

export const humanAccountServices = [
  {
    availability: "available",
    canonicalDestination: accountContract.productOrigins.fitness,
    currentDestination: accountContract.compatibilityOrigins.fitness,
    id: "fitness",
    name: "Fawxzzy Fitness",
    summary: "Training, workouts, and the Fitness-owned account experience.",
  },
  {
    availability: "available",
    canonicalDestination: accountContract.productOrigins.mazer,
    currentDestination: accountContract.compatibilityOrigins.mazer,
    id: "mazer",
    name: "Mazer",
    summary: "The independently owned Mazer product and its account experience.",
  },
] as const satisfies readonly HumanAccountService[];

export const nonHumanAccountSurfaces = [
  {
    id: "discordos",
    name: "DiscordOS",
    reason:
      "DiscordOS is an operational coordination surface, not a human account service without a separately ratified linkage capability.",
  },
] as const;

export type ServiceRegistrationAdapter = {
  activate(input: {
    idempotencyKey: string;
    serviceId: HumanAccountServiceId;
  }): Promise<unknown>;
  read(): Promise<unknown>;
};

export type ServiceRegistrationCapability =
  | { availability: "available"; adapter: ServiceRegistrationAdapter }
  | { availability: "unavailable"; adapter: null };

export const sourceOnlyServiceRegistrationCapability = {
  availability: "unavailable",
  adapter: null,
} as const satisfies ServiceRegistrationCapability;

export type ServiceRegistrationPresentation = HumanAccountService & {
  disposition: ServiceRegistrationDisposition;
};

export type ServiceRegistrationSnapshot = {
  capability: "available" | "unavailable" | "unknown";
  services: readonly ServiceRegistrationPresentation[];
};

type ReadModelRecord = {
  disposition: Exclude<ServiceRegistrationDisposition, "unavailable" | "unknown">;
  serviceId: HumanAccountServiceId;
};

type ReadModel = {
  services: readonly ReadModelRecord[];
  status: "available";
  version: 1;
};

const observedDispositions = new Set<string>([
  "not_registered",
  "active",
  "action_required",
]);

function unresolvedSnapshot(
  capability: ServiceRegistrationSnapshot["capability"],
  disposition: "unavailable" | "unknown",
): ServiceRegistrationSnapshot {
  return {
    capability,
    services: humanAccountServices.map((service) => ({
      ...service,
      disposition,
    })),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseReadModelRecord(value: unknown): ReadModelRecord | null {
  if (!isRecord(value)) return null;
  if (value.serviceId !== "fitness" && value.serviceId !== "mazer") return null;
  if (
    typeof value.disposition !== "string" ||
    !observedDispositions.has(value.disposition)
  ) {
    return null;
  }

  return {
    disposition: value.disposition as ReadModelRecord["disposition"],
    serviceId: value.serviceId,
  };
}

export function normalizeServiceRegistrationReadModel(
  value: unknown,
): ServiceRegistrationSnapshot {
  if (value === null || value === undefined) {
    return unresolvedSnapshot("unavailable", "unavailable");
  }

  if (!isRecord(value)) return unresolvedSnapshot("unknown", "unknown");
  if (value.status === "unavailable") {
    return unresolvedSnapshot("unavailable", "unavailable");
  }
  if (
    value.status !== "available" ||
    value.version !== 1 ||
    !Array.isArray(value.services)
  ) {
    return unresolvedSnapshot("unknown", "unknown");
  }
  const serviceValues = value.services;

  return {
    capability: "available",
    services: humanAccountServices.map((service) => {
      const matchingValues = serviceValues.filter(
        (candidate) => isRecord(candidate) && candidate.serviceId === service.id,
      );
      const parsed = matchingValues.map(parseReadModelRecord);
      const record = parsed.length === 1 ? parsed[0] : null;

      return {
        ...service,
        disposition: record?.disposition ?? "unknown",
      };
    }),
  };
}

function localReadModel(disposition: string | null): ReadModel | null | unknown {
  if (disposition === "unavailable" || !disposition) return null;
  if (disposition === "unknown") return { status: "available", version: 0 };

  const normalized = disposition.replace("-", "_");
  if (!observedDispositions.has(normalized)) {
    return { status: "available", version: 1, services: "malformed" };
  }

  return {
    services: humanAccountServices.map((service) => ({
      disposition: normalized as ReadModelRecord["disposition"],
      serviceId: service.id,
    })),
    status: "available",
    version: 1,
  };
}

export function resolveServiceRegistrationPresentation(
  location: Pick<Location, "origin" | "search">,
): ServiceRegistrationSnapshot {
  if (!isLocalAuthTestOrigin(location.origin)) {
    return normalizeServiceRegistrationReadModel(null);
  }

  const scenario = new URLSearchParams(location.search).get("services_test");
  return normalizeServiceRegistrationReadModel(localReadModel(scenario));
}

export function serviceDispositionLabel(disposition: ServiceRegistrationDisposition) {
  switch (disposition) {
    case "not_registered":
      return "Not registered";
    case "active":
      return "Active";
    case "action_required":
      return "Action required";
    case "unknown":
      return "Unknown";
    default:
      return "Unavailable";
  }
}

export function serviceDispositionCopy(disposition: ServiceRegistrationDisposition) {
  switch (disposition) {
    case "not_registered":
      return "No authoritative service account has been observed for this shared identity.";
    case "active":
      return "Authoritative platform readback reports this service account as active.";
    case "action_required":
      return "Authoritative platform readback reports that this service needs a separate next step.";
    case "unknown":
      return "The capability did not provide a complete authoritative state, so this service is not treated as active.";
    default:
      return "Authoritative registration readback is not connected, so no service account is claimed.";
  }
}
