export interface Organization {
  id: string;
  name: string;
  type: string;
}

export interface Machine {
  id: string;
  name: string;
  serial: string;
  vin: string | null;
  pin: string | null;
  organization: Organization;
}

export type SignalType = "numeric" | "string" | null;

export interface SignalUnit {
  key: string;
  label: string;
}

export interface LogicalType {
  type?: string;
  direction?: string;
  subType?: string;
}

export interface Signal {
  key: string;
  label: string;
  type: SignalType;
  format: string | null;
  minValue: number | null;
  maxValue: number | null;
  unit: SignalUnit;
  logicalType?: LogicalType;
}

interface ProemionTokenResponse {
  access_token: string;
  expires_in: number;
  token_type: string;
}

export class ProemionClient {
  private cachedAccessToken: string | null = null;
  private accessTokenExpiresAtMs = 0;

  constructor(
    private readonly baseUrl: string,
    private readonly tokenUrl: string,
    private readonly clientId: string,
    private readonly clientSecret: string,
  ) {}

  private async ensureValidAccessToken(): Promise<string> {
    if (
      this.cachedAccessToken &&
      Date.now() < this.accessTokenExpiresAtMs - 60_000
    ) {
      return this.cachedAccessToken;
    }
    const authHttpResponse = await fetch(this.tokenUrl, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: this.clientId,
        client_secret: this.clientSecret,
      }),
    });
    if (!authHttpResponse.ok)
      throw new Error(`auth failed: HTTP ${authHttpResponse.status}`);
    const tokenBody = (await authHttpResponse.json()) as ProemionTokenResponse;
    this.cachedAccessToken = tokenBody.access_token;
    this.accessTokenExpiresAtMs = Date.now() + tokenBody.expires_in * 1000;
    return this.cachedAccessToken;
  }

  private async fetchJson<T>(resourcePath: string): Promise<T> {
    const accessToken = await this.ensureValidAccessToken();
    const httpResponse = await fetch(`${this.baseUrl}${resourcePath}`, {
      headers: { authorization: `Bearer ${accessToken}` },
    });
    if (!httpResponse.ok)
      throw new Error(`GET ${resourcePath} failed: HTTP ${httpResponse.status}`);
    return (await httpResponse.json()) as T;
  }

  async fetchMachineCount(): Promise<number> {
    return this.fetchJson<number>("/machines/count");
  }

  async fetchMachines(limit: number, offset: number): Promise<Machine[]> {
    return this.fetchJson<Machine[]>(`/machines?limit=${limit}&offset=${offset}`);
  }

  async fetchMachineSignals(machineId: string): Promise<Signal[]> {
    return this.fetchJson<Signal[]>(
      `/machines/${encodeURIComponent(machineId)}/signals`,
    );
  }
}
