#!/usr/bin/env node
// 실호출 게이트 — 실시간 추적 `lang=en`(E27 잔여 ①, spec 2026-09-01 §5.5).
//
// 보는 것 셋: ①영문 조각이 실제로 실리는가 ②한국어 필드가 en 응답에서도 한국어인가(원칙 1)
// ③행렬 밖 모양이 부재로 떨어지는가(거짓 문장 없음).
//
// ⚠ **항목 0건은 합격이 아니라 미실측이다.** 운행 시간 밖이면 도착이 0건인데, 0건을 통과로 세면
// 아무것도 검증하지 않고 게이트를 지난다(설계 리뷰 #20). 최소 한 provider에서 비어 있지 않은
// 응답이 있어야 게이트가 성립하고, 그렇지 않으면 exit 2(미실측)로 끝난다.
//
// 사용법: node scripts/verify-transit-track-lang.mjs
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
const unmeasured = [];
function note(name, detail) {
  unmeasured.push({ name, detail });
  console.log(`SKIP — ${name} (${detail})`);
}

const HANGUL = /[가-힣]/;

const workDir = mkdtempSync(join(tmpdir(), "track-lang-gate-"));
const entryPath = join(workDir, "entry.ts");
const bundlePath = join(workDir, "track.mjs");
writeFileSync(
  entryPath,
  // 서비스 계층을 그대로 태운다(판정 복제 금지 — verify-odsay-lang 동형).
  `export { trackSubway, trackSeoulWait, trackTago, resolveTagoStop } from ${JSON.stringify(resolve("src/lib/transit-track"))};`,
);

try {
  execFileSync(
    "npx",
    ["esbuild", entryPath, "--bundle", "--format=esm", "--platform=node", `--outfile=${bundlePath}`],
    { stdio: "pipe" },
  );
  const { trackSubway, trackSeoulWait, trackTago, resolveTagoStop } = await import(bundlePath);

  let sawItems = false;

  // ── 지하철(수도권) ────────────────────────────────────────────────
  {
    const params = { station: "천호", lineName: "수도권 5호선" };
    const en = await trackSubway({ ...params, lang: "en" });
    const ko = await trackSubway({ ...params, lang: "ko" });
    if (en.status !== "ok" || ko.status !== "ok") {
      note("지하철 천호 5호선", `status=${en.status}/${ko.status} — 운행 시간 밖이거나 미등장`);
    } else {
      sawItems = true;
      const item = en.items[0];
      check("지하철: 한국어 필드가 en 응답에서도 한국어", HANGUL.test(item.message), item.message);
      check(
        "지하철: 영문 조각이 하나 이상 실린다",
        Boolean(item.messageEn || item.directionEn || item.destinationNameEn),
        JSON.stringify({ messageEn: item.messageEn, directionEn: item.directionEn, destinationNameEn: item.destinationNameEn }),
      );
      const enFields = en.items.flatMap((i) =>
        [i.messageEn, i.directionEn, i.destinationNameEn, i.currentLocationEn].filter((v) => v != null),
      );
      check("지하철: 영문 조각에 한글이 섞이지 않는다", !enFields.some((v) => HANGUL.test(v)), enFields.join(" | "));
      check(
        "지하철: ko 응답에는 영문 키가 0개",
        ko.items.every((i) => Object.keys(i).every((k) => !k.endsWith("En"))),
      );
      const missing = en.items.filter((i) => i.messageEn == null).map((i) => i.message);
      if (missing.length) console.log(`  · 행렬 밖으로 부재 처리된 문장 ${missing.length}건: ${missing.join(" / ")}`);
    }
  }

  // ── 서울버스(TOPIS) ──────────────────────────────────────────────
  {
    // 천호역.풍납시장(24101) × 30-3(227000006) — fixture와 같은 표본.
    const params = { arsId: "24101", routeId: "227000006" };
    const en = await trackSeoulWait({ ...params, lang: "en" });
    const ko = await trackSeoulWait({ ...params, lang: "ko" });
    if (en.status !== "ok") {
      note("서울버스 천호역.풍납시장 30-3", `status=${en.status} — 운행 종료이거나 도착 없음`);
    } else {
      sawItems = true;
      const item = en.items[0];
      check("서울버스: 한국어 문장 그대로", HANGUL.test(item.message), item.message);
      check("서울버스: 방향·종착역 자리를 만들지 않는다(구조적 부재)",
        !("directionEn" in item) && !("destinationNameEn" in item));
      check("서울버스: ko 응답에는 영문 키가 0개",
        ko.status !== "ok" || ko.items.every((i) => !("messageEn" in i)));
      const withEn = en.items.filter((i) => i.messageEn != null);
      check("서울버스: 영문 문장이 하나 이상", withEn.length > 0,
        en.items.map((i) => `${i.message} → ${i.messageEn ?? "(부재)"}`).join(" | "));
    }
  }

  // ── 지방버스(TAGO) ───────────────────────────────────────────────
  try {
    // 대전 시청 부근 — 좌표로 정류소를 먼저 해석한다(웹·iOS와 같은 경로).
    const resolved = await resolveTagoStop({ lat: 36.3504, lng: 127.3845 });
    if (resolved.status !== "ok") {
      note("TAGO 대전 시청", `resolve status=${resolved.status}`);
    } else {
      const arrivals = await trackTago({
        cityCode: resolved.stop.cityCode, nodeId: resolved.stop.nodeId, routeNo: "102", lang: "en",
      });
      if (arrivals.status !== "ok") {
        note("TAGO 대전 시청 102", `status=${arrivals.status} — 그 노선 도착 없음`);
      } else {
        sawItems = true;
        check("TAGO: messageEn이 빈 문자열로 실린다(부재가 아니라 자리 표시)",
          arrivals.items.every((i) => i.messageEn === ""));
      }
    }
  } catch (e) {
    // upstream 장애는 우리 계약의 실패가 아니다 — **미실측**으로 기록하고 넘어간다
    // (게이트가 죽으면 앞의 PASS까지 잃는다).
    note("TAGO 대전 시청", `upstream 오류: ${e instanceof Error ? e.message : String(e)}`);
  }

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} PASS, 미실측 ${unmeasured.length}건`);
  if (!sawItems) {
    console.log("미실측 — 어느 provider에서도 항목이 0건이었다. 0건은 합격이 아니다(운행 시간을 바꿔 재실행).");
    process.exit(2);
  }
  process.exit(failed.length ? 1 : 0);
} finally {
  rmSync(workDir, { recursive: true, force: true });
}
