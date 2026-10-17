#!/usr/bin/env node
// 실호출 게이트 — E70 여정의 출구 예선(spec `docs/superpowers/specs/2026-10-17-e70-mode-change-journey-design.md` §4.5-5·§9.2).
//
// 재는 것: 하차역 × 노선 그룹마다 "목적지까지 직선 상위 5개"(예선) 안에 택시 시간이 가장 짧은 출구가 드는가.
//   카카오로 출구를 모으고(provider `searchSubwayExitsKakao` 그대로) → 순수 계층으로 해석·노선 그룹 →
//   노선 거른 출구가 5개를 넘는 그룹만 전 출구 Tmap(`getCarRoute` 그대로) 대 예선 5개를 비교한다.
//   5개 이하 그룹은 예선이 아무것도 자르지 않으므로 Tmap 없이 통과로 기록한다.
//   통과 조건: 예선이 최단(분 단위)을 놓친 그룹 0 ∧ 측정하지 못한 그룹 0. 놓치면 exit 1 — spec §4.5-5대로 예선
//   기준·상한을 다시 판정한다. Tmap이 실패해 카카오모빌리티로 폴백한 응답은 비교에서 뺀다(두 provider의 분을 섞지
//   않는다). 운영 예선은 승차·하차를 둘 다 지정하면 그룹당 2~3칸까지 준다(§4.5-1) — 그 폭(k=3·2)의 놓침은 참고로 보고한다.
//
// 저장·재생: `--out <dir>`는 카카오·Tmap 응답을 요청 단위 파일로 저장하고(있으면 다시 부르지 않는다), `--from-corpus <dir>`는
//   호출 없이 저장본만 읽는다(없는 요청은 실패). 저장소 밖 경로만 받는다(공개 저장소 — 응답 dump를 커밋하지 않는다).
// 비용: 카카오 로컬은 무료(일 한도 안), Tmap 자동차는 일 1,000건 무료분을 정식판 자동차·도보 폴백과 공유한다 —
//   실호출 Tmap은 `TMAP_CAP`에서 멈춘다. 표본은 공공 역·명소만(자택 근처 역·위원장 실조회 구간 금지).
//
// 사용법:
//   live:    node scripts/verify-journey-exits.mjs --out <dir>
//   offline: node scripts/verify-journey-exits.mjs --from-corpus <dir>
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";

const TMAP_CAP = 120;

/** 하차역 → 목적지(공공 명소). 역 좌표·목적지 좌표는 카카오 키워드 1순위로 잡는다. */
const SAMPLES = [
  { station: "대방", dest: "여의도 IFC몰" },
  { station: "개봉", dest: "구로구청" },
  { station: "강남", dest: "코엑스" },
  { station: "서울", dest: "서울대학교병원" },
  { station: "잠실", dest: "올림픽공원" },
  { station: "수원", dest: "수원시청" },
  { station: "신도림", dest: "고척스카이돔" },
  { station: "홍대입구", dest: "마포구청" },
  { station: "사당", dest: "서울대학교" },
  { station: "고속터미널", dest: "예술의전당" },
  // 괄호 부기 역(ODsay 정류 이름 `총신대입구(이수)`) — 질의 이름이 괄호를 떼는지(「출구 없음」 위장 방지).
  { station: "총신대입구(이수)", dest: "동작구청" },
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
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
} catch { /* CI 등에서는 환경변수 직접 주입 */ }
if (opts.offline) {
  process.env.KAKAO_REST_API_KEY ||= "corpus-replay-no-key";
  process.env.TMAP_APP_KEY ||= "corpus-replay-no-key";
}

// fetch 가로채기 — 요청(메서드·URL·본문, 인증 헤더 제외) 하나 = 파일 하나.
const realFetch = globalThis.fetch;
const counts = { kakao: 0, tmap: 0, replay: 0 };
globalThis.fetch = async (input, init = {}) => {
  const url = String(input instanceof URL ? input : input.url ?? input);
  const host = new URL(url).host;
  const key = createHash("sha1").update(`${init.method ?? "GET"} ${url} ${init.body ?? ""}`).digest("hex").slice(0, 20);
  const file = join(opts.dir, `${host.split(".")[0]}-${key}.json`);
  if (existsSync(file)) {
    counts.replay++;
    const { status, body } = JSON.parse(readFileSync(file, "utf8"));
    return new Response(body, { status });
  }
  if (opts.offline) throw new Error(`corpus에 응답 없음: ${url}`);
  const isTmap = host.endsWith("openapi.sk.com");
  if (isTmap && counts.tmap >= TMAP_CAP) throw new Error(`Tmap 상한 ${TMAP_CAP} 도달 — 멈추고 보고한다`);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- Next 전용 캐시 옵션을 걷어 낸다
  const { next: _next, ...rest } = init;
  const res = await realFetch(url, rest);
  if (isTmap) counts.tmap++;
  else counts.kakao++;
  const body = await res.text();
  // 실패 응답은 저장하지 않는다(재생이 영영 그 실패를 사실로 읽는다).
  if (res.ok) writeFileSync(file, JSON.stringify({ status: res.status, body }));
  return new Response(body, { status: res.status });
};

