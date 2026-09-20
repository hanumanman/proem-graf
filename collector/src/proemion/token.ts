interface TokenResponse {
  access_token: string;
  expires_in: number;
  token_type: string;
}

const REFRESH_EARLY_MS = 60_000;

export class TokenProvider {
  private cachedToken: string | null = null;
  private expiresAtMs = 0;

  constructor(
    private readonly tokenUrl: string,
    private readonly clientId: string,
    private readonly clientSecret: string,
  ) {}

  async getToken(): Promise<string> {
    if (this.hasValidCache()) {
      return this.cachedToken as string;
    }
    return this.fetchNewToken();
  }

  private hasValidCache(): boolean {
    return (
      this.cachedToken !== null && Date.now() < this.expiresAtMs - REFRESH_EARLY_MS
    );
  }

  private async fetchNewToken(): Promise<string> {
    const response = await fetch(this.tokenUrl, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: this.clientId,
        client_secret: this.clientSecret,
      }),
    });
    if (!response.ok) throw new Error(`auth failed: HTTP ${response.status}`);
    const body = (await response.json()) as TokenResponse;
    this.cachedToken = body.access_token;
    this.expiresAtMs = Date.now() + body.expires_in * 1000;
    return this.cachedToken;
  }
}
