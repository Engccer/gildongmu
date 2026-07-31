#!/usr/bin/env node
// 길동무 과금·쿼터 상태 리포트. 로컬 전용, 외부 의존성 0
// 실행: node scripts/usage-report.mjs
import { execFileSync } from "node:child_process";
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

/**
 * Vercel CLI가 이미 로그인 토큰을 갖고 있다. 별도 발급을 요구하지 않는다.
 * ⚠ expiresAt은 초 단위다. 밀리초로 비교하면 1970년이 되어 항상 만료로 읽힌다.
 * 만료된 토큰을 그대로 보내면 "인증 실패"로 표시되어 계정 문제로 오해된다.
 */
function loadVercelCliToken() {
  try {
    const authPath = path.join(
      os.homedir(),
      "Library/Application Support/com.vercel.cli/auth.json",
    );
    const auth = JSON.parse(readFileSync(authPath, "utf8"));
    if (auth.expiresAt && auth.expiresAt * 1000 < Date.now()) return undefined;
    return auth.token || undefined;
  } catch {
    return undefined;
  }
}

/**
 * Gemini API에는 사용량 엔드포인트가 없어 Cloud Monitoring을 쓰고,
 * 그 인증은 gcloud 사용자 토큰이다(1시간 만료라 매 실행마다 새로 얻는다).
 * gcloud가 없거나 미인증이면 그 칸만 키 미설정으로 떨어진다.
 */
function loadGcloudToken() {
  try {
    return (
      execFileSync("gcloud", ["auth", "print-access-token"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
        timeout: 10_000,
      }).trim() || undefined
    );
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
  if (!env.GCLOUD_ACCESS_TOKEN) {
    const gcloudToken = loadGcloudToken();
    if (gcloudToken) env.GCLOUD_ACCESS_TOKEN = gcloudToken;
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
