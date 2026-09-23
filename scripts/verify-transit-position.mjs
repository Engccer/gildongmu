#!/usr/bin/env node
// 실호출 게이트 — 승차 중 현재역(E35, spec docs/superpowers/specs/2026-09-23-riding-current-station-design.md §8).
//
// 무엇을 보나: 도착 API의 열차번호(`btrainNo`)로 **우리 라우트** `/api/transit/position`을 물었을 때
// ① 그 열차가 found로 조인되는가(fixture가 아니라 실데이터 커버리지) ② 돌려받은 현재역이 그 노선의 seed
// 역명과 정규화 일치하는가(표식 조인이 성립하는 표기인가) ③ 없는 열차는 notFound, 매핑 밖 노선은 unsupported
// ④ 조회 창 밖이 있으면 upstream이 total로 말하는가(`truncated` 판정의 전제).
//
// ⚠ 낮 시간대에 돌린다 — 심야에는 열차가 없어 결측과 운행 밖을 가를 수 없다.
// upstream 호출: 도착 4 + 위치 4(노선 캐시로 노선당 1) + 창 확인 1 = 9건. ODsay는 부르지 않는다.
//
// 사용법: (dev 서버를 띄운 뒤) node scripts/verify-transit-position.mjs [BASE_URL=http://localhost:3000] [--all-lines]
// --all-lines는 매핑표 20노선의 제공 여부를 노선당 1건으로 더 본다(설계 리뷰 M5).
import { readFileSync } from "node:fs";

try {
  for (const line of readFileSync(".env.local", "utf8").split("\n")) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
} catch { /* 환경변수 직접 주입 */ }

const BASE_URL = process.argv[2] ?? "http://localhost:3000";
const KEY = process.env.SEOUL_SUBWAY_REALTIME_KEY ?? "";
const SWOPEN = "http://swopenapi.seoul.go.kr/api/subway";
let upstreamCalls = 0;

const results = [];
function check(name, cond, detail) {
  results.push({ name, pass: Boolean(cond) });
  console.log(`${cond ? "PASS" : "FAIL"} — ${name}${detail ? ` (${detail})` : ""}`);
}

// transit-guide.ts normalizeStopName과 같은 규칙(괄호 부역명·"역" 접미 제거).
const normalize = (s) => s.replace(/\s*\([^)]*\)/g, "").replace(/역$/, "").trim();
const seed = JSON.parse(readFileSync("src/lib/data/subway-stations.json", "utf8"));

async function swopen(path) {
  upstreamCalls += 1;
  const res = await fetch(`${SWOPEN}/${KEY}/json/${path}`, { signal: AbortSignal.timeout(20000) });
  return res.json();
}

