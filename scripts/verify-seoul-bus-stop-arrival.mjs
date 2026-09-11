#!/usr/bin/env node
// 실호출 조사 — 서울버스 도착 API의 "곧 도착"이 정차인가(A41, spec 2026-09-12 §0).
//
// 한 정류소(getStationByUid)를 일정 간격으로 폴해 **차량 단위**로 상태 전이를 기록한다.
// 한 호출이 그 정류소 전 노선을 주므로 정류소 단위 폴이 차량 표본을 가장 싸게 모은다.
// 보는 것 셋: ①"곧 도착" 동안 isArrive1·stationNm1·sectOrd1이 "이 정류소 정차"를 가르는가
// ②정차 뒤 그 차량이 목록에서 언제 사라지는가(출발 신호) ③"곧 도착"이 얼마나 유지되는가.
// 잔여 ≤1 차량이 있으면 그 노선의 getArrInfoByRoute(승차 후 하차 카운트다운 op)도 함께
// 받아 두 op의 필드가 같은지 본다(상한 --byRouteMax).
//
// ⚠ 프로덕션 쿼터(DATA_GO_KR_API_KEY)를 공유한다 — 기본 상한 60폴 + byRoute 15회.
// 폴마다 JSONL로 부분 저장하고, `--from-corpus <jsonl>`은 호출 없이 요약만 다시 낸다.
//
// 사용법: node scripts/verify-seoul-bus-stop-arrival.mjs --arsId 03012 [--interval 15] [--max 60]
//         [--out /path/samples.jsonl] [--byRouteMax 15] [--from-corpus /path/samples.jsonl]
import { readFileSync, appendFileSync, existsSync } from "node:fs";

try {
  for (const line of readFileSync(".env.local", "utf8").split("\n")) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
} catch { /* 환경변수 직접 주입 */ }

const args = Object.fromEntries(
  process.argv.slice(2).map((a, i, arr) => (a.startsWith("--") ? [a.slice(2), arr[i + 1] ?? "1"] : [])).filter((p) => p.length),
);
const arsId = args.arsId ?? "03012";
// 숫자 인자는 유한값만 받고 폴 간격은 5초 하한 — NaN이 setTimeout에 들어가면 쉼 없이 연타한다(프로덕션 쿼터 공유).
function num(v, fallback, min = 0) {
  const n = Number(v ?? fallback);
  if (!Number.isFinite(n) || n < min) {
    console.error(`잘못된 숫자 인자: ${v} (하한 ${min})`);
    process.exit(2);
  }
  return n;
}
const intervalMs = num(args.interval, 15, 5) * 1000;
const maxPolls = num(args.max, 60);
const byRouteMax = num(args.byRouteMax, 15);
const out = args.out ?? `seoul-bus-arrival-${arsId}-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "")}.jsonl`;

const BASE = "http://ws.bus.go.kr/api/rest";
const key = process.env.DATA_GO_KR_API_KEY;

function items(raw) {
  const list = raw?.msgBody?.itemList;
  return Array.isArray(list) ? list : list ? [list] : [];
}

async function call(path, params) {
  const url = new URL(`${BASE}/${path}`);
  url.searchParams.set("serviceKey", key);
  url.searchParams.set("resultType", "json");
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${path} HTTP ${res.status}`);
  const data = await res.json();
  const cd = String(data?.msgHeader?.headerCd ?? "");
  if (cd !== "0" && cd !== "4") throw new Error(`${path} headerCd ${cd}: ${data?.msgHeader?.headerMsg}`);
  return data;
}

/** 한 항목의 슬롯 n을 관측 행으로 투영(vehId 0은 빈 슬롯). */
function slotRow(t, source, it, n) {
  const vehId = String(it[`vehId${n}`] ?? "");
  if (!vehId || vehId === "0") return null;
  const staOrd = Number(it.staOrd);
  const sectOrd = Number(it[`sectOrd${n}`]);
  return {
    t,
    source,
    route: String(it.rtNm ?? ""),
    busRouteId: String(it.busRouteId ?? ""),
    stId: String(it.stId ?? ""),
    staOrd,
    slot: n,
    vehId,
    arrmsg: String(it[`arrmsg${n}`] ?? ""),
    arrmsgSec: String(it[`arrmsgSec${n}`] ?? ""),
    sectOrd,
    remaining: Number.isFinite(staOrd) && Number.isFinite(sectOrd) ? staOrd - sectOrd : null,
    isArrive: String(it[`isArrive${n}`] ?? ""),
    stationNm: String(it[`stationNm${n}`] ?? "").trim(),
    traTime: String(it[`traTime${n}`] ?? ""),
    repTm: String(it[`repTm${n}`] ?? ""),
    isLast: String(it[`isLast${n}`] ?? ""),
  };
}

function stateKey(r) {
  return `${r.arrmsg}|sect=${r.sectOrd}|rem=${r.remaining}|isArrive=${r.isArrive}|stn=${r.stationNm}`;
}

function summarize(rows) {
  // 차량(노선+vehId) 단위 상태 시퀀스. byRoute 표본은 같은 차량 행에 병기.
  const byVeh = new Map();
  for (const r of rows) {
    const k = `${r.route}/${r.vehId}`;
    if (!byVeh.has(k)) byVeh.set(k, []);
    byVeh.get(k).push(r);
  }
  const lines = [];
  for (const [k, list] of byVeh) {
    list.sort((a, b) => a.t.localeCompare(b.t));
    const uid = list.filter((r) => r.source === "byUid");
    if (!uid.some((r) => /^곧\s*도착/.test(r.arrmsg) || (r.remaining !== null && r.remaining <= 1))) continue; // 근접 관측 없는 차량은 생략
    lines.push(`\n## ${k} (staOrd ${list[0].staOrd})`);
    let prev = null;
    let since = null;
    for (const r of list) {
      const sk = `${r.source}:${stateKey(r)}`;
      if (sk !== prev) {
        if (prev && since) lines.push(`   … ${since.slice(11, 19)}~${r.t.slice(11, 19)}`);
        lines.push(`- ${r.t.slice(11, 19)} [${r.source}] ${r.arrmsg} | sectOrd ${r.sectOrd} rem ${r.remaining} | isArrive ${r.isArrive} | stationNm "${r.stationNm}" | traTime ${r.traTime} | repTm ${r.repTm.slice(11, 19)} | sec "${r.arrmsgSec}"`);
        prev = sk;
        since = r.t;
      }
    }
    lines.push(`- 마지막 관측 ${list[list.length - 1].t.slice(11, 19)}`);
  }
  return lines.join("\n");
}