// provider·순수 계층을 그대로 태운다(판정 로직 복제 금지).
const workDir = mkdtempSync(join(tmpdir(), "journey-exits-gate-"));
const entryPath = join(workDir, "entry.ts");
const bundlePath = join(workDir, "bundle.mjs");
const stubPath = join(workDir, "next-cache-stub.mjs");
writeFileSync(stubPath, "export const unstable_cache = (fn) => fn;\n");
writeFileSync(
  entryPath,
  [
    `export { searchSubwayExitsKakao, searchPlacesKakaoLocal } from ${JSON.stringify(resolve("src/lib/providers/kakao-local"))};`,
    `export { parseExitDoc, prefilterExits } from ${JSON.stringify(resolve("src/lib/journey/egress"))};`,
    `export { exitQueryStationName } from ${JSON.stringify(resolve("src/lib/journey/display"))};`,
    `export { getCarRoute } from ${JSON.stringify(resolve("src/lib/car-route"))};`,
  ].join("\n"),
);
execFileSync(
  "npx",
  ["esbuild", entryPath, "--bundle", "--format=esm", "--platform=node", `--alias:next/cache=${stubPath}`, `--outfile=${bundlePath}`],
  { stdio: "pipe" },
);
const { searchSubwayExitsKakao, searchPlacesKakaoLocal, parseExitDoc, prefilterExits, exitQueryStationName, getCarRoute } =
  await import(bundlePath);

async function topPlace(query, mustInclude) {
  const { places } = await searchPlacesKakaoLocal({ query, limit: 15 });
  const hit = places.find((p) => !mustInclude || p.category.includes(mustInclude)) ?? places[0];
  if (!hit) throw new Error(`카카오 키워드 0건: ${query}`);
  return { name: hit.name, coord: { lat: hit.lat, lng: hit.lng } };
}

const minutes = (b) => Math.round(b.durationSeconds / 60);
let missed = 0;
let compared = 0;
let unmeasured = 0;
const narrowMissed = { 3: 0, 2: 0 };
const rows = [];
for (const s of SAMPLES) {
  const query = exitQueryStationName(s.station);
  const station = await topPlace(`${query}역`, "지하철,전철");
  const dest = await topPlace(s.dest);
  const docs = await searchSubwayExitsKakao(query, station.coord);
  const exits = docs.flatMap((d) => parseExitDoc(d, query) ?? []);
  if (exits.length === 0) {
    unmeasured++;
    rows.push(`  UNMEASURED ${s.station}역 → ${s.dest}: 출구 0건(질의 이름 「${query}」)`);
    continue;
  }
  const byLine = new Map();
  for (const e of exits) {
    const k = e.lineName ?? "(무표기)";
    if (!byLine.has(k)) byLine.set(k, []);
    byLine.get(k).push(e);
  }
  for (const [line, group] of byLine) {
    if (group.length <= 5) {
      rows.push(`  ${s.station}역 ${line} → ${s.dest}: 출구 ${group.length}개 — 예선이 자르지 않음(Tmap 없음)`);
      continue;
    }
    compared++;
    const timed = [];
    for (const e of group) {
      try {
        const route = await getCarRoute({ origin: e.coord, dest: dest.coord });
        if (route.provider !== "tmap") {
          rows.push(`    (${e.placeName} Tmap 실패 → ${route.provider} 폴백, 비교에서 뺀다)`);
          continue;
        }
        timed.push({ e, min: minutes(route) });
      } catch (err) {
        if (String(err).includes("상한")) throw err;
        rows.push(`    (${e.placeName} 경로 실패: ${String(err).slice(0, 80)})`);
      }
    }
    const bestWithin = (k) => {
      const kept = new Set(prefilterExits(group, dest.coord, k).map((e) => e.placeName));
      return Math.min(...timed.filter((t) => kept.has(t.e.placeName)).map((t) => t.min));
    };
    const best = Math.min(...timed.map((t) => t.min));
    const bestKept = bestWithin(5);
    // 측정하지 못한 그룹을 통과로 세지 않는다(전부 실패면 Infinity === Infinity).
    if (!Number.isFinite(best) || !Number.isFinite(bestKept)) {
      unmeasured++;
      rows.push(`  UNMEASURED ${s.station}역 ${line} → ${s.dest}: Tmap 측정 ${timed.length}/${group.length}`);
      continue;
    }
    for (const k of [3, 2]) if (bestWithin(k) !== best) narrowMissed[k]++;
    const ok = bestKept === best;
    if (!ok) missed++;
    const fastest = timed.filter((t) => t.min === best).map((t) => t.e.label).join("·");
    rows.push(
      `  ${ok ? "PASS" : "MISS"} ${s.station}역 ${line} → ${s.dest}: 출구 ${group.length}개, 최단 ${best}분(${fastest}번), 예선 최단 ${bestKept}분`,
    );
  }
}

console.log(rows.join("\n"));
console.log(`비교 그룹 ${compared}, 예선이 최단을 놓친 그룹 ${missed}, 측정하지 못한 그룹 ${unmeasured}`);
console.log(`참고(운영 감축 폭): k=3 놓침 ${narrowMissed[3]}, k=2 놓침 ${narrowMissed[2]}`);
console.log(`호출: 카카오 ${counts.kakao}, Tmap ${counts.tmap}, 저장본 재생 ${counts.replay}`);
const pass = missed === 0 && unmeasured === 0;
console.log(pass ? "PASS — 예선 5개가 모든 그룹에서 최단 출구를 지켰다" : "FAIL — 놓침·측정 불가를 판정한다(spec §4.5-5)");
process.exit(pass ? 0 : 1);
