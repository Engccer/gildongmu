// 도보 줄 구성(E52) 게이트 — spec docs/superpowers/specs/2026-09-23-walk-two-lines-kakao-design.md §7-1.
//
// 두 모드:
//   재생(호출 0): node scripts/verify-walk-lines.mjs --from-corpus <corpus.json>
//     조사(docs/research/RESEARCH-2026-09-30-walk-line-composition.md)의 카카오 원응답을 프로덕션
//     정규화(`normalizeKakaoWalkRoute`)와 줄 고르기(`composeKoWalkLines`)에 그대로 흘린다.
//   실호출: BASE_URL=http://localhost:3010 node scripts/verify-walk-lines.mjs --pairs <pairs.json> [--expect <corpus.json>]
//     `/api/route/walk?lines=2`와 `lines=1`을 구간마다 부른다(카카오 3건/구간, lines=1은 fetch 캐시).
//     --expect를 주면 구간별 줄 구성이 재생 결과와 같은지도 본다(길이 그날 바뀌면 FAIL로 드러난다).
//
// 단언은 **표본 전체 위에서** 한다(표본을 고르지 않는다): 줄 수 분포가 판정문(1줄 10 · 2줄 27 · 3줄 8)과
// 같은가, 판본 1은 세 줄이 없는가, 최단 ≤ 다른 줄 거리. 어긋나면 어긋난 구간을 전부 찍는다.
// 원자료는 실좌표(자택 생활권)라 저장소 밖(~/gildongmu-private/field-logs/walk-route-modes-2026-09-30/)에 둔다.
// 종료 코드: 전부 PASS면 0, 하나라도 FAIL이면 1.

import { readFileSync } from "node:fs";
import { createJiti } from "jiti";

const EXPECTED = { 1: 10, 2: 27, 3: 8 };
const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

const results = [];
function check(name, ok, detail = "") {
  results.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
}

async function loadLib() {
  const jiti = createJiti(import.meta.url, { alias: { "@": new URL("../src", import.meta.url).pathname } });
  const wr = await jiti.import(new URL("../src/lib/walk-route.ts", import.meta.url).pathname);
  const kw = await jiti.import(new URL("../src/lib/providers/kakao-walk.ts", import.meta.url).pathname);
  return { compose: wr.composeKoWalkLines, normalize: kw.normalizeKakaoWalkRoute };
}

/** 코퍼스 → 구간별 줄 구성 `{ "grp|name": { v1: [kind], v2: [kind], dist: {kind: m} } }`. */
async function replay(corpusPath) {
  const { compose, normalize } = await loadLib();
  const corpus = JSON.parse(readFileSync(corpusPath, "utf8"));
  const byPair = new Map();
  for (const [key, raw] of Object.entries(corpus)) {
    const [grp, name, mode] = key.split("|");
    const pair = `${grp}|${name}`;
    if (!byPair.has(pair)) byPair.set(pair, {});
    // 응답 오류(HTTP·네트워크)·정규화 throw는 "조회 실패"(undefined), 경로 없음은 null — 프로덕션과 같은 3-state.
    let value;
    if (raw.httpError || raw.netError) value = undefined;
    else {
      try {
        value = normalize(raw);
      } catch {
        value = undefined;
      }
    }
    byPair.get(pair)[mode] = value;
  }
  const out = {};
  for (const [pair, m] of byPair) {
    const raw = { shortest: m.SHORTEST ?? null, broad: m.BROAD_FIRST, accessible: m.ACCESSIBLE };
    const v2 = compose(raw, 2);
    out[pair] = {
      v1: compose(raw, 1).map((l) => l.kind),
      v2: v2.map((l) => l.kind),
      dist: Object.fromEntries(v2.map((l) => [l.kind, l.raw.distanceMeters])),
    };
  }
  return out;
}

