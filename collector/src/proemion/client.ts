import { TokenProvider } from "./token.ts";
import type {
  Machine,
  Signal,
  TimeseriesRequest,
  TimeseriesResult,
} from "./types.ts";

const DEFAULT_LIMIT = 10_000;

export class ProemionClient {
  constructor(
    private readonly baseUrl: string,
    private readonly tokens: TokenProvider,
  ) {}

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

  async fetchTimeseries(request: TimeseriesRequest): Promise<TimeseriesResult[]> {
    return this.postJson<TimeseriesResult[]>("/timeseries", {
      from: request.window.fromMs,
      to: request.window.toMs,
      bucketSize: request.bucketSizeMs,
      limit: request.limit ?? DEFAULT_LIMIT,
      queries: request.queries,
    });
  }

  private async authHeaders(): Promise<Record<string, string>> {
    const token = await this.tokens.getToken();
    return { authorization: `Bearer ${token}` };
  }

  private async checkOk(response: Response, context: string): Promise<void> {
    if (!response.ok) throw new Error(`${context} failed: HTTP ${response.status}`);
  }

  private async fetchJson<T>(path: string): Promise<T> {
    const headers = await this.authHeaders();
    const response = await fetch(`${this.baseUrl}${path}`, { headers });
    await this.checkOk(response, `GET ${path}`);
    return (await response.json()) as T;
  }

  private async postJson<T>(path: string, body: unknown): Promise<T> {
    const headers = await this.authHeaders();
    const response = await fetch(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    await this.checkOk(response, `POST ${path}`);
    return (await response.json()) as T;
  }
}
