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
// ⚠ **이 게이트가 보는 것은 업스트림 표기뿐이다.** "우리 정규화가 그 표기에
//   닿는가"는 여기서 재구현한 정규식이 아니라 단위 테스트가 지킨다
//   (`transit-guide.test.ts`·`TransitGuideTests.swift`가 `"수도권 9호선(급행)"`
//   문자열 그대로를 `subwayIdForOdsayLine`에 넣어 단언한다). 둘이 합쳐야 축이
//   덮인다 — 이 게이트만으로는 `subwayLineCore`가 바뀌어도 통과한다.
//
// 사용법: node scripts/verify-odsay-express-lane.mjs
//   exit 0 = 통과 / 1 = 계약 위반 또는 호출 불가 / 2 = ODsay 일일 쿼터 소진
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
  // ⚠ 봉투가 2형(객체·배열)이라 배열 첫 원소도 본다(odsay-envelope와 같은 함정).
  const err = Array.isArray(json.error) ? json.error[0] : json.error;
  const code = String(err?.code ?? "");
  console.error(`ODsay error: ${JSON.stringify(json.error)}`);
  // **쿼터 소진만** "지금은 돌릴 수 없는 상태"(exit 2)다. 키 만료·Referer 등록
  // 해제도 같은 코드로 끝내면 그 사망이 "쿼터 탓"으로 영구 위장된다 — 3-state.
  process.exit(code === "429" ? 2 : 1);
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
  express.length > 0 && express.every((s) => /\(급행\)\s*$/.test(s.lane[0].name)),
  express.map((s) => s.lane[0].name).join(", "),
);

// 접미를 벗기면 완행 표기와 같아져야 매핑표에 닿는다.
check(
  "접미를 벗기면 완행과 같은 노선명이 된다",
  // ⚠ length 가드 필수 — 빈 배열의 every()는 무조건 true라 검증하지 않은 것을
  //   검증한 것처럼 PASS 줄에 남긴다(파일 아래 경유역 비교와 같은 관용구).
  express.length > 0 && express.every((s) => s.lane[0].name.replace(/\(급행\)\s*$/, "").trim() === "수도권 9호선"),
);

// 경유역이 급행 기준으로 좁혀져 오는가(E14 ① 근거 — 이게 깨지면 경유역 목록이
// 급행 승객에게 거짓이 된다).
// ⚠ **같은 구간끼리만 비교한다.** subPath는 모든 path에서 평평하게 모이므로,
//   환승 경로 안의 짧은 9호선 구간이 완행 대표로 잡히면 역 수 비교가 정차역
//   축약과 무관하게 성립하거나 깨진다.
const expLeg = express[0];
const locLeg = local.find(
  (s) => s.startName === expLeg?.startName && s.endName === expLeg?.endName,
);
const expStops = expLeg?.passStopList?.stations?.length ?? 0;
const locStops = locLeg?.passStopList?.stations?.length ?? 0;
check(
  "급행 경유역이 같은 구간의 완행보다 적다(정차역 축약이 살아 있다)",
  expStops > 0 && locStops > 0 && expStops < locStops,
  locLeg
    ? `${expLeg.startName}→${expLeg.endName}: 급행 ${expStops}역 / 완행 ${locStops}역`
    : "같은 구간의 완행 subPath를 찾지 못했다(비교 불가)",
);

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} PASS`);
process.exit(failed.length > 0 ? 1 : 0);
