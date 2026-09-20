import { requestWithRetry, readJson } from "../infra/http.ts";
import { parseTokenResponse } from "./schemas.ts";

const REFRESH_EARLY_MS = 60_000;

export class TokenProvider {
  private cachedToken: string | null = null;
  private expiresAtMs = 0;
  private inflight: Promise<string> | null = null;

  constructor(
    private readonly tokenUrl: string,
    private readonly clientId: string,
    private readonly clientSecret: string,
  ) {}

  async getToken(): Promise<string> {
    if (this.hasValidCache()) {
      return this.cachedToken as string;
    }
    this.inflight ??= this.fetchNewToken().finally(() => {
      this.inflight = null;
    });
    return this.inflight;
  }

  private hasValidCache(): boolean {
    return (
      this.cachedToken !== null && Date.now() < this.expiresAtMs - REFRESH_EARLY_MS
    );
  }

  private async fetchNewToken(): Promise<string> {
    const response = await requestWithRetry(
      this.tokenUrl,
      {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "client_credentials",
          client_id: this.clientId,
          client_secret: this.clientSecret,
        }),
      },
      "auth",
      { maxRetries: 0 },
    );
    const json = await readJson(response, "auth");
    const token = parseTokenResponse(json);
    this.cachedToken = token.accessToken;
    this.expiresAtMs = Date.now() + token.expiresInSec * 1000;
    return this.cachedToken;
  }
}
