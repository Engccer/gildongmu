// 도보 출발점 재시도(A70) 실호출 게이트 — spec `2026-10-19-reroute-start-gap-design.md` §7.
//
// fixture green ≠ 실계약 검증: 카카오가 출발점을 어디에 붙이는지, 그때 Tmap이 더 가까이 붙이는지는 실호출로만 안다.
//
// 보는 것:
//  ⓐ 공개 지점 기하 응답: `originGapM`은 응답 첫 점까지 거리 > 30m일 때만, 그 거리의 반올림과 같다(모든 기하 응답에 공통 단언)
//  ⓑ 비공개 사례(`ORIGIN_GAP_CASES` — 실보행 캐시에서 첫 점이 30m 밖이었던 요청, 저장소 밖 파일): 응답 첫 점이 캐시된 카카오
//     첫 점보다 멀어지지 않는다(재시도가 나빠지게 하지 않는다, 허용 1m)
//  ⓒ 같은 좌표의 브리핑 응답(기하 없음): `originGapM`·`kind` 없음(미지정 응답 불변)
//  ⓓ en 기하 응답: 재시도 없이 ⓐ 규칙
//  양성 대조: ⓑ에서 재시도가 Tmap을 고른 사례(`kind: recommended`) 또는 둘 다 먼 사례(`originGapM` 있음)를 1건 이상 관측
//
// 출력은 거리만 낸다(좌표 금지 — 비공개 사례는 사용자 실위치다).
// 사용법: BASE_URL=http://localhost:3070 ORIGIN_GAP_CASES=<저장소 밖 json> node scripts/verify-walk-origin-gap.mjs
// 호출 수: 공개 2 + 비공개 N×(카카오 1 + 재시도 Tmap ≤1) + 브리핑 1 + en 1(Tmap). 429는 창이 지나면 재시도한다.
// 종료 코드: 전부 PASS면 0, 하나라도 FAIL이면 1.

import { readFileSync } from "node:fs";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const RETRY_M = 30;

/** `verify-non-ko-walk-guidance.mjs` 코퍼스의 도심 쌍(공개 지점). [출발lat, 출발lng, 도착lat, 도착lng] */
const PUBLIC = [
  [37.5665, 126.978, 37.571, 126.992],
  [37.4979, 127.0276, 37.51, 127.04],
];

const results = [];
function check(name, ok, detail = "") {
  results.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
}

function hav(a, b) {
  const R = 6371000;
  const r = (x) => (x * Math.PI) / 180;
  const dp = r(b.lat - a.lat);
  const dl = r(b.lng - a.lng);
  const h = Math.sin(dp / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(dl / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

async function walk({ origin, dest, geometry = true, lang = "ko", variant, accessible, via }) {
  const q = new URLSearchParams({ origin: origin.join(","), dest: dest.join(",") });
  if (geometry) q.set("includeGeometry", "1");
  if (lang !== "ko") q.set("lang", lang);
  if (variant) q.set("variant", variant);
  if (accessible) q.set("accessible", accessible);
  if (via) q.set("via", via);
  const url = `${BASE}/api/route/walk?${q}`;
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(url);
    if (res.status !== 429) return { status: res.status, body: await res.json().catch(() => null) };
    await new Promise((r) => setTimeout(r, 61_000));
  }
  const res = await fetch(url);
  return { status: res.status, body: await res.json().catch(() => null) };
}

/** 기하 응답 공통 단언: originGapM ⇔ 첫 점 거리 > 30, 값은 반올림. 첫 점 거리(m)를 돌려준다. */
function gapRule(label, origin, r) {
  const first = r.body?.result?.steps?.[0]?.pathCoords?.[0];
  if (r.status !== 200 || !first) {
    check(`${label} 응답`, false, `status ${r.status}`);
    return null;
  }
  const gap = hav({ lat: origin[0], lng: origin[1] }, first);
  const field = r.body.result.originGapM;
  const ok = gap > RETRY_M ? field === Math.round(gap) : field === undefined;
  check(`${label} originGapM 규칙`, ok, `첫 점 ${gap.toFixed(1)}m, 필드 ${field ?? "없음"}, 줄 종류 ${r.body.result.kind ?? "-"}`);
  return gap;
}

// ⓐ
for (const [i, p] of PUBLIC.entries()) {
  const origin = [p[0], p[1]];
  gapRule(`ⓐ 공개 ${i + 1}`, origin, await walk({ origin, dest: [p[2], p[3]] }));
}

// ⓑ
const casesPath = process.env.ORIGIN_GAP_CASES;
let retriedOrFar = 0;
if (!casesPath) {
  check("ⓑ 비공개 사례 파일(ORIGIN_GAP_CASES)", false, "미지정");
} else {
  const cases = JSON.parse(readFileSync(casesPath, "utf8"));
  for (const [i, c] of cases.entries()) {
    const r = await walk({ origin: c.origin, dest: c.dest, variant: c.variant, accessible: c.accessible, via: c.via });
    const gap = gapRule(`ⓑ 사례 ${i + 1}(캐시 카카오 ${c.cachedGapM}m)`, c.origin, r);
    if (gap === null) continue;
    check(`ⓑ 사례 ${i + 1} 나빠지지 않음`, gap <= c.cachedGapM + 1, `${c.cachedGapM}m → ${gap.toFixed(1)}m`);
    if (r.body.result.kind === "recommended" || r.body.result.originGapM !== undefined) retriedOrFar++;
  }
  check("ⓑ 양성 대조(재시도가 Tmap을 골랐거나 둘 다 먼 사례 ≥ 1)", retriedOrFar >= 1, `${retriedOrFar}건`);
}

// ⓒ
{
  const p = PUBLIC[0];
  const r = await walk({ origin: [p[0], p[1]], dest: [p[2], p[3]], geometry: false });
  const res = r.body?.result;
  check("ⓒ 브리핑 응답에 originGapM·kind 없음", r.status === 200 && res && !("originGapM" in res) && !("kind" in res), `status ${r.status}`);
}

// ⓓ
{
  const p = PUBLIC[1];
  gapRule("ⓓ en 기하", [p[0], p[1]], await walk({ origin: [p[0], p[1]], dest: [p[2], p[3]], lang: "en" }));
}

const failed = results.filter((x) => !x).length;
console.log(`\n${results.length - failed}/${results.length} PASS`);
process.exit(failed === 0 ? 0 : 1);
