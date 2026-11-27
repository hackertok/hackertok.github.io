/** The message to show for a caught value; `fallback` when it isn't an Error. */
export function errorMessage(err: unknown, fallback?: string): string {
  if (err instanceof Error) return err.message;
  return fallback ?? String(err);
}

/** True for the rejection of an aborted fetch (or a dismissed share sheet). */
export function isAbortError(err: unknown): boolean {
  return err instanceof Error && err.name === 'AbortError';
}
