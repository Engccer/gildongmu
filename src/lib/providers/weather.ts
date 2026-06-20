/**
 * 이 지역 날씨 provider — 기상청 단기예보 API(data.go.kr 15084084).
 *
 * 2-오퍼레이션 체인: WGS84→격자(LCC) 변환 → 초단기실황(getUltraSrtNcst, 현재
 * 실측 기온·습도·강수형태) + 단기예보(getVilageFcst, 하늘상태·최고최저·강수확률).
 * 인증: data.go.kr serviceKey(`DATA_GO_KR_API_KEY`, 공기질/버스와 동일 키).
 *
 * 정본 원칙(설계 `docs/superpowers/specs/2026-06-20-local-weather-conditions-design.md`):
 * - 격자 변환은 기상청 공식 LCC 알고리즘(자체 파라미터라 표준 EPSG 없음 — 직접 이식).
 * - 상태 단어(하늘상태/강수형태)가 낭독 정본, 수치는 보강. 미매핑 코드 → unknown.
 * - upstream 장애 → throw → 502. 무데이터·미커버 → null(graceful). mock 폴백 없음.
 * - 부분 성공 보존: 실황·예보를 allSettled 독립 처리, 둘 다 실패해야 throw.
 */

import type { PrecipLabel, SkyLabel, Weather } from "../types";
import { env } from "../env";

/** 기상청 격자 변환 상수(공식 dfs_xy_conv). */
const RE = 6371.00877; // 지구 반경(km)
const GRID = 5.0; // 격자 간격(km)
const SLAT1 = 30.0; // 표준 위도 1
const SLAT2 = 60.0; // 표준 위도 2
const OLON = 126.0; // 기준점 경도
const OLAT = 38.0; // 기준점 위도
const XO = 43; // 기준점 격자 X
const YO = 136; // 기준점 격자 Y

/** WGS84(위도, 경도) → 기상청 격자(nx, ny). 순수·결정적(Lambert 정각원추). */
export function latLngToGrid(lat: number, lng: number): { nx: number; ny: number } {
  const DEGRAD = Math.PI / 180.0;
  const re = RE / GRID;
  const slat1 = SLAT1 * DEGRAD;
  const slat2 = SLAT2 * DEGRAD;
  const olon = OLON * DEGRAD;
  const olat = OLAT * DEGRAD;

  let sn =
    Math.tan(Math.PI * 0.25 + slat2 * 0.5) /
    Math.tan(Math.PI * 0.25 + slat1 * 0.5);
  sn = Math.log(Math.cos(slat1) / Math.cos(slat2)) / Math.log(sn);
  let sf = Math.tan(Math.PI * 0.25 + slat1 * 0.5);
  sf = (Math.pow(sf, sn) * Math.cos(slat1)) / sn;
  let ro = Math.tan(Math.PI * 0.25 + olat * 0.5);
  ro = (re * sf) / Math.pow(ro, sn);

  let ra = Math.tan(Math.PI * 0.25 + lat * DEGRAD * 0.5);
  ra = (re * sf) / Math.pow(ra, sn);
  let theta = lng * DEGRAD - olon;
  if (theta > Math.PI) theta -= 2.0 * Math.PI;
  if (theta < -Math.PI) theta += 2.0 * Math.PI;
  theta *= sn;

  const nx = Math.floor(ra * Math.sin(theta) + XO + 0.5);
  const ny = Math.floor(ro - ra * Math.cos(theta) + YO + 0.5);
  return { nx, ny };
}

/** KST(+9) 벽시계 구성요소. 서버 TZ와 무관하게 결정적(공기질·B1 동형). */
function kstParts(now: Date): {
  y: number;
  mo: number;
  d: number;
  h: number;
  mi: number;
} {
  const shifted = new Date(now.getTime() + 9 * 3_600_000);
  return {
    y: shifted.getUTCFullYear(),
    mo: shifted.getUTCMonth(),
    d: shifted.getUTCDate(),
    h: shifted.getUTCHours(),
    mi: shifted.getUTCMinutes(),
  };
}

