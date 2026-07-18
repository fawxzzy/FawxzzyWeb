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
