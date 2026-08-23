#!/usr/bin/env node
// 실호출 게이트 — ODsay 급행 lane 표기(A16 선행 / E14).
//
// 지키려는 계약: ODsay가 급행 운행 구간을 **별도 subPath**로 주고 그 `lane[].name`
// 끝에 `(급행)`을 붙인다는 것(실호출 2026-08-23 확정). `subwayLineCore`가 그 한
// 토큰을 벗겨 매핑표에 닿기 때문에, 표기가 바뀌면 매핑이 미스가 되고 **급행 leg의
// 실시간 안내가 통째로 사라진다**. 증상이 "이 경로는 추적할 수 없습니다" 한 줄뿐이라
// 정적 리뷰·fixture로는 드리프트를 볼 수 없다 — 그래서 관측을 상설로 둔다.
//
// ⚠ ODsay는 일 1,000회이고 길찾기와 공유한다. 이 게이트는 **호출 1회**만 쓴다.
//
// 사용법: node scripts/verify-odsay-express-lane.mjs
import { readFileSync } from "node:fs";

try {
  for (const line of readFileSync(".env.local", "utf8").split("\n")) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
} catch { /* CI 등에서는 환경변수 직접 주입 */ }

const results = [];
function check(name, cond, detail) {
  results.push({ name, pass: Boolean(cond), detail });
  console.log(`${cond ? "PASS" : "FAIL"} — ${name}${detail ? ` (${detail})` : ""}`);
}

const KEY = process.env.ODSAY_API_KEY ?? "";
if (!KEY) {
  console.error("ODSAY_API_KEY 없음 — .env.local 확인");
  process.exit(1);
}

// 김포공항 → 종합운동장: 9호선 급행·완행이 같은 OD에 공존하는 구간(운행 다이어와
// 무관하게 ODsay는 출발 시각을 반영하지 않으므로 시각·요일에 흔들리지 않는다).
const url =
  `https://api.odsay.com/v1/api/searchPubTransPathT?apiKey=${KEY}` +
  `&SX=126.8018&SY=37.5629&EX=127.0733&EY=37.5110&OPT=0&SearchPathType=1`;

// ⚠ URI 전용 키라 Referer 필수(provider와 같은 값).
const res = await fetch(url, {
  headers: { Referer: "https://gildongmu.vercel.app/" },
  signal: AbortSignal.timeout(20000),
});
const text = await res.text();
let json;
try {
  json = JSON.parse(text);
} catch {
  console.error(`비정상 응답: ${text.slice(0, 200)}`);
  process.exit(1);
}
if (json.error) {
  // 쿼터 소진(429)은 계약 위반이 아니라 이 게이트를 돌릴 수 없는 상태다 —
  // 통과로 위장하지 않고 별도 코드로 끝낸다.
  console.error(`ODsay error: ${JSON.stringify(json.error)}`);
  process.exit(2);
}

const subways = (json.result?.path ?? []).flatMap((p) =>
  (p.subPath ?? []).filter((s) => s.trafficType === 1),
);
const names = [...new Set(subways.map((s) => s.lane?.[0]?.name).filter(Boolean))];
console.log(`지하철 lane 표기: ${names.join(" | ")}`);

const express = subways.filter((s) => (s.lane?.[0]?.name ?? "").includes("급행"));
const local = subways.filter(
  (s) => (s.lane?.[0]?.name ?? "") === "수도권 9호선",
);

check("급행 subPath가 존재한다", express.length > 0, `${express.length}건`);

// 핵심 단언 — 우리가 벗기는 토큰과 실제 표기가 같은가.
check(
  '급행 표기가 "(급행)" 접미 형태다',
  express.every((s) => /\(급행\)\s*$/.test(s.lane[0].name)),
  express.map((s) => s.lane[0].name).join(", "),
);

// 접미를 벗기면 완행 표기와 같아져야 매핑표에 닿는다.
check(
  "접미를 벗기면 완행과 같은 노선명이 된다",
  express.every((s) => s.lane[0].name.replace(/\(급행\)\s*$/, "").trim() === "수도권 9호선"),
);

// 경유역이 급행 기준으로 좁혀져 오는가(E14 ① 근거 — 이게 깨지면 경유역 목록이
// 급행 승객에게 거짓이 된다).
const expStops = express[0]?.passStopList?.stations?.length ?? 0;
const locStops = local[0]?.passStopList?.stations?.length ?? 0;
check(
  "급행 경유역이 완행보다 적다(정차역 축약이 살아 있다)",
  expStops > 0 && locStops > 0 && expStops < locStops,
  `급행 ${expStops}역 / 완행 ${locStops}역`,
);

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} PASS`);
process.exit(failed.length > 0 ? 1 : 0);
