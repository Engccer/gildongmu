#!/usr/bin/env node
// 실호출 게이트 — TAGO 지하철 시간표 (국토교통부 15098554 SubwayInfo, B-3). dodo 동명 게이트의 gildongmu판(A19).
//
// 배경: 업스트림이 인증 정상(00)인데 (역·노선)별로 스케줄 0행을 준다(홍대입구 2호선·강남 신분당·
// 서울역 공항, 2026-08-23 실측). 정적 리뷰로는 이 축이 잡히지 않아 실호출 관측을 상설로 둔다.
//
// ⚠ 두 축을 따로 본다. 인증(resultCode=00)이 통과해도 데이터가 0건일 수 있고,
//   그 둘을 뭉개면 "업스트림이 죽었다"와 "이 노선은 원래 데이터가 없다"를 구분할 수 없다.
//
// 사용법: node scripts/verify-korea-subway-timetable.mjs
import { readFileSync } from "node:fs";

// .env.local 로드 (dotenv 없이 — verify-korea-station 동형)
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

const KEY = process.env.DATA_GO_KR_API_KEY ?? "";
// ⚠ https 필수: http는 연결만 되고 응답이 오지 않는다(read ETIMEDOUT hang, 2026-08-04 실측).
const BASE = "https://apis.data.go.kr/1613000/SubwayInfo";

// ⚠ 오퍼레이션 첫 글자 대문자. 소문자 get은 "API not found".
async function call(op, params) {
  const url = new URL(`${BASE}/${op}`);
  url.searchParams.set("serviceKey", KEY);
  url.searchParams.set("_type", "json");
  url.searchParams.set("numOfRows", "500");
  url.searchParams.set("pageNo", "1");
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
  const text = await res.text();
  try {
    const json = JSON.parse(text);
    const header = json?.response?.header ?? {};
    const item = json?.response?.body?.items?.item;
    return {
      code: String(header.resultCode ?? ""),
      msg: String(header.resultMsg ?? ""),
      total: Number(json?.response?.body?.totalCount ?? 0),
      items: Array.isArray(item) ? item : item ? [item] : [],
    };
  } catch {
    return { code: "PARSE_FAIL", msg: text.slice(0, 120).replace(/\s+/g, " "), total: 0, items: [] };
  }
}

// 1. 인증 축 — 키워드 검색이 정상 응답 + 봉투가 response.header 모양
const search = await call("GetKwrdFndSubwaySttnList", { subwayStationName: "강남" });
check(
  "키워드 검색: 인증 통과(resultCode=00) — 2026-08-04 거부의 해소 확인",
  search.code === "00",
  `${search.code} ${search.msg}`,
);
check("키워드 검색: 강남 매칭 1건 이상", search.items.length > 0, `${search.items.length}건`);
check(
  "키워드 검색: subwayStationId·subwayRouteName 필드 계약(표본 1건 이상)",
  search.items.length > 0 &&
    search.items.every((s) => s?.subwayStationId && s?.subwayRouteName),
  `${search.items.length}건 검사`,
);

// 2. 인증 축 — 스케줄 오퍼레이션도 같은 키로 통과하는가
//    (오퍼레이션마다 승인 상태가 다를 수 있어 검색 통과가 스케줄 통과를 증명하지 않는다)
const gangnam2 = search.items.find((s) => String(s.subwayRouteName).includes("2호선"));
const schedule = gangnam2
  ? await call("GetSubwaySttnAcctoSchdulList", {
      subwayStationId: String(gangnam2.subwayStationId),
      dailyTypeCode: "01",
      upDownTypeCode: "U",
    })
  : { code: "NO_SAMPLE", msg: "2호선 강남 미매칭", total: 0, items: [] };
check(
  "스케줄 조회: 인증 통과(resultCode=00)",
  schedule.code === "00",
  `${schedule.code} ${schedule.msg}`,
);
check("스케줄 조회: 2호선 강남 상행 발차 행 존재", schedule.total > 0, `${schedule.total}행`);
// ⚠ 빈 배열에서 `every`는 true다 — 표본이 비면 조용히 통과한다. 위 total 검사가
//   실질적으로 막아 주지만 total과 items는 다른 필드라 논리적 보장이 아니므로 하한을 함께 건다.
check(
  "스케줄 조회: depTime 필드 계약(표본 1건 이상)",
  schedule.items.length > 0 && schedule.items.every((r) => r?.depTime != null),
  `${schedule.items.length}행 검사`,
);

// 3. 커버리지 축 — 인증과 별개. 같은 키·같은 응답 코드로도 노선별 0건이 실재한다.
//
//    ⚠ 여기서는 원시 응답만 보지 않고 **실제 provider를 태운다**. 원시 API만 두드리면
//    "업스트림이 0행을 준다"까지만 확인하고, 우리 판정이 그것을 사용자에게 어떻게
//    전달하는지는 확인하지 못한다 — 이 게이트가 지키려는 계층이 바로 그 자리다.
//    판정 로직을 이 스크립트에 복제하지 않는 이유도 같다(복제하면 게이트가 코드가
//    아니라 자기 복사본을 검증한다). esbuild로 TS provider를 번들해 import한다.
//
//    ⚠ **요일에 의존하는 수치는 단언하지 않는다.** dailyTypeCode=02(토요일)는
//    수도권·코레일 계열 전 노선이 0행이라(2026-08-23 실측), "ok가 1건 이상" 같은
//    단언을 넣으면 매주 토요일 FAIL한다. 그것은 코드 정확성이 아니라 업스트림 제공
//    여부를 테스트하는 것이고, 주기적으로 빨개지는 게이트는 결국 무시된다.
//    요일 무관 불변식만 단언하고 수치는 로그로 남긴다.
//    ⚠ gildongmu는 역 단위 토요일→휴일 폴백이 분류 앞에서 돌므로 토요일 unknown이 dodo보다 적다.
//    설계 정본: docs/superpowers/specs/2026-08-23-tago-timetable-coverage-design.md §4
console.log("\n[커버리지] provider 실판정 — 매칭된 노선이 전부 살아 있는가");

