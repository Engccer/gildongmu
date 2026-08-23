/**
 * OSM 보행 노드(횡단보도·점자블록) 정적 seed 빌드.
 *
 * 종전에는 이 데이터를 사용자 조회마다 Overpass에서 실시간으로 받았고, 그 호출이
 * 429·504로 실패하는 것이 프로덕션 로그로 확정됐다. 110m 격자 타일이라 **걸어가면
 * 정의상 신규 타일이 연속**되므로 캐시가 가장 안 듣는 사용자가 보행자였다(spec §1).
 *
 * ⚠ **국경 판정의 정본은 `area["ISO3166-1"="KR"]`다.** 한국을 감싸는 bbox만으로 받으면
 * 일본 노드가 17,806개 섞인다(대마도·규슈 북부, 2026-08-16 실측). 상류 부하 때문에
 * 질의를 둘로 나누지만(§KR_IDS_QUERY 주석) 국경을 자르는 것은 언제나 area 쪽이고,
 * 가드 G5가 그 사실을 매 빌드 검증한다.
 *
 * ⚠ **이 seed를 국내 공공데이터 seed(audio-signals.json 등)와 한 파일로 합치지 말 것.**
 * 병합본은 ODbL상 Derivative Database가 되어 "OSM 원본 가리키기"로 §4.6을 채울 수
 * 없게 되고, 그 순간 공공데이터 국외 반출 제한과 정면 충돌한다. 병합은 런타임에서만
 * 한다(docs/research/RESEARCH-2026-08-16-odbl-compliance.md).
 *
 * 실행: node scripts/build-osm-walk-nodes.mjs
 * 산출: src/lib/data/osm-walk-nodes.json (약 2.7MB) + 국경 폴리곤 사본 2벌(아래 BOUNDARY_OUTS).
 *       **두 산출물은 한 실행이 함께 쓴다** — 링과 노드가 같은 시점의 같은 국경 정의여야
 *       G11(노드 전수가 링 안)이 뜻을 갖는다. 국경만 따로 갱신하지 말 것.
 * 갱신: 연 1회(횡단보도·점자블록은 신설이 드물다). 실보행에서 "새로 생긴 횡단보도가
 *       안 나온다"가 실제로 나오면 그때 주기를 당긴다.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { basename, dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const OUT = join(ROOT, "src/lib/data/osm-walk-nodes.json");

/**
 * 국경 폴리곤 산출 경로. 웹 정본과 Kit 리소스는 **바이트 동일 사본**이고
 * src/lib/__tests__/korea-boundary-drift.test.ts가 그것을 강제한다(E19).
 * seed(2.7MB) 안에 두면 클라이언트 번들이 통째로 무너지므로 파일이 갈렸다.
 */
const BOUNDARY_OUTS = [
  join(ROOT, "src/lib/data/korea-boundary.json"),
  join(ROOT, "ios/GildongmuKit/Sources/GildongmuKit/Resources/korea-boundary.json"),
];

const OVERPASS_URL = "https://overpass-api.de/api/interpreter";
const USER_AGENT = "gildongmu-seed-build/1.0 (+https://gildongmu.dodoplanet.space)";

/** 서버 실행 예산. 빌드는 사람이 기다리는 1회 작업이라 조회 경로(6초)와 무관하게 넉넉히 준다. */
const SERVER_TIMEOUT_S = 900;

const SEED_BBOX_VALUES = { latMin: 33.0, latMax: 38.7, lngMin: 124.5, lngMax: 131.9 };

/**
 * 질의를 둘로 나눈다. **국경 판정은 area가 정본이고 태그는 bbox 질의가 나른다.**
 *
 * ⚠ 하나로 합칠 수 없다(2026-08-16 실측): `area` + `out skel`(좌표만)도, `bbox` +
 * `out body`(태그 포함)도 각각 성공하는데 **`area` + `out body`는 상류가 504**를 낸다 —
 * area 필터와 태그 출력을 동시에 요구하는 것이 가장 비싸다. 그래서 KR 노드 id 집합을
 * skel로 받고, 태그·좌표는 bbox로 받아 **교집합**을 낸다.
 *
 * ⚠ `out body`여야 한다. `out tags`는 태그만 주고 **좌표를 생략**해 파싱은 성공하는데
 * 결과가 통째로 0건이 된다(같은 날 실측, G1 가드가 잡았다).
 */
