import type { BarrierFreePlace, BarrierFreeDetail, BarrierFreeFacility } from "../types";
import { env } from "../env";
import { haversineMeters } from "../geo";

/**
 * 한국관광공사 무장애 여행 정보 provider — B551011/KorWithService2.
 *
 * 장애유형별 무장애 편의시설(휠체어·장애인화장실·점자블록·음성안내 등)을 제공.
 * tour-api.ts(KorService2)와 키·envelope·좌표 규약 동일(serviceKey=TOUR_API_KEY,
 * mapx=경도/mapy=위도, 빈결과 items:"").
 *
 * ⚠ 필드 철자는 활용신청 승인 후 실호출로 확정(Task 6) — 한국 공공 API는 철자가
 * 비표준(braile 단철자 등)이라, 화이트리스트 키 중 값이 비어있지 않은 것만 라벨링해
 * 철자 불확실성에 강건하게 둔다(틀린 키는 조용히 누락, 오정보 노출 없음).
 *
 * 3-state: 값 있음(노출)/빈 값(제외)/조회 실패(throw→502).
 */

const BASE = "https://apis.data.go.kr/B551011/KorWithService2";
const MAX_DISTANCE_METERS = 3000; // 관광지 — 도보권보다 넓게
const TOP_N = 8;
const MATCH_RADIUS_METERS = 50; // 장소 상세 매칭 — 좁게(false positive 차단)

/** 무장애 편의시설 필드 화이트리스트 → 한글 라벨. ⚠ Task 6에서 실응답으로 교정. */
export const BARRIER_FREE_FIELD_LABELS: Record<string, string> = {
  // 지체/공통
  wheelchair: "휠체어 대여",
  restroom: "장애인 화장실",
  elevator: "엘리베이터",
  parking: "장애인 주차장",
  route: "주출입구 접근로",
  exit: "출입문",
  publictransport: "대중교통",
  // 시각
  braileblock: "점자블록",
  audioguide: "음성안내",
  braileguide: "점자 안내책자",
  guidehuman: "안내요원",
  helpdog: "보조견 동반",
  bigprint: "큰글씨 자료",
  guidesystem: "음성안내 시스템",
  // 청각
  signguide: "수어 안내",
  videoguide: "자막 영상안내",
  hearinghandicapetc: "청각장애 편의(기타)",
  // 영유아
  lactationroom: "수유실",
  stroller: "유모차 대여",
  babysparechair: "유아용 의자",
};

function str(v: unknown): string {
  return v == null ? "" : String(v).trim();
}
function numF(v: unknown): number {
  if (v == null || (typeof v === "string" && v.trim() === "")) return NaN;
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
}

/** data.go.kr JSON: items.item 은 단일 객체/배열/빈문자열. 안전 추출(night-clinic 동형). */
export function extractTourItems(raw: unknown): Record<string, unknown>[] {
  const items = (raw as { response?: { body?: { items?: unknown } } })?.response?.body?.items;
  if (!items || typeof items === "string") return [];
  const item = (items as { item?: unknown }).item;
  if (item == null) return [];
  return Array.isArray(item)
    ? (item as Record<string, unknown>[])
    : [item as Record<string, unknown>];
}

function resultCode(raw: unknown): string | null {
  const c = (raw as { response?: { header?: { resultCode?: unknown } } })?.response?.header
    ?.resultCode;
  return c != null ? String(c) : null;
}

/** 화이트리스트 키 중 값이 비어있지 않은 것만 → 라벨링된 편의시설 목록. */
export function labelFacilities(item: Record<string, unknown>): BarrierFreeFacility[] {
  const out: BarrierFreeFacility[] = [];
  for (const [key, label] of Object.entries(BARRIER_FREE_FIELD_LABELS)) {
    const value = str(item[key]);
    if (value) out.push({ key, label, value });
  }
  return out;
}

