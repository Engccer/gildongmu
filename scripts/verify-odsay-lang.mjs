#!/usr/bin/env node
// 실호출 게이트 — ODsay `lang=1` 영문 응답(E27 spec §3.8). 게이트는 관측 증거이고 계약의 정본은
// provider의 런타임 `*Kor` 완전성 검증(fail-closed)이다. 여기서는 오늘의 ODsay가 그 계약을 지키고
// 우리 투영(노선명 표·정류소명 정규화)이 실데이터에서 결측 0인지 본다.
//
// 경로 셋: 길동→강남(지하철 3구간) · 김포공항→신논현(9호선 급행 **필수 표본** — 급행 lane이 없으면 FAIL) ·
// 길동→하남(버스 정류소 복합명). 각각 en·ko로 조회해 대조하고, 실시간 도착 en(강남·서울역)도 관측한다.
//
// 사용법: node scripts/verify-odsay-lang.mjs
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

const HANGUL = /[가-힣]/;
/** §3.2 예외 토큰 뒤가 아닌 `. `가 남았는가(정규화 누락 탐지) */
function hasRawSeparator(s) {
  return /(?<!\b(?:Apt|Univ|Nat'l|Edu|St|Mt|Jr|Sr|Dr|Co|Dept|Elem|Bldg|Ave|Rd|Blvd|Ctr|Hosp|No|Gen|Bros|Inc|Ltd|II|III|[A-Z]|\d+))\. (?=\S)/.test(s);
}

// provider를 그대로 태운다(판정 로직 복제 금지, verify-odsay-transfer-door 동형).
const workDir = mkdtempSync(join(tmpdir(), "odsay-lang-gate-"));
const entryPath = join(workDir, "entry.ts");
const bundlePath = join(workDir, "odsay.mjs");
writeFileSync(
  entryPath,
  [
    `export { getTransitRoute, normalizeOdsayRoutes, assertKorComplete } from ${JSON.stringify(resolve("src/lib/providers/odsay"))};`,
    `export { fetchSubwayArrivals, withArrivalsEn } from ${JSON.stringify(resolve("src/lib/providers/seoul-subway-arrival"))};`,
  ].join("\n"),
);
try {
  execFileSync(
    "npx",
    ["esbuild", entryPath, "--bundle", "--format=esm", "--platform=node", `--outfile=${bundlePath}`],
    { stdio: "pipe" },
  );
  const mod = await import(bundlePath);
  const { getTransitRoute, normalizeOdsayRoutes, fetchSubwayArrivals, withArrivalsEn } = mod;
  /** provider 캐시 밖 raw 호출 — 급행 전수 검사용(선정 5개에 가려지지 않게). */
  async function fetchOdsayRaw(origin, dest) {
    const q = new URLSearchParams({ SX: String(origin.lng), SY: String(origin.lat), EX: String(dest.lng), EY: String(dest.lat), OPT: "0", lang: "1" });
    const res = await fetch(`https://api.odsay.com/v1/api/searchPubTransPathT?${q}&apiKey=${process.env.ODSAY_API_KEY ?? ""}`, { headers: { Referer: "https://gildongmu.vercel.app/" } });
    if (!res.ok) throw new Error(`ODsay raw HTTP ${res.status}`);
    return res.json();
  }

  const ROUTES = [
    { name: "길동→강남", origin: { lat: 37.5384, lng: 127.1408 }, dest: { lat: 37.4979, lng: 127.0276 } },
    { name: "김포공항→신논현(9호선 급행)", origin: { lat: 37.5623, lng: 126.8012 }, dest: { lat: 37.5045, lng: 127.0249 }, expressRequired: true },
    { name: "길동→하남(버스)", origin: { lat: 37.5384, lng: 127.1408 }, dest: { lat: 37.5395, lng: 127.214 } },
  ];

  const legsOf = (r) => [r.recommended, ...r.alternatives].flatMap((route) => route.legs.map((leg) => ({ route, leg })));
  const signature = (route) =>
    [
      route.summary.totalMinutes,
      route.summary.fare,
      ...route.legs.filter((l) => l.mode !== "walk").map((l) => `${l.mode}:${l.stationCount ?? ""}:${l.serviceWayCode ?? ""}`),
    ].join("|");

  for (const r of ROUTES) {
    const en = await getTransitRoute({ origin: r.origin, dest: r.dest, includeStops: true, lang: "en" });
    const ko = await getTransitRoute({ origin: r.origin, dest: r.dest, includeStops: true });
    check(`${r.name}: en·ko 응답 존재`, en && ko);
    if (!en || !ko) continue;

    // 1. `*En` 결측 0 + 한글 0
    const boardLegs = legsOf(en).filter(({ leg }) => leg.mode !== "walk");
    const missing = boardLegs.filter(({ leg }) => !leg.lineNameEn || !leg.fromNameEn || !leg.toNameEn);
    check(`${r.name}: 탑승 leg *En 결측 0`, missing.length === 0, missing.map(({ leg }) => `${leg.lineName}@${leg.fromName}`).join("; "));
    const stopsMissing = boardLegs.flatMap(({ leg }) => (leg.stops ?? []).filter((s) => !s.nameEn));
    check(`${r.name}: 경유 정류장 nameEn 결측 0`, stopsMissing.length === 0, `${stopsMissing.length}`);
    const summaries = [en.recommended, ...en.alternatives].map((x) => x.summary);
    check(`${r.name}: 요약 departNameEn·arriveNameEn 결측 0`, summaries.every((s) => s.departNameEn && s.arriveNameEn));
    const enValues = [
      ...boardLegs.flatMap(({ leg }) => [leg.lineNameEn, leg.fromNameEn, leg.toNameEn, ...(leg.stops ?? []).map((s) => s.nameEn)]),
      ...summaries.flatMap((s) => [s.departNameEn, s.arriveNameEn]),
    ].filter(Boolean);
    check(`${r.name}: *En 값에 한글 0`, enValues.every((v) => !HANGUL.test(v)));

    // 4. 정규화 잔존물 0
    const dirty = enValues.filter((v) => /[ㆍ·]|Stn\.|\.\./.test(v) || hasRawSeparator(v));
    check(`${r.name}: *En 정규화 잔존물(ㆍ·Stn.·..·비예외 '. ') 0`, dirty.length === 0, dirty.slice(0, 5).join(" | "));

    // 5. 표 미스 0(지하철 leg lineNameEn이 표 값)
    const subwayLegs = boardLegs.filter(({ leg }) => leg.mode === "subway");
    check(`${r.name}: 지하철 lineNameEn 표 미스 0`, subwayLegs.every(({ leg }) => leg.lineNameEn), `${subwayLegs.length} legs`);

    // 2. 한국어 필드 en·ko 전수 일치(언어 무관 서명으로 짝)
    const koBySig = new Map([ko.recommended, ...ko.alternatives].map((route) => [signature(route), route]));
    let paired = 0;
    let mismatched = [];
    for (const route of [en.recommended, ...en.alternatives]) {
      const mate = koBySig.get(signature(route));
      if (!mate) continue;
      paired += 1;
      const a = JSON.stringify(route.legs.map((l) => [l.lineName, l.fromName, l.toName, (l.stops ?? []).map((s) => s.name)]));
      const b = JSON.stringify(mate.legs.map((l) => [l.lineName, l.fromName, l.toName, (l.stops ?? []).map((s) => s.name)]));
      if (a !== b || route.summary.departName !== mate.summary.departName || route.summary.arriveName !== mate.summary.arriveName) {
        mismatched.push(signature(route));
      }
    }
    const total = 1 + en.alternatives.length;
    check(`${r.name}: en·ko 한국어 필드 전수 일치(짝 ${paired}/${total})`, paired === total && mismatched.length === 0, paired < total ? `짝 못 맺음 ${total - paired}(호출 시점 차로 경로 집합이 달라짐)` : mismatched.join("; "));

    // 6. ko 응답에 *En 키 0
    check(`${r.name}: ko 응답에 *En 키 없음`, !/"(lineNameEn|fromNameEn|toNameEn|nameEn|departNameEn|arriveNameEn)"/.test(JSON.stringify(ko)));

    // 3. 급행 표본
    if (r.expressRequired) {
      // 선정 5개 밖이어도 정규화 전체 배열에서 본다(spec §3.8 3항) — raw lang=1 응답을 직접 받아 정규화.
      const raw = await fetchOdsayRaw(r.origin, r.dest);
      const all = normalizeOdsayRoutes(raw, { includeStops: true, lang: "en" }) ?? [];
      const expressLeg = all.flatMap((route) => route.legs).find((leg) => leg.lineName?.includes("(급행)"));
      check(`${r.name}: 급행 leg 존재(필수 표본, 전체 ${all.length}경로)`, Boolean(expressLeg), expressLeg ? expressLeg.lineName : "전체 후보에 급행 없음");
      if (expressLeg) {
        check(`${r.name}: 급행 lineName 보존 + lineNameEn "Line 9 Express"`, expressLeg.lineName === "수도권 9호선(급행)" && expressLeg.lineNameEn === "Line 9 Express", `${expressLeg.lineName} → ${expressLeg.lineNameEn}`);
      }
    }
    console.log(`  표본: ${boardLegs.slice(0, 3).map(({ leg }) => `${leg.lineNameEn} ${leg.fromNameEn}→${leg.toNameEn}`).join(" / ")}`);
  }

  // 7. 실시간 도착 en 관측
  for (const station of ["강남", "서울"]) {
    const raw = await fetchSubwayArrivals(station);
    if (!raw) {
      check(`도착 ${station}: 실시간 응답`, false, "null(INFO-200 — 운행 시간 밖이면 정상)");
      continue;
    }
    const en = withArrivalsEn(raw);
    const total = en.arrivals.length;
    const msg = en.arrivals.filter((a) => a.messageEn).length;
    const train = en.arrivals.filter((a) => a.trainLineNmEn).length;
    check(`도착 ${station}: messageEn 생성률 100% (${msg}/${total})`, total > 0 && msg === total, en.arrivals.filter((a) => !a.messageEn).map((a) => `${a.arrivalCode}:${a.message}`).join("; "));
    check(`도착 ${station}: trainLineNmEn 생성률 100% (${train}/${total})`, total > 0 && train === total, en.arrivals.filter((a) => !a.trainLineNmEn).map((a) => a.trainLineNm).join("; "));
    check(`도착 ${station}: 한국어 원문 불변`, en.arrivals.every((a, i) => a.message === raw.arrivals[i].message && a.trainLineNm === raw.arrivals[i].trainLineNm));
    console.log(`  표본: ${en.arrivals.slice(0, 3).map((a) => `${a.lineEn} ${a.directionEn}, ${a.trainLineNmEn}, ${a.messageEn}`).join(" / ")}`);
  }
} finally {
  rmSync(workDir, { recursive: true, force: true });
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} PASS`);
process.exit(failed.length === 0 ? 0 : 1);
