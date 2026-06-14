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

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function stnName(item: RawItem): string {
  return typeof item.stn_nm === "string" ? item.stn_nm : "";
}

/** 정규화된 타깃 역명과 일치하는 item을 목록에서 찾는다. */
function findByName(items: RawItem[], target: string): RawItem | null {
  return items.find((it) => normalizeStationName(stnName(it)) === target) ?? null;
}

/**
 * 두 엔드포인트 응답을 역명으로 조인해 StationFacilities로 정규화한다.
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

  const station = findByName(parseStationItems(stationRaw), normalizedName);
  const elevatorRaw = station?.elevt_cnt;

  return {
    stationName: stnName(person) || stnName(station ?? {}) || normalizedName,
    accessibleToilet: yn(person.pwdbs_tolt_estnc),
    wheelchairLifts: num(person.whlch_liftt_cnt),
    accessibleSlope: yn(person.pwdbs_slwy_estnc),
    elevators: elevatorRaw != null ? num(elevatorRaw) : undefined,
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
 * 키 없음·실패·미커버 역은 모두 null(graceful) — 가짜 데이터 금지.
 */
export async function fetchStationFacilities(
  stationName: string,
): Promise<StationFacilities | null> {
  const key = env.DATA_GO_KR_API_KEY;
  if (!key) return null;
  const target = normalizeStationName(stationName);
  if (!target) return null;
  try {
    const [weekPersonRaw, stationRaw] = await Promise.all([
      fetchList("weekPersonFacilities", key),
      // 엘리베이터(보조)는 실패해도 전체를 막지 않도록 개별 흡수
      fetchList("stationFacilities", key).catch(() => null),
    ]);
    return parseStationFacilities(weekPersonRaw, stationRaw, target);
  } catch {
    return null;
  }
}