function loadCorpus(path) {
  return readFileSync(path, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
}

if (args["from-corpus"]) {
  const rows = loadCorpus(args["from-corpus"]);
  console.log(`corpus ${rows.length}행`);
  console.log(summarize(rows));
  process.exit(0);
}

if (!key) {
  console.error("DATA_GO_KR_API_KEY 없음");
  process.exit(2);
}

const rows = existsSync(out) ? loadCorpus(out) : [];
const seen = new Map(); // vehKey → 마지막 stateKey
let byRouteCalls = 0;
let polls = 0;
let stopping = false;
let wakeUp = null;
// Ctrl-C: 대기 중이면 즉시 깨워 요약으로 넘어가고, 두 번째는 그대로 종료한다.
process.on("SIGINT", () => {
  if (stopping) process.exit(130);
  stopping = true;
  wakeUp?.();
});
const sleep = (ms) => new Promise((resolve) => { wakeUp = resolve; setTimeout(resolve, ms); });

console.log(`arsId ${arsId} · ${intervalMs / 1000}s × ${maxPolls}폴 · byRoute ≤${byRouteMax} · out ${out}`);

while (polls < maxPolls && !stopping) {
  polls += 1;
  const t = new Date().toISOString();
  let batch = [];
  try {
    const raw = await call("stationinfo/getStationByUid", { arsId });
    for (const it of items(raw)) {
      for (const n of ["1", "2"]) {
        const r = slotRow(t, "byUid", it, n);
        if (r) batch.push(r);
      }
    }
  } catch (e) {
    console.log(`${t.slice(11, 19)} 폴 실패(격리): ${e.message}`);
    await sleep(intervalMs);
    continue;
  }
  // 근접 차량의 노선은 getArrInfoByRoute도 받아 두 op의 필드를 대조한다.
  const near = batch.filter((r) => /^곧\s*도착/.test(r.arrmsg) || (r.remaining !== null && r.remaining <= 1));
  const nearRoutes = [...new Set(near.map((r) => `${r.busRouteId}|${r.stId}|${r.staOrd}`))];
  for (const nr of nearRoutes) {
    if (byRouteCalls >= byRouteMax) break;
    const [busRouteId, stId, ord] = nr.split("|");
    byRouteCalls += 1;
    try {
      const raw = await call("arrive/getArrInfoByRoute", { stId, busRouteId, ord });
      for (const it of items(raw)) {
        for (const n of ["1", "2"]) {
          const r = slotRow(t, "byRoute", it, n);
          if (r) batch.push(r);
        }
      }
    } catch (e) {
      console.log(`${t.slice(11, 19)} byRoute 실패(격리): ${e.message}`);
    }
  }
  for (const r of batch) appendFileSync(out, JSON.stringify(r) + "\n");
  rows.push(...batch);

  // 전이 로그: 상태가 바뀐 차량과 사라진 차량만 출력.
  const nowKeys = new Set();
  for (const r of batch.filter((r) => r.source === "byUid")) {
    const vk = `${r.route}/${r.vehId}`;
    nowKeys.add(vk);
    const sk = stateKey(r);
    if (seen.get(vk) !== sk) {
      if (r.remaining !== null && r.remaining <= 2) {
        console.log(`${t.slice(11, 19)} ${vk}: ${r.arrmsg} | rem ${r.remaining} isArrive ${r.isArrive} stn "${r.stationNm}" traTime ${r.traTime}`);
      }
      seen.set(vk, sk);
    }
  }
  for (const vk of [...seen.keys()]) {
    if (!nowKeys.has(vk)) {
      const last = seen.get(vk);
      if (/곧\s*도착|rem=[01]\|/.test(last)) console.log(`${t.slice(11, 19)} ${vk}: 목록에서 사라짐 (직전 ${last})`);
      seen.delete(vk);
    }
  }
  const fast = near.length > 0;
  if (polls < maxPolls && !stopping) await sleep(fast ? Math.min(intervalMs, 10_000) : intervalMs);
}

console.log(`\n폴 ${polls}회 · byRoute ${byRouteCalls}회 · 행 ${rows.length}`);
console.log(summarize(rows));
