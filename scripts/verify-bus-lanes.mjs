#!/usr/bin/env node
// 실호출 게이트 — E76 버스 노선 집합(spec `docs/superpowers/specs/2026-10-31-e76-bus-lane-set-design.md` §8).
//
// 재는 것 세 층(판정 로직은 이 스크립트에 복제하지 않는다 — provider·서비스 계층을 그대로 태운다):
//   ① 경로 조회(`getTransitRoute`, `includeStops`·`includeLanes`): 서울 버스 leg 중 `lanes`(둘 이상)가 실린 것이 있는가.
//      첫 항목이 leg 자신인가(`lineName`·`serviceRouteId` 일치).
//   ② 같은 하차 정류소(위원장 판정 ⓑ): 집합의 노선마다 TOPIS 경유 정류소(`fetchSeoulRouteStops`)에서 승차 정류소 뒤에
//      하차 정류소가 오는가(`pickAlightOrd` 비-null). ODsay가 한 subPath로 묶은 노선이 정말 같은 정류소 쌍을 잇는지.
//   ③ 키 호환: 승차 정류소 도착(`trackSeoulWait` 집합 폴)에 집합의 노선 ID(= ODsay busLocalBlID)가 나타나는가.
//      하나도 안 나타나면 키가 어긋난 것이라 FAIL, 일부만 없으면 WARN(운행 시간 밖·차고지 대기 노선은 도착 항목이
//      없을 수 있다 — 낮 시간에 돌린다).
//   ②' 사이 정류소: 그 노선의 승차→하차 정거장 수가 leg 경유(viaStops, 첫 노선 것)와 다르면 WARN — 고른 노선으로
//      leg를 바꿔도 경유는 첫 노선 것이라 승차 중 정류소 기반 안내가 어긋날 수 있다(spec §4.3).
//   통과 조건: ① 집합 leg ≥ 1 ∧ ② 전 노선 통과 ∧ ③ leg마다 1개 이상 ∧ 측정 못 한 표본 0.
//
// 저장·재생: `--out <dir>`는 응답을 요청 단위 파일로 저장하고(있으면 다시 부르지 않는다), `--from-corpus <dir>`는 호출 없이
//   저장본만 읽는다. 단 ③은 실시간 도착이라 재생은 저장 시점의 사실만 말한다. 저장소 밖 경로만 받는다(공개 저장소).
// 비용: ODsay는 호출당 과금이라 실호출 상한 `ODSAY_CAP`. TOPIS·data.go.kr은 무료지만 일 트래픽을 정식판과 나눠 `BUS_CAP`.
//   표본은 공개 명소만(자택 근처·위원장 실조회 구간 금지 — 실승차 증상 구간도 표본으로 쓰지 않는다).
//
// 사용법:
//   live:    node scripts/verify-bus-lanes.mjs --out <dir>
//   offline: node scripts/verify-bus-lanes.mjs --from-corpus <dir>
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";

const ODSAY_CAP = 4;
// 운행시간은 집합 노선만이 아니라 후보 경로 전체의 버스 노선마다 1회다(게이트는 캐시를 걷어 내 매번 실호출 — 운영은
// 하루 캐시). 표본 셋 첫 실행이 운행시간만 70회 남짓을 썼다(2026-10-31). 여기에 경유 정류소(노선당 1)·정류소 도착(leg당 1).
const BUS_CAP = 160;
const MAX_LEGS = 4; // 집합 leg를 이만큼만 잰다(TOPIS 트래픽 상한)

// 공개 명소 좌표(누구나 아는 랜드마크 중심 근사).
const P = {
  ahyeon: { name: "아현역", coord: { lat: 37.5574, lng: 126.9562 } },
  gwanghwamun: { name: "광화문광장", coord: { lat: 37.5725, lng: 126.9769 } },
  sinchon: { name: "신촌역", coord: { lat: 37.5552, lng: 126.9369 } },
  seoulStn: { name: "서울역", coord: { lat: 37.5547, lng: 126.9707 } },
  cityHall: { name: "서울시청", coord: { lat: 37.5663, lng: 126.9779 } },
  dongdaemun: { name: "동대문디자인플라자", coord: { lat: 37.5665, lng: 127.0092 } },
};
const SAMPLES = [
  { label: "아현역 → 광화문", from: P.ahyeon, to: P.gwanghwamun },
  { label: "신촌역 → 서울역", from: P.sinchon, to: P.seoulStn },
  { label: "서울시청 → 동대문디자인플라자", from: P.cityHall, to: P.dongdaemun },
];

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
  for (const k of ["ODSAY_API_KEY", "DATA_GO_KR_API_KEY", "TOUR_API_KEY"]) process.env[k] ||= "corpus-replay-no-key";
}

