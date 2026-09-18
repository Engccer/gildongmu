#!/usr/bin/env node
// 실호출 게이트 1단 — 경로 브리핑 역 진입점(E45)의 **표본 수집**.
// spec docs/superpowers/specs/2026-09-18-briefing-station-entry-design.md §8.
//
// 이 스크립트는 판정하지 않는다. ODsay 실응답의 `legs`를 그대로 덤프하고, **표본 구성**만 PASS/FAIL로
// 보고한다 — 확인하려는 케이스가 표본에 실제로 있었는지는 성립률과 별개의 단언이기 때문이다(표본에 없으면
// 그 케이스는 "통과"가 아니라 "미실측"이다). 조인 성립 판정은 2단, 즉 **실제 구현**인 Kit
// `transitBriefingStations`가 이 덤프를 읽어 한다(술어를 여기에 재현하면 판정 주체가 구현이 아니게 된다):
//
//   node scripts/verify-briefing-station-join.mjs --out /tmp/briefing-join.json
//   BRIEFING_JOIN_GATE=/tmp/briefing-join.json swift test --package-path ios/GildongmuKit \
//       --filter BriefingStationJoinGateTests
//
// 여기서 직접 재는 것은 **필드 동치** 하나다: 도보 leg의 `toName`이 다음 non-walk leg의 `fromName`과
// 같은가. Kit `.walk` 게이트가 그 동치 위에 서 있어서(줄에 들리는 이름과 조인에 쓰는 이름이 같다는 전제)
// 서버 계약이 바뀌면 여기서 먼저 빨개져야 한다. 이건 술어 재현이 아니라 두 필드의 비교다.
//
// ⚠ ODsay Basic 일 30회(근거: BACKLOG E46/47)를 프로덕션과 공유한다. 이 게이트는 **OD 쌍 수만큼**(현재 12콜) 쓴다. 429면
//   재시도하지 않는다. 표본 미충족이면 exit 1, 그 외 쿼터 중단은 exit 2다.
//
// live: node scripts/verify-briefing-station-join.mjs [--out <path>] [--lang ko|en]
// offline: node scripts/verify-briefing-station-join.mjs --from-corpus <path> [--lang ko|en]
//   offline은 저장 시각·언어를 보존하고 같은 파일로 Kit 조인 테스트까지 실행한다.
//   --lang 생략 시 저장 언어 사용, 명시 시 일치 필수. --out 병용 금지(원본 읽기 전용).
//   exit 0 = 구성·동치 충족(offline은 Kit도 통과) / 1 = 미충족·검증 실패 / 2 = 쿼터 소진
import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

function parseArgs(args) {
  const options = {};
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i];
    if (!["--from-corpus", "--out", "--lang"].includes(key) || key in options) {
      throw new Error(`인자 오류: 알 수 없거나 중복된 옵션 ${key}`);
    }
    const value = args[i + 1];
    if (!value?.trim() || value.startsWith("--")) throw new Error(`인자 오류: ${key} 값이 필요하다`);
    options[key] = value;
  }
  if (options["--lang"] && !["ko", "en"].includes(options["--lang"])) {
    throw new Error("인자 오류: --lang은 ko 또는 en이어야 한다");
  }
  if (options["--from-corpus"] && options["--out"]) {
    throw new Error("인자 오류: --from-corpus와 --out을 함께 쓸 수 없다(원본 읽기 전용)");
  }
  return options;
}

