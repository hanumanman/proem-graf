import { InfluxDBClient } from "@influxdata/influxdb3-client";
import type { InfluxConfig } from "./config.ts";

export class InfluxWriter {
  private readonly client: InfluxDBClient;
  private readonly database: string;

  constructor(config: InfluxConfig) {
    this.database = config.database;
    this.client = new InfluxDBClient({
      host: config.host,
      token: config.token,
      authScheme: "Bearer",
      database: config.database,
      writeOptions: { useV2Api: false },
    });
  }

  async writeLines(lines: string[]): Promise<void> {
    if (lines.length === 0) return;
    await this.client.write(lines, this.database);
  }

  async close(): Promise<void> {
    await this.client.close();
  }
}
