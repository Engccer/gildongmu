// 자동차 안내 "현재 도로" 줄(E56) 실호출 게이트 — spec docs/superpowers/specs/2026-09-30-car-current-road-line-design.md §5.
//
// 두 모드:
//   수집(Tmap 호출 = 구간 수): node scripts/verify-car-road-names.mjs --collect <raw.json>   (실패 구간이 있으면 종료 코드 1)
//     공공 장소 6구간을 Tmap 자동차 경로(POST /tmap/routes)로 직접 불러 원응답을 저장한다.
//     Tmap 일 1,000건 무료를 도보 폴백과 나누므로 표본은 작게 두고, 판정은 저장본 재생으로 한다.
//   재생(호출 0): node scripts/verify-car-road-names.mjs --from-corpus <raw.json>
//     원응답을 프로덕션 정규화(`normalizeTmapCarRoute`, 기하 옵트인)와 기하 조립(`buildCarGuide`)에
//     그대로 흘려 "현재 도로" 줄의 원천(`roadSpans` + `roadNameAt`)이 실제로 얼마나 채워지는지 잰다.
//
// 단언은 **표본 전체 위에서** 한다(구간을 고르지 않는다): 모든 구간이 상세 적격(기하 조립 성공)이고
// 도로명 스팬이 강등되지 않았으며(링크 합 ≈ 경로 총거리), 거리 기준 채움률이 하한 이상이다.
// 원응답은 저장소 밖(~/gildongmu-private/field-logs/car-road-names-2026-09-30/)에 둔다(약관 — 응답 보관 최소화).
// 종료 코드: 전부 PASS면 0, 하나라도 FAIL이면 1.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
/** ⚠ jiti는 package.json에 직접 선언돼 있지 않다(tailwind의 전이 의존성으로 설치된다). 재생 모드만 필요하다.
 *  없으면 조용히 넘어가지 않고 멈춘다. */
async function loadJiti() {
  const mod = await import("jiti").catch(() => {
    console.error("jiti를 찾지 못했다 — TS 모듈을 불러올 수 없어 재생 게이트를 돌릴 수 없다(npm ls jiti).");
    process.exit(2);
  });
  return mod.createJiti;
}

/** 스텝 경계에서 링크 누적 길이와 경로 진행거리의 어긋남 상한(m) — 줄이 이만큼 이르거나 늦게 바뀐다. */
const MAX_BOUNDARY_DRIFT_M = 100;
/** 거리 기준 채움률 하한 — 2026-09-30 실측 표본의 값보다 낮게 잡아 그날 길이 바뀌어도 흔들리지 않게 한다.
 *  풀링만 보면 긴 구간(수원→인천 67km가 표본의 절반)이 한 구간의 붕괴를 가리므로 구간별 하한을 함께 둔다. */
const MIN_NAMED_RATIO = 0.8;
const MIN_ROUTE_NAMED_RATIO = 0.9;
/** 도로 이름이 아닌 자리표시자·일반명사 — 이런 값이 "현재 도로, …"에 실리면 가짜 정밀이다.
 *  서버는 "일반도로"만 null로 낮춘다(tmap-car.ts). 여기 걸리면 그 목록을 넓혀야 한다. */
const PLACEHOLDER_NAMES = new Set(["일반도로", "고속도로", "도로", "램프", "연결로", "-", ""]);

const PLACES = {
  서울역: [37.5547, 126.9707],
  강남역: [37.4979, 127.0276],
  잠실역: [37.5133, 127.1001],
  여의도역: [37.5216, 126.9243],
  광화문: [37.5759, 126.9768],
  김포공항: [37.5586, 126.7944],
  강동구청: [37.5301, 127.1238],
  천호역: [37.5386, 127.1236],
  수원역: [37.2657, 127.0],
  인천공항: [37.4491, 126.4506],
  부산역: [35.1151, 129.0422],
  해운대해수욕장: [35.1587, 129.1604],
};
const PAIRS = [
  ["서울역", "강남역"],
  ["잠실역", "여의도역"],
  ["광화문", "김포공항"],
  ["강동구청", "천호역"],
  ["수원역", "인천공항"],
  ["부산역", "해운대해수욕장"],
];

const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

const results = [];
function check(name, ok, detail = "") {
  results.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
}

function tmapKey() {
  if (process.env.TMAP_APP_KEY) return process.env.TMAP_APP_KEY;
  const envPath = new URL("../.env.local", import.meta.url);
  if (!existsSync(envPath)) return "";
  const line = readFileSync(envPath, "utf8")
    .split("\n")
    .find((l) => l.startsWith("TMAP_APP_KEY="));
  return line ? line.slice("TMAP_APP_KEY=".length).trim().replace(/^"|"$/g, "") : "";
}

async function collect(outPath) {
  const key = tmapKey();
  if (!key) {
    console.error("TMAP_APP_KEY가 없다(.env.local 또는 환경변수).");
    process.exit(2);
  }
  const out = {};
  for (const [a, b] of PAIRS) {
    const [olat, olng] = PLACES[a];
    const [dlat, dlng] = PLACES[b];
    const label = `${a}→${b}`;
    // 구간 단위 실패 격리 — 한 구간의 오류가 나머지 수집을 날리지 않는다.
    try {
      const res = await fetch("https://apis.openapi.sk.com/tmap/routes?version=1", {
        method: "POST",
        headers: { appKey: key, "Content-Type": "application/json" },
        body: JSON.stringify({
          startX: String(olng),
          startY: String(olat),
          endX: String(dlng),
          endY: String(dlat),
          reqCoordType: "WGS84GEO",
          resCoordType: "WGS84GEO",
        }),
      });
      out[label] = res.ok ? await res.json() : { httpError: res.status, body: await res.text() };
    } catch (e) {
      out[label] = { netError: String(e) };
    }
    console.log(label, out[label].features ? `features ${out[label].features.length}` : "실패");
    writeFileSync(outPath, JSON.stringify(out)); // 부분 저장
  }
  // 수집도 종료 코드로 판정한다 — 실패 구간이 있으면 재생 표본이 비어 게이트가 헛돈다.
  return Object.values(out).filter((v) => !v.features).length;
}

