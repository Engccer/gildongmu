#!/usr/bin/env node
// 실호출 게이트 — E71 「지금 탄 열차에서 여정 시작」 서버 aboard 계약(spec `docs/superpowers/specs/2026-10-27-e71-riding-start-design.md` §4·§8.2).
//
// 재는 것(판정 로직은 이 스크립트에 복제하지 않는다 — 서버 계층을 그대로 태운다):
//   ① 서울 실시간 도착(`fetchSubwayArrivals`, 실 provider)으로 역마다 한 번 도착 목록을 받아, 방면 묶음을 만든다.
//      묶음 규칙은 Kit `journeyAboardDirections`(ios/GildongmuKit/Sources/GildongmuKit/Journey.swift) 문서 주석이 정본이다:
//      같은 노선(`sameLine` — Kit `journeySameLine`의 웹 짝)의 도착만, `direction`(= updnLine, 공백·탭·개행 trim 뒤 빈 값 버림)으로
//      묶고 처음 본 순서를 지키며, 이름은 `trainLineNm`의 「 - 」 뒤 조각(없으면 direction)이다.
//   ② 묶음마다 그 `updnLine`으로 aboard 여정(`getJourney`, `board.kind = "aboard"`, 역 B 없음)을 조회한다.
//
// 판정(묶음 하나):
//   - 지정 변형(designated): variants 1개 ∧ 첫 탈것이 지하철 ∧ `serviceWayCode`가 있고 `directionMatchesWayCode(updnLine, wayCode) === true`
//     ∧ 첫 탈것 승차 정류 이름이 표본 역.
//   - 반대 방향(opposite): variants 0개 ∧ `designatedMissing.oppositeDirection === true`.
//   - 그 밖(other): variants 0개이고 `designatedMissing`(사유)이 있다 — 순환선에서만 허용된다(아래 규칙).
// 판정(표본 하나, 묶음 결과를 모아서):
//   - 직선 노선: 지정 변형이 정확히 하나, 나머지는 전부 반대 방향. (한 방향의 열차만 도착 목록에 있으면 그 하나만 지정 변형이면 된다.)
//   - 순환선(2호선): 지정 변형이 하나 이상(내선·외선 둘 다 목적지에 닿을 수 있어 둘 다 지정 변형이어도 정상). 지정 변형이 아닌 묶음은
//     `variants: []`이고 `designatedMissing`(사유)이 있어야 한다.
//   - FAIL: 도착 0건·같은 노선 묶음 0·`updnLine` 미지 표기·`wayCode` 없음·위 판정 불일치·Tmap 비용 예약(역 B가 없어 0이어야 한다).
//   - 측정 못 한 표본(조회 throw·reserve 거절·상한 도달)도 FAIL. 통과 = 전 표본 PASS ∧ 측정 못 함 0.
//
// 저장·재생: `--out <dir>`는 응답을 요청 단위 파일로 저장하고(있으면 다시 부르지 않는다 — 같은 OD의 두 방향 조회는 같은 ODsay
//   요청이라 한 번만 나간다), `--from-corpus <dir>`는 호출 없이 저장본만 읽는다(저장본이 없으면 실패). 저장소 밖 경로만 받는다(공개 저장소).
// 비용: ODsay는 호출당 과금이라 `ODSAY_CAP`(세션 상한 10)에서 멈춘다 — 상한은 corpus 폴더 단위 누적이다. 급행 정차역 조회(1호선 등)가
//   getJourney 한 번에 ODsay를 더 부를 수 있어 호출 수는 표본 수의 2배보다 클 수 있다. 서울 실시간은 `SEOUL_RT_CAP`(일 1,000회 중 세션분).
//   Tmap·카카오는 역 B가 없어 0 — 부르면 상한 도달로 실패한다. 표본은 공개 역·랜드마크만(자택 근처 금지).
//
// 사용법:
//   live:    node scripts/verify-journey-aboard.mjs --out <저장소 밖 dir> [--only seoul,sindorim,wangsimni]
//   offline: node scripts/verify-journey-aboard.mjs --from-corpus <dir>   (--only 같이 쓸 수 있다)
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";

