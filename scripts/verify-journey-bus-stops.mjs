#!/usr/bin/env node
// 실호출 게이트 — E70-e 정류장 지정 여정(spec `docs/superpowers/specs/2026-10-27-e70e-bus-stop-transfer-design.md` §8).
//
// 재는 것 두 층(판정 로직은 이 스크립트에 복제하지 않는다 — 서버 계층을 그대로 태운다):
//   ① 정류장 이름 검색(`searchJourneyStops`, 실 deps — `/api/route/journey/stops`와 같은 계층): TOPIS(서울)·TAGO(지방
//      광역시·도 시군·행정구역과 제공 코드가 어긋나는 지역)가 각각 결과를 주는가, 결과 좌표가 요청 좌표 20km 안인가,
//      `failed`가 없는가. 표본마다 기대 출처(seoul/tago)가 결과에 있어야 PASS.
//   ② 그 결과의 정류장(앵커에 가장 가까운 것)을 여정의 승차·하차 정류장으로 지정한 조립(`getJourney`, `stops`)이
//      지정 경로를 찾는가: 지정 경로 있음 ∧ 그 쪽 끝 탈것이 버스 ∧ (하차면) egress가 `none` 하나 → PASS.
//   통과 조건: 전부 PASS ∧ 측정 못 한 표본 0.
//
// 저장·재생: `--out <dir>`는 응답을 요청 단위 파일로 저장하고(있으면 다시 부르지 않는다), `--from-corpus <dir>`는 호출 없이
//   저장본만 읽는다(없는 요청은 실패). 저장소 밖 경로만 받는다(공개 저장소 — 응답 dump를 커밋하지 않는다).
// 비용: ODsay는 호출당 과금이라 실호출 상한 `ODSAY_CAP`(세션 상한 10)에서 멈춘다. Tmap은 일 무료분을 정식판과 공유해
//   `TMAP_CAP`, 카카오는 `KAKAO_CAP`. TOPIS·TAGO는 무료지만 일 트래픽을 정식판과 나눠 `BUS_CAP`. 표본은 공개 명소만
//   (자택 근처·위원장 실조회 구간 금지).
//
// 사용법:
//   live:    node scripts/verify-journey-bus-stops.mjs --out <dir>
//   offline: node scripts/verify-journey-bus-stops.mjs --from-corpus <dir>
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";

const ODSAY_CAP = 8;
const TMAP_CAP = 15;
const KAKAO_CAP = 14; // 세션 허용 30 중 잔여
const STOP_CAP = 24; // 세션 허용 30 중 사전 실측 2·첫 실행분을 뺀 잔여
const BUS_CAP = 60; // 기존 여정 조립 경로(무료) — 표본당 약 20

// 공개 명소 좌표(누구나 아는 랜드마크 중심 근사).
const P = {
  cityHall: { name: "서울시청", coord: { lat: 37.5663, lng: 126.9779 } },
  gwanghwamun: { name: "광화문광장", coord: { lat: 37.5725, lng: 126.9769 } },
  yonsei: { name: "연세대학교", coord: { lat: 37.5658, lng: 126.9386 } },
  gyeongbokgung: { name: "경복궁", coord: { lat: 37.5796, lng: 126.977 } },
  coex: { name: "코엑스", coord: { lat: 37.5115, lng: 127.0595 } },
  assembly: { name: "국회의사당", coord: { lat: 37.5317, lng: 126.914 } },
  busanStn: { name: "부산역", coord: { lat: 35.1151, lng: 129.0422 } },
  seomyeon: { name: "서면", coord: { lat: 35.1578, lng: 129.0594 } },
  busanPark: { name: "부산시민공원", coord: { lat: 35.168, lng: 129.0573 } },
  suwonStn: { name: "수원역", coord: { lat: 37.2659, lng: 127.0001 } },
  hwaseong: { name: "수원화성", coord: { lat: 37.2871, lng: 127.0119 } },
  damyang: { name: "담양군청", coord: { lat: 35.3212, lng: 126.9881 } },
};

// q: 사용자가 칠 정류장 이름. coords: 여정의 출발·도착(앱이 싣는 좌표). anchor: 고를 정류장의 기준점.
// pick: 고를 정류장 이름(있으면 앵커 최근접 대신 — 후보 경로가 실제로 서는 정류장을 골라 조립 사슬을 잰다).
// journey가 있으면 그 정류장으로 여정을 조회한다(side 쪽 지정).
const SAMPLES = [
  { label: "서울 TOPIS · 승차", q: "덕수궁", expect: "seoul", from: P.coex, to: P.yonsei, anchor: P.cityHall, journey: "board" },
  { label: "서울 TOPIS · 하차", q: "광화문", expect: "seoul", from: P.assembly, to: P.gyeongbokgung, anchor: P.gwanghwamun },
  { label: "부산 TAGO(광역시) · 하차", q: "서면역", expect: "tago", from: P.busanStn, to: P.busanPark, anchor: P.seomyeon, pick: "서면역.롯데호텔백화점", journey: "alight" },
  { label: "수원 TAGO(도 시군) · 검색만", q: "수원역", expect: "tago", from: P.suwonStn, to: P.hwaseong, anchor: P.suwonStn },
  { label: "담양 TAGO(인접 광역시 코드) · 검색만", q: "담양", expect: "tago", from: P.damyang, to: P.damyang, anchor: P.damyang },
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
  for (const k of ["KAKAO_REST_API_KEY", "TMAP_APP_KEY", "ODSAY_API_KEY", "DATA_GO_KR_API_KEY", "TOUR_API_KEY"]) {
    process.env[k] ||= "corpus-replay-no-key";
  }
}

