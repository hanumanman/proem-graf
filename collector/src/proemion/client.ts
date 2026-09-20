import { requestWithRetry, readJson } from "../infra/http.ts";
import {
  parseMachineCount,
  parseMachines,
  parseSignals,
  parseTimeseriesResults,
} from "./schemas.ts";
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
    return this.fetchJson("/machines/count", parseMachineCount);
  }

  async fetchMachines(limit: number, offset: number): Promise<Machine[]> {
    const query = new URLSearchParams({
      limit: String(limit),
      offset: String(offset),
    });
    return this.fetchJson(`/machines?${query.toString()}`, parseMachines);
  }

  async fetchMachineSignals(machineId: string): Promise<Signal[]> {
    return this.fetchJson(
      `/machines/${encodeURIComponent(machineId)}/signals`,
      parseSignals,
    );
  }

  async fetchTimeseries(request: TimeseriesRequest): Promise<TimeseriesResult[]> {
    return this.postJson("/timeseries", parseTimeseriesResults, {
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

  private async fetchJson<T>(path: string, parse: (json: unknown) => T): Promise<T> {
    const headers = await this.authHeaders();
    const response = await requestWithRetry(
      `${this.baseUrl}${path}`,
      { headers },
      `GET ${path}`,
    );
    return parse(await readJson(response, `GET ${path}`));
  }

  private async postJson<T>(
    path: string,
    parse: (json: unknown) => T,
    body: unknown,
  ): Promise<T> {
    const headers = await this.authHeaders();
    const response = await requestWithRetry(
      `${this.baseUrl}${path}`,
      {
        method: "POST",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify(body),
      },
      `POST ${path}`,
    );
    return parse(await readJson(response, `POST ${path}`));
  }
}
