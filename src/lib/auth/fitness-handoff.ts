import { accountContract, accountExperienceContexts } from "@/config/account";

export type FitnessHandoffActivation = Readonly<{
  fitnessConsumerMerges: readonly [string, string, string, string, string, string, string];
  state: "active" | "inactive";
}>;

export const FITNESS_HANDOFF_READINESS_CONTRACT_VERSION =
  "fitness.auth-handoff-readiness.v1";
export const FITNESS_HANDOFF_MASTER_PROJECT_REF = "bxtcuhkotumitoqtrcej";

export const FITNESS_HANDOFF_ACTIVATION = Object.freeze({
  fitnessConsumerMerges: [
    // Reviewed Fitness main after PR256-257 (live until the PR258-266 release; the rollback after it).
    "3db7fe30cb397b83042950f3ef642c930a8e0b8b",
    // Reviewed Fitness main after PR258-266 (sign-out session revocation, Auth Surface v2 PR-A, copy and floors; reviewed, superseded before it shipped).
    "d335131a8602206c5c7702ac7fd3399c26c43f35",
    // Reviewed Fitness main after PR258-270 (adds status screens and Lane C: duration clamp, completion helper, Finish confirm; live until the PR267-278 release; the rollback after it).
    "9979e22faa639d4fb60d915e4a02fefded823dc3",
    // Reviewed Fitness main after PR267-278 (ScreenHeader lanes H0-H3, account screens on the portal with device-only sign out, Auth Surface v2 copy parity; live; the rollback after the PR279+ release).
    "b761e6527e72bbfe34386cfe49e49674610ccfec",
    // Reviewed Fitness main 1ebbd945 (live; the rollback after the PR283 release).
    "1ebbd945312b6d48bfbb46fad28c3134767b932c",
    // Reviewed Fitness main 02917bfb (PR283; live; the rollback after the PR285-287 release).
    "02917bfb0612dce212d3aa55e0f338c0b0e6d57d",
    // Reviewed Fitness main a68b9bc8 (PR285-287: data export schema and settings, P2 cleanups, QA tests; current source; 02917bfb above is the live rollback).
    "a68b9bc8456a36a3b84d16279dc08e0bdfa1ab2b",
  ],
  state: "active",
} as const satisfies FitnessHandoffActivation);

/**
 * The portal may attempt the first, credential-free handshake only from its
 * canonical origin. Fitness must still independently attest the deployed
 * source, master Auth audience, and handoff store before credentials are read.
 */
export function fitnessHandoffRuntimeReady(
  runtimeOrigin: string,
  activation: FitnessHandoffActivation = FITNESS_HANDOFF_ACTIVATION,
): boolean {
  try {
    const candidate = new URL(runtimeOrigin);
    return candidate.origin === accountContract.canonicalOrigin
      && !candidate.username && !candidate.password
      && accountExperienceContexts.fitness.consumerIntegration === "active"
      && activation.state === "active"
      && activation.fitnessConsumerMerges.length === 7
      && new Set(activation.fitnessConsumerMerges).size === 7
      && activation.fitnessConsumerMerges.every((merge) => /^[0-9a-f]{40}$/.test(merge));
  } catch {
    return false;
  }
}

export const FITNESS_HANDOFF_UNAVAILABLE = "Signed in. Could not reach Fitness.";

export class FitnessHandoffError extends Error {
  constructor() {
    super(FITNESS_HANDOFF_UNAVAILABLE);
    this.name = "FitnessHandoffError";
  }
}

const paths = new Set(["/", "/entry", "/today"]);
const origin = accountContract.productOrigins.fitness;
const timeoutMs = 10_000;
const maxTokenLength = 4 * 1024;
const maxRequestBodyBytes = 8 * 1024;
const maxResponseBodyBytes = 16 * 1024;

export function fitnessReturnPath(candidate: string): string {
  try {
    const url = new URL(candidate, origin);
    if (
      url.origin === origin && !url.username && !url.password &&
      !url.search && !url.hash && paths.has(url.pathname) &&
      !candidate.includes("\\") && !candidate.startsWith("//")
    ) return url.pathname;
  } catch { /* Use the fixed safe destination. */ }
  return "/entry";
}

type SessionPair = { accessToken: string; refreshToken: string };
type FitnessRuntimeReadiness = {
  authProjectRef: string;
  contractVersion: string;
  handoffStore: string;
  sourceCommit: string;
};
type Dependencies = {
  enabled: boolean;
  isAttemptCurrent?: () => boolean | Promise<boolean>;
  persistSession: (session: SessionPair) => Promise<void>;
  readSession: () => Promise<SessionPair | null>;
  request?: typeof fetch;
};