// fetch 가로채기 — 요청(메서드·URL·본문, 인증 헤더 제외 — 키는 URL 쿼리에서 걷는다) 하나 = 파일 하나.
const SECRET_PARAMS = ["apiKey", "serviceKey", "ServiceKey", "appKey"];
const realFetch = globalThis.fetch;
const counts = { odsay: 0, tmap: 0, kakao: 0, stop: 0, bus: 0, replay: 0 };
// 상한은 실행마다가 아니라 corpus 폴더 단위 누적이다(실패 응답은 저장되지 않아 재실행이 다시 부르기 때문).
const ledgerFile = join(opts.dir, "_live-calls.json");
const ledger = existsSync(ledgerFile) ? JSON.parse(readFileSync(ledgerFile, "utf8")) : {};
const spent = (cls) => (ledger[cls] ?? 0) + counts[cls];
function hostClass(host) {
  if (host.endsWith("odsay.com")) return "odsay";
  if (host.endsWith("openapi.sk.com")) return "tmap";
  if (host.endsWith("kakao.com") || host.endsWith("kakaomobility.com")) return "kakao";
  return "bus";
}
// 정류장 이름 검색이 새로 부르는 경로(TOPIS 이름 검색·TAGO 이름 검색·TAGO 좌표 근접)만 E70-e 상한으로 센다.
// 그 밖의 버스·공공 호출(여정 조립의 노선 운행시간 등 기존 경로)은 `bus`로 따로 센다.
const STOP_SEARCH_PATHS = ["getStationByName", "getSttnNoList", "getCrdntPrxmtSttnList"];
const CAPS = { odsay: ODSAY_CAP, tmap: TMAP_CAP, kakao: KAKAO_CAP, stop: STOP_CAP, bus: BUS_CAP };
globalThis.fetch = async (input, init = {}) => {
  const url = String(input instanceof URL ? input : input.url ?? input);
  const u = new URL(url);
  for (const p of SECRET_PARAMS) u.searchParams.delete(p);
  const host = hostClass(u.host);
  const cls = host === "bus" && STOP_SEARCH_PATHS.some((p) => u.pathname.endsWith(p)) ? "stop" : host;
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
  counts[cls]++; // 병렬 요청이 같은 잔여를 함께 통과하지 않게 await 전에 센다
  writeFileSync(ledgerFile, JSON.stringify({ ...ledger, ...Object.fromEntries(Object.keys(CAPS).map((c) => [c, spent(c)])) }));
  const res = await realFetch(url, rest);
  const body = await res.text();
  // 실패 응답은 저장하지 않는다(재생이 영영 그 실패를 사실로 읽는다). ODsay는 오류도 HTTP 200 + error 봉투다.
  const odsayError = cls === "odsay" && /"error"\s*:/.test(body);
  // data.go.kr(TAGO)도 오류를 HTTP 200 + resultCode 비"00"으로 준다(동시 세션 한도 99 실측).
  const dataGoKrError = /"resultCode"\s*:\s*"(?!00")/.test(body);
  if (res.ok && !odsayError && !dataGoKrError) writeFileSync(file, JSON.stringify({ status: res.status, body }));
  return new Response(body, { status: res.status });
};

// provider·조립 계층을 그대로 태운다(판정 로직 복제 금지).
const workDir = mkdtempSync(join(tmpdir(), "journey-bus-stops-gate-"));
const entryPath = join(workDir, "entry.ts");
const bundlePath = join(workDir, "bundle.mjs");
const stubPath = join(workDir, "next-cache-stub.mjs");
writeFileSync(stubPath, "export const unstable_cache = (fn) => fn;\n");
writeFileSync(
  entryPath,
  [
    `export { getJourney, journeyDeps } from ${JSON.stringify(resolve("src/lib/journey/assemble"))};`,
    `export { haversineMeters } from ${JSON.stringify(resolve("src/lib/geo"))};`,
    `export { searchJourneyStops, stopSearchDeps } from ${JSON.stringify(resolve("src/lib/journey/stop-search"))};`,
  ].join("\n"),
);
execFileSync(
  "npx",
  ["esbuild", entryPath, "--bundle", "--format=esm", "--platform=node", `--alias:next/cache=${stubPath}`, `--outfile=${bundlePath}`],
  { stdio: "pipe" },
);
const { getJourney, journeyDeps, searchJourneyStops, stopSearchDeps, haversineMeters: haversineRaw } = await import(bundlePath);
const haversineMeters = (a, b) => haversineRaw(a.lat, a.lng, b.lat, b.lng);

