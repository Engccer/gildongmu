#!/usr/bin/env node
// 실호출 게이트 — E76 후속(spec `docs/superpowers/specs/2026-11-07-e76-followup-design.md` §7). ODsay는 부르지 않는다(유료).
//
// 재는 것(판정 로직은 복제하지 않는다 — 서비스 계층 `trackSeoulLanes`·`trackSeoulWait`·`trackTago`를 그대로 태운다):
//   ⓔ① 재기준 집합: ODsay 실응답 fixture(`src/lib/__tests__/fixtures/odsay-e70/ahyeon-gwanghwamun.json`)의 271번 구간
//       아현역 → 광화문역(localId 100000384)에서 정류장을 고른 경우. 같은 fixture가 그 정류장 → 광화문역을 지나는 다른 노선을
//       보여 주므로(충정로역에서 160·260), 그 노선이 집합에 **반드시** 있어야 한다(부재 FAIL — 우리 판정이 표본을 자르는지 본다).
//       지금 노선(271)은 응답에 없어야 하고, 경유 조회 전부 미확인(unverified == checked)이면 FAIL.
//   ⓔ② 다른 하차 정류장(광화문역6번출구 100000025)으로만 가는 노선(600·602·603)이 섞이면 WARN — TOPIS 경유상 두 정류장을
//       모두 지날 수 있어 FAIL로 단정하지 않는다.
//   ⓔ③ 키 호환: 그 정류장 도착(`trackSeoulWait` 집합 폴)에 새 노선 ID가 하나라도 나타나는가(낮 시간 — 없으면 UNMEASURED).
//   ⓓ  지방버스 집합 폴: 공개 명소(대전역) 정류소 해석 → 전체 도착에서 노선 둘을 골라 `routeNos` 폴 — 항목이 그 노선뿐이고
//       `route`를 싣고 잔여순인가. 단일 노선 폴은 `route`가 없다(byte-호환). 정류소 해석·도착 0건은 UNMEASURED(시간대).
//
// 저장·재생: `--out <dir>`는 응답을 요청 단위 파일로 저장하고(있으면 다시 부르지 않는다), `--from-corpus <dir>`는 호출 없이
//   저장본만 읽는다. 저장소 밖 경로만 받는다(공개 저장소). TAGO 동시 세션 한도(200 + resultCode 99)는 저장하지 않는다.
// 비용: TOPIS·data.go.kr은 무료지만 일 트래픽을 정식판과 나눠 `BUS_CAP`. 표본은 공개 명소·공개 fixture 구간만.
//
// 사용법:
//   live:    node scripts/verify-bus-lanes-followup.mjs --out <dir>
//   offline: node scripts/verify-bus-lanes-followup.mjs --from-corpus <dir>
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";

const BUS_CAP = 60;

// fixture 271번 구간(위 주석). 정류장 ID는 fixture 값 그대로.
const ALIGHT_LOCAL_ID = "100000384"; // 광화문역
const CURRENT_ROUTE = { routeId: "100100047", lineName: "271" };
const REANCHORS = [
  {
    label: "충정로역(경유 1번째)",
    arsId: "13045",
    localId: "112000430",
    // fixture: 160(100100033)·260(100100042)이 충정로역 → 광화문역을 지난다.
    mustInclude: [
      { routeId: "100100033", lineName: "160" },
      { routeId: "100100042", lineName: "260" },
    ],
  },
  {
    label: "서울역사박물관.경희궁앞(하차 직전)",
    arsId: "01007",
    localId: "100000380",
    // fixture: 160·260·370(100100061)이 이 정류장 → 광화문역을 지난다.
    mustInclude: [
      { routeId: "100100033", lineName: "160" },
      { routeId: "100100042", lineName: "260" },
      { routeId: "100100061", lineName: "370" },
    ],
  },
];
// 광화문역6번출구(100000025)로 가는 노선(fixture) — 섞이면 WARN.
const OTHER_ALIGHT_ONLY = new Set(["100100085", "100100087", "100100088"]);
// 공개 명소 대전역 앞 정류소 하나 위(같은 이름 쌍이 40m 밖이라 해석이 모호하지 않다 — `pickTagoStop`).
const TAGO_SAMPLE = { label: "대전역/역전시장", coord: { lat: 36.33012, lng: 127.433365 } };

function parseArgs(argv) {
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    if (!["--out", "--from-corpus"].includes(key)) throw new Error(`인자 오류: 모르는 인자 ${key}`);
    const value = argv[++i];
    if (!value) throw new Error(`인자 오류: ${key} 값 없음`);
    opts[key] = value;
  }
  if (!!opts["--out"] === !!opts["--from-corpus"]) throw new Error("인자 오류: --out 또는 --from-corpus 중 하나만");
  const dir = resolve(opts["--out"] ?? opts["--from-corpus"]);
  const rel = relative(process.cwd(), dir);
  if (!rel.startsWith("..") && !isAbsolute(rel)) throw new Error("인자 오류: 저장 경로는 저장소 밖이어야 한다");
  return { dir, offline: Boolean(opts["--from-corpus"]) };
}