export const KR_IDS_QUERY =
  `[out:json][timeout:${SERVER_TIMEOUT_S}];` +
  `area["ISO3166-1"="KR"][admin_level=2]->.kr;` +
  `(node(area.kr)[highway=crossing];node(area.kr)[tactile_paving=yes];);` +
  `out skel qt;`;

/**
 * 국경 폴리곤 질의.
 *
 * ⚠ **이것이 "제공 지역인가" 판정의 정본이다.** 사각형 bbox로는 판정할 수 없다 —
 * 후쿠오카·기타큐슈·대마도·시모노세키가 한국 bbox 안에 있고(그 좌표에서 0건을 내면
 * "이 근처에 횡단보도가 없다"는 거짓말이 된다), 반대로 개성·해주는 파주와 위경도가
 * 겹쳐 사각형 뺄셈으로 갈리지 않는다. 두 문제를 동시에 푸는 것은 폴리곤뿐이다.
 *
 * `admin_level=2` 경계는 **해안선이 아니라 영해 경계선**이라 좌표점이 2,686개뿐이다
 * (해안선을 따라갔다면 수십만 점이었다). 링 4개 = 본토+제주 · 서해5도 · 울릉도 · 독도.
 */
export const BOUNDARY_QUERY =
  `[out:json][timeout:${SERVER_TIMEOUT_S}];rel["ISO3166-1"="KR"][admin_level=2];out geom;`;

/**
 * 태그 질의는 **위도 1도 밴드로 쪼개서** 받는다.
 *
 * ⚠ 전국을 한 번에 요구하면 504가 난다(2026-08-16 실측). Overpass의 `[timeout:N]`은
 * *실행* 시간에만 걸리고 슬롯 대기는 포함하지 않으므로, 504는 질의가 무겁다는 뜻보다
 * **대기 큐가 포화됐다**는 뜻이다. 밴드로 나누면 각 질의가 가볍고, 실패해도 그 밴드만
 * 다시 받으면 된다. 밴드 경계의 중복 노드는 id 기준 Map이 흡수한다.
 */
export function taggedQueries() {
  const queries = [];
  for (let lat = SEED_BBOX_VALUES.latMin; lat < SEED_BBOX_VALUES.latMax; lat += 1) {
    const top = Math.min(lat + 1, SEED_BBOX_VALUES.latMax);
    const box = `${lat},${SEED_BBOX_VALUES.lngMin},${top},${SEED_BBOX_VALUES.lngMax}`;
    queries.push({
      label: `위도 ${lat}~${top}`,
      query:
        `[out:json][timeout:${SERVER_TIMEOUT_S}];` +
        `(node(${box})[highway=crossing];node(${box})[tactile_paving=yes];);` +
        `out body;`,
    });
  }
  return queries;
}

/**
 * seed가 실제로 담은 범위. 판정 정본은 `src/lib/providers/osm-walk-nodes.ts`의
 * `KOREA_WALK_SEED_BBOX`이며 값이 같아야 한다(§5.1).
 *
 * ⚠ `KOREA_COVERAGE_BBOX`(31.43~44.35 / 122.37~132.0)와 **다른 것이 정상**이다 —
 * 그쪽은 "서비스한다고 선언한 범위"이고 이것은 "이 파일이 담은 범위"다.
 */
export const SEED_BBOX = SEED_BBOX_VALUES;

// 실측 79,574 / 76,185 / 6,002의 75% 선. 부분 응답·질의 오타를 잡는다.
const MIN_TOTAL = 60_000;
const MIN_CROSSING = 55_000;
const MIN_TACTILE = 4_000;

/**
 * G5 국외 부재 golden. 대마도는 한국 bbox 안이지만 일본이다 — bbox 질의로 되돌아가면
 * 여기가 0이 아니게 된다. **존재만 검사하면 "전부 담겼다"와 "남의 것도 담겼다"를
 * 구분하지 못한다.**
 */
export const GOLDEN_ABSENT = { name: "대마도", lat: 34.4, lng: 129.35, radiusMeters: 20_000 };

