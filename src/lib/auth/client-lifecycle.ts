export type OneShotAttemptState = {
  started: boolean;
};

export type DeferredScheduler = {
  clear(handle: unknown): void;
  schedule(callback: () => void): unknown;
};

export type CooldownScheduler = {
  clear(handle: unknown): void;
  now(): number;
  schedule(callback: () => void, intervalMs: number): unknown;
};

const browserDeferredScheduler: DeferredScheduler = {
  clear(handle) {
    window.clearTimeout(handle as number);
  },
  schedule(callback) {
    return window.setTimeout(callback, 0);
  },
};

const browserCooldownScheduler: CooldownScheduler = {
  clear(handle) {
    window.clearInterval(handle as number);
  },
  now() {
    return Date.now();
  },
  schedule(callback, intervalMs) {
    return window.setInterval(callback, intervalMs);
  },
};

export function scheduleDeferredAttempt(
  state: OneShotAttemptState,
  attempt: () => void,
  scheduler: DeferredScheduler = browserDeferredScheduler,
) {
  if (state.started) return () => undefined;

  let active = true;
  const handle = scheduler.schedule(() => {
    if (!active || state.started) return;
    state.started = true;
    attempt();
  });

  return () => {
    if (!active) return;
    active = false;
    scheduler.clear(handle);
  };
}

export function scheduleCooldownTicks(
  deadline: number,
  onTick: (clock: number, expired: boolean) => void,
  scheduler: CooldownScheduler = browserCooldownScheduler,
  intervalMs = 250,
) {
  let handle: unknown | null = null;

  const stop = () => {
    if (handle === null) return;
    const current = handle;
    handle = null;
    scheduler.clear(current);
  };

  const tick = () => {
    const now = scheduler.now();
    if (now >= deadline) {
      stop();
      onTick(deadline, true);
      return;
    }
    onTick(now, false);
  };

  if (scheduler.now() >= deadline) {
    onTick(deadline, true);
    return stop;
  }

  handle = scheduler.schedule(tick, intervalMs);
  return stop;
}

/** Least time between two provider checks of a cached session. */
export const SESSION_REVALIDATE_MIN_INTERVAL_MS = 20_000;

/**
 * Admits one provider check at a time and no more often than `minIntervalMs`, so coming back to a
 * page (focus, visibility and page-restore events often fire together) costs one request, not
 * three. `begin()` returns whether the caller may start a check; call `end()` when it settles.
 */
export function createRevalidationGate(
  minIntervalMs = SESSION_REVALIDATE_MIN_INTERVAL_MS,
  now: () => number = Date.now,
) {
  let inFlight = false;
  let lastStartedAt: number | null = null;
  return {
    begin() {
      const at = now();
      if (inFlight || (lastStartedAt !== null && at - lastStartedAt < minIntervalMs)) return false;
      inFlight = true;
      lastStartedAt = at;
      return true;
    },
    end() {
      inFlight = false;
    },
  };
}