// fetch 가로채기 — 요청(메서드·URL, 키 쿼리 제외) 하나 = 파일 하나. 상한은 corpus 폴더 단위 누적이다.
const SECRET_PARAMS = ["apiKey", "serviceKey", "ServiceKey"];
const realFetch = globalThis.fetch;
const counts = { odsay: 0, bus: 0, replay: 0 };
const CAPS = { odsay: ODSAY_CAP, bus: BUS_CAP };
const ledgerFile = join(opts.dir, "_live-calls.json");
const ledger = existsSync(ledgerFile) ? JSON.parse(readFileSync(ledgerFile, "utf8")) : {};
const spent = (cls) => (ledger[cls] ?? 0) + counts[cls];
globalThis.fetch = async (input, init = {}) => {
  const url = String(input instanceof URL ? input : input.url ?? input);
  const u = new URL(url);
  for (const p of SECRET_PARAMS) u.searchParams.delete(p);
  const cls = u.host.endsWith("odsay.com") ? "odsay" : "bus";
  const key = createHash("sha1").update(`${init.method ?? "GET"} ${u} ${init.body ?? ""}`).digest("hex").slice(0, 20);
  const file = join(opts.dir, `${cls}-${key}.json`);
  if (existsSync(file)) {
    counts.replay++;
    const { status, body } = JSON.parse(readFileSync(file, "utf8"));
    return new Response(body, { status });
  }
  if (opts.offline) throw new Error(`corpus에 응답 없음: ${cls} ${u.pathname}`);
  if (spent(cls) >= CAPS[cls]) throw new Error(`${cls} 실호출 상한 ${CAPS[cls]} 도달 — 멈추고 보고한다`);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- Next 전용 캐시 옵션을 걷어 낸다
  const { next: _next, ...rest } = init;
  counts[cls]++;
  writeFileSync(ledgerFile, JSON.stringify({ ...ledger, ...Object.fromEntries(Object.keys(CAPS).map((c) => [c, spent(c)])) }));
  const res = await realFetch(url, rest);
  const body = await res.text();
  // 실패 응답은 저장하지 않는다. ODsay는 오류도 HTTP 200 + error 봉투, data.go.kr은 resultCode 비"00"이다.
  const odsayError = cls === "odsay" && /"error"\s*:/.test(body);
  const dataGoKrError = /"resultCode"\s*:\s*"(?!00")/.test(body);
  if (res.ok && !odsayError && !dataGoKrError) writeFileSync(file, JSON.stringify({ status: res.status, body }));
  return new Response(body, { status: res.status });
};

// provider·서비스 계층을 그대로 태운다(판정 로직 복제 금지).
const workDir = mkdtempSync(join(tmpdir(), "bus-lanes-gate-"));
const entryPath = join(workDir, "entry.ts");
const bundlePath = join(workDir, "bundle.mjs");
const stubPath = join(workDir, "next-cache-stub.mjs");
writeFileSync(stubPath, "export const unstable_cache = (fn) => fn;\n");
writeFileSync(
  entryPath,
  [
    `export { getTransitRoute } from ${JSON.stringify(resolve("src/lib/providers/odsay"))};`,
    `export { fetchSeoulRouteStops } from ${JSON.stringify(resolve("src/lib/providers/seoul-bus"))};`,
    `export { pickAlightOrd, trackSeoulWait } from ${JSON.stringify(resolve("src/lib/transit-track"))};`,
  ].join("\n"),
);
execFileSync(
  "npx",
  ["esbuild", entryPath, "--bundle", "--format=esm", "--platform=node", `--alias:next/cache=${stubPath}`, `--outfile=${bundlePath}`],
  { stdio: "pipe" },
);
const { getTransitRoute, fetchSeoulRouteStops, pickAlightOrd, trackSeoulWait } = await import(bundlePath);