const ODSAY_CAP = 10;
const SEOUL_RT_CAP = 20;
const TMAP_CAP = 0; // 역 B 표본이 없다 — 하차 출구·택시 조회가 일어나지 않는다
const KAKAO_CAP = 0;
const OTHER_CAP = 40; // 여정 조립 경로의 무료 공공 조회(노선 운행시간 등)

// 공개 역·랜드마크 좌표(누구나 아는 역 중심 근사). 우선순위 순서 — 상한이 모자라면 뒤(왕십리)부터 못 잰다.
// line은 카카오 출구 이름 표기(수도권 접두)로 둔다: 접두 힌트 ↔ 도착 목록 `1호선`을 `sameLine`이 같게 보는지가 이 게이트의 대상이다.
// circle: 순환선(내선·외선 둘 다 목적지에 닿을 수 있다).
const SAMPLES = [
  {
    id: "seoul",
    label: "서울역 1호선 → 영등포(남쪽, 직선 노선)",
    station: { name: "서울역", coord: { lat: 37.5547, lng: 126.9707 }, line: "수도권1호선" },
    to: { name: "영등포역", coord: { lat: 37.5159, lng: 126.9075 } },
    circle: false,
  },
  {
    id: "sindorim",
    label: "신도림 2호선 → 강남(순환선, 내선·외선)",
    station: { name: "신도림", coord: { lat: 37.5088, lng: 126.8913 }, line: "수도권2호선" },
    to: { name: "강남역", coord: { lat: 37.4979, lng: 127.0276 } },
    circle: true,
  },
  {
    id: "wangsimni",
    label: "왕십리 5호선 → 광화문(한 방향)",
    station: { name: "왕십리", coord: { lat: 37.5612, lng: 127.0371 }, line: "수도권5호선" },
    to: { name: "광화문", coord: { lat: 37.571, lng: 126.9769 } },
    circle: false,
  },
];

function parseArgs(argv) {
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    if (!["--out", "--from-corpus", "--only"].includes(key)) throw new Error(`인자 오류: 모르는 인자 ${key}`);
    const value = argv[++i];
    if (!value) throw new Error(`인자 오류: ${key} 값 없음`);
    opts[key] = value;
  }
  if (!opts["--out"] && !opts["--from-corpus"]) {
    throw new Error("인자 오류: --out <저장소 밖 dir>(실호출, ODsay 과금) 또는 --from-corpus <dir>(재생, 호출 0) 중 하나가 필요하다");
  }
  if (opts["--out"] && opts["--from-corpus"]) throw new Error("인자 오류: --out 또는 --from-corpus 중 하나만");
  const dir = resolve(opts["--out"] ?? opts["--from-corpus"]);
  const rel = relative(process.cwd(), dir);
  if (!rel.startsWith("..") && !isAbsolute(rel)) throw new Error("인자 오류: 저장 경로는 저장소 밖이어야 한다");
  const only = opts["--only"] ? opts["--only"].split(",").map((s) => s.trim()) : null;
  if (only) {
    const unknown = only.filter((id) => !SAMPLES.some((s) => s.id === id));
    if (unknown.length > 0) throw new Error(`인자 오류: 모르는 표본 ${unknown.join(",")} (있는 것: ${SAMPLES.map((s) => s.id).join(",")})`);
  }
  return { dir, offline: Boolean(opts["--from-corpus"]), only };
}

let opts;
try {
  opts = parseArgs(process.argv.slice(2));
} catch (e) {
  console.error(`FAIL: ${e.message}`);
  process.exit(64);
}
if (opts.offline) {
  const saved = existsSync(opts.dir) ? readdirSync(opts.dir).filter((f) => f.endsWith(".json") && !f.startsWith("_")) : [];
  if (saved.length === 0) {
    console.error(`FAIL: 저장본 없음 — ${opts.dir}에 응답 파일이 없다. 먼저 --out으로 실호출 1회를 저장한다(호출 0으로 종료).`);
    process.exit(2);
  }
} else {
  mkdirSync(opts.dir, { recursive: true });
}
try {
  for (const line of readFileSync(".env.local", "utf8").split("\n")) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"(.*)"$/, "$1");
  }
} catch { /* CI 등에서는 환경변수 직접 주입 */ }
if (opts.offline) {
  for (const k of ["KAKAO_REST_API_KEY", "TMAP_APP_KEY", "ODSAY_API_KEY", "DATA_GO_KR_API_KEY", "TOUR_API_KEY", "SEOUL_SUBWAY_REALTIME_KEY"]) {
    process.env[k] ||= "corpus-replay-no-key";
  }
}