/** `whole` = 조사 45구간 전체일 때만 분포를 판정문과 대조한다(스팟은 구간별 대조만). */
function judge(label, table, whole) {
  const pairs = Object.entries(table);
  const hist = { 0: 0, 1: 0, 2: 0, 3: 0 };
  for (const [, r] of pairs) hist[r.v2.length] += 1;
  const matches = [1, 2, 3].every((n) => hist[n] === EXPECTED[n]) && hist[0] === 0;
  if (!whole) {
    console.log(`${label}: 스팟 ${pairs.length}구간 — 1줄 ${hist[1]} · 2줄 ${hist[2]} · 3줄 ${hist[3]}${hist[0] ? ` · 0줄 ${hist[0]}` : ""}`);
  } else check(
    `${label}: 판본 2 줄 수 분포가 판정문과 같다(${pairs.length}구간)`,
    matches,
    `1줄 ${hist[1]} · 2줄 ${hist[2]} · 3줄 ${hist[3]}${hist[0] ? ` · 0줄 ${hist[0]}` : ""} / 기대 1줄 ${EXPECTED[1]} · 2줄 ${EXPECTED[2]} · 3줄 ${EXPECTED[3]}`,
  );
  const v1Three = pairs.filter(([, r]) => r.v1.length > 2);
  check(`${label}: 판본 1은 세 줄이 없다`, v1Three.length === 0, v1Three.map(([p]) => p).join(", "));
  const v1Mismatch = pairs.filter(([, r]) =>
    r.v2.length === 3 ? r.v1.join() !== "shortest,accessible" : r.v1.join() !== r.v2.join(),
  );
  check(`${label}: 판본 1 = 판본 2(세 줄 구간만 [최단, 계단 회피])`, v1Mismatch.length === 0, v1Mismatch.map(([p]) => p).join(", "));
  const longer = pairs.filter(([, r]) =>
    r.dist.shortest !== undefined && Object.values(r.dist).some((d) => d < r.dist.shortest),
  );
  check(`${label}: 최단 ≤ 다른 줄 거리`, longer.length === 0, longer.map(([p, r]) => `${p} ${JSON.stringify(r.dist)}`).join("; "));
  console.log(`\n${label} 구간별(판본 2):`);
  for (const [p, r] of pairs) console.log(`  ${p}: ${r.v2.join(" · ") || "(없음)"}`);
}

async function live(pairsPath, expectPath) {
  const BASE = process.env.BASE_URL ?? "http://localhost:3000";
  const pairs = JSON.parse(readFileSync(pairsPath, "utf8"));
  const expected = expectPath ? await replay(expectPath) : null;
  const table = {};
  for (const { grp, name, origin, dest } of pairs) {
    const q = `origin=${origin[0]},${origin[1]}&dest=${dest[0]},${dest[1]}`;
    const get = async (v) => {
      const res = await fetch(`${BASE}/api/route/walk?${q}&lines=${v}`);
      if (res.status !== 200) throw new Error(`${grp}|${name} lines=${v} HTTP ${res.status}`);
      return (await res.json()).lines;
    };
    try {
      const v2 = await get(2);
      const v1 = await get(1);
      table[`${grp}|${name}`] = {
        v1: v1.map((l) => l.kind),
        v2: v2.map((l) => l.kind),
        dist: Object.fromEntries(v2.map((l) => [l.kind, l.route.distanceMeters])),
      };
    } catch (e) {
      check(`${grp}|${name} 응답`, false, String(e));
    }
  }
  judge("실호출", table, pairs.length === 45);
  if (expected) {
    const diff = Object.entries(table).filter(([p, r]) => expected[p] && expected[p].v2.join() !== r.v2.join());
    check(
      "실호출 = 재생(구간별 줄 구성)",
      diff.length === 0,
      diff.map(([p, r]) => `${p}: 실호출 ${r.v2.join("·")} / 재생 ${expected[p].v2.join("·")}`).join("; "),
    );
  }
}

const corpusPath = opt("--from-corpus");
const pairsPath = opt("--pairs");
if (corpusPath) judge("재생", await replay(corpusPath), true);
else if (pairsPath) await live(pairsPath, opt("--expect"));
else {
  console.error("사용법: --from-corpus <corpus.json> | --pairs <pairs.json> [--expect <corpus.json>]");
  process.exit(2);
}
const failed = results.filter((ok) => !ok).length;
console.log(`\n${results.length - failed}/${results.length} PASS`);
process.exit(failed ? 1 : 0);
