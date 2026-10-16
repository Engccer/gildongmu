#!/usr/bin/env node
// 조사 스크립트 — E70(역에서 수단을 바꾸는 여정) 설계 선행 조사. 기록 `docs/research/RESEARCH-2026-10-17-e70-maasrp-probe.md`.
//
// 묻는 것:
//   (1) ODsay `maasRP`(멀티모달 대중교통 길찾기)가 택시·자동차 구간을 담은 경로를 주는가 — 문서상 수단은
//       1 도보·2 대중교통·3 대중교통+자전거·4 자전거뿐이다. 문서에 없는 값(5)을 넣으면 무엇이 오는가.
//   (2) 역 좌표 → 역 좌표로 `searchPubTransPathT`를 부르면 그 두 역에서 타고 내리는 경로가 후보에 있는가,
//       1순위인가(판정 7: 지정 역 경로 / ODsay 추천 경로). 없으면 `SearchPathType=1`(지하철만) 재조회가 그것을 주는가.
//   (3) 역 번호로 지정하는 지하철 전용 `subwayPath`가 무엇을 주는가(지정 역 경로를 보장하는 유일한 API).
//
// 이것은 게이트가 아니라 계약 조사다: 오류 봉투도 사실(문서에 없는 값에 대한 응답)이라 JSON이면 전부 저장한다.
// 인증·쿼터 오류가 저장됐으면 그 파일을 지우고 다시 돈다(원장은 그 호출도 센다).
//
// ⚠ ODsay Flex는 호출당 과금(건당 약 27원)이다. 실호출은 `--ledger` 필수, 원장 누적이 CALL_CAP에 닿으면 호출 전에 멈춘다.
//   저장·재생은 공용 corpus 규약(`scripts/lib/odsay-corpus.mjs`) — `--out` 디렉터리에 있는 응답은 다시 부르지 않는다.
//
// 사용법:
//   live:    node scripts/probe-odsay-maas.mjs --out <dir> --ledger <file>
//   offline: node scripts/probe-odsay-maas.mjs --from-corpus <dir>
//   (응답은 저장소 밖 사설 경로에 둔다 — 저장소 안 경로는 lib가 거절한다)
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { corpusDirProblem, OFFLINE_KEY_PLACEHOLDER, openCorpus, requestKey } from "./lib/odsay-corpus.mjs";

const CALL_CAP = 10;
const REFERER = "https://gildongmu.dodoplanet.space/";

function parseArgs(argv) {
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    if (!["--out", "--ledger", "--from-corpus"].includes(key)) throw new Error(`모르는 인자 ${key}`);
    const value = argv[++i];
    if (!value) throw new Error(`${key} 값 없음`);
    opts[key] = value;
  }
  if (opts["--from-corpus"] && (opts["--out"] || opts["--ledger"])) {
    throw new Error("--from-corpus는 단독으로만(원본 읽기 전용, 호출 0)");
  }
  if (!opts["--from-corpus"] && !(opts["--out"] && opts["--ledger"])) {
    throw new Error("live는 --out과 --ledger가 모두 필요하다(호출 원장 없는 실호출 금지)");
  }
  return opts;
}

let opts;
try {
  opts = parseArgs(process.argv.slice(2));
  const dir = opts["--from-corpus"] ?? opts["--out"];
  const problem = corpusDirProblem(dir, Boolean(opts["--from-corpus"]));
  if (problem) throw new Error(problem);
} catch (e) {
  console.error(`인자 오류: ${e.message}`);
  process.exit(64);
}
const offline = Boolean(opts["--from-corpus"]);
if (offline) process.env.ODSAY_API_KEY = OFFLINE_KEY_PLACEHOLDER;
try {
  for (const line of readFileSync(".env.local", "utf8").split("\n")) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
} catch { /* 환경변수 직접 주입 */ }

const corpus = openCorpus({ dir: opts["--from-corpus"] ?? opts["--out"], offline, shouldStore: () => true });

function ledgerCount() {
  const file = opts["--ledger"];
  if (!file || !existsSync(file)) return 0;
  return readFileSync(file, "utf8").split("\n").filter(Boolean).length;
}