// fetch 가로채기 — 요청(메서드·URL·본문, 키 제외) 하나 = 파일 하나. 서울 실시간은 키가 URL 경로에 있어 경로에서도 걷는다.
const SECRET_PARAMS = ["apiKey", "serviceKey", "ServiceKey", "appKey"];
const realFetch = globalThis.fetch;
const counts = { odsay: 0, seoul: 0, tmap: 0, kakao: 0, other: 0, replay: 0 };
// 상한은 실행마다가 아니라 corpus 폴더 단위 누적이다(실패 응답은 저장되지 않아 재실행이 다시 부르기 때문).
const ledgerFile = join(opts.dir, "_live-calls.json");
const ledger = existsSync(ledgerFile) ? JSON.parse(readFileSync(ledgerFile, "utf8")) : {};
const spent = (cls) => (ledger[cls] ?? 0) + counts[cls];
function hostClass(host) {
  if (host.endsWith("odsay.com")) return "odsay";
  if (host.endsWith("swopenapi.seoul.go.kr")) return "seoul";
  if (host.endsWith("openapi.sk.com")) return "tmap";
  if (host.endsWith("kakao.com") || host.endsWith("kakaomobility.com")) return "kakao";
  return "other";
}
const CAPS = { odsay: ODSAY_CAP, seoul: SEOUL_RT_CAP, tmap: TMAP_CAP, kakao: KAKAO_CAP, other: OTHER_CAP };
globalThis.fetch = async (input, init = {}) => {
  const url = String(input instanceof URL ? input : input.url ?? input);
  const u = new URL(url);
  for (const p of SECRET_PARAMS) u.searchParams.delete(p);
  u.pathname = u.pathname.replace(/^(\/api\/subway\/)[^/]+/, "$1KEY");
  const cls = hostClass(u.host);
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
  // 서울 실시간은 정상(INFO-000)만 저장한다 — INFO-200(데이터 없음)은 운행 시간에 따라 바뀌는 값이라 굳히지 않는다.
  const odsayError = cls === "odsay" && /"error"\s*:/.test(body);
  const seoulNotOk = cls === "seoul" && !/"code"\s*:\s*"INFO-000"/.test(body);
  const dataGoKrError = cls === "other" && /"resultCode"\s*:\s*"(?!00")/.test(body);
  if (res.ok && !odsayError && !seoulNotOk && !dataGoKrError) writeFileSync(file, JSON.stringify({ status: res.status, body }));
  return new Response(body, { status: res.status });
};

// provider·조립 계층을 그대로 태운다(판정 로직 복제 금지).
const workDir = mkdtempSync(join(tmpdir(), "journey-aboard-gate-"));
const entryPath = join(workDir, "entry.ts");
const bundlePath = join(workDir, "bundle.mjs");
const stubPath = join(workDir, "next-cache-stub.mjs");
writeFileSync(stubPath, "export const unstable_cache = (fn) => fn;\n");
writeFileSync(
  entryPath,
  [
    `export { getJourney, journeyDeps } from ${JSON.stringify(resolve("src/lib/journey/assemble"))};`,
    `export { fetchSubwayArrivals } from ${JSON.stringify(resolve("src/lib/providers/seoul-subway-arrival"))};`,
    `export { sameLine } from ${JSON.stringify(resolve("src/lib/journey/station-identity"))};`,
    `export { directionMatchesWayCode } from ${JSON.stringify(resolve("src/lib/transit-guide"))};`,
    `export { normalizeStationName } from ${JSON.stringify(resolve("src/lib/station-match"))};`,
  ].join("\n"),
);
execFileSync(
  "npx",
  ["esbuild", entryPath, "--bundle", "--format=esm", "--platform=node", `--alias:next/cache=${stubPath}`, `--outfile=${bundlePath}`],
  { stdio: "pipe" },
);
const { getJourney, journeyDeps, fetchSubwayArrivals, sameLine, directionMatchesWayCode, normalizeStationName } = await import(bundlePath);