/** G6 전국 존재 golden. 17개 시도 대표 좌표(도청 소재지 기준). 최소 실측은 안동 13건. */
export const GOLDEN_PRESENT = [
  { name: "서울", lat: 37.5665, lng: 126.978 },
  { name: "부산", lat: 35.1796, lng: 129.0756 },
  { name: "대구", lat: 35.8714, lng: 128.6014 },
  { name: "인천", lat: 37.4563, lng: 126.7052 },
  { name: "광주", lat: 35.1595, lng: 126.8526 },
  { name: "대전", lat: 36.3504, lng: 127.3845 },
  { name: "울산", lat: 35.5384, lng: 129.3114 },
  { name: "세종", lat: 36.48, lng: 127.289 },
  { name: "경기(수원)", lat: 37.2636, lng: 127.0286 },
  { name: "강원(춘천)", lat: 37.8813, lng: 127.73 },
  { name: "충북(청주)", lat: 36.6424, lng: 127.489 },
  { name: "충남(홍성)", lat: 36.6009, lng: 126.665 },
  { name: "전북(전주)", lat: 35.8242, lng: 127.148 },
  { name: "전남(무안)", lat: 34.8118, lng: 126.4629 },
  { name: "경북(안동)", lat: 36.5684, lng: 128.7294 },
  { name: "경남(창원)", lat: 35.2278, lng: 128.6817 },
  { name: "제주", lat: 33.4996, lng: 126.5312 },
];

/**
 * G9~G11 국경 판정 golden. 사각형 bbox로는 이 표를 통과할 수 없다는 것이 폴리곤을
 * 쓰는 이유다 — 앞의 넷은 한국 bbox **안**이고, 뒤의 넷 중 셋은 별개 링에 있다.
 */
/**
 * 국경 판정 golden. **표의 정본은 공유 fixture 한 벌**이고 웹 vitest(coverage.test.ts)·
 * Kit CoverageTests.swift·이 스크립트 G10이 같은 파일을 읽는다(E19).
 */
export const BOUNDARY_GOLDEN = JSON.parse(
  readFileSync(join(ROOT, "src/lib/__tests__/fixtures/korea-boundary-cases.json"), "utf8"),
).cases;

/** G7 도심 밀도 golden. 태그 매핑이 무너지면 crossing 플래그가 통째로 꺼진다. */
export const GOLDEN_DENSE = { name: "강남역", lat: 37.4979, lng: 127.0276, radiusMeters: 300, minCrossing: 5 };