/** (y, 0-based month, d) → "YYYYMMDD". */
function fmtDate(y: number, mo: number, d: number): string {
  return (
    String(y) +
    String(mo + 1).padStart(2, "0") +
    String(d).padStart(2, "0")
  );
}

/** KST 자정 직전 날짜로 하루 되돌린 "YYYYMMDD"(자정 경계용). */
function prevDate(y: number, mo: number, d: number): string {
  const prev = new Date(Date.UTC(y, mo, d) - 24 * 3_600_000);
  return fmtDate(prev.getUTCFullYear(), prev.getUTCMonth(), prev.getUTCDate());
}

/**
 * 초단기실황 base_date/base_time(KST). 매시 정시 발표·40분 이후 제공이라
 * 분<40이면 직전 정시 사용. 00시대에 되돌리면 전날 23시.
 */
export function ultraSrtNcstBaseTime(now: Date): {
  baseDate: string;
  baseTime: string;
} {
  const p = kstParts(now);
  let h = p.h;
  let date = fmtDate(p.y, p.mo, p.d);
  if (p.mi < 40) h -= 1;
  if (h < 0) {
    h = 23;
    date = prevDate(p.y, p.mo, p.d);
  }
  return { baseDate: date, baseTime: String(h).padStart(2, "0") + "00" };
}

const FCST_HOURS = [2, 5, 8, 11, 14, 17, 20, 23];

/**
 * 현재 KST 날짜 "YYYYMMDD" — 단기예보 오늘 TMX/TMN 매칭 기준.
 * 실황 base_date(ultraSrtNcstBaseTime)는 00:00~00:39에 전날로 되돌려지므로
 * "오늘"의 정본이 아니다 → 현재 벽시계 날짜를 별도 산출해 자정 경계 오표시를 막는다.
 */
export function currentKstYmd(now: Date): string {
  const p = kstParts(now);
  return fmtDate(p.y, p.mo, p.d);
}

/**
 * 단기예보 base_date/base_time(KST). 발표시각(02/05/…/23) 중 발표+10분이
 * 현재 이하인 가장 최근. 첫 발표(02:10) 전이면 전날 23시.
 */
export function vilageFcstBaseTime(now: Date): {
  baseDate: string;
  baseTime: string;
} {
  const p = kstParts(now);
  const mins = p.h * 60 + p.mi;
  let chosen = -1;
  for (const fh of FCST_HOURS) {
    if (fh * 60 + 10 <= mins) chosen = fh;
  }
  if (chosen === -1) {
    return { baseDate: prevDate(p.y, p.mo, p.d), baseTime: "2300" };
  }
  return {
    baseDate: fmtDate(p.y, p.mo, p.d),
    baseTime: String(chosen).padStart(2, "0") + "00",
  };
}

type RawItem = Record<string, unknown>;