// Kit `journeyAboardDirections`와 같은 규칙(문서 주석이 정본) — 공백·탭·개행만 뗀다.
const trim = (s) => s.replace(/^[ \t\n]+|[ \t\n]+$/g, "");
function aboardDirections(arrivals, line) {
  const order = [];
  const names = new Map();
  const terminals = new Map();
  for (const a of arrivals) {
    if (!a.line || !sameLine(a.line, line)) continue;
    const dir = trim(a.direction);
    if (dir === "") continue;
    if (!terminals.has(dir)) {
      order.push(dir);
      terminals.set(dir, []);
    }
    const at = a.trainLineNm.indexOf(" - ");
    if (!names.has(dir) && at >= 0) {
      const tail = trim(a.trainLineNm.slice(at + 3));
      if (tail !== "") names.set(dir, tail);
    }
    const dest = trim(a.destination);
    if (dest !== "" && !terminals.get(dir).includes(dest)) terminals.get(dir).push(dest);
  }
  return order.map((direction) => ({ direction, name: names.get(direction) ?? direction, terminals: terminals.get(direction) }));
}

const SERVER_DIRECTIONS = ["상행", "하행", "내선", "외선"];
const vehicles = (route) => route.legs.filter((l) => l.mode !== "walk");
const describe = (v) =>
  vehicles(v.transit)
    .map((l) => `${l.mode}:${l.lineName ?? "?"}(wayCode ${l.serviceWayCode ?? "없음"}, ${l.fromName ?? "?"}→${l.toName ?? "?"})`)
    .join(" / ");

const samples = SAMPLES.filter((s) => !opts.only || opts.only.includes(s.id));
let passed = 0;
let unmeasured = 0;
const rows = [];
let capStop = false;