/** 저장본이 있으면 재생, 없으면 원장 상한을 확인하고 한 번 부른다. */
async function odsay(endpoint, params) {
  const q = new URLSearchParams(params);
  const url = `https://api.odsay.com/v1/api/${endpoint}?${q.toString()}`;
  const key = requestKey(url);
  return corpus.fetchOrReplay(key, async () => {
    if (ledgerCount() >= CALL_CAP) {
      throw new Error(`호출 원장이 상한 ${CALL_CAP}건에 닿았다 — 위원장 판정 없이 더 부르지 않는다`);
    }
    appendFileSync(opts["--ledger"], `${new Date().toISOString()}\t${key}\n`);
    const res = await fetch(`${url}&apiKey=${process.env.ODSAY_API_KEY ?? ""}`, { headers: { Referer: REFERER } });
    const text = await res.text();
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
    return JSON.parse(text);
  });
}

// 표본: 공개 역 좌표(카카오 키워드 검색 `{역}역 {노선}`의 장소 좌표, 2026-10-17). 4자리 반올림은 provider와 같다.
const r4 = (n) => n.toFixed(4);
const ST = {
  yongsan1: { name: "용산", lat: 37.52977, lng: 126.96463 },
  bucheon1: { name: "부천", lat: 37.48399, lng: 126.78308 },
  ahyeon2: { name: "아현", lat: 37.55741, lng: 126.95615 },
  gwanghwamun5: { name: "광화문", lat: 37.57165, lng: 126.97642 },
  sinchonGj: { name: "신촌", lat: 37.55968, lng: 126.94209 },
  seoul1: { name: "서울역", lat: 37.55598, lng: 126.97209 },
  suwon1: { name: "수원", lat: 37.26568, lng: 127.00005 },
};
const PAIRS = [
  ["yongsan1", "bucheon1", "1호선 급행이 서는 두 역"],
  ["ahyeon2", "gwanghwamun5", "환승 1회(2호선→5호선) vs 버스"],
  ["sinchonGj", "seoul1", "같은 이름 다른 역(경의중앙선 신촌 ↔ 2호선 신촌)"],
  ["seoul1", "suwon1", "출발역에 노선이 여럿"],
];
const coordParams = (a, b) => ({ SX: r4(ST[a].lng), SY: r4(ST[a].lat), EX: r4(ST[b].lng), EY: r4(ST[b].lat) });
// 정해진 미래 평일 오전(키 결정론). 요일 판정에 쓰지 않는다.
const SEARCH_TIME = "202610201000";

const norm = (s) => String(s ?? "").replace(/\s+/g, "").replace(/역$/, "");
const laneName = (sp) => {
  const l = (sp.lane ?? [])[0] ?? {};
  return l.name ?? l.busNo ?? "?";
};

function describePubTrans(body, from, to) {
  const err = body?.error;
  if (err) return { error: JSON.stringify(err) };
  const paths = body?.result?.path ?? [];
  const rows = paths.map((p, i) => {
    const rides = p.subPath.filter((s) => s.trafficType !== 3);
    const first = rides[0];
    const last = rides[rides.length - 1];
    const boardsAt = first?.trafficType === 1 && norm(first.startName) === norm(ST[from].name);
    const alightsAt = last?.trafficType === 1 && norm(last.endName) === norm(ST[to].name);
    const desc = rides
      .map((s) => `${s.trafficType === 1 ? "S" : s.trafficType === 2 ? "B" : `T${s.trafficType}`}:${laneName(s)}[${s.startName}→${s.endName}]`)
      .join(" > ");
    return { i, pathType: p.pathType, min: p.info.totalTime, designated: boardsAt && alightsAt, boardsAt, alightsAt, desc };
  });
  return { count: paths.length, rows };
}

