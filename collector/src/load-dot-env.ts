const dotEnvPath = new URL("../../.env", import.meta.url);

const envFileText = await Bun.file(dotEnvPath)
  .text()
  .catch(() => "");

for (const rawLine of envFileText.split("\n")) {
  const trimmedLine = rawLine.trim();
  if (!trimmedLine || trimmedLine.startsWith("#")) continue;
  const equalsIndex = trimmedLine.indexOf("=");
  if (equalsIndex === -1) continue;
  const envKey = trimmedLine.slice(0, equalsIndex).trim();
  let envValue = trimmedLine.slice(equalsIndex + 1).trim();
  if (
    (envValue.startsWith('"') && envValue.endsWith('"')) ||
    (envValue.startsWith("'") && envValue.endsWith("'"))
  ) {
    envValue = envValue.slice(1, -1);
  }
  if (!(envKey in process.env)) {
    process.env[envKey] = envValue;
  }
}
