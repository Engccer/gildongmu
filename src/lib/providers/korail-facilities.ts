import { env } from "../env";
import type { StationFacilities } from "../types";
import { normalizeStationName } from "../station-match";

/**
 * 한국철도공사(B551457) 역 편의시설 provider.
 *
 * 실 API 특성 (2026-06-14 실호출 확인):
 * - 베이스: https://apis.data.go.kr/B551457/convenience
 * - 교통약자 정보가 두 엔드포인트에 분산된다:
 *   - /weekPersonFacilities : 장애인 화장실(pwdbs_tolt_estnc),
 *     휠체어 리프트(whlch_liftt_cnt), 장애인 경사로(pwdbs_slwy_estnc)
 *   - /stationFacilities    : 엘리베이터 수(elevt_cnt) 등 일반 시설
 *   두 응답을 역명으로 조인해 하나의 StationFacilities로 합친다.
 * - **역명 필터 파라미터 미지원**: stn_nm 등을 넣어도 무시되고 전체
 *   목록(406역, ~50KB)을 alphabetical로 돌려준다. 따라서 전체를 받아
 *   클라이언트에서 normalizeStationName으로 매칭한다 (next 캐시로 비용 흡수).
 * - 인증: data.go.kr serviceKey(DATA_GO_KR_API_KEY, hex 64자 단일 키).
 * - envelope: response.body.items.item (배열). 빈 결과는 items:"".
 *   resultCode "0" = 정상 (TourAPI의 "0000"과 다름).
 *
 * graceful degrade 원칙: 키 없음/네트워크 실패/미커버 역은 모두 null —
 * 가짜 실데이터를 만들지 않는다.
 */

const BASE = "https://apis.data.go.kr/B551457/convenience";

type RawItem = Record<string, unknown>;

/** data.go.kr 표준 envelope에서 item 배열을 안전하게 추출한다. */
export function parseStationItems(raw: unknown): RawItem[] {
  const items = (raw as { response?: { body?: { items?: unknown } } })?.response
    ?.body?.items;
  if (!items || items === "") return [];
  const item = (items as { item?: unknown }).item;
  if (Array.isArray(item)) return item as RawItem[];
  if (item && typeof item === "object") return [item as RawItem];
  return [];
}

function yn(v: unknown): boolean {
  const s = String(v ?? "")
    .trim()
    .toUpperCase();
  return s === "Y" || s === "있음" || s === "1" || s === "TRUE";
}

/**
 * 수치 필드를 파싱한다 — "접근성 정본" 원칙상 **"0대"와 "정보 없음"을
 * 뭉개지 않는다**: 실제 숫자(또는 숫자 문자열 `"0"`/`"4"`)면 그 값,
 * 빈문자열·null·undefined·파싱불가면 `undefined`(=정보 없음).
 */
function num(v: unknown): number | undefined {
  if (v == null) return undefined;
  if (typeof v === "string" && v.trim() === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function stnName(item: RawItem): string {
  return typeof item.stn_nm === "string" ? item.stn_nm : "";
}

function stnCode(item: RawItem): string {
  const c = item.stn_cd;
  return c == null ? "" : String(c);
}

/** 정규화된 타깃 역명과 일치하는 item을 목록에서 찾는다. */
function findByName(items: RawItem[], target: string): RawItem | null {
  return items.find((it) => normalizeStationName(stnName(it)) === target) ?? null;
}

/** stn_cd로 item을 찾는다(역명 표기차/동명이역 혼입 방지). */
function findByCode(items: RawItem[], code: string): RawItem | null {
  if (!code) return null;
  return items.find((it) => stnCode(it) === code) ?? null;
}

/**
 * 두 엔드포인트 응답을 조인해 StationFacilities로 정규화한다.
 *
 * 조인 키 정책: weekPerson에서 **정규화 역명으로 매칭**한 그 항목의
 * `stn_cd`를 확보한 뒤, stationFacilities(엘리베이터)는 **같은 stn_cd로
 * 조인**한다. 역명은 weekPerson 후보 선별에만 쓰여 동명이역/표기차로
 * 다른 역 데이터가 혼입되는 것을 막는다.
 *
 * 교통약자(weekPerson) 응답에 해당 역이 없으면 null — 그 데이터가
 * 이 기능의 핵심이기 때문. 엘리베이터(stationFacilities)는 보조라
 * 없으면 elevators를 undefined로 두고 부분 결과를 반환한다.
 */
export function parseStationFacilities(
  weekPersonRaw: unknown,
  stationRaw: unknown,
  normalizedName: string,
): StationFacilities | null {
  const person = findByName(parseStationItems(weekPersonRaw), normalizedName);
  if (!person) return null;

  // stn_cd로만 보조 데이터를 조인 — 역명 재매칭은 하지 않는다.
  const code = stnCode(person);
  const station = findByCode(parseStationItems(stationRaw), code);

  return {
    stationName: stnName(person) || stnName(station ?? {}) || normalizedName,
    accessibleToilet: yn(person.pwdbs_tolt_estnc),
    wheelchairLifts: num(person.whlch_liftt_cnt),
    accessibleSlope: yn(person.pwdbs_slwy_estnc),
    elevators: num(station?.elevt_cnt),
  };
}

async function fetchList(path: string, key: string): Promise<unknown> {
  const url = new URL(`${BASE}/${path}`);
  url.searchParams.set("serviceKey", key);
  url.searchParams.set("_type", "json");
  url.searchParams.set("numOfRows", "500"); // 전체 406역 + 여유
  url.searchParams.set("pageNo", "1");
  // 전국 목록은 거의 불변 — 하루 캐시로 쿼터(개발계정 일 10,000건)를 아낀다.
  const res = await fetch(url, { next: { revalidate: 86_400 } });
  if (!res.ok) throw new Error(`철도공사 편의시설 조회 실패: HTTP ${res.status}`);
  return res.json();
}

/**
 * 역 이름으로 교통약자 편의시설을 가져온다.
 *
 * 장애("정보 없음")와 일시 장애를 구분한다(접근성 정본 원칙):
 * - **키 없음 / 미커버 역**(weekPerson 매칭 없음) → null(graceful → "정보 없음").
 * - **주(weekPerson) fetch·HTTP·파싱 실패**(=upstream 장애) → throw →
 *   라우트가 502, UI는 "조회 실패"로 표시(정보 없음으로 오인 금지).
 * - **보조(stationFacilities, 엘리베이터) 실패만** 개별 흡수 → 부분 결과
 *   (엘리베이터 undefined).
 */
export async function fetchStationFacilities(
  stationName: string,
): Promise<StationFacilities | null> {
  const key = env.DATA_GO_KR_API_KEY;
  if (!key) return null;
  const target = normalizeStationName(stationName);
  if (!target) return null;
  // 주 데이터(weekPerson)의 실패는 흡수하지 않고 전파한다 — 일시 장애를
  // "정보 없음"으로 뭉개면 접근성 정본이 거짓이 된다.
  const weekPersonRaw = await fetchList("weekPersonFacilities", key);
  // 엘리베이터(보조)는 실패해도 전체를 막지 않도록 개별 흡수.
  const stationRaw = await fetchList("stationFacilities", key).catch(() => null);
  return parseStationFacilities(weekPersonRaw, stationRaw, target);
}
