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
writeFileSync(
  entryPath,
  `export { getTransitRoute } from ${JSON.stringify(resolve("src/lib/providers/odsay"))};`,
);
try {
  execFileSync(
    "npx",
    ["esbuild", entryPath, "--bundle", "--format=esm", "--platform=node", `--outfile=${bundlePath}`],
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
