/**
 * 서울 실시간 도시데이터 핫스팟 영역 seed 빌드.
 *
 * `citydata_ppltn`(혼잡도) 응답에는 좌표가 **한 필드도 없다**. 대신 전체
 * `citydata` 응답의 `SUB_STTS`·`BUS_STN_STTS`가 그 영역을 구성하는
 * 지하철역·버스정류장을 WGS84 좌표와 함께 준다. 이 지점들이 영역의 범위를
 * 정의한다 — 이름을 지오코딩하거나 반경을 가정할 필요가 없다는 뜻이고,
 * 그것이 이 기능의 착수를 막고 있던 유일한 장애물이었다(스펙 §1-2).
 *
 * 실행: node scripts/build-congestion-areas.mjs
 * 산출: src/lib/providers/data/congestion-areas.json
 * 갱신: 연 1회 또는 서울시 영역 신설 통보 시(구성 정류장은 준정적).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { basename, dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const OUT = join(ROOT, "src/lib/providers/data/congestion-areas.json");

/** 코드 탐색 범위. 현재 실재는 POI001~POI131(10개 공백). 여유를 두고 훑는다. */
const CODE_MAX = 140;
const CONCURRENCY = 6;

/** 서울 bbox — 좌표계 회귀(EPSG 혼동·축 교환) 즉시 검출용. */
const SEOUL = { latMin: 37.4, latMax: 37.72, lngMin: 126.73, lngMax: 127.27 };
/** golden: 강남역 영역 중심. 좌표계가 어긋나면 수백 m~수십 km 벌어진다. */
const GOLDEN = { code: "POI014", name: "강남역", lat: 37.4988, lng: 127.0276, tolMeters: 500 };

const MIN_AREAS = 100;
const MIN_POINTS = 1500;

