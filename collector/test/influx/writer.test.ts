import { describe, test } from "bun:test";
import { InfluxWriter } from "../../src/influx/writer.ts";

describe("InfluxWriter", () => {
  test("skips empty batches without network", async () => {
    const writer = new InfluxWriter({
      host: "http://127.0.0.1:1",
      database: "proemion",
      token: "test",
    });
    await writer.writeLines([]);
    await writer.close();
  });
});
