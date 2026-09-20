import { describe, expect, test } from "bun:test";
import { parseDotEnvLine } from "../../src/config/dotenv.ts";

describe("parseDotEnvLine", () => {
  test("parses key=value", () => {
    expect(parseDotEnvLine("A=1")).toEqual(["A", "1"]);
  });

  test("skips blanks and comments", () => {
    expect(parseDotEnvLine("")).toBeNull();
    expect(parseDotEnvLine("# hi")).toBeNull();
  });

  test("skips lines without equals", () => {
    expect(parseDotEnvLine("nope")).toBeNull();
  });

  test("strips quotes", () => {
    expect(parseDotEnvLine('A="1"')).toEqual(["A", "1"]);
    expect(parseDotEnvLine("A='1'")).toEqual(["A", "1"]);
  });
});
