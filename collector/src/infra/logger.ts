export function log(message: string): void {
  console.error(message);
}

export function logError(message: string, cause: unknown): void {
  console.error(message, cause);
}
