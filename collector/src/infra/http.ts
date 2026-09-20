export interface RetryOptions {
  timeoutMs: number;
  maxRetries: number;
  baseDelayMs: number;
}

export const DEFAULT_RETRY_OPTIONS: RetryOptions = {
  timeoutMs: 30_000,
  maxRetries: 3,
  baseDelayMs: 500,
};

function isRetryableStatus(status: number): boolean {
  return status === 429 || status === 408 || status >= 500;
}

function retryDelayMs(
  response: Response,
  attempt: number,
  baseDelayMs: number,
): number {
  const retryAfterSeconds = Number(response.headers.get("retry-after"));
  if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds >= 0) {
    return retryAfterSeconds * 1000;
  }
  return baseDelayMs * 2 ** attempt + Math.random() * 200;
}

function backoffDelayMs(attempt: number, baseDelayMs: number): number {
  return baseDelayMs * 2 ** attempt + Math.random() * 200;
}

export async function requestWithRetry(
  url: string,
  init: RequestInit,
  context: string,
  options: Partial<RetryOptions> = {},
): Promise<Response> {
  const { timeoutMs, maxRetries, baseDelayMs } = {
    ...DEFAULT_RETRY_OPTIONS,
    ...options,
  };
  for (let attempt = 0; ; attempt += 1) {
    let response: Response;
    try {
      response = await fetch(url, {
        ...init,
        signal: init.signal ?? AbortSignal.timeout(timeoutMs),
      });
    } catch (cause) {
      if (attempt >= maxRetries) {
        throw new Error(`${context} network failed after ${attempt + 1} attempts`, {
          cause,
        });
      }
      await Bun.sleep(backoffDelayMs(attempt, baseDelayMs));
      continue;
    }
    if (response.ok) return response;
    const body = await response.text().catch(() => "");
    const snippet = body.slice(0, 500);
    if (!isRetryableStatus(response.status) || attempt >= maxRetries) {
      throw new Error(`${context} failed: HTTP ${response.status} ${snippet}`);
    }
    await Bun.sleep(retryDelayMs(response, attempt, baseDelayMs));
  }
}

export async function readJson(response: Response, context: string): Promise<unknown> {
  try {
    return (await response.json()) as unknown;
  } catch (cause) {
    throw new Error(`${context} returned invalid JSON`, { cause });
  }
}