// 기존 dump envelope와 구성 판정에 쓰는 필드만 검사한다. 나머지 leg 디코딩 계약은
// 실제 Kit JSONDecoder가 검사하므로 TransitRouteLeg 스키마를 여기 복제하지 않는다.
function readCorpus(path, requestedLang) {
  const dump = JSON.parse(readFileSync(path, "utf8"));
  const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
  const require = (condition, field) => {
    if (!condition) throw new Error(`코퍼스 형식 오류: ${field}`);
  };
  require(object(dump), "최상위 객체");
  require(["ko", "en"].includes(dump.lang), "lang (ko|en)");
  if (requestedLang && requestedLang !== dump.lang) throw new Error(`코퍼스 언어 불일치: ${dump.lang} != ${requestedLang}`);
  // 기존 writer의 ISO UTC 형식만 허용하며 2월 30일 같은 날짜 자동 보정을 거부한다.
  const date = typeof dump.capturedAt === "string" ? new Date(dump.capturedAt) : null;
  require(date && Number.isFinite(date.getTime()) && date.toISOString() === dump.capturedAt, "capturedAt (ISO UTC)");
  require(Array.isArray(dump.samples) && dump.samples.length > 0, "samples (비어 있지 않은 배열)");
  for (const [si, sample] of dump.samples.entries()) {
    const at = `samples[${si}]`;
    require(object(sample) && typeof sample.pair === "string" && sample.pair.trim(), `${at}.pair`);
    require(Array.isArray(sample.routes) && sample.routes.length > 0, `${at}.routes`);
    for (const [ri, route] of sample.routes.entries()) {
      const where = `${at}.routes[${ri}]`;
      require(object(route) && Array.isArray(route.legs) && route.legs.length > 0, `${where}.legs`);
      for (const [li, leg] of route.legs.entries()) {
        require(object(leg) && ["walk", "bus", "subway"].includes(leg.mode), `${where}.legs[${li}].mode`);
        require(Number.isSafeInteger(leg.minutes), `${where}.legs[${li}].minutes`);
        for (const field of ["fromName", "toName"]) {
          require(leg[field] == null || typeof leg[field] === "string", `${where}.legs[${li}].${field}`);
        }
      }
    }
  }
  return dump;
}

let options;
let dump;
try {
  options = parseArgs(process.argv.slice(2));
  if (options["--from-corpus"]) dump = readCorpus(options["--from-corpus"], options["--lang"]);
} catch (error) {
  console.error(`FAIL: ${options?.["--from-corpus"] ? "코퍼스 읽기·검증: " : ""}${error.message}`);
  process.exit(1);
}

const corpusPath = options["--from-corpus"] ? resolve(options["--from-corpus"]) : undefined;
const outPath = options["--out"] ?? join(tmpdir(), "briefing-join.json");
const lang = dump?.lang ?? options["--lang"] ?? "ko";
const results = [];
function check(name, cond, detail) {
  results.push({ name, pass: Boolean(cond), detail });
  console.log(`${cond ? "PASS" : "FAIL"}: ${name}${detail ? ` (${detail})` : ""}`);
}

let samples;
let quota = false;
let pairCount;
if (dump) {
  samples = dump.samples;
  console.log(`저장 코퍼스 재검증 (신규 실호출 아님): ${corpusPath}`);
  console.log(`capturedAt=${dump.capturedAt} lang=${dump.lang}`);
} else {
  // 인자·코퍼스 검증을 마친 뒤에만 live 의존성을 불러온다. 오프라인은 env·provider·번들에 닿지 않는다.
  const { collectBriefingSamples } = await import("./lib/briefing-station-join-live.mjs");
  const collected = await collectBriefingSamples(lang);
  ({ samples, quota, pairCount } = collected);
  if (collected.providerError) check("provider 번들·호출", false, collected.providerError);
}

if (quota) {
  console.log(`\nODsay 일일 쿼터 소진: ${samples.length}/${pairCount} OD에서 끊겼다. 재시도하지 않는다.`);
  console.log("⚠ 게이트가 429라는 것은 **그날 프로덕션도 429**라는 뜻이다(같은 키·같은 한도).");
  if (samples.length === 0) process.exit(2);
  console.log("모은 표본만으로 아래 구성 판정을 이어 간다: 부족하면 그 항목이 FAIL로 드러난다.");
}

const allLegs = samples.flatMap((s) => s.routes.flatMap((r) => r.legs));
const subwayLegs = allLegs.filter((l) => l.mode === "subway");
check("표본을 모았다", samples.length > 0 && subwayLegs.length > 0, `${samples.length}OD / ${allLegs.length}구간 / 지하철 ${subwayLegs.length}`);

