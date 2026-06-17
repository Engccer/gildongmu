import proj4 from "proj4";
import type { AirGrade, AirPollutant, AirQuality } from "../types";
import { env } from "../env";

/**
 * 이 지역 공기질(B2) provider — 에어코리아 15073877·15073861.
 *
 * 2-call 체인: WGS84→TM 변환 → 근접 측정소(`getNearbyMsrstnList`) →
 * 측정소명 단건 실시간(`getMsrstnAcctoRltmMesureDnsty`).
 * 인증: data.go.kr serviceKey(`DATA_GO_KR_API_KEY`, 버스/B1과 동일 키).
 *
 * 정본 원칙(설계 `docs/superpowers/specs/2026-06-17-air-quality-design.md`):
 * - 좌표 변환은 **proj4 EPSG:2097**(Bessel+towgs84). 카카오/네이버 EPSG:5181 아님
 *   (false E/N 동일해 혼동, 결과 Δ300m+). datum-shift 직접 구현 금지(표준 lib).
 * - 등급(좋음/보통/나쁨/매우나쁨)이 낭독 정본, 수치는 보강.
 * - 3-state: `*Flag`(측정 장애) non-null → value:null·grade:"unknown"
 *   (측정 안 됨을 숫자로 노출 금지 — arrivalStatus·B1 unknown 교훈).
 * - 거리는 에어코리아 `tm`(km) 정본 — 자체 Haversine 재계산 안 함(이중 진실 금지).
 * - upstream 장애 → throw → 502. 근접 측정소·측정 데이터 없음 → null(graceful).
 */

const MSRSTN_BASE =
  "https://apis.data.go.kr/B552584/MsrstnInfoInqireSvc/getNearbyMsrstnList";
const MEASURE_BASE =
  "https://apis.data.go.kr/B552584/ArpltnInforInqireSvc/getMsrstnAcctoRltmMesureDnsty";

// EPSG:2097 — TM중부원점(Bessel 타원체 + Tokyo→WGS84 datum shift). 에어코리아 측정소 좌표계.
const TM_2097 =
  "+proj=tmerc +lat_0=38 +lon_0=127 +k=1 +x_0=200000 +y_0=500000 " +
  "+ellps=bessel +units=m +no_defs " +
  "+towgs84=-145.907,505.034,685.756,-1.162,2.347,1.592,6.342";

type RawItem = Record<string, unknown>;

function str(v: unknown): string {
  return v == null ? "" : String(v).trim();
}

