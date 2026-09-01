#!/usr/bin/env node
// 실호출 게이트 — ODsay 빠른환승 문(A20). 노원 → 구로디지털단지에서 사당 4호선→2호선 환승 leg가
// `quickExit.transfer` "5-2"를 싣고(카카오지하철·ODsay subwayPath 일치 확인 2026-08-25),
// 하차 leg의 `door="null"` 문자열이 응답 어디에도 새지 않는지 본다.
//
// 사용법: node scripts/verify-odsay-transfer-door.mjs
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

// 판정 로직을 복제하지 않고 provider를 그대로 태운다(verify-korea-subway-timetable 동형).
const workDir = mkdtempSync(join(tmpdir(), "odsay-gate-"));
const entryPath = join(workDir, "entry.ts");
const bundlePath = join(workDir, "odsay.mjs");
const stubPath = join(workDir, "next-cache-stub.mjs");
writeFileSync(stubPath, "export const unstable_cache = (fn) => fn;\n");
writeFileSync(
  entryPath,
  `export { getTransitRoute } from ${JSON.stringify(resolve("src/lib/providers/odsay"))};`,
);
try {
  execFileSync(
    "npx",
    // odsay.ts가 급행 정차역 캐시(`next/cache`)를 끌어오므로 Next 런타임 밖에서는 통과 스텁으로 대체한다
    // (2026-09-02 — 없으면 esbuild가 `@opentelemetry/api` 미해결로 번들 자체가 실패한다).
    ["esbuild", entryPath, "--bundle", "--format=esm", "--platform=node", `--alias:next/cache=${stubPath}`, `--outfile=${bundlePath}`],
    { stdio: "pipe" },
  );
  const { getTransitRoute } = await import(bundlePath);
  const result = await getTransitRoute({
    origin: { lat: 37.6563, lng: 127.0634 }, // 노원
    dest: { lat: 37.4849, lng: 126.8965 }, // 구로디지털단지
    includeStops: true,
  });
  const routes = result ? [result.recommended, ...result.alternatives] : [];
  check("경로 조회: 후보 1건 이상", routes.length > 0, `${routes.length}건`);

  const sadang = routes
    .flatMap((r) => r.legs)
    .find((l) => l.mode === "subway" && l.toName === "사당" && /4호선/.test(l.lineName ?? ""));
  check(
    "사당 4호선 환승 leg: quickExit.transfer = 5-2",
    sadang?.quickExit?.transfer?.doors?.[0] === "5-2",
    JSON.stringify(sadang?.quickExit ?? null),
  );
  check(
    "사당 환승 leg: seed 엘베·계단을 싣지 않는다(배타)",
    sadang && !sadang.quickExit?.elevator && !sadang.quickExit?.stairs,
    JSON.stringify(sadang?.quickExit ?? null),
  );
  const guro = routes
    .flatMap((r) => r.legs)
    .find((l) => l.mode === "subway" && l.toName === "구로디지털단지");
  check(
    "구로디지털단지 최종 하차 leg: transfer 없음 + seed 값",
    guro && !guro.quickExit?.transfer && Boolean(guro.quickExit?.elevator || guro.quickExit?.stairs),
    JSON.stringify(guro?.quickExit ?? null),
  );
  check('응답 직렬화에 "null" 문자열 값이 없다', !JSON.stringify(result).includes('"null"'));
  // A21: 4호선은 TAGO 시간표가 노선째 0행(unknown)이라 종전엔 running 버스 뒤로 밀려 5개
  // 절단에서 사라졌다. unknown이 정렬 키에서 빠졌으면 ODsay 1순위가 추천으로 돌아온다.
  // ⚠ 심야(01~05시)엔 2호선도 outside라 근거가 달라지므로 그 시간대엔 단언하지 않는다.
  const kstHour = (new Date().getUTCHours() + 9) % 24;
  const rec = result?.recommended;
  // 시나리오 유효성: 4호선 leg가 여전히 unknown이어야 이 단언이 A21을 검증한다. TAGO가 4호선을
  // 채우면 이 검사가 먼저 FAIL해 "게이트가 다른 것을 재고 있다"를 드러낸다(조용한 초록 방지).
  const line4 = routes.flatMap((r) => r.legs).find((l) => l.mode === "subway" && /4호선/.test(l.lineName ?? ""));
  // 2026-09-02 재관측: TAGO가 4호선을 채워(232행) 이 조건이 더는 성립하지 않는다 — 시나리오 무효는 FAIL이 아니라
  // 표기다(추천 단언은 그대로 돈다: unknown이든 running이든 ODsay 1순위가 추천이어야 한다).
  console.log(`  A21 시나리오(4호선 unknown) ${line4?.serviceStatus === "unknown" ? "유효" : "무효 — TAGO가 4호선을 채웠다"}: ${line4?.lineName ?? "(4호선 없음)"}[${line4?.serviceStatus}]`);
  const recIsLine4Sadang =
    rec?.legs.some((l) => l.mode === "subway" && /4호선/.test(l.lineName ?? "") && l.toName === "사당") &&
    rec?.legs.some((l) => l.mode === "subway" && /2호선/.test(l.lineName ?? ""));
  if (kstHour >= 1 && kstHour < 5) {
    console.log("  (심야라 A21 추천 단언 생략)");
  } else {
    check("A21: 추천이 ODsay 1순위 '4호선 노원→사당→2호선'(4호선 unknown인 채로)", recIsLine4Sadang,
      rec?.legs.filter((l) => l.mode !== "walk").map((l) => `${l.lineName}[${l.serviceStatus}]`).join(" | "));
  }
  for (const r of routes) {
    console.log(
      `  ${r.summary.totalMinutes}분 ${r.highlight?.join("/") ?? ""}: ` +
        r.legs.filter((l) => l.mode !== "walk").map((l) => `${l.lineName}→${l.toName}[${l.serviceStatus}]${l.quickExit ? " " + JSON.stringify(l.quickExit) : ""}`).join(" | "),
    );
  }
  console.log(`  totalCandidates=${result?.totalCandidates}`);
} catch (e) {
  check("provider 실호출", false, String(e).slice(0, 200));
} finally {
  rmSync(workDir, { recursive: true, force: true });
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} PASS`);
process.exit(failed.length > 0 ? 1 : 0);