// --- 표본 구성: 확인하려는 케이스가 실제로 들었는가(부재는 FAIL = 미실측) ---
const routesFlat = samples.flatMap((s) => s.routes);
const transferTwice = routesFlat.filter((r) => r.legs.filter((l) => l.mode !== "walk").length >= 3);
check("환승 2회 이상 경로가 표본에 있다", transferTwice.length > 0, `${transferTwice.length}경로`);

const mixed = routesFlat.filter((r) => r.legs.some((l) => l.mode === "bus") && r.legs.some((l) => l.mode === "subway"));
check("버스↔지하철 혼합 경로가 표본에 있다", mixed.length > 0, `${mixed.length}경로`);

// 도보 줄 없이 지하철이 연달아 오는 자리(0m 환승 통로는 서버가 목록에서 지운다)
let adjacent = 0;
for (const r of routesFlat) {
  for (let i = 1; i < r.legs.length; i += 1) {
    if (r.legs[i].mode === "subway" && r.legs[i - 1].mode === "subway") adjacent += 1;
  }
}
check("도보 줄 없는 지하철 연속 구간이 표본에 있다", adjacent > 0, `${adjacent}자리`);

const localCities = samples.filter((s) => /부산|대구|대전|인천/.test(s.pair) && s.routes.length > 0);
check("수도권 밖 도시가 표본에 있다", localCities.length > 0, localCities.map((s) => s.pair).join(", "));

// --- 필드 동치: 도보 leg `toName` == 다음 non-walk leg `fromName`(Kit `.walk` 게이트의 전제) ---
let walkPairs = 0;
const walkMismatch = [];
for (const r of routesFlat) {
  for (let i = 0; i < r.legs.length; i += 1) {
    if (r.legs[i].mode !== "walk") continue;
    const next = r.legs.slice(i + 1).find((l) => l.mode !== "walk");
    if (!next?.fromName) continue;
    walkPairs += 1;
    if (r.legs[i].toName !== next.fromName) {
      walkMismatch.push(`${r.legs[i].toName ?? "(없음)"} ≠ ${next.fromName}`);
    }
  }
}
check(
  "도보 줄 행선지가 다음 탑승 구간 승차역과 같다(Kit .walk 게이트의 전제)",
  walkPairs > 0 && walkMismatch.length === 0,
  `${walkPairs}쌍 중 불일치 ${walkMismatch.length}${walkMismatch.length ? ": " + walkMismatch.slice(0, 3).join(" | ") : ""}`,
);

if (corpusPath) {
  // 셸 문자열 조립 없이 원본의 절대 경로를 전달한다(공백·한글·인용부호 경로 포함).
  // 패키지는 외부 의존성이 없으며 자동 resolution/update도 끈다.
  console.log("2단: 동일 코퍼스로 실제 Kit 조인 테스트 실행");
  try {
    execFileSync("swift", [
      "test", "--package-path", fileURLToPath(new URL("../ios/GildongmuKit", import.meta.url)),
      "--disable-automatic-resolution", "--skip-update", "--filter", "BriefingStationJoinGateTests",
    ], { stdio: "inherit", env: { ...process.env, BRIEFING_JOIN_GATE: corpusPath } });
  } catch (error) {
    console.error(`FAIL: Kit 조인 테스트 실행 실패 (${error.code ?? error.status ?? error.message})`);
    process.exitCode = 1;
  }
} else {
  // live는 쿼터로 잘린 표본도 원래 형식으로 보존한다.
  writeFileSync(outPath, JSON.stringify({ lang, capturedAt: new Date().toISOString(), samples }, null, 2));
  console.log(`\n덤프: ${outPath}`);
  console.log("2단(조인 성립률)은 실제 구현이 판정한다:");
  console.log(`  BRIEFING_JOIN_GATE=${outPath} swift test --package-path ios/GildongmuKit --filter BriefingStationJoinGateTests`);
}

const failed = results.filter((r) => !r.pass);
console.log(`\n표본 구성·필드 동치: ${results.length - failed.length}/${results.length} PASS${quota ? " (쿼터로 표본 절단)" : ""}`);
process.exitCode = process.exitCode || (failed.length ? 1 : quota ? 2 : 0);
