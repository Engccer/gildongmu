// 카카오 분류 영문화(A28) 실호출 커버리지 게이트
// (spec docs/superpowers/specs/2026-08-31-kakao-category-en-design.md §8·§11).
//
// fixture green ≠ 실계약 검증. 사전은 스냅샷이라 "지금 카카오가 주는 경로"가 얼마나 덮이는지는 우리 라우트를
// 실제로 불러야 안다. 4투영 경로(장소 검색·둘러보기·아이 놀 곳·부근 장면) 전부를 표본에 넣고, **카드 기준**과
// **고유 경로 기준** 두 비율을 엔드포인트·지역별로 낸다. 합격선은 카드 기준 전체 90%(미달 exit 1).
// 미등재 세그먼트는 빈도순으로 출력한다 — 사전 보강 루프의 입력.
//
// 사용법: node scripts/verify-kakao-category-en.mjs [--base http://localhost:3100] [--min 90]
//   기본 base는 프로덕션. 종료 코드: 합격 0, 미달·실패 1.
const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : fallback;
};
const BASE = arg("--base", "https://gildongmu.dodoplanet.space");
const MIN = Number(arg("--min", "90"));

const REGIONS = [
  ["서울 강동", 37.5301, 127.1238],
  ["서울 강남", 37.4979, 127.0276],
  ["부산 서면", 35.1578, 129.0593],
  ["대구 동성로", 35.8694, 128.5949],
  ["광주 상무", 35.1531, 126.8514],
  ["전주", 35.8242, 127.148],
  ["제주", 33.4996, 126.5312],
];
const QUERIES = ["학교", "병원", "카페", "맛집", "공원", "마트", "호텔", "주유소"];

const perEndpoint = new Map(); // endpoint -> { cards, covered, paths:Map(path->covered) }
const perRegion = new Map();
const missing = new Map(); // segment -> count
let failures = 0;

function tally(endpoint, region, place) {
  const raw = (place.category ?? "").trim();
  if (!raw) return; // 원문 없는 카드는 분모 밖(리뷰 #11)
  const ok = typeof place.categoryEn === "string" && place.categoryEn.length > 0 && !/[가-힣]/.test(place.categoryEn);
  for (const [map, key] of [[perEndpoint, endpoint], [perRegion, region]]) {
    const e = map.get(key) ?? { cards: 0, covered: 0, paths: new Map() };
    e.cards++;
    if (ok) e.covered++;
    e.paths.set(raw, ok);
    map.set(key, e);
  }
  if (!ok) {
    for (const seg of raw.split(">").map((s) => s.trim()).filter(Boolean)) {
      // 세그먼트 단위 미등재는 사전으로 판정할 수 없으니(서버 사전) 경로 전체 세그먼트를 후보로 센다.
      missing.set(seg, (missing.get(seg) ?? 0) + 1);
    }
  }
}

async function getJson(path, params) {
  const u = new URL(path, BASE);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, String(v));
  const res = await fetch(u);
  if (!res.ok) throw new Error(`HTTP ${res.status} ${u.pathname}`);
  return res.json();
}

for (const [region, lat, lng] of REGIONS) {
  for (const q of QUERIES) {
    try {
      const body = await getJson("/api/places", { query: q, lat, lng, lang: "en", limit: 15 });
      for (const p of body.places ?? []) if (String(p.id).startsWith("kakao-")) tally("places", region, p);
    } catch (e) {
      failures++;
      console.log(`FAIL places ${region} ${q}: ${e}`);
    }
  }
  try {
    const body = await getJson("/api/places/around", { lat, lng, limit: 50 });
    for (const p of body.places ?? []) tally("around", region, { category: p.categoryRaw, categoryEn: p.categoryEn });
  } catch (e) {
    failures++;
    console.log(`FAIL around ${region}: ${e}`);
  }
  try {
    const body = await getJson("/api/places/kids", { lat, lng, limit: 50 });
    for (const p of body.kids ?? []) tally("kids", region, p);
  } catch (e) {
    failures++;
    console.log(`FAIL kids ${region}: ${e}`);
  }
  try {
    const body = await getJson("/api/surroundings/scene", { lat, lng });
    for (const g of body.data?.groups ?? []) for (const it of g.items ?? []) tally("scene", region, { category: it.categoryRaw, categoryEn: it.categoryEn });
  } catch (e) {
    failures++;
    console.log(`FAIL scene ${region}: ${e}`);
  }
}

function report(label, map) {
  console.log(`\n${label}`);
  for (const [key, e] of map) {
    const pathsCovered = [...e.paths.values()].filter(Boolean).length;
    console.log(
      `  ${key}: 카드 ${e.covered}/${e.cards} (${((e.covered / Math.max(e.cards, 1)) * 100).toFixed(1)}%) · 고유 경로 ${pathsCovered}/${e.paths.size}`,
    );
  }
}
report("엔드포인트별", perEndpoint);
report("지역별", perRegion);

let cards = 0, covered = 0;
const allPaths = new Map();
for (const e of perEndpoint.values()) {
  cards += e.cards;
  covered += e.covered;
  for (const [p, ok] of e.paths) allPaths.set(p, ok);
}
const pct = (covered / Math.max(cards, 1)) * 100;
const pathPct = ([...allPaths.values()].filter(Boolean).length / Math.max(allPaths.size, 1)) * 100;
console.log(`\n전체: 카드 ${covered}/${cards} (${pct.toFixed(1)}%) · 고유 경로 ${[...allPaths.values()].filter(Boolean).length}/${allPaths.size} (${pathPct.toFixed(1)}%) · 요청 실패 ${failures}`);
if (missing.size) {
  console.log(`\n미번역 경로의 세그먼트(빈도순, 상위 40):`);
  for (const [seg, n] of [...missing].sort((a, b) => b[1] - a[1]).slice(0, 40)) console.log(`  ${n}\t${seg}`);
}
const pass = failures === 0 && pct >= MIN;
console.log(pass ? `\nPASS (합격선 ${MIN}%)` : `\nFAIL (합격선 ${MIN}%)`);
process.exit(pass ? 0 : 1);