function describeMaas(body) {
  if (body?.error) return { error: JSON.stringify(body.error) };
  const r = body?.result ?? {};
  const counts = Object.fromEntries(Object.entries(r).filter(([k]) => k.endsWith("_pathCnt")));
  const paths = r.paths ?? r.path ?? [];
  const types = paths.map((p) => ({
    pathType: p.pathType,
    pathSubType: p.pathSubType,
    totalTime: p.totalTime,
    traffic: (p.rps ?? p.subPath ?? []).map((x) => x.trafficType),
  }));
  return { topKeys: Object.keys(r), counts, paths: types };
}

const out = { maas: {}, pubtrans: {}, subwayOnly: {}, subwayPath: {} };

// (1) maasRP — 문서의 수단(1,2) 한 번, 문서에 없는 값(5) 한 번. 서울역 → 수원역.
out.maas.documented = describeMaas(
  await odsay("maasRP", { ...coordParams("seoul1", "suwon1"), SearchTime: SEARCH_TIME, SearchMethod: "1,2" }),
);
out.maas.undocumented5 = describeMaas(
  await odsay("maasRP", { ...coordParams("seoul1", "suwon1"), SearchTime: SEARCH_TIME, SearchMethod: "5" }),
);

// (2) searchPubTransPathT 역 → 역(provider와 같은 파라미터 OPT=0).
const bodies = {};
for (const [a, b, why] of PAIRS) {
  const body = await odsay("searchPubTransPathT", { ...coordParams(a, b), OPT: "0" });
  bodies[`${a}-${b}`] = body;
  out.pubtrans[`${a}-${b}`] = { why, ...describePubTrans(body, a, b) };
}
// 지정 역 경로가 후보에 없던 쌍만 지하철만 재조회(SearchPathType=1). 상한 안에 들도록 앞의 둘까지만.
const lacking = PAIRS.filter(([a, b]) => {
  const d = out.pubtrans[`${a}-${b}`];
  return !d.error && !d.rows?.some((r) => r.designated);
}).slice(0, 2);
// 1순위가 지정 역이 아니었던 쌍(아현 → 광화문, 1순위 애오개 승차)도 지하철만 재조회가 지정 역 경로를 앞에 주는지 본다.
const firstNotDesignated = PAIRS.filter(([a, b]) => {
  const d = out.pubtrans[`${a}-${b}`];
  return !d.error && d.rows?.length && !d.rows[0].designated && d.rows.some((r) => r.designated);
}).slice(0, 1);
for (const [a, b] of [...lacking, ...firstNotDesignated]) {
  const body = await odsay("searchPubTransPathT", { ...coordParams(a, b), OPT: "0", SearchPathType: "1" });
  out.subwayOnly[`${a}-${b}`] = describePubTrans(body, a, b);
}

// (3) subwayPath — 용산 → 부천을 역 번호로. 번호는 (2) 응답의 지하철 구간에서 읽는다.
const yb = bodies["yongsan1-bucheon1"]?.result?.path ?? [];
const seg = yb.flatMap((p) => p.subPath).find((s) => s.trafficType === 1 && norm(s.startName) === "용산");
const segEnd = yb.flatMap((p) => p.subPath).find((s) => s.trafficType === 1 && norm(s.endName) === "부천");
if (seg && segEnd) {
  const body = await odsay("subwayPath", { CID: "1000", SID: String(seg.startID), EID: String(segEnd.endID), Sopt: "1" });
  const r = body?.result;
  out.subwayPath = body?.error
    ? { error: JSON.stringify(body.error) }
    : {
        start: r?.globalStartName,
        end: r?.globalEndName,
        minutes: r?.globalTravelTime,
        drive: (r?.driveInfoSet?.driveInfo ?? []).map((d) => `${d.laneName} ${d.startName} ${d.stationCount}정거장 ${d.wayName}`),
        keys: Object.keys(r ?? {}),
      };
} else {
  out.subwayPath = { skipped: "용산·부천 역 번호를 (2) 응답에서 찾지 못했다" };
}

console.log(JSON.stringify(out, null, 2));
console.error(corpus.summary() + (offline ? "" : ` · 원장 누적 ${ledgerCount()}/${CALL_CAP}`));
corpus.exitIfMissed();
