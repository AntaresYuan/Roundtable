export interface Logger {
  event(name: string, payload?: Record<string, unknown>): void;
}

export function createNoopLogger(): Logger {
  return {
    event(): void {
      // Intentionally empty for tests and local scripts that do not configure logs.
    },
  };
}
