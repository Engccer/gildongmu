#!/usr/bin/env node
// 길동무 과금·쿼터 상태 리포트. 로컬 전용, 외부 의존성 0
// 실행: node scripts/usage-report.mjs
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import os from "node:os";
import path from "node:path";
import {
  parseEnvFile,
  daysUntil,
  renderReport,
} from "./lib/usage-report-core.mjs";
import {
  MONEY_PROBES,
  AVAILABILITY_PROBES,
  DEADLINES,
  SAFE_NOTES,
  runProbe,
} from "./lib/usage-probes.mjs";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

function loadEnvFile() {
  try {
    return parseEnvFile(readFileSync(path.join(repoRoot, ".env.local"), "utf8"));
  } catch {
    return {};
  }
}

/** Vercel CLI가 이미 로그인 토큰을 갖고 있다. 별도 발급을 요구하지 않는다 */
function loadVercelCliToken() {
  try {
    const authPath = path.join(
      os.homedir(),
      "Library/Application Support/com.vercel.cli/auth.json",
    );
    return JSON.parse(readFileSync(authPath, "utf8")).token || undefined;
  } catch {
    return undefined;
  }
}

function toISODate(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

async function main() {
  const env = { ...loadEnvFile(), ...process.env };
  if (!env.VERCEL_TOKEN) {
    const cliToken = loadVercelCliToken();
    if (cliToken) env.VERCEL_TOKEN = cliToken;
  }
  const now = new Date();

  const [money, availability] = await Promise.all([
    Promise.all(MONEY_PROBES.map((p) => runProbe(p, env))),
    Promise.all(AVAILABILITY_PROBES.map((p) => runProbe(p, env))),
  ]);

  const today = toISODate(now);
  const deadlines = DEADLINES.map((d) => ({
    ...d,
    days: daysUntil(d.date, today),
  }));

  process.stdout.write(
    `${renderReport({ now, money, availability, deadlines, safe: SAFE_NOTES })}\n`,
  );
}

main();