function normalizePlace(item: Record<string, unknown>, originLat: number, originLng: number): BarrierFreePlace | null {
  const lat = numF(item.mapy);
  const lng = numF(item.mapx);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const name = str(item.title);
  if (!name) return null;
  return {
    contentId: str(item.contentid),
    name,
    category: "", // contenttypeid 라벨은 Task 1 비범위(빈 문자열) — 필요 시 후속
    address: [str(item.addr1), str(item.addr2)].filter(Boolean).join(" "),
    lat,
    lng,
    distanceMeters: Math.round(haversineMeters(originLat, originLng, lat, lng)),
  };
}

async function callKorWith(operation: string, params: Record<string, string>): Promise<unknown> {
  const url = new URL(`${BASE}/${operation}`);
  url.searchParams.set("serviceKey", env.TOUR_API_KEY ?? "");
  url.searchParams.set("MobileOS", "WEB");
  url.searchParams.set("MobileApp", "gildongmu");
  url.searchParams.set("_type", "json");
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url, { next: { revalidate: 86_400 } });
  if (!res.ok) throw new Error(`무장애 여행 정보 조회 실패: HTTP ${res.status}`);
  const raw = await res.json();
  const code = resultCode(raw);
  if (code !== "0000") throw new Error(`무장애 여행 정보 비정상 응답: resultCode ${code}`);
  return raw;
}

/** 좌표 → 반경 내 무장애 관광지 상위 N(거리순). 키 없으면 빈 배열. */
export async function searchBarrierFreeNearby(
  lat: number,
  lng: number,
  opts: { radiusMeters?: number; limit?: number } = {},
): Promise<BarrierFreePlace[]> {
  if (!env.TOUR_API_KEY) return [];
  const radius = opts.radiusMeters ?? MAX_DISTANCE_METERS;
  const limit = opts.limit ?? TOP_N;
  const raw = await callKorWith("locationBasedList2", {
    mapX: String(lng),
    mapY: String(lat),
    radius: String(radius),
    arrange: "E", // 거리순
    numOfRows: String(limit),
  });
  return extractTourItems(raw)
    .map((it) => normalizePlace(it, lat, lng))
    .filter((p): p is BarrierFreePlace => p !== null)
    .sort((a, b) => a.distanceMeters - b.distanceMeters) // dist 신뢰 대신 코드 정렬
    .slice(0, limit);
}

/** contentId → 무장애 편의시설 상세(값 있는 항목만). 항목 자체가 없으면 null. */
export async function getBarrierFreeDetail(contentId: string): Promise<BarrierFreeDetail | null> {
  if (!env.TOUR_API_KEY || !contentId) return null;
  const raw = await callKorWith("detailWithTour2", { contentId });
  const items = extractTourItems(raw);
  if (items.length === 0) return null;
  const item = items[0];
  return {
    contentId,
    name: str(item.title),
    facilities: labelFacilities(item),
  };
}

/** 좌표 50m ∩ 이름 일치 시에만 detail. false positive 차단. 매칭 실패 null. */
export async function matchBarrierFreePlace(args: {
  lat: number;
  lng: number;
  name: string;
}): Promise<BarrierFreeDetail | null> {
  if (!env.TOUR_API_KEY) return null;
  const near = await searchBarrierFreeNearby(args.lat, args.lng, {
    radiusMeters: MATCH_RADIUS_METERS,
    limit: 10,
  });
  const target = normalizeName(args.name);
  const matched = near.find((p) => normalizeName(p.name) === target);
  if (!matched) return null;
  return getBarrierFreeDetail(matched.contentId);
}

/** 공백·괄호·흔한 지점 접미 제거 후 비교(보수적 동일성). */
export function normalizeName(name: string): string {
  return name
    .replace(/\(.*?\)/g, "")
    .replace(/\s+/g, "")
    .replace(/(본점|점|지점)$/u, "")
    .toLowerCase();
}