/** 수치 문자열 → number. 빈 값·"-"·비유한 → null. */
function numOrNull(v: unknown): number | null {
  if (v == null) return null;
  const s = String(v).trim();
  if (s === "" || s === "-") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/**
 * 기상청 표준 envelope items 추출 — `response.body.items.item[]`.
 * (공기질 에어코리아의 직접 배열 quirk와 다름 — 기상청은 표준 item 중첩.)
 * 빈 결과 `items:""` → []. resultCode≠"00" 검증은 fetch 계층 책임.
 */
function extractItems(raw: unknown): RawItem[] {
  const items = (raw as { response?: { body?: { items?: unknown } } })?.response
    ?.body?.items;
  if (!items || typeof items === "string") return [];
  const item = (items as { item?: unknown }).item;
  if (item == null) return [];
  return Array.isArray(item) ? (item as RawItem[]) : [item as RawItem];
}

/** SKY 코드 → 라벨. 1 맑음·3 구름많음·4 흐림, 그 외 unknown. */
export function skyLabel(code: unknown): SkyLabel {
  switch (String(code ?? "").trim()) {
    case "1":
      return "clear";
    case "3":
      return "partlyCloudy";
    case "4":
      return "cloudy";
    default:
      return "unknown";
  }
}

/** PTY 코드 → 라벨. 0 없음·1 비·2 비눈·3 눈·4 소나기, 그 외 unknown. */
export function precipLabel(code: unknown): PrecipLabel {
  switch (String(code ?? "").trim()) {
    case "0":
      return "none";
    case "1":
      return "rain";
    case "2":
      return "rainSnow";
    case "3":
      return "snow";
    case "4":
      return "shower";
    default:
      return "unknown";
  }
}

/** 카테고리별 첫 obsrValue. */
function ncstValue(items: RawItem[], category: string): unknown {
  return items.find((it) => String(it.category).trim() === category)?.obsrValue;
}

/** 초단기실황 → 현재기온·습도·강수형태. 빈 응답 → null. */
export function parseNcst(raw: unknown): {
  tempC: number | null;
  humidity: number | null;
  precipitation: { code: number | null; label: PrecipLabel };
} | null {
  const items = extractItems(raw);
  if (items.length === 0) return null;
  const ptyRaw = ncstValue(items, "PTY");
  return {
    tempC: numOrNull(ncstValue(items, "T1H")),
    humidity: numOrNull(ncstValue(items, "REH")),
    precipitation: { code: numOrNull(ptyRaw), label: precipLabel(ptyRaw) },
  };
}

/** fcstDate+fcstTime 오름차순 키. */
function fcstKey(it: RawItem): string {
  return String(it.fcstDate ?? "") + String(it.fcstTime ?? "");
}

/** 카테고리의 fcst 항목들 중 시각 오름차순 첫 항목 fcstValue. */
function firstFcst(items: RawItem[], category: string): unknown {
  const matched = items
    .filter((it) => String(it.category).trim() === category)
    .sort((a, b) => fcstKey(a).localeCompare(fcstKey(b)));
  return matched[0]?.fcstValue;
}

/** 카테고리의 오늘(todayYmd) 항목 fcstValue. */
function todayFcst(
  items: RawItem[],
  category: string,
  todayYmd: string,
): unknown {
  return items.find(
    (it) =>
      String(it.category).trim() === category &&
      String(it.fcstDate).trim() === todayYmd,
  )?.fcstValue;
}

/**
 * 단기예보 → 하늘상태(가장 이른 SKY)·강수확률(가장 이른 POP)·오늘 최고/최저.
 * 빈 응답 → null. 오늘 TMX/TMN이 예보에 없으면(밤늦게) 해당 값 null.
 */
export function parseFcst(
  raw: unknown,
  todayYmd: string,
): {
  sky: { code: number | null; label: SkyLabel };
  tempMax: number | null;
  tempMin: number | null;
  precipProbability: number | null;
} | null {
  const items = extractItems(raw);
  if (items.length === 0) return null;
  const skyRaw = firstFcst(items, "SKY");
  return {
    sky: { code: numOrNull(skyRaw), label: skyLabel(skyRaw) },
    tempMax: numOrNull(todayFcst(items, "TMX", todayYmd)),
    tempMin: numOrNull(todayFcst(items, "TMN", todayYmd)),
    precipProbability: numOrNull(firstFcst(items, "POP")),
  };
}

/** 실황·예보 합성 → Weather. 둘 다 null이면 null(빈 카드 금지). */
export function mergeWeather(
  ncst: ReturnType<typeof parseNcst>,
  fcst: ReturnType<typeof parseFcst>,
  baseTime: string,
  grid: { nx: number; ny: number },
): Weather | null {
  if (!ncst && !fcst) return null;
  return {
    sky: fcst?.sky ?? { code: null, label: "unknown" },
    precipitation: ncst?.precipitation ?? { code: null, label: "unknown" },
    tempC: ncst?.tempC ?? null,
    tempMax: fcst?.tempMax ?? null,
    tempMin: fcst?.tempMin ?? null,
    humidity: ncst?.humidity ?? null,
    precipProbability: fcst?.precipProbability ?? null,
    baseTime,
    grid,
  };
}

const NCST_BASE =
  "https://apis.data.go.kr/1360000/VilageFcstInfoService_2.0/getUltraSrtNcst";
const FCST_BASE =
  "https://apis.data.go.kr/1360000/VilageFcstInfoService_2.0/getVilageFcst";

/** envelope resultCode 추출(정상 "00"). */
function resultCode(raw: unknown): string | null {
  const c = (raw as { response?: { header?: { resultCode?: unknown } } })
    ?.response?.header?.resultCode;
  return c != null ? String(c) : null;
}

/**
 * 기상청 한 오퍼레이션 호출 → 검증된 raw JSON. 공기질 fetchAirkorea 동형 방어:
 * - serviceKey 등 모든 파라미터 URLSearchParams 인코딩.
 * - 인증 실패 등은 dataType=JSON이어도 XML 에러를 HTTP 200으로 보냄 → text()
 *   받아 JSON.parse try-catch, 게이트웨이 에러 envelope·resultCode≠"00" → throw
 *   (라우트 502 — "조회 실패"와 "정보 없음" 구분).
 */
async function fetchKma(
  base: string,
  params: Record<string, string | number>,
  label: string,
): Promise<unknown> {
  const key = env.DATA_GO_KR_API_KEY!;
  const url = new URL(base);
  url.searchParams.set("serviceKey", key);
  url.searchParams.set("dataType", "JSON");
  url.searchParams.set("pageNo", "1");
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, String(v));
  }

  const res = await fetch(url, { next: { revalidate: 1800 } });
  if (!res.ok) throw new Error(`${label} 조회 실패: HTTP ${res.status}`);

  const text = await res.text();
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error(`${label} 비정상 응답(XML?): ${text.slice(0, 200)}`);
  }
  if ((raw as { OpenAPI_ServiceResponse?: unknown }).OpenAPI_ServiceResponse) {
    throw new Error(`${label} 서비스 에러(인증?): ${text.slice(0, 200)}`);
  }
  const code = resultCode(raw);
  if (code !== "00") throw new Error(`${label} 비정상 응답: resultCode ${code}`);
  return raw;
}