function exactObject(value: unknown, keys: string[]): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value) &&
    Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key)));
}

function validSessionPair(value: unknown): value is SessionPair {
  return exactObject(value, ["accessToken", "refreshToken"]) &&
    typeof value.accessToken === "string" && typeof value.refreshToken === "string" &&
    Boolean(value.accessToken.trim()) && Boolean(value.refreshToken.trim()) &&
    value.accessToken.length <= maxTokenLength && value.refreshToken.length <= maxTokenLength;
}

function validRuntimeReadiness(
  value: unknown,
  activation: FitnessHandoffActivation = FITNESS_HANDOFF_ACTIVATION,
): value is FitnessRuntimeReadiness {
  return exactObject(value, ["authProjectRef", "contractVersion", "handoffStore", "sourceCommit"])
    && value.authProjectRef === FITNESS_HANDOFF_MASTER_PROJECT_REF
    && value.contractVersion === FITNESS_HANDOFF_READINESS_CONTRACT_VERSION
    && value.handoffStore === "available"
    && typeof value.sourceCommit === "string"
    && activation.fitnessConsumerMerges.some((merge) => merge === value.sourceCommit);
}

async function bounded<T>(operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation(controller.signal),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => { controller.abort(); reject(new FitnessHandoffError()); }, timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** One attempt, fixed endpoints, no credentials or challenge IDs outside POST bodies. */
export async function completeFitnessHandoff(candidate: string, dependencies: Dependencies): Promise<string> {
  if (!dependencies.enabled) throw new FitnessHandoffError();
  const request = dependencies.request ?? fetch;
  const post = (path: string, body: object) => bounded(async (signal) => {
    const serialized = JSON.stringify(body);
    if (new TextEncoder().encode(serialized).byteLength > maxRequestBodyBytes) {
      throw new FitnessHandoffError();
    }
    const response = await request(`${origin}${path}`, {
      method: "POST", mode: "cors", credentials: "include", cache: "no-store",
      redirect: "error", referrerPolicy: "no-referrer", signal,
      headers: { "Content-Type": "application/json" }, body: serialized,
    });
    if (!response.ok || response.redirected ||
      response.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !== "application/json") {
      throw new FitnessHandoffError();
    }
    // Never include an error body, URL, or provider detail in the thrown error.
    const reader = response.body?.getReader();
    if (!reader) throw new FitnessHandoffError();
    const chunks: Uint8Array[] = [];
    let length = 0;
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        length += value.byteLength;
        if (length > maxResponseBodyBytes) throw new FitnessHandoffError();
        chunks.push(value);
      }
    } finally {
      void reader.cancel().catch(() => undefined);
      reader.releaseLock();
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  });

  try {
    const assertCurrent = async () => {
      if (dependencies.isAttemptCurrent && !await dependencies.isAttemptCurrent()) {
        throw new FitnessHandoffError();
      }
    };
    const returnTo = fitnessReturnPath(candidate);
    const started = await post("/auth/session-handoff", { returnTo });
    if (!exactObject(started, ["ok", "handoffId", "readiness", "returnTo"]) || started.ok !== true ||
      typeof started.handoffId !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(started.handoffId) ||
      !validRuntimeReadiness(started.readiness) || started.returnTo !== returnTo) {
      throw new FitnessHandoffError();
    }
    await assertCurrent();

    // Tokens stay inside this invocation; they never enter PortalSession or React state.
    const pair = await bounded(() => dependencies.readSession());
    if (!validSessionPair(pair)) throw new FitnessHandoffError();
    await assertCurrent();
    const finished = await post("/auth/session-sync", {
      handoffId: started.handoffId, accessToken: pair.accessToken, refreshToken: pair.refreshToken,
    });
    if (!exactObject(finished, ["ok", "returnTo", "session"])) throw new FitnessHandoffError();
    const rotatedSession = finished.session;
    if (finished.ok !== true || finished.returnTo !== returnTo ||
      !validSessionPair(rotatedSession)) throw new FitnessHandoffError();
    await assertCurrent();
    // Local persistence is awaited to completion rather than deadline-raced. A timed-out
    // promise must never continue later and overwrite a sign-out or newer login.
    await dependencies.persistSession(rotatedSession);
    await assertCurrent();
    return `${origin}${returnTo}`;
  } catch {
    throw new FitnessHandoffError();
  }
}