async function replay(corpusPath) {
  const createJiti = await loadJiti();
  const jiti = createJiti(import.meta.url, { alias: { "@": new URL("../src", import.meta.url).pathname } });
  const tc = await jiti.import(new URL("../src/lib/providers/tmap-car.ts", import.meta.url).pathname);
  const crg = await jiti.import(new URL("../src/lib/car-route-guide.ts", import.meta.url).pathname);
  const corpus = JSON.parse(readFileSync(corpusPath, "utf8"));
  let total = 0;
  let named = 0;
  const broken = [];
  const degraded = [];
  let maxDrift = 0;
  const lowRoutes = [];
  const names = new Set();
  let shortSpans = 0;
  for (const [label, raw] of Object.entries(corpus)) {
    if (!raw.features) {
      broken.push(`${label}(응답 실패)`);
      continue;
    }
    let guide;
    let briefing;
    try {
      briefing = tc.normalizeTmapCarRoute(raw, { includeGeometry: true });
      guide = crg.buildCarGuide({ ...briefing, provider: "tmap" });
    } catch (e) {
      broken.push(`${label}(정규화 throw: ${e.message})`);
      continue;
    }
    if (!guide) {
      broken.push(`${label}(기하 조립 null)`);
      continue;
    }
    if (guide.roadSpans.length === 0) degraded.push(label);
    // 스팬은 Tmap 링크 길이의 누적이고 현재 위치(state.d)는 폴리라인 위 거리라 두 축이 따로 쌓인다.
    let acc = 0;
    let drift = 0;
    briefing.guides.forEach((g, i) => {
      for (const link of g.roadLinks ?? []) acc += link.distanceMeters;
      drift = Math.max(drift, Math.abs(acc - guide.route.steps[i].endD));
    });
    maxDrift = Math.max(maxDrift, drift);
    for (const span of guide.roadSpans) {
      if (span.name === null) continue;
      names.add(span.name);
      // 스팬이 이 구간의 어긋남보다 짧으면 실제로 그 도로 위가 아닐 때 잠깐 표시될 수 있다(관측만 — 단언 보류).
      if (span.endD - span.startD < drift) shortSpans++;
    }
    // 줄 원천 그대로 5m 간격으로 표본을 뜬다 — 소비자가 부르는 함수(roadNameAt)가 판정 술어다.
    let routeNamed = 0;
    let samples = 0;
    let changes = 0;
    let prev;
    for (let d = 0; d < guide.route.totalMeters; d += 5) {
      const name = crg.roadNameAt(guide.roadSpans, d);
      samples++;
      if (name) routeNamed++;
      if (samples > 1 && name !== prev) changes++;
      prev = name;
    }
    const km = guide.route.totalMeters / 1000;
    total += samples;
    named += routeNamed;
    if (routeNamed / samples < MIN_ROUTE_NAMED_RATIO) lowRoutes.push(`${label} ${(routeNamed / samples).toFixed(3)}`);
    console.log(
      `  ${label}: ${km.toFixed(1)}km, 스팬 ${guide.roadSpans.length}, 채움률 ${(routeNamed / samples).toFixed(3)}, 줄 바뀜 ${changes}회(${(changes / km).toFixed(2)}/km), 경계 어긋남 최대 ${Math.round(drift)}m`,
    );
  }
  check("표본 전체 상세 적격(정규화·기하 조립 성공)", broken.length === 0, broken.join(", "));
  check("도로명 스팬 강등 0(링크 합 ≈ 경로 총거리)", degraded.length === 0, degraded.join(", "));
  check(`구간별 채움률 ≥ ${MIN_ROUTE_NAMED_RATIO}`, lowRoutes.length === 0, lowRoutes.join(", "));
  const placeholders = [...names].filter((n) => PLACEHOLDER_NAMES.has(n.trim()));
  check("도로 이름에 자리표시자·일반명사 없음", placeholders.length === 0, placeholders.join(", "));
  console.log(`  (관측) 이름 ${names.size}종: ${[...names].join(", ")}`);
  console.log(`  (관측) 구간 어긋남보다 짧은 이름 스팬: ${shortSpans}개`);
  check(`스텝 경계 어긋남 ≤ ${MAX_BOUNDARY_DRIFT_M}m`, maxDrift <= MAX_BOUNDARY_DRIFT_M, `실측 최대 ${Math.round(maxDrift)}m`);
  const ratio = total > 0 ? named / total : 0;
  check(`거리 기준 채움률 ≥ ${MIN_NAMED_RATIO}`, ratio >= MIN_NAMED_RATIO, `실측 ${ratio.toFixed(3)}`);
}

const collectOut = opt("--collect");
const corpus = opt("--from-corpus");
if (collectOut) {
  const failed = await collect(collectOut);
  process.exit(failed === 0 ? 0 : 1);
}
if (!corpus) {
  console.error("사용: --collect <raw.json> | --from-corpus <raw.json>");
  process.exit(2);
}
await replay(corpus);
process.exit(results.every(Boolean) ? 0 : 1);
