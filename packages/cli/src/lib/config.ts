import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export interface CliConfig {
  apiUrl: string;
  output?: "text" | "json";
  location?: { label: string; lat: number; lng: number };
}

const DEFAULT_API_URL = "https://gildongmu.dodoplanet.space";

function configDir(): string {
  return process.env.GILDONGMU_CONFIG_DIR ?? join(homedir(), ".config", "gildongmu");
}
export function configPath(): string {
  return join(configDir(), "config.json");
}

export async function readConfig(): Promise<CliConfig> {
  let fromFile: Partial<CliConfig> = {};
  try {
    fromFile = JSON.parse(await readFile(configPath(), "utf8"));
  } catch { /* 파일 없음 = 기본값 */ }
  return {
    ...fromFile,
    apiUrl: process.env.GILDONGMU_API_URL ?? fromFile.apiUrl ?? DEFAULT_API_URL,
  };
}

export async function writeConfig(patch: Partial<CliConfig>): Promise<void> {
  const current = await readConfig().catch(() => ({}) as CliConfig);
  await mkdir(configDir(), { recursive: true });
  await writeFile(configPath(), JSON.stringify({ ...current, ...patch }, null, 2) + "\n", "utf8");
}