for (const s of samples) {
  if (capStop) {
    unmeasured++;
    rows.push(`  ${s.label}\n    UNMEASURED 앞 표본에서 실호출 상한에 도달해 재지 않았다`);
    continue;
  }
  rows.push(`  ${s.label}`);
  const problems = []; // FAIL 사유
  let unmeasuredHere = false;
  try {
    const arrivals = await fetchSubwayArrivals(s.station.name);
    const list = arrivals?.arrivals ?? [];
    if (list.length === 0) {
      problems.push(`도착 0건(${arrivals === null ? "null — 키 없음·미커버·INFO-200" : "빈 목록"})`);
    }
    const groups = aboardDirections(list, s.station.line);
    rows.push(
      `    도착 ${list.length}건, 같은 노선 방면 묶음 ${groups.length}: ${groups.map((g) => `${g.direction}「${g.name}」[${g.terminals.join(",")}]`).join(" / ") || "-"}`,
    );
    if (list.length > 0 && groups.length === 0) problems.push("같은 노선 방면 묶음 0(노선 매칭 실패 의심)");

    const verdicts = [];
    for (const g of groups) {
      if (!SERVER_DIRECTIONS.includes(g.direction)) {
        problems.push(`미지 updnLine 「${g.direction}」(서버 입력은 ${SERVER_DIRECTIONS.join("·")}만 받는다)`);
        continue;
      }
      const reserved = [];
      const req = {
        from: s.station.coord,
        to: s.to.coord,
        board: { name: s.station.name, coord: s.station.coord, line: s.station.line, kind: "aboard", direction: g.direction },
      };
      const before = counts.odsay;
      let outcome;
      try {
        outcome = await getJourney(req, journeyDeps, (cost) => {
          reserved.push(cost);
          return "ok";
        });
      } catch (e) {
        if (String(e).includes("상한")) capStop = true;
        unmeasuredHere = true;
        rows.push(`    ${g.direction}: UNMEASURED ${String(e).slice(0, 200)}`);
        if (capStop) break;
        continue;
      }
      rows.push(`    ${g.direction}: ODsay 실호출 ${counts.odsay - before}회`);
      if (outcome.kind !== "ok") {
        unmeasuredHere = true;
        rows.push(`    ${g.direction}: UNMEASURED ${outcome.kind}`);
        continue;
      }
      const cost = reserved.reduce((a, b) => a + b, 0);
      if (cost !== 0) problems.push(`${g.direction}: Tmap 비용 ${cost} 예약(역 B가 없어 0이어야 한다)`);
      const { variants, designatedMissing } = outcome.result;
      for (const v of variants) rows.push(`    ${g.direction} ${v.kind}: ${describe(v)}`);

      if (variants.length === 1) {
        const v = variants[0];
        const first = vehicles(v.transit)[0];
        const wayCode = first?.serviceWayCode ?? null;
        const checks = [
          [v.kind === "designated", `kind ${v.kind}`],
          [first?.mode === "subway", `첫 탈것 ${first?.mode}`],
          [wayCode !== null, "serviceWayCode 없음"],
          [directionMatchesWayCode(g.direction, wayCode) === true, `방향 불일치(${g.direction} ↔ wayCode ${wayCode})`],
          [normalizeStationName(v.boardStation.name) === normalizeStationName(s.station.name), `승차 정류 「${v.boardStation.name}」≠ 표본 역`],
        ];
        const bad = checks.filter(([ok]) => !ok).map(([, why]) => why);
        if (bad.length > 0) problems.push(`${g.direction}: 지정 변형 검증 실패(${bad.join(", ")})`);
        verdicts.push({ direction: g.direction, kind: bad.length > 0 ? "broken" : "designated" });
      } else if (variants.length === 0) {
        verdicts.push({
          direction: g.direction,
          kind: designatedMissing?.oppositeDirection === true ? "opposite" : designatedMissing ? "other" : "broken",
          missing: designatedMissing,
        });
        if (!designatedMissing) problems.push(`${g.direction}: variants 0개인데 designatedMissing 사유가 없다`);
      } else {
        problems.push(`${g.direction}: variants ${variants.length}개(aboard는 최대 1개)`);
        verdicts.push({ direction: g.direction, kind: "broken" });
      }
    }

    const designated = verdicts.filter((v) => v.kind === "designated").length;
    for (const v of verdicts) rows.push(`    판정 ${v.direction}: ${v.kind}${v.missing ? ` ${JSON.stringify(v.missing)}` : ""}`);
    if (verdicts.length > 0) {
      if (s.circle) {
        // 순환선: 지정 변형 ≥ 1, 나머지는 사유(designatedMissing)가 있는 빈 결과(반대 방향 포함).
        if (designated < 1) problems.push("순환선인데 지정 변형이 하나도 없다");
        const nonDesignated = verdicts.filter((v) => v.kind !== "designated" && v.kind !== "broken");
        if (nonDesignated.some((v) => !v.missing)) problems.push("지정 변형이 아닌 묶음에 사유가 없다");
      } else {
        // 직선 노선: 지정 변형 정확히 하나, 나머지는 전부 반대 방향.
        if (designated !== 1) problems.push(`직선 노선인데 지정 변형이 ${designated}개(정확히 1개 기대)`);
        const wrong = verdicts.filter((v) => v.kind === "other");
        if (wrong.length > 0) problems.push(`반대 방향이어야 할 묶음이 다른 사유: ${wrong.map((v) => v.direction).join(",")}`);
      }
    }
  } catch (e) {
    if (String(e).includes("상한")) capStop = true;
    unmeasuredHere = true;
    rows.push(`    UNMEASURED: ${String(e).slice(0, 200)}`);
  }

  if (unmeasuredHere) {
    unmeasured++;
    rows.push("    UNMEASURED(측정 못 함 — FAIL로 센다)");
  }
  if (problems.length > 0) {
    for (const p of problems) rows.push(`    FAIL: ${p}`);
  }
  if (!unmeasuredHere && problems.length === 0) {
    passed++;
    rows.push("    PASS");
  }
}

console.log(rows.join("\n"));
console.log(
  `\nPASS ${passed}/${samples.length} · ODsay 실호출 ${counts.odsay} · 서울 실시간 ${counts.seoul} · Tmap ${counts.tmap} · 카카오 ${counts.kakao} · 기타 공공 ${counts.other}, 재생 ${counts.replay}`,
);
if (passed !== samples.length) {
  console.error(`FAIL: 통과 ${passed}/${samples.length} · 측정 못 함 ${unmeasured}`);
  process.exit(1);
}
console.log("PASS: aboard 방면 묶음·방향 판정 표본 전부 통과");