let failed = 0;
let unmeasured = 0;
let warned = 0;
let measuredLegs = 0;
const rows = [];
const seen = new Set();
for (const s of SAMPLES) {
  try {
    rows.push(`  ${s.label}`);
    const result = await getTransitRoute({ origin: s.from.coord, dest: s.to.coord, includeStops: true, includeLanes: true });
    if (!result) {
      unmeasured++;
      rows.push("    UNMEASURED 경로 없음");
      continue;
    }
    const routes = [result.recommended, ...result.alternatives];
    const laneLegs = routes
      .flatMap((r) => r.legs)
      .filter((l) => l.mode === "bus" && l.lanes && l.stops?.length >= 2)
      .filter((l) => l.stops[0].cityCode === "1000" && l.stops[l.stops.length - 1].cityCode === "1000");
    rows.push(`    경로 ${routes.length}개, 서울 버스 집합 leg ${laneLegs.length}개`);
    for (const leg of laneLegs) {
      const board = leg.stops[0];
      const alight = leg.stops[leg.stops.length - 1];
      const legKey = `${board.localId}>${alight.localId}:${leg.lanes.map((l) => l.serviceRouteId).join(",")}`;
      if (seen.has(legKey) || measuredLegs >= MAX_LEGS) continue;
      seen.add(legKey);
      measuredLegs++;
      rows.push(`    ${board.name} → ${alight.name}: ${leg.lanes.map((l) => l.lineName).join(", ")}`);
      // ①
      const head = leg.lanes[0];
      if (head.lineName !== leg.lineName || head.serviceRouteId !== leg.serviceRouteId) {
        failed++;
        rows.push(`      FAIL ① 첫 항목이 leg 자신이 아니다(${head.lineName}/${head.serviceRouteId})`);
      }
      // ②
      for (const lane of leg.lanes) {
        if (!lane.serviceRouteId) {
          warned++;
          rows.push(`      WARN ② ${lane.lineName}: 노선 ID 없음(대기 폴 대상 밖)`);
          continue;
        }
        const stops = await fetchSeoulRouteStops(lane.serviceRouteId);
        const ord = pickAlightOrd(stops, board.localId, alight.localId);
        if (ord == null) failed++;
        rows.push(`      ${ord == null ? "FAIL" : "PASS"} ② ${lane.lineName}: 경유 ${stops.length}곳, 하차 순번 ${ord ?? "없음"}`);
        // ②' 사이 정류소(spec §4.3 위험): 고른 노선으로 바꿔도 경유 정류소(viaStops)는 첫 노선 것이다. 이 노선의
        //   승차→하차 사이 정류소 수가 leg의 정거장 수와 다르면 승차 중 정류소 기반 안내가 어긋날 수 있다 — WARN.
        if (ord != null) {
          const boardOrd = Math.min(...stops.filter((x) => x.nodeId === board.localId && x.order < ord).map((x) => x.order));
          const between = ord - boardOrd;
          const legCount = leg.stops.length - 1;
          if (between !== legCount) {
            warned++;
            rows.push(`      WARN ②' ${lane.lineName}: 승차→하차 ${between}정거장, leg 경유 ${legCount}정거장 — 사이 정류소가 다르다`);
          }
        }
      }
      // ③
      const ids = leg.lanes.flatMap((l) => (l.serviceRouteId ? [l.serviceRouteId] : []));
      const wait = await trackSeoulWait({ arsId: board.arsId, routeIds: ids, lang: "ko" });
      const present = new Set(wait.status === "ok" ? wait.items.map((i) => i.route) : []);
      const missing = leg.lanes.filter((l) => l.serviceRouteId && !present.has(l.serviceRouteId)).map((l) => l.lineName);
      const rawCount = wait.status === "unsupported" ? 0 : wait.rawCount;
      if (present.size === 0) {
        failed++;
        rows.push(`      FAIL ③ 정류소 도착 ${rawCount}건 중 집합 노선 0 — 키 어긋남 의심`);
      } else if (missing.length > 0) {
        warned++;
        rows.push(`      WARN ③ 정류소 도착 ${rawCount}건, 집합 중 도착 없음: ${missing.join(", ")}`);
      } else {
        rows.push(`      PASS ③ 정류소 도착 ${rawCount}건에 집합 노선 전부`);
      }
      if (wait.status === "ok") {
        rows.push(`      후보 ${wait.items.length}건(잔여순): ${wait.items.slice(0, 5).map((i) => `${leg.lanes.find((l) => l.serviceRouteId === i.route)?.lineName ?? i.route} ${i.message}`).join(" / ")}`);
      }
    }
  } catch (e) {
    unmeasured++;
    if (String(e).includes("상한")) {
      console.error(`STOP: ${e.message}`);
      break;
    }
    rows.push(`    UNMEASURED: ${String(e).slice(0, 200)}`);
  }
}

console.log(rows.join("\n"));
console.log(`\n실호출 ODsay ${counts.odsay} · TOPIS·공공 ${counts.bus}, 재생 ${counts.replay}, WARN ${warned}`);
if (measuredLegs === 0) {
  console.error("FAIL: 집합 leg를 하나도 재지 못했다");
  process.exit(1);
}
if (failed > 0 || unmeasured > 0) {
  console.error(`FAIL: 실패 ${failed} · 측정 못 함 ${unmeasured}`);
  process.exit(1);
}
console.log(`PASS: 서울 버스 집합 leg ${measuredLegs}개 — 같은 하차 정류소·키 호환 통과`);
