import type { AggregationFunction } from "./config.ts";

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

/** Signal value kind. `null` means platform did not report a type. */
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

export interface MachineGroupBy {
  type: "machine";
  id: string;
}

export interface TimeseriesQuery {
  signal: string;
  aggregationFunction: AggregationFunction;
  groupBy: MachineGroupBy;
}

/** One bucketed datapoint. `time` is epoch millis, `value` null on empty bucket. */
export interface TimeseriesDatapoint {
  time: number;
  value: number | null;
}

export interface TimeseriesResult {
  type: string;
  id: string;
  signal: string;
  aggregationFunction: string;
  totalDatapoints: number;
  timeseries: TimeseriesDatapoint[];
}

interface ProemionTokenResponse {
  access_token: string;
  expires_in: number;
  token_type: string;
}

const DEFAULT_TIMESERIES_LIMIT = 10_000;

export class ProemionClient {
  private cachedAccessToken: string | null = null;
  private accessTokenExpiresAtMs = 0;

  constructor(
    private readonly baseUrl: string,
    private readonly tokenUrl: string,
    private readonly clientId: string,
    private readonly clientSecret: string,
  ) {}

  /**
   * Return cached bearer token or fetch new one via client-credentials flow.
   * Refreshes 60s before expiry to avoid 401 mid-poll.
   * @returns Valid access token.
   * @throws Error when auth endpoint returns non-2xx.
   */
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

  private async postJson<T>(
    resourcePath: string,
    requestBody: unknown,
  ): Promise<T> {
    const accessToken = await this.ensureValidAccessToken();
    const httpResponse = await fetch(`${this.baseUrl}${resourcePath}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(requestBody),
    });
    if (!httpResponse.ok)
      throw new Error(
        `POST ${resourcePath} failed: HTTP ${httpResponse.status}`,
      );
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

  /**
   * Fetch bucketed timeseries for batch of signal queries.
   * @param fromMs - Window start, epoch millis.
   * @param toMs - Window end, epoch millis.
   * @param bucketSizeMs - Bucket width in millis.
   * @param queries - Signal plus machine selectors.
   * @param limit - Max datapoints per result. Defaults to DEFAULT_TIMESERIES_LIMIT.
   * @returns One result per query.
   */
  async fetchTimeseries(
    fromMs: number,
    toMs: number,
    bucketSizeMs: number,
    queries: TimeseriesQuery[],
    limit: number = DEFAULT_TIMESERIES_LIMIT,
  ): Promise<TimeseriesResult[]> {
    return this.postJson<TimeseriesResult[]>("/timeseries", {
      from: fromMs,
      to: toMs,
      bucketSize: bucketSizeMs,
      limit,
      queries,
    });
  }
}