/** "57"/"0.142" 등 수치 문자열 → number. 빈 값·"-"·비유한 → null. */
function numOrNull(v: unknown): number | null {
  if (v == null) return null;
  const s = String(v).trim();
  if (s === "" || s === "-") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** WGS84(위도, 경도) → 에어코리아 TM중부원점 좌표(EPSG:2097). 순수·결정적. */
export function wgs84ToTm(lat: number, lng: number): { tmX: number; tmY: number } {
  const [tmX, tmY] = proj4("EPSG:4326", TM_2097, [lng, lat]);
  return { tmX, tmY };
}

/**
 * 응답 items 안전 추출. ⚠ 에어코리아(B552584)는 다른 data.go.kr 서비스(items.item)와
 * 달리 **`body.items`가 직접 배열**이다(실응답 검증 2026-06-17). 두 형태 모두 처리.
 */
function extractItems(raw: unknown): RawItem[] {
  const items = (raw as { response?: { body?: { items?: unknown } } })?.response
    ?.body?.items;
  if (!items || typeof items === "string") return []; // 빈 결과 items:""
  if (Array.isArray(items)) return items as RawItem[]; // 에어코리아: items 자체가 배열
  const item = (items as { item?: unknown }).item; // 표준 envelope 폴백
  if (item == null) return [];
  return Array.isArray(item) ? (item as RawItem[]) : [item as RawItem];
}

/** envelope resultCode 추출(정상 "00"). */
function resultCode(raw: unknown): string | null {
  const c = (raw as { response?: { header?: { resultCode?: unknown } } })?.response
    ?.header?.resultCode;
  return c != null ? String(c) : null;
}

/** 등급 코드("1"~"4") → AirGrade. 부재·비정상 → "unknown"(낭독 정본). */
export function gradeFromCode(code: unknown): AirGrade {
  switch (str(code)) {
    case "1":
      return "good";
    case "2":
      return "moderate";
    case "3":
      return "bad";
    case "4":
      return "veryBad";
    default:
      return "unknown";
  }
}

/**
 * 오염물질 한 종 정규화 — 3-state.
 * Flag(측정 장애) non-null이면 value·grade를 신뢰 불가로 보고 null/unknown 강제.
 */
export function parsePollutant(
  valueRaw: unknown,
  gradeRaw: unknown,
  flagRaw: unknown,
): AirPollutant {
  const flagged = str(flagRaw) !== "";
  if (flagged) return { value: null, grade: "unknown" };
  return { value: numOrNull(valueRaw), grade: gradeFromCode(gradeRaw) };
}

export interface NearestStation {
  stationName: string;
  distanceKm: number;
  addr: string;
}

/** 근접 측정소 응답 → 최근접 1곳(API가 이미 거리순 정렬). 빈결과 → null. */
export function parseNearestStation(raw: unknown): NearestStation | null {
  const items = extractItems(raw);
  if (items.length === 0) return null;
  const it = items[0];
  return {
    stationName: str(it.stationName),
    distanceKm: numOrNull(it.tm) ?? 0,
    addr: str(it.addr),
  };
}

/** 측정소 실시간 응답 + 근접 측정소 정보 → AirQuality. 빈 측정 → null. */
export function parseAirMeasure(
  raw: unknown,
  station: NearestStation,
): AirQuality | null {
  const items = extractItems(raw);
  if (items.length === 0) return null;
  const m = items[0];
  return {
    stationName: station.stationName,
    distanceKm: station.distanceKm,
    addr: station.addr,
    dataTime: str(m.dataTime),
    // 통합대기환경지수는 별도 Flag 필드가 없어 값/등급 부재만으로 unknown 판정.
    // ⚠ khai는 에어코리아가 **유효 오염물질만으로 서버측 산출한 공식 통합지수**다
    // (우리 파생값 아님). 따라서 pm10/pm25 Flag(측정 장애)가 있어도 khai는 그 자체로
    // 정본이므로 unknown으로 끌어내리지 않는다(Flag 3번째 인자 항상 null — 의도).
    khai: parsePollutant(m.khaiValue, m.khaiGrade, null),
    pm10: parsePollutant(m.pm10Value, m.pm10Grade, m.pm10Flag),
    pm25: parsePollutant(m.pm25Value, m.pm25Grade, m.pm25Flag),
  };
}

/**
 * 에어코리아 한 오퍼레이션 호출 → 검증된 raw JSON. tago-bus.ts 동형 방어:
 * - serviceKey 포함 모든 파라미터를 `URLSearchParams`로 인코딩(Base64 키의 `+/=`
 *   가 URL을 깨는 경우 방지 — 현재 hex 키는 무해하나 키 교체 견고성).
 * - **인증 실패 등은 `returnType=json`이어도 XML 에러 body를 HTTP 200으로 보낸다**
 *   → `text()`로 받아 `JSON.parse` try-catch(미처리 시 `res.json()`이 모호한
 *   SyntaxError로 throw). 파싱 실패·서비스 에러·resultCode≠"00" 모두 throw(라우트
 *   502 — "조회 실패"와 "정보 없음" 구분).
 */
async function fetchAirkorea(
  base: string,
  params: Record<string, string | number>,
  revalidate: number,
  label: string,
): Promise<unknown> {
  const key = env.DATA_GO_KR_API_KEY!;
  const url = new URL(base);
  url.searchParams.set("serviceKey", key);
  url.searchParams.set("returnType", "json");
  url.searchParams.set("_returnType", "json");
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));

  const res = await fetch(url, { next: { revalidate } });
  if (!res.ok) throw new Error(`${label} 조회 실패: HTTP ${res.status}`);

  const text = await res.text();
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    // 인증 실패 등은 _type=json이어도 XML 에러로 오기도 한다(키 만료·env 누락 진단).
    throw new Error(`${label} 비정상 응답(XML?): ${text.slice(0, 200)}`);
  }
  // data.go.kr 공통 게이트웨이 인증 에러 envelope.
  if ((raw as { OpenAPI_ServiceResponse?: unknown }).OpenAPI_ServiceResponse) {
    throw new Error(`${label} 서비스 에러(인증?): ${text.slice(0, 200)}`);
  }
  const code = resultCode(raw);
  if (code !== "00") throw new Error(`${label} 비정상 응답: resultCode ${code}`);
  return raw;
}

/** 근접 측정소 조회(call 1). 측정소 목록은 거의 불변이라 하루 캐시. */
async function fetchNearestStation(
  lat: number,
  lng: number,
): Promise<NearestStation | null> {
  const { tmX, tmY } = wgs84ToTm(lat, lng);
  const raw = await fetchAirkorea(
    MSRSTN_BASE,
    { tmX, tmY, pageNo: 1, numOfRows: 5 },
    86_400,
    "근접 측정소",
  );
  return parseNearestStation(raw);
}

/** 측정소 실시간 측정 조회(call 2). 시간 단위 갱신이라 10분 캐시. */
async function fetchAirMeasure(
  station: NearestStation,
): Promise<AirQuality | null> {
  const raw = await fetchAirkorea(
    MEASURE_BASE,
    { stationName: station.stationName, dataTerm: "DAILY", pageNo: 1, numOfRows: 1, ver: "1.3" },
    600,
    "측정소 실시간",
  );
  return parseAirMeasure(raw, station);
}

/**
 * 좌표 → 가장 가까운 측정소의 실시간 공기질(2-call 체인). 키 없으면 null.
 * 근접 측정소·측정 데이터 없음 → null(graceful 숨김). upstream 장애 → throw(502).
 */
export async function findAirQualityNear(
  lat: number,
  lng: number,
): Promise<AirQuality | null> {
  if (!env.DATA_GO_KR_API_KEY) return null;
  const station = await fetchNearestStation(lat, lng);
  if (!station) return null;
  return fetchAirMeasure(station);
}
