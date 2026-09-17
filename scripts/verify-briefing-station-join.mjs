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
// ⚠ ODsay 일 1,000회를 프로덕션과 공유한다. 이 게이트는 **OD 쌍 수만큼**(현재 12콜) 쓴다. 429면
//   재시도하지 않는다(exit 2) — 게이트가 429라는 것은 그날 프로덕션도 429라는 뜻이다.
//
// 사용법: node scripts/verify-briefing-station-join.mjs [--out <path>] [--lang en]
//   exit 0 = 표본 구성 충족 / 1 = 미충족 또는 호출 불가 / 2 = 쿼터 소진
import { readFileSync, mkdtempSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

try {
  for (const line of readFileSync(".env.local", "utf8").split("\n")) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
} catch { /* CI 등에서는 환경변수 직접 주입 */ }

const args = process.argv.slice(2);
const outPath = args.includes("--out") ? args[args.indexOf("--out") + 1] : join(tmpdir(), "briefing-join.json");
const lang = args.includes("--lang") ? args[args.indexOf("--lang") + 1] : "ko";

const results = [];
function check(name, cond, detail) {
  results.push({ name, pass: Boolean(cond), detail });
  console.log(`${cond ? "PASS" : "FAIL"} — ${name}${detail ? ` (${detail})` : ""}`);
}

/**
 * OD 쌍. 확인하려는 케이스(환승 2회 이상 · 버스↔지하철 혼합 · 도보 줄 없는 지하철 연속 · 지방 도시 ·
 * 순환선)를 겨냥해 고르되, **그 케이스가 실제로 나왔는지는 응답을 보고 판정한다** — 겨냥이 곧 존재는 아니다.
 */
const PAIRS = [
  { name: "천호 → 여의도(5호선 직통)", origin: { lat: 37.5385, lng: 127.1235 }, dest: { lat: 37.5215, lng: 126.9243 } },
  { name: "김포공항 → 상봉(장거리 환승)", origin: { lat: 37.5629, lng: 126.8016 }, dest: { lat: 37.5964, lng: 127.0851 } },
  { name: "강남 → 잠실(2호선 순환)", origin: { lat: 37.4979, lng: 127.0276 }, dest: { lat: 37.5133, lng: 127.1 } },
  { name: "서울역 → 사당", origin: { lat: 37.5547, lng: 126.9707 }, dest: { lat: 37.4765, lng: 126.9816 } },
  { name: "수원역 → 판교역", origin: { lat: 37.2659, lng: 127.0003 }, dest: { lat: 37.3947, lng: 127.1112 } },
  { name: "부평역 → 인천시청", origin: { lat: 37.4894, lng: 126.7246 }, dest: { lat: 37.4574, lng: 126.7317 } },
  { name: "부산 서면 → 해운대", origin: { lat: 35.1579, lng: 129.0594 }, dest: { lat: 35.1631, lng: 129.1635 } },
  { name: "대구 반월당 → 동대구역", origin: { lat: 35.8656, lng: 128.5936 }, dest: { lat: 35.8797, lng: 128.6285 } },
  { name: "대전 정부청사 → 대전역", origin: { lat: 36.3612, lng: 127.3812 }, dest: { lat: 36.3323, lng: 127.4342 } },
  { name: "길동 주택가 → 천호(짧은 도보+지하철)", origin: { lat: 37.5372, lng: 127.1414 }, dest: { lat: 37.5385, lng: 127.1235 } },
  { name: "은평 주택가 → 종로3가(버스 혼합 기대)", origin: { lat: 37.6176, lng: 126.9227 }, dest: { lat: 37.5714, lng: 126.9917 } },
  { name: "과천 → 사당(경기-서울 경계)", origin: { lat: 37.4292, lng: 126.9897 }, dest: { lat: 37.4765, lng: 126.9816 } },
];

const workDir = mkdtempSync(join(tmpdir(), "briefing-join-gate-"));
const entryPath = join(workDir, "entry.ts");
const bundlePath = join(workDir, "odsay.mjs");
// next/cache는 Next 런타임 밖에 없다 — 통과 스텁으로 대체해 provider를 그대로 태운다(판정 로직 복제 금지).
const stubPath = join(workDir, "next-cache-stub.mjs");
writeFileSync(stubPath, "export const unstable_cache = (fn) => fn;\n");
writeFileSync(entryPath, `export { getTransitRoute } from ${JSON.stringify(resolve("src/lib/providers/odsay"))};`);

let quota = false;
const samples = [];
try {
  execFileSync(
    "npx",
    ["esbuild", entryPath, "--bundle", "--format=esm", "--platform=node", `--alias:next/cache=${stubPath}`, `--outfile=${bundlePath}`],
    { stdio: "pipe" },
  );
  const { getTransitRoute } = await import(bundlePath);

  for (const pair of PAIRS) {
    if (quota) break;
    try {
      const result = await getTransitRoute({
        origin: pair.origin, dest: pair.dest, includeStops: true,
        ...(lang === "en" ? { lang: "en" } : {}),
      });
      if (!result) {
        console.log(`  · ${pair.name}: 경로 없음`);
        continue;
      }
      const routes = [result.recommended, ...result.alternatives];
      samples.push({ pair: pair.name, routes: routes.map((r) => ({ legs: r.legs })) });
      console.log(`  · ${pair.name}: ${routes.length}경로 / ${routes.reduce((n, r) => n + r.legs.length, 0)}구간`);
    } catch (e) {
      // ⚠ provider가 `kind`를 안 붙이는 경로도 있다 — 메시지로도 본다. 쿼터를 일반 실패로 접으면 남은 OD를
      //   계속 때려 그날 프로덕션 한도를 더 깎는다(2026-09-18 실측: 10번째 OD에서 429가 왔다).
      const message = String(e?.message ?? e);
      if (e?.kind === "quota" || /\b429\b|quota/i.test(message)) { quota = true; break; }
      console.log(`  · ${pair.name}: 실패 ${e?.kind ?? "?"} ${message.slice(0, 120)}`);
    }
  }
} catch (e) {
  check("provider 번들·호출", false, String(e?.message ?? e).slice(0, 200));
}

if (quota) {
  console.log(`\nODsay 일일 쿼터 소진 — ${samples.length}/${PAIRS.length} OD에서 끊겼다. 재시도하지 않는다.`);
  console.log("⚠ 게이트가 429라는 것은 **그날 프로덕션도 429**라는 뜻이다(같은 키·같은 한도).");
  if (samples.length === 0) process.exit(2);
  console.log("모은 표본만으로 아래 구성 판정을 이어 간다 — 부족하면 그 항목이 FAIL로 드러난다.");
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

writeFileSync(outPath, JSON.stringify({ lang, capturedAt: new Date().toISOString(), samples }, null, 2));
console.log(`\n덤프: ${outPath}`);
console.log("2단(조인 성립률)은 실제 구현이 판정한다:");
console.log(`  BRIEFING_JOIN_GATE=${outPath} swift test --package-path ios/GildongmuKit --filter BriefingStationJoinGateTests`);

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} PASS${quota ? " (쿼터로 표본 절단)" : ""}`);
process.exit(failed.length ? 1 : quota ? 2 : 0);