let opts;
try {
  opts = parseArgs(process.argv.slice(2));
} catch (e) {
  console.error(`FAIL: ${e.message}`);
  process.exit(64);
}
if (!opts.offline) mkdirSync(opts.dir, { recursive: true });
try {
  for (const line of readFileSync(".env.local", "utf8").split("\n")) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"(.*)"$/, "$1");
  }
} catch { /* CI 등에서는 환경변수 직접 주입 */ }
if (opts.offline) {
  for (const k of ["DATA_GO_KR_API_KEY", "TOUR_API_KEY"]) process.env[k] ||= "corpus-replay-no-key";
}

// fetch 가로채기 — 요청(메서드·URL, 키 쿼리 제외) 하나 = 파일 하나. 상한은 corpus 폴더 단위 누적이다.
const SECRET_PARAMS = ["apiKey", "serviceKey", "ServiceKey"];
const realFetch = globalThis.fetch;
const counts = { bus: 0, replay: 0 };
const ledgerFile = join(opts.dir, "_live-calls.json");
const ledger = existsSync(ledgerFile) ? JSON.parse(readFileSync(ledgerFile, "utf8")) : {};
const spent = () => (ledger.bus ?? 0) + counts.bus;
globalThis.fetch = async (input, init = {}) => {
  const url = String(input instanceof URL ? input : input.url ?? input);
  const u = new URL(url);
  if (u.host.endsWith("odsay.com")) throw new Error("ODsay 호출 금지(유료) — 이 게이트는 부르지 않는다");
  for (const p of SECRET_PARAMS) u.searchParams.delete(p);
  const key = createHash("sha1").update(`${init.method ?? "GET"} ${u} ${init.body ?? ""}`).digest("hex").slice(0, 20);
  const file = join(opts.dir, `bus-${key}.json`);
  if (existsSync(file)) {
    counts.replay++;
    const { status, body } = JSON.parse(readFileSync(file, "utf8"));
    return new Response(body, { status });
  }
  if (opts.offline) throw new Error(`corpus에 응답 없음: ${u.pathname}`);
  if (spent() >= BUS_CAP) throw new Error(`실호출 상한 ${BUS_CAP} 도달 — 멈추고 보고한다`);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- Next 전용 캐시 옵션을 걷어 낸다
  const { next: _next, ...rest } = init;
  counts.bus++;
  writeFileSync(ledgerFile, JSON.stringify({ ...ledger, bus: spent() }));
  const res = await realFetch(url, rest);
  const body = await res.text();
  // 실패 응답은 저장하지 않는다(data.go.kr resultCode 비"00" — TAGO 동시 세션 한도 99 포함, TOPIS headerCd 비"0").
  const dataGoKrError = /"resultCode"\s*:\s*"(?!00")/.test(body);
  const topisError = /<headerCd>(?!0<)/.test(body) || /"headerCd"\s*:\s*"(?!0")/.test(body);
  if (res.ok && !dataGoKrError && !topisError) writeFileSync(file, JSON.stringify({ status: res.status, body }));
  return new Response(body, { status: res.status });
};

// 서비스 계층을 그대로 태운다(판정 로직 복제 금지).
const workDir = mkdtempSync(join(tmpdir(), "bus-lanes-followup-gate-"));
const entryPath = join(workDir, "entry.ts");
const bundlePath = join(workDir, "bundle.mjs");
const stubPath = join(workDir, "next-cache-stub.mjs");
writeFileSync(stubPath, "export const unstable_cache = (fn) => fn;\n");
writeFileSync(
  entryPath,
  `export { trackSeoulLanes, trackSeoulWait, resolveTagoStop, trackTago } from ${JSON.stringify(resolve("src/lib/transit-track"))};\n` +
    `export { fetchTagoArrivals } from ${JSON.stringify(resolve("src/lib/providers/tago-bus"))};\n`,
);
execFileSync(
  "npx",
  ["esbuild", entryPath, "--bundle", "--format=esm", "--platform=node", `--alias:next/cache=${stubPath}`, `--outfile=${bundlePath}`],
  { stdio: "pipe" },
);
const { trackSeoulLanes, trackSeoulWait, resolveTagoStop, trackTago, fetchTagoArrivals } = await import(bundlePath);

let failed = 0;
let unmeasured = 0;
let warned = 0;
const rows = [];
const fail = (msg) => {
  failed++;
  rows.push(`      FAIL ${msg}`);
};
const warn = (msg) => {
  warned++;
  rows.push(`      WARN ${msg}`);
};

