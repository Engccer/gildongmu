#!/usr/bin/env node
// 실호출 게이트 — 급행 정차역 집합(A16 L1) + 출구 번호 투영(E25).
// spec docs/superpowers/specs/2026-09-02-express-stops-data-design.md §6.
//
// 지키려는 계약:
//   ① 9호선 급행 정차역 집합이 **16역 골든과 전수 일치**한다(이름·순서). 부분 단언(당산 포함·노들 미포함)은
//      같은 길이 치환(여의도 → 샛강)을 못 잡는다 — ODsay 데이터가 양방향 일관되게 틀린 경우는 단일 소스
//      수락 판정이 못 잡으므로 이 게이트가 그 축이다. ⚠ 골든이 어긋나면 다이어 개정인지 ODsay 오류인지
//      사람이 가른다(개정이면 골든을 고치고 CHANGELOG에 남긴다).
//   ② 길찾기 응답에서 9호선 leg(완행·급행)에 `expressStops`가 붙고 빈 배열이 없다.
//   ③ `exit`: 첫 지하철 leg board="2"(개화), 마지막 leg alight="1"(중앙보훈병원), 환승 leg엔 없음,
//      값은 운영 정규식과 같은 완전 일치, 직렬화에 "null" 문자열 0.
//
//   ④ 정차 패턴이 여럿인 1호선(급행·특급)은 표에 없어 **필드 부재**다 — 소비자가 검증할 수 없는 계약이라 생산자
//      게이트가 정본이다(용산→동인천 1콜).
//
// ⚠ ODsay 일 1,000회를 프로덕션과 공유한다. 이 게이트는 **6콜**(집합 정·역 2 + 9호선 길찾기 1 + 그 안의 express
//   조회 2(캐시 없는 환경) + 1호선 길찾기 1)을 쓴다. 429면 재시도하지 않는다(exit 2).
//
// 사용법: node scripts/verify-odsay-express-stops.mjs
//   exit 0 = 통과 / 1 = 계약 위반 또는 호출 불가 / 2 = ODsay 일일 쿼터 소진
import { readFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

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

// 골든(실호출 2026-09-02 개화→중앙보훈병원, 서울시메트로9호선 급행 정차역과 일치)
const GOLDEN_LINE9 = [
  "김포공항", "마곡나루", "가양", "염창", "당산", "여의도", "노량진", "동작",
  "고속터미널", "신논현", "선정릉", "봉은사", "종합운동장", "석촌", "올림픽공원", "중앙보훈병원",
];
const GOLDEN_LINE9_IDS = ["902", "905", "907", "910", "913", "915", "917", "920", "923", "925", "927", "929", "930", "933", "936", "938"];
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const EXIT_RE = /^[1-9]\d*(?:-[1-9]\d*)?$/; // 운영 `exitNumber`와 같은 완전 일치

let quota = false;
const workDir = mkdtempSync(join(tmpdir(), "odsay-express-gate-"));
const entryPath = join(workDir, "entry.ts");
const bundlePath = join(workDir, "odsay.mjs");
// next/cache는 Next 런타임 밖에 없다 — 통과 스텁으로 대체해 provider를 그대로 태운다(판정 로직 복제 금지).
const stubPath = join(workDir, "next-cache-stub.mjs");
writeFileSync(stubPath, "export const unstable_cache = (fn) => fn;\n");
writeFileSync(
  entryPath,
  `export { getTransitRoute } from ${JSON.stringify(resolve("src/lib/providers/odsay"))};
export { fetchExpressStopsUncached } from ${JSON.stringify(resolve("src/lib/providers/odsay-express-stops"))};
export { EXPRESS_LINES } from ${JSON.stringify(resolve("src/lib/express-stops"))};`,
);
try {
  execFileSync(
    "npx",
    ["esbuild", entryPath, "--bundle", "--format=esm", "--platform=node", `--alias:next/cache=${stubPath}`, `--outfile=${bundlePath}`],
    { stdio: "pipe" },
  );
  const { getTransitRoute, fetchExpressStopsUncached, EXPRESS_LINES } = await import(bundlePath);
  const line9 = EXPRESS_LINES.find((e) => e.line === "수도권 9호선");

  // ① 집합 골든 전수(정·역방향 2콜)
  let set = null;
  try {
    set = await fetchExpressStopsUncached(line9);
  } catch (e) {
    if (e?.kind === "quota") quota = true;
    check("9호선 급행 정차역 집합 조회", false, `${e?.kind ?? "?"}: ${String(e?.message ?? e).slice(0, 160)}`);
  }
  if (set) {
    check("9호선 급행 정차역 16역 골든 전수 일치(이름·순서)", same(set.names, GOLDEN_LINE9), set.names.join("·"));
    check("9호선 급행 정차역 stationID 16개 골든 전수 일치(같은 순서)", same(set.ids, GOLDEN_LINE9_IDS), set.ids.join("·"));
  }

  // ② ③ 길찾기 응답(개화→중앙보훈병원, includeStops) — 표본이 정·역 조회 OD와 같다
  if (!quota) {
    const result = await getTransitRoute({
      origin: line9.probe.origin,
      dest: line9.probe.dest,
      includeStops: true,
    });
    const routes = result ? [result.recommended, ...result.alternatives] : [];
    check("경로 조회: 후보 1건 이상", routes.length > 0, `${routes.length}건`);
    const legs = routes.flatMap((r) => r.legs);
    const line9Legs = legs.filter((l) => l.mode === "subway" && /9호선/.test(l.lineName ?? ""));
    check(
      "9호선 leg(완행·급행) 전부에 expressStops 16역 + expressStopIds 같은 순서",
      line9Legs.length > 0 && line9Legs.every((l) => same(l.expressStops, GOLDEN_LINE9) && same(l.expressStopIds, GOLDEN_LINE9_IDS)),
      line9Legs.map((l) => `${l.lineName}:${l.expressStops?.length ?? "부재"}/${l.expressStopIds?.length ?? "부재"}`).join(" | "),
    );
    check(
      "빈 expressStops 없음 + 도보·버스 leg 부재",
      legs.every((l) => (l.mode === "subway" ? !("expressStops" in l) || l.expressStops.length > 0 : !("expressStops" in l))),
    );
    // ③ exit — 경로 문맥: 첫 지하철 leg board, 마지막 지하철 leg alight, 사이 leg 없음
    for (const r of routes) {
      const boards = r.legs.filter((l) => l.mode !== "walk");
      const subs = r.legs.filter((l) => l.mode === "subway");
      const first = subs[0];
      const last = subs[subs.length - 1];
      const middle = subs.slice(1, -1);
      // 기대 출구는 OD가 개화·중앙보훈병원인 leg에만 단언한다 — 버스로 갈아타는 경로의 하차 출구는
      // 다른 역의 다른 번호가 정답이라 값을 못 박지 않고 형식만 본다.
      if (boards[0]?.mode === "subway" && first?.fromName === "개화") {
        check(`[${r.routeKey}] 첫 지하철 leg(개화 승차) exit.board === "2"`, first?.exit?.board === "2", JSON.stringify(first?.exit ?? null));
      }
      if (boards[boards.length - 1]?.mode === "subway" && last?.toName === "중앙보훈병원") {
        check(`[${r.routeKey}] 마지막 지하철 leg(중앙보훈병원 하차) exit.alight === "1"`, last?.exit?.alight === "1", JSON.stringify(last?.exit ?? null));
      }
      if (subs.length > 1) {
        check(`[${r.routeKey}] 지하철 환승 사이의 leg 경계엔 exit 없음`,
          middle.every((l) => !("exit" in l)) &&
            // 첫 지하철 leg 뒤가 지하철(역내 환승)이면 alight 없음, 마지막 지하철 leg 앞이 지하철이면 board 없음
            (boards[boards.indexOf(first) + 1]?.mode !== "subway" || first.exit?.alight == null) &&
            (boards[boards.indexOf(last) - 1]?.mode !== "subway" || last.exit?.board == null));
      }
      for (const l of subs) {
        for (const v of [l.exit?.board, l.exit?.alight]) {
          if (v != null) check(`[${r.routeKey}] exit 값 완전 일치 정규식`, EXIT_RE.test(v), v);
        }
      }
    }
    check('응답 직렬화에 "null" 문자열 값이 없다', !JSON.stringify(result).includes('"null"'));

    // ④ 1호선(급행·특급 복수 패턴)은 표에 없다 → 필드 부재. 용산 → 동인천(경인급행 구간).
    const line1 = await getTransitRoute({
      origin: { lat: 37.5299, lng: 126.9646 },
      dest: { lat: 37.4749, lng: 126.6327 },
      includeStops: true,
    });
    const line1Legs = (line1 ? [line1.recommended, ...line1.alternatives] : []).flatMap((r) => r.legs).filter((l) => l.mode === "subway" && /1호선/.test(l.lineName ?? ""));
    check(
      "1호선 leg에는 expressStops·expressStopIds 부재(복수 정차 패턴 노선 = 판정 불가)",
      line1Legs.length > 0 && line1Legs.every((l) => !("expressStops" in l) && !("expressStopIds" in l)),
      `${line1Legs.length}건`,
    );
    for (const r of routes) {
      console.log(
        `  ${r.summary.totalMinutes}분: ` +
          r.legs.filter((l) => l.mode !== "walk").map((l) => `${l.lineName}→${l.toName}${l.expressStops ? `[급행${l.expressStops.length}]` : ""}${l.exit ? " " + JSON.stringify(l.exit) : ""}`).join(" | "),
      );
    }
  }
} catch (e) {
  // 길찾기 단계에서 만난 429도 쿼터다(provider는 일반 Error로 던지므로 메시지로 가른다) — exit 2.
  if (/\b429\b/.test(String(e))) quota = true;
  check("provider 실호출", false, String(e).slice(0, 300));
} finally {
  rmSync(workDir, { recursive: true, force: true });
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} PASS`);
process.exit(quota ? 2 : failed.length > 0 ? 1 : 0);