const { execFileSync } = await import("node:child_process");
const { mkdtempSync, rmSync, writeFileSync } = await import("node:fs");
const { tmpdir } = await import("node:os");
const { join, resolve } = await import("node:path");

const workDir = mkdtempSync(join(tmpdir(), "tago-gate-"));
const entryPath = join(workDir, "entry.ts");
const bundlePath = join(workDir, "tago-subway.mjs");
// ⚠ 역명 정규화(parseStationQuery·normalizeStationName)도 **provider의 것을 재사용**한다.
//   이 스크립트에서 `name.replace(/역$/, "")` 같은 자체 규칙을 쓰면 "서울역"에서 어긋난다
//   (역명 자체가 "서울역"이라 접미사를 떼면 안 된다 — 실제로 이 게이트가 그 실수로 한 번
//   FAIL했다). 판정도 정규화도 복제하지 않는 것이 이 게이트의 규율이다.
const libDir = resolve(process.cwd(), "src/lib");
writeFileSync(entryPath, [
  `export { fetchStationTimetable, MAX_LINES } from ${JSON.stringify(join(libDir, "providers/tago-subway"))};`,
  `export { parseStationQuery, normalizeStationName, lineHintMatches } from ${JSON.stringify(join(libDir, "station-match"))};`,
].join("\n"));

let fetchStationTimetable, MAX_LINES, parseStationQuery, normalizeStationName, lineHintMatches;
try {
  execFileSync(
    "npx",
    ["esbuild", entryPath, "--bundle", "--format=esm", "--platform=node", `--outfile=${bundlePath}`],
    { stdio: "pipe" },
  );
  ({ fetchStationTimetable, MAX_LINES, parseStationQuery, normalizeStationName, lineHintMatches } = await import(bundlePath));
} catch (e) {
  check("provider 번들 로드", false, String(e).slice(0, 160));
}

try {
  if (fetchStationTimetable) {
  // 노원역: 4호선이 **노선째** 0행(unknown)이고 7호선은 정상인 역(A21, 2026-08-25). 관측용.
  for (const station of ["강남역", "홍대입구역", "서울역", "노원역"]) {
    let tt;
    try {
      tt = await fetchStationTimetable(station);
    } catch (e) {
      check(`${station}: provider 조회`, false, String(e).slice(0, 120));
      continue;
    }
    if (!tt) {
      console.log(`  ${station}: 미커버(null) — 키워드 정확매칭 0건`);
      continue;
    }

    // 매칭된 노선 수는 provider 내부값이라 밖에서 못 본다. provider와 **같은 함수·같은
    // 상수**로 질의를 정규화해 키워드를 다시 조회하고 대조한다(정확매칭 + lineHint + MAX_LINES).
    // ⚠ 상한을 여기서 재선언하지 않는다 — provider가 상한을 줄이면 게이트만 옛 값으로
    //   세어 "탈락 0"이라는 거짓 PASS를 낸다(정규화 복제와 같은 함정, 실패 방향이 더 나쁘다).
    const { nameKey, lineHint } = parseStationQuery(station);
    const kw = await call("GetKwrdFndSubwaySttnList", { subwayStationName: nameKey });
    const matched = kw.items
      .filter((x) => normalizeStationName(String(x.subwayStationName)) === nameKey)
      .filter((x) => !lineHint || lineHintMatches(String(x.subwayRouteName), lineHint))
      .slice(0, MAX_LINES);

    check(
      `${station}: 매칭된 노선이 전부 lines에 남는다(탈락 0)`,
      tt.lines.length === matched.length,
      `lines ${tt.lines.length} vs 매칭 ${matched.length}`,
    );
    check(
      `${station}: 모든 노선에 coverage가 있다`,
      tt.lines.every((l) => typeof l.coverage === "string" && l.coverage.length > 0),
      tt.lines.map((l) => `${l.lineName}=${l.coverage ?? "(없음)"}`).join(", "),
    );
    check(
      `${station}: lineName이 유일하다(iOS ForEach id·표시 경계 — 전 매칭 노선이 실리므로)`,
      new Set(tt.lines.map((l) => l.lineName)).size === tt.lines.length,
      tt.lines.map((l) => l.lineName).join(", "),
    );
    check(
      `${station}: directions가 비지 않는 것은 coverage="ok"인 노선뿐`,
      tt.lines.every((l) => (l.directions.length > 0) === (l.coverage === "ok")),
      tt.lines.map((l) => `${l.lineName}:${l.coverage}/${l.directions.length}`).join(", "),
    );

    // 사용자에게 실제로 도달하는 내용 — 단언이 아니라 관측 로그(요일 의존).
    console.log(`  ${station} (${tt.dailyType}${tt.partial ? ", partial" : ""}):`);
    for (const l of tt.lines) {
      const detail = l.coverage === "ok"
        ? l.directions.map((d) => `${d.direction} ${d.first.time}~${d.last.time}`).join(" / ")
        : "첫차·막차 없음";
      console.log(`    - ${l.lineName}: coverage=${l.coverage} — ${detail}`);
    }
  }
  }
} finally {
  rmSync(workDir, { recursive: true, force: true });
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} PASS`);
process.exit(failed.length > 0 ? 1 : 0);