// ⓔ
for (const r of REANCHORS) {
  rows.push(`  ⓔ ${r.label} → 광화문역, 지금 노선 ${CURRENT_ROUTE.lineName}`);
  try {
    const res = await trackSeoulLanes({
      arsId: r.arsId,
      boardLocalId: r.localId,
      alightLocalId: ALIGHT_LOCAL_ID,
      routeId: CURRENT_ROUTE.routeId,
      lang: "ko",
    });
    rows.push(`      집합 ${res.routes.length}개(경유 조회 ${res.checked}, 미확인 ${res.unverified}): ${res.routes.map((x) => x.lineName).join(", ")}`);
    if (res.checked === 0) fail("① 경유를 조회한 노선이 0 — 정류소 노선 목록이 비었다");
    else if (res.unverified === res.checked) fail("① 경유 조회 전부 미확인(ID 축 어긋남 의심)");
    else if (res.unverified > 0) warn(`① 미확인 ${res.unverified}개(순환·회차·ID 어긋남·조회 실패) — 그 노선은 집합 밖`);
    if (res.routes.some((x) => x.routeId === CURRENT_ROUTE.routeId)) fail("① 지금 노선이 응답에 있다");
    const ids = new Set(res.routes.map((x) => x.routeId));
    for (const m of r.mustInclude) {
      if (ids.has(m.routeId)) rows.push(`      PASS ① ${m.lineName} 포함`);
      else fail(`① ${m.lineName}(${m.routeId}) 없음 — fixture상 이 정류장 → 광화문역을 지난다`);
    }
    for (const x of res.routes) if (OTHER_ALIGHT_ONLY.has(x.routeId)) warn(`② ${x.lineName}: fixture상 6번출구행 — TOPIS 경유를 눈으로 확인`);
    const wait = await trackSeoulWait({ arsId: r.arsId, routeIds: [CURRENT_ROUTE.routeId, ...res.routes.map((x) => x.routeId)].slice(0, 12), lang: "ko" });
    const present = new Set(wait.status === "ok" ? wait.items.map((i) => i.route) : []);
    const seenNew = res.routes.filter((x) => present.has(x.routeId)).map((x) => x.lineName);
    if (res.routes.length > 0 && seenNew.length === 0) {
      // 키 호환은 이 관측으로만 확인된다 — 0은 통과가 아니라 측정 못 함(시간대)이다.
      unmeasured++;
      rows.push(`      UNMEASURED ③ 정류소 도착에 새 노선 0(시간대?) — 도착 ${wait.status === "ok" ? wait.rawCount : 0}건`);
    }
    else rows.push(`      PASS ③ 정류소 도착에 새 노선: ${seenNew.join(", ") || "(집합 없음)"}`);
  } catch (e) {
    unmeasured++;
    rows.push(`      UNMEASURED: ${String(e).slice(0, 200)}`);
    if (String(e).includes("상한")) break;
  }
}

// ⓓ
rows.push(`  ⓓ 지방버스 ${TAGO_SAMPLE.label}`);
try {
  const stop = await resolveTagoStop(TAGO_SAMPLE.coord);
  if (stop.status !== "ok") throw new Error("정류소 해석 unsupported");
  rows.push(`      정류소 ${stop.stop.name}(${stop.stop.cityCode}/${stop.stop.nodeId})`);
  const arrivals = await fetchTagoArrivals(stop.stop.cityCode, stop.stop.nodeId);
  const nos = [...new Set(arrivals.map((a) => a.routeNo).filter(Boolean))];
  if (nos.length < 2) throw new Error(`도착 노선 ${nos.length}개 — 집합 폴을 잴 수 없다(시간대)`);
  const set = nos.slice(0, 2);
  const res = await trackTago({ cityCode: stop.stop.cityCode, nodeId: stop.stop.nodeId, routeNos: set, lang: "ko" });
  if (res.status !== "ok") fail(`집합 폴 status ${res.status}`);
  else {
    const outside = res.items.filter((i) => !set.includes(i.route));
    const rem = res.items.map((i) => i.remainingStops ?? Infinity);
    const sorted = rem.every((v, i) => i === 0 || rem[i - 1] <= v);
    if (res.items.length === 0) fail("집합 폴 항목 0 — 전체 도착엔 있었다");
    else if (outside.length > 0) fail(`집합 밖 항목 ${outside.length}건`);
    else if (!sorted) fail("잔여순이 아니다");
    else rows.push(`      PASS 집합 폴 ${set.join(",")}: ${res.items.map((i) => `${i.route} ${i.remainingStops}`).join(" / ")}`);
  }
  const single = await trackTago({ cityCode: stop.stop.cityCode, nodeId: stop.stop.nodeId, routeNo: set[0], lang: "ko" });
  if (single.status === "ok" && single.items.some((i) => "route" in i)) fail("단일 노선 폴에 route가 실렸다");
  else rows.push("      PASS 단일 노선 폴은 route 없음");
} catch (e) {
  unmeasured++;
  rows.push(`      UNMEASURED: ${String(e).slice(0, 200)}`);
}

console.log(rows.join("\n"));
console.log(`\n실호출 TOPIS·공공 ${counts.bus}, 재생 ${counts.replay}, WARN ${warned}`);
if (failed > 0 || unmeasured > 0) {
  console.error(`FAIL: 실패 ${failed} · 측정 못 함 ${unmeasured}`);
  process.exit(1);
}
console.log("PASS: 재기준 집합·지방버스 집합 폴");