/** "HHmm" → "HH:mm"(낭독 조회시각). */
function formatBaseTime(hhmm: string): string {
  return hhmm.length === 4 ? `${hhmm.slice(0, 2)}:${hhmm.slice(2)}` : hhmm;
}

/**
 * 좌표 → 가장 가까운 격자의 현재 날씨(2-오퍼레이션 allSettled). 키 없으면 null.
 * 무데이터 → null(graceful). 실황·예보 둘 다 실패해야 throw(502). 한쪽만 실패면
 * 부분 Weather 보존(mergeWeather). 시각은 실호출 시점 기준(`new Date()`).
 */
export async function findWeatherNear(
  lat: number,
  lng: number,
): Promise<Weather | null> {
  if (!env.DATA_GO_KR_API_KEY) return null;
  const grid = latLngToGrid(lat, lng);
  const now = new Date();
  const ncstBase = ultraSrtNcstBaseTime(now);
  const fcstBase = vilageFcstBaseTime(now);

  const [ncstRes, fcstRes] = await Promise.allSettled([
    fetchKma(
      NCST_BASE,
      { base_date: ncstBase.baseDate, base_time: ncstBase.baseTime, nx: grid.nx, ny: grid.ny, numOfRows: 60 },
      "초단기실황",
    ),
    fetchKma(
      FCST_BASE,
      { base_date: fcstBase.baseDate, base_time: fcstBase.baseTime, nx: grid.nx, ny: grid.ny, numOfRows: 1000 },
      "단기예보",
    ),
  ]);

  if (ncstRes.status === "rejected" && fcstRes.status === "rejected") {
    throw ncstRes.reason;
  }

  const todayYmd = currentKstYmd(now);
  const ncst = ncstRes.status === "fulfilled" ? parseNcst(ncstRes.value) : null;
  const fcst =
    fcstRes.status === "fulfilled" ? parseFcst(fcstRes.value, todayYmd) : null;

  return mergeWeather(ncst, fcst, formatBaseTime(ncstBase.baseTime), grid);
}