export function haversineMeters(aLat, aLng, bLat, bLng) {
  const R = 6371000;
  const p1 = (aLat * Math.PI) / 180;
  const p2 = (bLat * Math.PI) / 180;
  const dp = ((bLat - aLat) * Math.PI) / 180;
  const dl = ((bLng - aLng) * Math.PI) / 180;
  const h =
    Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/**
 * 좌표 파싱. ⚠ 빈 문자열을 먼저 걸러야 한다: `Number("")`는 `0`이라
 * 결측 좌표가 조용히 (0, 0)이 되고, 그 점은 bbox 가드에도 걸리지만
 * 애초에 만들지 않는 편이 맞다(라우트 14곳의 같은 함정이 백로그 D3).
 */
function num(v) {
  const s = String(v ?? "").trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** 소수 6자리(약 11cm) 절단 — seed 파일 크기를 절반으로 줄인다. */
function round6(n) {
  return Math.round(n * 1e6) / 1e6;
}

/**
 * 전체 citydata 응답 하나 → 영역 1건. 구성 지점이 없으면 null(한강공원류 —
 * 판정 대상에서 자연 탈락하고, 그 결과는 침묵이지 오답이 아니다. 스펙 §1-5).
 */
/**
 * 배열 또는 단일 객체를 목록으로. ⚠ **단건일 때 배열이 아니라 단일 객체로 오는
 * API가 있다**(data.go.kr에서 기관코드마다 갈렸던 실측 함정). 여기서 배열만
 * 받으면 지점이 1개뿐인 영역이 조용히 지점 0개가 되고, 그러면 `toArea`가 null을
 * 돌려 **영역 자체가 seed에서 사라진다** — 진짜 인프라 부재(§1-5)와 구분되지
 * 않는 침묵이라 두 모양을 다 받는다. 서울 API가 실제로 그러는지는 미확인이고,
 * 확인되지 않았다는 것이 방어를 빼는 근거는 아니다.
 */
function asList(v) {
  if (Array.isArray(v)) return v;
  return v && typeof v === "object" ? [v] : [];
}

export function toArea(raw) {
  const c = raw?.CITYDATA;
  if (!c || typeof c !== "object") return null; // 공백 코드
  const pts = [];
  for (const s of asList(c.SUB_STTS)) {
    const lat = num(s?.SUB_STN_Y);
    const lng = num(s?.SUB_STN_X);
    if (lat !== null && lng !== null) pts.push([round6(lat), round6(lng)]);
  }
  for (const b of asList(c.BUS_STN_STTS)) {
    const lat = num(b?.BUS_STN_Y);
    const lng = num(b?.BUS_STN_X);
    if (lat !== null && lng !== null) pts.push([round6(lat), round6(lng)]);
  }
  const name = String(c.AREA_NM ?? "").trim();
  const code = String(c.AREA_CD ?? "").trim();
  if (!name || !code || pts.length === 0) return null;
  const cLat = round6(pts.reduce((s, p) => s + p[0], 0) / pts.length);
  const cLng = round6(pts.reduce((s, p) => s + p[1], 0) / pts.length);
  return { code, name, c: [cLat, cLng], pts };
}

/**
 * 조용한 열화 차단. 서울시가 응답 구조를 바꾸거나 좌표계가 어긋나면
 * seed가 반쯤 빈 채로 커밋되는 것을 여기서 막는다.
 */
export function validateAreas(areas) {
  if (areas.length < MIN_AREAS) {
    throw new Error(`영역 수 부족: ${areas.length} < ${MIN_AREAS} — 응답 구조 변경 의심`);
  }
  const total = areas.reduce((s, a) => s + a.pts.length, 0);
  if (total < MIN_POINTS) {
    throw new Error(`총 지점 수 부족: ${total} < ${MIN_POINTS}`);
  }
  for (const a of areas) {
    for (const [lat, lng] of a.pts) {
      if (
        lat < SEOUL.latMin || lat > SEOUL.latMax ||
        lng < SEOUL.lngMin || lng > SEOUL.lngMax
      ) {
        throw new Error(`서울 bbox 이탈: ${a.name} ${lat},${lng} — 좌표계 회귀 의심`);
      }
    }
  }
  const golden = areas.find((a) => a.code === GOLDEN.code);
  if (!golden) throw new Error(`golden 영역 부재: ${GOLDEN.code}(${GOLDEN.name})`);
  const err = haversineMeters(golden.c[0], golden.c[1], GOLDEN.lat, GOLDEN.lng);
  if (err > GOLDEN.tolMeters) {
    throw new Error(
      `강남역 golden 오차 ${err.toFixed(0)}m > ${GOLDEN.tolMeters}m — 좌표계 정의 회귀 의심`,
    );
  }
  return { areas: areas.length, points: total, goldenErrorMeters: Math.round(err) };
}

async function main() {
  const envText = readFileSync(join(ROOT, ".env.local"), "utf8");
  const key = /^SEOUL_OPEN_DATA_KEY=(.+)$/m.exec(envText)?.[1]?.trim();
  if (!key) throw new Error(".env.local에 SEOUL_OPEN_DATA_KEY가 없다");

  const codes = Array.from({ length: CODE_MAX }, (_, i) => `POI${String(i + 1).padStart(3, "0")}`);
  const areas = [];
  let skipped = 0;

  for (let i = 0; i < codes.length; i += CONCURRENCY) {
    const batch = codes.slice(i, i + CONCURRENCY);
    const results = await Promise.all(
      batch.map(async (code) => {
        const url = `http://openapi.seoul.go.kr:8088/${key}/json/citydata/1/5/${code}`;
        try {
          const res = await fetch(url, { signal: AbortSignal.timeout(45000) });
          if (!res.ok) return null;
          return toArea(await res.json());
        } catch {
          return null; // 공백 코드·일시 장애 — 가드가 총량으로 잡는다
        }
      }),
    );
    for (const a of results) {
      if (a) areas.push(a);
      else skipped += 1;
    }
    process.stdout.write(`\r수집 ${areas.length}개 (건너뜀 ${skipped})   `);
  }
  process.stdout.write("\n");

  areas.sort((a, b) => a.code.localeCompare(b.code));
  const stats = validateAreas(areas);
  const generatedAt = new Date().toISOString().slice(0, 10);
  writeFileSync(OUT, `${JSON.stringify({ generatedAt, areas })}\n`);
  console.log(
    `완료: 영역 ${stats.areas}개 · 지점 ${stats.points}개 · golden 오차 ${stats.goldenErrorMeters}m`,
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
