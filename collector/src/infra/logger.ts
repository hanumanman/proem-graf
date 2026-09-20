export interface ScopedLogger {
  log(message: string): void;
  logError(message: string, cause: unknown): void;
}

export function createLogger(scope: string): ScopedLogger {
  const prefix = `[${scope}]`;
  return {
    log(message: string): void {
      console.error(`${prefix} ${message}`);
    },
    logError(message: string, cause: unknown): void {
      console.error(`${prefix} ${message}`, cause);
    },
  };
}