async function position(line, train) {
  const url = `${BASE_URL}/api/transit/position?line=${encodeURIComponent(line)}&train=${encodeURIComponent(train)}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
  return { status: res.status, body: res.status === 200 ? await res.json() : null };
}

const CASES = [
  { odsayLine: "수도권 5호선", seoulLine: "5호선", subwayId: "1005", station: "강동" },
  { odsayLine: "수도권 2호선", seoulLine: "2호선", subwayId: "1002", station: "강남" },
  // 열차번호 표기가 다른 노선(구현 리뷰 m5): 1호선은 선행 0(`0106`), 공항철도는 영문 접두(`A2123`)가 위치 목록에
  // 있다 — 도착 `btrainNo`가 같은 표기가 아니면 조인이 조용히 0이 된다.
  { odsayLine: "수도권 1호선", seoulLine: "1호선", subwayId: "1001", station: "종로3가" },
  { odsayLine: "공항철도", seoulLine: "공항철도", subwayId: "1065", station: "공덕" },
];

const missing = await position("수도권 5호선", "99999");
check("없는 열차번호는 notFound(정보 없음)", missing.status === 200 && missing.body?.status === "notFound", JSON.stringify(missing.body));
const unmapped = await position("부산 1호선", "1001");
check("매핑 밖 노선은 unsupported(upstream 0회)", unmapped.status === 200 && unmapped.body?.status === "unsupported");

for (const c of CASES) {
  const arr = await swopen(`realtimeStationArrival/0/20/${encodeURIComponent(c.station)}`);
  const trains = [...new Set(
    (arr.realtimeArrivalList ?? []).filter((a) => a.subwayId === c.subwayId).map((a) => a.btrainNo).filter(Boolean),
  )].slice(0, 4);
  check(`${c.seoulLine} ${c.station} 도착 목록에 열차번호가 있다`, trains.length > 0, `${trains.length}편성`);
  // 역명 체계 대조는 노선을 가리지 않는다 — seed는 코레일 구간을 `경부선`, 공항철도를 `인천국제공항선`으로 적어
  // 서울 노선명으로 거르면 정상 역이 떨어진다(2026-09-23 실측). 표식 조인 대상은 ODsay 경유역 이름이고 이 대조는
  // "위치 API 역명이 역명 체계 안의 표기인가"만 본다.
  const lineStations = new Set(seed.map((s) => normalize(s.name)));
  let found = 0;
  const unmatched = [];
  for (const t of trains) {
    const r = await position(c.odsayLine, t);
    if (r.status === 200 && r.body?.status === "found") {
      found += 1;
      if (!lineStations.has(normalize(r.body.station))) unmatched.push(r.body.station);
      console.log(`  ${t}: ${r.body.station} sttus=${r.body.trainStatus} age=${r.body.dataAgeSeconds}s`);
    } else {
      console.log(`  ${t}: HTTP ${r.status} ${JSON.stringify(r.body)}`);
    }
  }
  // 판정하는 것은 "도착 `btrainNo`와 위치 `trainNo`가 같은 표기인가"다. 표기 불일치는 노선 단위로 체계적이라
  // 그 노선 전체가 0이 된다 — 그래서 문자열 완전 일치 1편성 이상이면 표기 일치가 입증된다. 목록에 없는 편성(결측)은
  // 판정이 아니라 관측으로 따로 적는다(비율 문턱은 표기 불일치 한 편성을 통과시키는 헐거운 술어였다).
  check(`${c.seoulLine} 도착 btrainNo ↔ 위치 trainNo 표기 일치(완전 일치 조인 ≥ 1)`, found >= 1, `${found}/${trains.length}`);
  if (found < trains.length) console.log(`  관측: ${c.seoulLine} 위치 목록 결측 ${trains.length - found}편성`);
  check(`${c.seoulLine} 현재역이 seed 역명과 정규화 일치`, found > 0 && unmatched.length === 0, unmatched.join(",") || "전부 일치");
}

const small = await swopen(`realtimePosition/0/5/${encodeURIComponent("2호선")}`);
const rows = (small.realtimePositionList ?? []).length;
const total = Number(small.errorMessage?.total ?? 0);
check("조회 창 밖이 있으면 total이 받은 행보다 크다(truncated 전제)", rows <= 6 && total > rows, `rows=${rows} total=${total}`);

// --all-lines: 매핑표 20노선 전부의 위치 API 제공 여부(설계 리뷰 M5). 노선당 1건 — 기본 게이트 밖이다.
if (process.argv.includes("--all-lines")) {
  const src = readFileSync("src/lib/providers/seoul-subway-arrival.ts", "utf8");
  const lines = [...src.matchAll(/"(\d{4})": "([^"]+)"/g)].map((m) => m[2]);
  console.log(`\n노선별 realtimePosition(${lines.length}노선):`);
  for (const line of lines) {
    const j = await swopen(`realtimePosition/0/200/${encodeURIComponent(line)}`);
    const code = j?.errorMessage?.code ?? j?.code ?? "?";
    console.log(`  ${line}: ${code} total=${j?.errorMessage?.total ?? 0} rows=${(j?.realtimePositionList ?? []).length}`);
  }
}

const failed = results.filter((r) => !r.pass).length;
console.log(`\n${results.length - failed}/${results.length} PASS · upstream 직접 호출 ${upstreamCalls}건(+ 라우트 경유 위치 조회는 노선 캐시로 노선당 1건)`);
process.exit(failed ? 1 : 0);
