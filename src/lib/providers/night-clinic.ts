import type {
  ClinicHours,
  ClinicOpenStatus,
  NightClinic,
} from "../types";
import { env } from "../env";
import { haversineMeters } from "../geo";

/**
 * 내 주변 소아 야간·휴일 진료(달빛어린이병원·소아전문센터) provider —
 * NMC 15000736 `getBabyListInfoInqire`.
 *
 * 엔드포인트: apis.data.go.kr/B552657/HsptlAsembySearchService/getBabyListInfoInqire
 * 인증: data.go.kr serviceKey(`DATA_GO_KR_API_KEY`). `_type=json`으로 JSON 수신
 * (korail/버스/따릉이 동형). 전국 ~152개로 적어 한 번에 받아(numOfRows=200)
 * 서버 Haversine 정렬→반경 cap→상위 N(따릉이 패턴, 좌표/반경 파라미터 없음).
 *
 * 정본 원칙(의료 정보 — 가짜 금지):
 * - mock 폴백 없음. 키 없음 → 빈 배열(섹션 미노출). upstream 장애 → throw → 502.
 * - 진료 상태는 open/closed/**unknown** 3-state. 해당 요일 진료시간이 없으면
 *   "마감"이 아니라 "정보 없음"(시각장애인 오판 방지 — arrivalStatus 교훈).
 * - `totalCount > numOfRows`면 throw(silent truncation 방지 — metro 교훈).
 */

const BASE =
  "https://apis.data.go.kr/B552657/HsptlAsembySearchService/getBabyListInfoInqire";
const NUM_OF_ROWS = 200; // 전국 ~152개 < 200 (totalCount 가드로 증가 대비)
const MAX_DISTANCE_METERS = 20_000; // 야간 소아 응급 — 도보권보다 넓게(차량 이동 전제)
const TOP_N = 5;

type RawItem = Record<string, unknown>;

function str(v: unknown): string {
  return v == null ? "" : String(v).trim();
}

function numF(v: unknown): number {
  if (v == null || (typeof v === "string" && v.trim() === "")) return NaN;
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
}

/** "0900"/"2400" 등 HHMM 문자열 → 정수. 빈 값·비유한 → null(정보 없음). */
function parseHHMM(v: unknown): number | null {
  const n = numF(v);
  return Number.isFinite(n) ? n : null;
}

/** data.go.kr JSON: items.item 은 단일 객체(1건) 또는 배열(N건). 안전 추출. */
export function extractItems(raw: unknown): RawItem[] {
  const items = (
    raw as { response?: { body?: { items?: unknown } } }
  )?.response?.body?.items;
  // 빈 결과는 items:"" 또는 items.item 부재로 온다.
  if (!items || typeof items === "string") return [];
  const item = (items as { item?: unknown }).item;
  if (item == null) return [];
  return Array.isArray(item) ? (item as RawItem[]) : [(item as RawItem)];
}

/** 응답 본문에서 resultCode·totalCount 추출(envelope 검사용). */
function header(raw: unknown): { code: string | null; totalCount: number } {
  const r = (raw as {
    response?: { header?: { resultCode?: unknown }; body?: { totalCount?: unknown } };
  })?.response;
  return {
    code: r?.header?.resultCode != null ? String(r.header.resultCode) : null,
    totalCount: (() => {
      const n = numF(r?.body?.totalCount);
      return Number.isFinite(n) ? n : 0;
    })(),
  };
}

/** dutyTime1..8 → ClinicHours[8] (index 0..7 = 월~일·공휴일). */
function parseHours(it: RawItem): ClinicHours[] {
  const hours: ClinicHours[] = [];
  for (let d = 1; d <= 8; d++) {
    hours.push({
      start: parseHHMM(it[`dutyTime${d}s`]),
      end: parseHHMM(it[`dutyTime${d}c`]),
    });
  }
  return hours;
}

/**
 * getBabyListInfoInqire 응답 → NightClinic[] (거리 미부여, 원순서).
 * 좌표 비유한 항목은 제외(지도/거리 정렬 불가 — 좌표 없는 행은 버린다).
 */