const vehicles = (route) => route.legs.filter((l) => l.mode !== "walk");
const describe = (v) =>
  vehicles(v.transit)
    .map((l) => `${l.mode}:${l.lineName ?? "?"}(${l.fromName ?? "?"}→${l.toName ?? "?"})`)
    .join(" / ");

let failed = 0;
let unmeasured = 0;
const rows = [];
for (const s of SAMPLES) {
  try {
    rows.push(`  ${s.label}: 「${s.q}」`);
    const coords = [s.from.coord, s.to.coord];
    // 어느 의존이 실패했는지 보고에 남긴다(판정은 searchJourneyStops 그대로).
    const depErrors = [];
    const tracedDeps = Object.fromEntries(
      Object.entries(stopSearchDeps).map(([k, fn]) => [
        k,
        async (...a) => {
          try {
            return await fn(...a);
          } catch (e) {
            depErrors.push(`${k}(${a.map((x) => (typeof x === "object" ? `${x.lat},${x.lng}` : x)).join(",")}): ${String(e).slice(0, 120)}`);
            throw e;
          }
        },
      ]),
    );
    const found = await searchJourneyStops(s.q, coords, tracedDeps);
    for (const e of depErrors) rows.push(`    의존 실패 ${e}`);
    const far = found.stops.filter((x) => Math.min(...coords.map((c) => haversineMeters(c, x))) > 20_000);
    const hasExpected = found.stops.some((x) => x.source === s.expect);
    const flags = ["unsearched", "failed", "truncated"].filter((f) => found[f]).join(",") || "없음";
    rows.push(
      `    검색 ${found.stops.length}건(${[...new Set(found.stops.map((x) => x.source))].join("·") || "-"}), 표식 ${flags}, 상위 3: ${found.stops
        .slice(0, 3)
        .map((x) => x.name)
        .join(" / ")}`,
    );
    const searchOk = hasExpected && far.length === 0 && !found.failed;
    if (!searchOk) {
      failed++;
      rows.push(`    FAIL 검색: 기대 출처 ${s.expect} ${hasExpected ? "있음" : "없음"}, 20km 밖 ${far.length}건, failed ${!!found.failed}`);
      continue;
    }
    rows.push("    PASS 검색");
    if (!s.journey) continue;
    const stop = (s.pick && found.stops.find((x) => x.name === s.pick)) || [...found.stops].sort((a, b) => haversineMeters(s.anchor.coord, a) - haversineMeters(s.anchor.coord, b))[0];
    rows.push(`    고른 정류장 「${stop.name}」(앵커에서 ${Math.round(haversineMeters(s.anchor.coord, stop))}m)`);
    const input = { name: stop.name, coord: { lat: stop.lat, lng: stop.lng }, kind: "stop" };
    const before = counts.odsay;
    const outcome = await getJourney({ from: s.from.coord, to: s.to.coord, stops: true, [s.journey]: input }, journeyDeps, () => "ok");
    rows.push(`    ODsay 실호출 ${counts.odsay - before}회`);
    if (outcome.kind !== "ok") {
      unmeasured++;
      rows.push(`    UNMEASURED ${outcome.kind}`);
      continue;
    }
    const { variants, designatedMissing } = outcome.result;
    for (const v of variants) rows.push(`    ${v.kind}: ${describe(v)}`);
    const designated = variants.find((v) => v.kind === "designated");
    if (!designated) {
      failed++;
      rows.push(`    FAIL 여정: 지정 경로 없음 ${JSON.stringify(designatedMissing)}`);
      continue;
    }
    const vs = vehicles(designated.transit);
    const end = s.journey === "board" ? vs[0] : vs[vs.length - 1];
    const egressOk =
      s.journey !== "alight" || (designated.egress?.options.length === 1 && designated.egress.options[0].kind === "none");
    const ok = end?.mode === "bus" && egressOk;
    if (!ok) failed++;
    rows.push(
      `    ${ok ? "PASS" : "FAIL"} 여정: 끝 탈것 ${end?.mode}(${s.journey === "board" ? end?.fromName : end?.toName}), egress ${JSON.stringify(designated.egress?.options.map((o) => o.kind) ?? null)}`,
    );
  } catch (e) {
    if (String(e).includes("상한")) {
      console.error(`STOP: ${e.message}`);
      unmeasured++;
      break;
    }
    unmeasured++;
    rows.push(`    UNMEASURED: ${String(e).slice(0, 200)}`);
  }
}

console.log(rows.join("\n"));
console.log(
  `\n실호출 ODsay ${counts.odsay} · Tmap ${counts.tmap} · 카카오 ${counts.kakao} · 정류장 검색 ${counts.stop} · 기존 버스·공공 ${counts.bus}, 재생 ${counts.replay}`,
);
if (failed > 0 || unmeasured > 0) {
  console.error(`FAIL: 실패 ${failed} · 측정 못 함 ${unmeasured}`);
  process.exit(1);
}
console.log("PASS: 정류장 이름 검색(TOPIS·TAGO)과 정류장 지정 여정 표본 전부 통과");