export function haversineMeters(aLat, aLng, bLat, bLng) {
  const R = 6371000;
  const p1 = (aLat * Math.PI) / 180;
  const p2 = (bLat * Math.PI) / 180;
  const dp = ((bLat - aLat) * Math.PI) / 180;
  const dl = ((bLng - aLng) * Math.PI) / 180;
  const h = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

const CROSSING_SIGNAL_BITS = { traffic_signals: 1, uncontrolled: 0, unmarked: 0 };
const SIGNAL_UNKNOWN = 2;

/**
 * Overpass elements → seed 노드 `[id, lat, lng, flags]`.
 *
 * flags 비트: bit0 crossing · bit1~2 crossingSignal(0=no·1=yes·2=unknown) ·
 * bit3 tactilePaving · bit4~5 hostFeature(0=없음·1=busStop·2=subwayEntrance).
 *
 * 같은 id가 두 번 나오면(union 질의가 같은 물리 노드를 두 갈래에서 각각 매치) 병합한다.
 * 플래그는 OR, crossingSignal은 unknown이 아닌 값을 우선.
 */
export function normalizeElements(elements, /** @type {Set<number>|null} */ krIds = null) {
  const byId = new Map();
  for (const el of elements) {
    if (typeof el?.lat !== "number" || typeof el?.lon !== "number") continue;
    const id = Number(el.id);
    if (!Number.isFinite(id)) continue;
    // 국경 밖(일본 서부·대마도) 배제. 이 한 줄이 없으면 17,806건이 섞인다.
    if (krIds && !krIds.has(id)) continue;

    const tags = el.tags ?? {};
    const crossing = tags.highway === "crossing";
    const signal = tags.crossing ? (CROSSING_SIGNAL_BITS[tags.crossing] ?? SIGNAL_UNKNOWN) : SIGNAL_UNKNOWN;
    const tactile = tags.tactile_paving === "yes";
    let host = 0;
    if (!crossing && tactile) {
      if (tags.highway === "bus_stop") host = 1;
      else if (tags.railway === "subway_entrance") host = 2;
    }

    const existing = byId.get(id);
    if (existing) {
      existing.crossing ||= crossing;
      if (signal !== SIGNAL_UNKNOWN) existing.signal = signal;
      existing.tactile ||= tactile;
      if (existing.host === 0) existing.host = host;
      continue;
    }
    byId.set(id, {
      id,
      lat: Number(el.lat.toFixed(5)),
      lng: Number(el.lon.toFixed(5)),
      crossing,
      signal,
      tactile,
      host,
    });
  }

  return Array.from(byId.values())
    .map((f) => [
      f.id,
      f.lat,
      f.lng,
      (f.crossing ? 1 : 0) | (f.signal << 1) | ((f.tactile ? 1 : 0) << 3) | (f.host << 4),
    ])
    .sort((a, b) => a[1] - b[1] || a[2] - b[2]);
}

/**
 * 경계 relation의 outer way들을 닫힌 링으로 잇는다. way는 방향·순서가 제각각이라
 * 끝점을 맞춰 가며 붙이고, 닫히지 않는 링이 남으면 가드가 잡는다.
 */
export function buildRings(relation) {
  const segments = (relation.members ?? [])
    .filter((m) => m.role === "outer" && Array.isArray(m.geometry))
    .map((m) => m.geometry.map((p) => [p.lat, p.lon]));

  const same = (a, b) => a[0] === b[0] && a[1] === b[1];
  const rings = [];
  while (segments.length > 0) {
    let ring = segments.shift();
    let joined = true;
    while (joined && !same(ring[0], ring[ring.length - 1])) {
      joined = false;
      for (let i = 0; i < segments.length; i += 1) {
        const seg = segments[i];
        if (same(seg[0], ring[ring.length - 1])) ring = ring.concat(seg.slice(1));
        else if (same(seg[seg.length - 1], ring[ring.length - 1])) ring = ring.concat(seg.slice().reverse().slice(1));
        else if (same(seg[seg.length - 1], ring[0])) ring = seg.slice(0, -1).concat(ring);
        else if (same(seg[0], ring[0])) ring = seg.slice().reverse().slice(0, -1).concat(ring);
        else continue;
        segments.splice(i, 1);
        joined = true;
        break;
      }
    }
    rings.push(ring.map(([lat, lng]) => [Number(lat.toFixed(5)), Number(lng.toFixed(5))]));
  }
  return rings;
}

/** ray casting. 링은 닫혀 있다고 가정한다(가드가 보장). */
export function insideRings(lat, lng, rings) {
  for (const ring of rings) {
    let inside = false;
    for (let i = 0; i < ring.length - 1; i += 1) {
      const [y1, x1] = ring[i];
      const [y2, x2] = ring[i + 1];
      if (y1 > lat !== y2 > lat) {
        const xAt = x1 + ((lat - y1) * (x2 - x1)) / (y2 - y1);
        if (lng < xAt) inside = !inside;
      }
    }
    if (inside) return true;
  }
  return false;
}

function countNear(nodes, lat, lng, radiusMeters, pred) {
  const degLat = radiusMeters / 111_000;
  const degLng = degLat / Math.max(0.2, Math.cos((lat * Math.PI) / 180));
  let count = 0;
  for (const n of nodes) {
    if (Math.abs(n[1] - lat) > degLat) continue;
    if (Math.abs(n[2] - lng) > degLng) continue;
    if (haversineMeters(lat, lng, n[1], n[2]) > radiusMeters) continue;
    if (pred && !pred(n)) continue;
    count += 1;
  }
  return count;
}

/** 가드 전부. 조용한 축소가 아니라 빌드 실패가 되게 한다. */
export function validateNodes(nodes, /** @type {Array<Array<[number, number]>>|null} */ rings = null) {
  const crossing = nodes.filter((n) => (n[3] & 1) === 1).length;
  const tactile = nodes.filter((n) => ((n[3] >> 3) & 1) === 1).length;

  if (nodes.length < MIN_TOTAL) throw new Error(`G1 총 노드 ${nodes.length} < ${MIN_TOTAL}`);
  if (crossing < MIN_CROSSING) throw new Error(`G2 횡단보도 ${crossing} < ${MIN_CROSSING}`);
  if (tactile < MIN_TACTILE) throw new Error(`G3 점자블록 ${tactile} < ${MIN_TACTILE}`);

  for (const n of nodes) {
    if (
      n[1] < SEED_BBOX.latMin ||
      n[1] > SEED_BBOX.latMax ||
      n[2] < SEED_BBOX.lngMin ||
      n[2] > SEED_BBOX.lngMax
    ) {
      throw new Error(`G4 seed bbox 이탈 노드 ${n[0]} (${n[1]}, ${n[2]})`);
    }
  }

  const strays = countNear(nodes, GOLDEN_ABSENT.lat, GOLDEN_ABSENT.lng, GOLDEN_ABSENT.radiusMeters);
  if (strays > 0) {
    throw new Error(`G5 ${GOLDEN_ABSENT.name} 반경 ${GOLDEN_ABSENT.radiusMeters / 1000}km에 ${strays}건 — 국외 유입(bbox 질의 회귀 의심)`);
  }

  for (const p of GOLDEN_PRESENT) {
    if (countNear(nodes, p.lat, p.lng, 20_000) < 1) {
      throw new Error(`G6 ${p.name} 반경 20km 0건 — 지역 결손(area 질의 부분 응답 의심)`);
    }
  }

  const dense = countNear(nodes, GOLDEN_DENSE.lat, GOLDEN_DENSE.lng, GOLDEN_DENSE.radiusMeters, (n) => (n[3] & 1) === 1);
  if (dense < GOLDEN_DENSE.minCrossing) {
    throw new Error(`G7 ${GOLDEN_DENSE.name} ${GOLDEN_DENSE.radiusMeters}m 내 횡단보도 ${dense} < ${GOLDEN_DENSE.minCrossing} — 태그 매핑 회귀 의심`);
  }

  if (rings) {
    if (rings.length < 4) throw new Error(`G9 국경 링 ${rings.length}개 < 4(본토·서해5도·울릉·독도)`);
    const points = rings.reduce((sum, r) => sum + r.length, 0);
    if (points < 2_000) throw new Error(`G9 국경 좌표점 ${points} < 2000`);
    for (const [i, ring] of rings.entries()) {
      const first = ring[0];
      const last = ring[ring.length - 1];
      if (first[0] !== last[0] || first[1] !== last[1]) {
        throw new Error(`G9 링 ${i}이 닫히지 않았다 — outer way 연결 실패(PIP가 무의미해진다)`);
      }
    }

    for (const g of BOUNDARY_GOLDEN) {
      if (insideRings(g.lat, g.lng, rings) !== g.inside) {
        throw new Error(`G10 ${g.name} 국경 판정이 ${g.inside ? "밖" : "안"}으로 뒤집혔다`);
      }
    }

    // ⚠ seed 노드는 area(KR) 질의 산물이므로 정의상 전부 폴리곤 안이어야 한다.
    // 하나라도 밖이면 두 데이터가 서로 다른 시점·정의의 국경을 보고 있다는 뜻이고,
    // 그 어긋남은 "국내인데 미제공"이라는 조용한 결함이 된다.
    const stray = nodes.find((n) => !insideRings(n[1], n[2], rings));
    if (stray) {
      throw new Error(`G11 seed 노드 ${stray[0]}(${stray[1]}, ${stray[2]})가 국경 폴리곤 밖 — 경계와 노드의 정의가 어긋났다`);
    }
  }

  return { total: nodes.length, crossing, tactile, dense, boundaryPoints: rings ? rings.reduce((s, r) => s + r.length, 0) : 0 };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 질의 1회. 504·429는 대기 큐 포화라 **기다렸다 다시 물으면 대개 성공한다**(실행 시간
 * 문제가 아니다). 부분 응답(remark)은 재시도해도 같으므로 즉시 실패시킨다 — 조용히
 * 줄어든 seed가 가장 나쁜 결과다.
 */
export async function fetchOverpass(query, attempts = 4) {
  let lastError;
  for (let i = 0; i < attempts; i += 1) {
    if (i > 0) {
      const waitMs = 20_000 * i;
      console.log(`   재시도 ${i}/${attempts - 1} (${waitMs / 1000}초 대기): ${lastError.message}`);
      await sleep(waitMs);
    }
    const res = await fetch(OVERPASS_URL, {
      method: "POST",
      headers: { "User-Agent": USER_AGENT, "Content-Type": "application/x-www-form-urlencoded" },
      body: `data=${encodeURIComponent(query)}`,
    });
    if (!res.ok) {
      lastError = new Error(`Overpass HTTP ${res.status}`);
      continue;
    }
    const raw = await res.json();
    if (raw.remark) throw new Error(`G8 Overpass 부분 응답: ${raw.remark}`);
    if (!Array.isArray(raw.elements)) throw new Error("Overpass elements 비정상 응답");
    return raw;
  }
  throw lastError;
}

async function main() {
  console.log("① KR 노드 id 집합 질의 중(수십 초)...");
  const idsRaw = await fetchOverpass(KR_IDS_QUERY);
  const krIds = new Set(idsRaw.elements.map((el) => Number(el.id)).filter(Number.isFinite));
  console.log(`   KR 노드 ${krIds.size}건`);

  const bands = taggedQueries();
  console.log(`② 태그·좌표 질의 ${bands.length}밴드...`);
  const elements = [];
  let osmTimestamp = null;
  for (const [i, band] of bands.entries()) {
    if (i > 0) await sleep(3_000);
    const raw = await fetchOverpass(band.query);
    osmTimestamp ??= raw.osm3s?.timestamp_osm_base ?? null;
    elements.push(...raw.elements);
    console.log(`   ${band.label}: ${raw.elements.length}건 (누적 ${elements.length})`);
  }
  const nodes = normalizeElements(elements, krIds);
  console.log(`   bbox ${elements.length}건 → KR 교집합 ${nodes.length}건`);

  console.log("③ 국경 폴리곤 질의...");
  const boundaryRaw = await fetchOverpass(BOUNDARY_QUERY);
  const relation = boundaryRaw.elements.find((el) => el.type === "relation");
  if (!relation) throw new Error("국경 relation을 찾지 못했다");
  const rings = buildRings(relation);
  console.log(`   링 ${rings.length}개 · 좌표점 ${rings.reduce((s, r) => s + r.length, 0)}`);

  const stats = validateNodes(nodes, rings);

  const seed = {
    meta: {
      source: "OpenStreetMap contributors",
      license: "ODbL 1.0",
      licenseUrl: "https://opendatacommons.org/licenses/odbl/1-0/",
      attribution: "https://www.openstreetmap.org/copyright",
      query: `${KR_IDS_QUERY} | 위도 밴드별 태그 질의(taggedQueries)`,
      osmTimestamp,
      fetchedAt: new Date().toISOString(),
      counts: { total: stats.total, crossing: stats.crossing, tactile: stats.tactile },
    },
    nodes,
  };

  writeFileSync(OUT, `${JSON.stringify(seed)}\n`);

  // 제공 지역 판정용 국경 링(본토+제주·서해5도·울릉·독도). 사각형으로는 후쿠오카와
  // 개성을 동시에 가를 수 없다 — BOUNDARY_QUERY 주석 참조.
  const boundaryJson = `${JSON.stringify({
    meta: {
      source: seed.meta.source,
      license: seed.meta.license,
      licenseUrl: seed.meta.licenseUrl,
      attribution: seed.meta.attribution,
      osmTimestamp,
      points: stats.boundaryPoints,
    },
    rings,
  })}\n`;
  for (const path of BOUNDARY_OUTS) writeFileSync(path, boundaryJson);
  console.log(
    `완료: 노드 ${stats.total} · 횡단보도 ${stats.crossing} · 점자블록 ${stats.tactile} · 강남역 300m ${stats.dense} · 국경 좌표점 ${stats.boundaryPoints}`,
  );
  console.log(`→ ${OUT}`);
}

const isMain = process.argv[1] && import.meta.url.endsWith(basename(process.argv[1]));
if (isMain) {
  main().catch((e) => {
    console.error("실패:", e.message);
    process.exit(1);
  });
}
