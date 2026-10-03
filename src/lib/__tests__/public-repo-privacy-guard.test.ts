import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { haversineMeters } from "../geo";

/**
 * 공개 저장소 규율 ① 재유입 가드(CLAUDE.md 개발 규칙, docs/PATTERNS.md 같은 제목 절).
 *
 * 금지 좌표 반경과 금지 문자열은 저장소에 두지 않는다 — 목록 자체가 유출원이 되기 때문이다.
 * 입력은 저장소 밖 JSON(`GILDONGMU_PRIVACY_GUARD` 또는 `~/gildongmu-private/privacy-guard.json`)이다.
 * 커밋 이메일이 저장소 주인인 클론에서는 그 파일이 없으면 실패하고(가드가 조용히 사라지지 않게),
 * 포크에서는 건너뛴다. `.githooks/pre-commit`이 커밋마다 이 파일 하나를 돌린다.
 * 보지 못하는 것: 커밋 메시지, 투영 좌표(TM 등), 바이너리, 300자 넘게 떨어진 위·경도.
 *
 * 입력 형식: { centers: [{ id, lat, lng, radiusM }], tokens: string[], allowLines: string[],
 *             allowPathTokens: [{ path, token }], seedPrefixes: string[] }
 */

interface Guard {
  centers: { id: string; lat: number; lng: number; radiusM: number }[];
  tokens: string[];
  allowLines: string[];
  allowPathTokens: { path: string; token: string }[];
  seedPrefixes: string[];
}

const GUARD_PATH =
  process.env.GILDONGMU_PRIVACY_GUARD ?? join(homedir(), "gildongmu-private", "privacy-guard.json");
function loadGuard(): Guard | null {
  if (!existsSync(GUARD_PATH)) return null;
  const raw = JSON.parse(readFileSync(GUARD_PATH, "utf8")) as Partial<Guard>;
  return {
    centers: raw.centers ?? [],
    tokens: raw.tokens ?? [],
    allowLines: raw.allowLines ?? [],
    allowPathTokens: raw.allowPathTokens ?? [],
    seedPrefixes: raw.seedPrefixes ?? [],
  };
}
const guard = loadGuard();

const OWNER_EMAIL = "engccer@gmail.com";
const LAT = /(?<![\d.])3[3-8]\.\d{3,}(?!\d)/g;
const LNG = /(?<![\d.])1(?:2[4-9]|3[01])\.\d{3,}(?!\d)/g;
// 네이버 지역검색 mapx·mapy 같은 ×1e7 정수
const LAT_INT = /(?<![\d.])3[3-8]\d{7}(?![\d.])/g;
const LNG_INT = /(?<![\d.])1(?:2[4-9]|3[01])\d{7}(?![\d.])/g;

function gitEmail(): string {
  try {
    return execFileSync("git", ["config", "user.email"], { encoding: "utf8" }).trim();
  } catch {
    return "";
  }
}

const isOwnerClone = gitEmail() === OWNER_EMAIL;

/** 띄어쓰기·정규화 형태·대소문자 변형을 같은 문자열로 본다. */
function norm(s: string): string {
  return s.normalize("NFC").replace(/\s+/g, "").toLowerCase();
}

function matches(text: string, decimal: RegExp, integer: RegExp): { at: number; v: number }[] {
  return [
    ...[...text.matchAll(decimal)].map((m) => ({ at: m.index, v: Number(m[0]) })),
    ...[...text.matchAll(integer)].map((m) => ({ at: m.index, v: Number(m[0]) / 1e7 })),
  ].sort((a, b) => a.at - b.at);
}

function lineOf(text: string, index: number): number {
  let n = 1;
  for (let i = text.indexOf("\n"); i !== -1 && i < index; i = text.indexOf("\n", i + 1)) n++;
  return n;
}

/** 위도 리터럴마다 300자 안의 가장 가까운 경도 리터럴과 짝지어 반경 안이면 보고한다. */
function coordinateHits(text: string, g: Guard): number[] {
  const lngs = matches(text, LNG, LNG_INT);
  if (lngs.length === 0) return [];
  const hits: number[] = [];
  let k = 0;
  for (const m of matches(text, LAT, LAT_INT)) {
    while (k < lngs.length && lngs[k].at < m.at) k++;
    const near = [lngs[k - 1], lngs[k]].filter((c) => c && Math.abs(c.at - m.at) < 300);
    if (near.length === 0) continue;
    const lng = near.reduce((a, b) => (Math.abs(a.at - m.at) <= Math.abs(b.at - m.at) ? a : b)).v;
    if (g.centers.some((c) => haversineMeters(c.lat, c.lng, m.v, lng) <= c.radiusM)) hits.push(lineOf(text, m.at));
  }
  return hits;
}

function tokenHits(path: string, text: string, g: Guard, tokens: string[]): string[] {
  const out: string[] = [];
  const reported = new Set<number>();
  text.split("\n").forEach((line, i) => {
    const n = norm(line);
    tokens.forEach((t, k) => {
      if (reported.has(k) || !n.includes(t)) return;
      if (g.allowPathTokens.some((a) => a.path === path && a.token === g.tokens[k])) return;
      if (g.allowLines.some((a) => line.includes(a))) return;
      reported.add(k);
      out.push(`${path}:${i + 1} 금지 문자열 #${k}`);
    });
  });
  return out;
}

describe("공개 저장소 규율 ① 재유입 가드", () => {
  it.skipIf(!guard && !isOwnerClone)("추적 파일에 자택·지인 주택 반경 좌표와 금지 문자열이 없다", () => {
    if (!guard) throw new Error(`가드 입력이 없다: ${GUARD_PATH} (GILDONGMU_PRIVACY_GUARD로 지정 가능)`);
    const g = guard;
    expect(g.centers.length).toBeGreaterThan(0);
    expect(g.centers.every((c) => c.radiusM > 0)).toBe(true);
    expect(g.tokens.length).toBeGreaterThan(0);
    const tokens = g.tokens.map(norm);
    const root = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
    const files = execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], { cwd: root, encoding: "utf8", maxBuffer: 64 << 20 })
      .split("\0")
      .filter((f) => f && !g.seedPrefixes.some((p) => f.startsWith(p)));
    const problems: string[] = [];
    for (const f of files) {
      let text: string;
      try {
        text = readFileSync(join(root, f), "utf8");
      } catch {
        continue; // 작업 트리에서 지워진 추적 파일
      }
      if (text.includes("\u0000")) continue; // 바이너리
      problems.push(...tokenHits(f, text, g, tokens));
      for (const line of coordinateHits(text, g)) problems.push(`${f}:${line} 반경 안 좌표`);
    }
    expect(problems).toEqual([]);
  });
});