export function parseClinics(raw: unknown): NightClinic[] {
  return extractItems(raw)
    .map((it): NightClinic | null => {
      const lat = numF(it.wgs84Lat);
      const lng = numF(it.wgs84Lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
      return {
        id: str(it.hpid),
        name: str(it.dutyName),
        address: str(it.dutyAddr),
        phone: str(it.dutyTel1),
        kind: str(it.dutyDivNam),
        emergencyClass: str(it.dutyEmclsName),
        directions: str(it.dutyMapimg),
        lat,
        lng,
        distanceMeters: Number.POSITIVE_INFINITY,
        hours: parseHours(it),
      };
    })
    .filter((c): c is NightClinic => c !== null && c.name !== "");
}

/**
 * 출발 좌표로 거리 부여·정렬·반경 cap·상위 N.
 * 산술(Haversine)·정렬은 코드 책임(deterministic).
 */
export function rankClinicsByDistance(
  clinics: NightClinic[],
  lat: number,
  lng: number,
  opts: { radiusMeters?: number; limit?: number } = {},
): NightClinic[] {
  const radius = opts.radiusMeters ?? MAX_DISTANCE_METERS;
  const limit = opts.limit ?? TOP_N;
  return clinics
    .map((c) => ({
      ...c,
      distanceMeters: Math.round(haversineMeters(lat, lng, c.lat, c.lng)),
    }))
    .filter((c) => c.distanceMeters <= radius)
    .sort((a, b) => a.distanceMeters - b.distanceMeters)
    .slice(0, limit);
}

/**
 * 특정 요일(hoursIndex 0..7)·시각(hhmm)에서의 진료 상태.
 * 순수 함수(Date 비의존) — 라우트가 KST now로 index/hhmm을 주입해 호출.
 * - 해당 요일 시작/종료 정보 없음 → unknown("정보 없음", 마감 아님).
 * - 종료 2400 = 자정(hhmm 최대 2359라 자정 직전까지 open).
 * - 교차자정(start>end)은 방어적으로 [start,2400)∪[0,end) 처리.
 */
export function clinicOpenStatus(
  hours: ClinicHours[],
  hoursIndex: number,
  hhmm: number,
): ClinicOpenStatus {
  const slot = hours[hoursIndex];
  // 시작/종료 정보 없음 → unknown. "0000~0000"(일부 의료 API가 '운영 없음'을
  // 0으로 표기)도 마감이 아니라 "정보 없음"으로 본다(시각장애인 오판 방지).
  if (
    !slot ||
    slot.start == null ||
    slot.end == null ||
    (slot.start === 0 && slot.end === 0)
  ) {
    return { state: "unknown", start: null, end: null };
  }
  const { start, end } = slot;
  const open =
    start <= end
      ? hhmm >= start && hhmm < end // 일반: [start, end)
      : hhmm >= start || hhmm < end; // 교차자정 방어
  return { state: open ? "open" : "closed", start, end };
}

/** JS Date.getDay()(0=일..6=토) → hours index(0=월..6=일). 공휴일(7)은 별도 판정. */
export function dayToHoursIndex(jsDay: number): number {
  return (jsDay + 6) % 7;
}

/**
 * getBabyListInfoInqire 전국 목록을 호출해 파싱한다(거리 미부여).
 * 목록은 분 단위 변동이 없어 하루 캐시(쿼터 절약). resultCode "00"이 아니거나
 * HTTP 실패면 throw(라우트가 502 — "조회 실패"와 "근처에 없음"을 구분).
 * totalCount가 한 페이지(numOfRows)를 넘으면 throw(silent truncation 방지).
 */
export async function fetchNightClinics(): Promise<NightClinic[]> {
  const key = env.DATA_GO_KR_API_KEY;
  if (!key) return [];
  const url = `${BASE}?serviceKey=${key}&pageNo=1&numOfRows=${NUM_OF_ROWS}&_type=json`;
  const res = await fetch(url, { next: { revalidate: 86_400 } });
  if (!res.ok) throw new Error(`달빛어린이병원 목록 조회 실패: HTTP ${res.status}`);
  const raw = await res.json();
  const { code, totalCount } = header(raw);
  if (code !== "00") throw new Error(`달빛어린이병원 목록 비정상 응답: resultCode ${code}`);
  if (totalCount > NUM_OF_ROWS) {
    throw new Error(
      `달빛어린이병원 목록 ${totalCount}건 > 페이지 ${NUM_OF_ROWS} — 페이지네이션 필요(부분집합 금지)`,
    );
  }
  return parseClinics(raw);
}

/** 좌표 → 반경 내 근접 소아 야간·휴일 진료 상위 N(거리순). 키 없으면 빈 배열. */
export async function findNightClinicsNear(
  lat: number,
  lng: number,
): Promise<NightClinic[]> {
  if (!env.DATA_GO_KR_API_KEY) return [];
  const all = await fetchNightClinics();
  return rankClinicsByDistance(all, lat, lng);
}
