const REPO_DOT_ENV_URL = new URL("../../../.env", import.meta.url);

function isSkippableLine(line: string): boolean {
  return line.length === 0 || line.startsWith("#");
}

function stripQuotes(value: string): string {
  if (value.length >= 2) {
    const quoted =
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"));
    if (quoted) return value.slice(1, -1);
  }
  return value;
}

function splitKeyValue(line: string): [string, string] | null {
  const equalsIndex = line.indexOf("=");
  if (equalsIndex === -1) return null;
  const key = line.slice(0, equalsIndex).trim();
  const value = stripQuotes(line.slice(equalsIndex + 1).trim());
  return [key, value];
}

export function parseDotEnvLine(rawLine: string): [string, string] | null {
  const line = rawLine.trim();
  if (isSkippableLine(line)) return null;
  return splitKeyValue(line);
}

export async function installDotEnv(dotEnvUrl: URL = REPO_DOT_ENV_URL): Promise<void> {
  const text = await Bun.file(dotEnvUrl)
    .text()
    .catch(() => "");
  for (const rawLine of text.split("\n")) {
    const parsed = parseDotEnvLine(rawLine);
    if (!parsed) continue;
    const [key, value] = parsed;
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}
