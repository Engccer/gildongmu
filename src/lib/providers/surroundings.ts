import { env } from "../env";
import { bearingDegrees, bearingToCompass8, haversineMeters } from "../geo/bearing";
import type { SurroundingCategory, SurroundingPlace } from "../types";

/**
 * 내 주변 둘러보기(기능 A) provider — 카카오 로컬 **카테고리 검색** 좌표 근접.
 *
 * 신규 API·게이트 없음(기존 KAKAO_REST_API_KEY). kids-places가 키워드+화이트리스트로
 * 거짓양성을 걸렀다면, 이쪽은 `category_group_code`로 검색 자체가 카테고리 정제돼
 * 노이즈가 적다. 신규 핵심은 두 좌표 간 **북 기준 8방위 방향**(bearing.ts) 산출 —
 * BlindSquare식 "어느 쪽에 뭐가 있나" 상시 인지.
 * 설계 `docs/superpowers/specs/2026-06-20-surroundings-awareness-design.md`.
 */

const ENDPOINT = "https://dapi.kakao.com/v2/local/search/category.json";
const RADIUS_METERS = 500; // 도보 즉시권 "둘러보기"
/** 서버 반환 상한 — 표시 절단(초기 10, "더 보기" +10)은 웹·iOS 클라이언트 몫(V1 소아 진료 동형). */
const SERVER_CAP = 50;

/** 카카오 category_group_code → 우리 카테고리. 여기 없는 코드는 거부(null). */
const CATEGORY_GROUPS: Record<string, SurroundingCategory> = {
  CS2: "convenience",
  SW8: "subway",
  FD6: "restaurant",
  CE7: "cafe",
  BK9: "bank",
  PM9: "pharmacy",
  HP8: "hospital",
  MT1: "mart",
  PO3: "public",
  AT4: "attraction",
};

export interface KakaoCatDoc {
  id: string;
  place_name: string;
  category_name: string;
  category_group_code: string;
  phone?: string;
  x: string;
  y: string;
  place_url?: string;
  distance?: string;
}

function numOrNaN(v: unknown): number {
  if (v == null) return NaN;
  const n = Number(String(v).trim());
  return Number.isFinite(n) ? n : NaN;
}

/** doc → SurroundingPlace. group code 미매핑 시 null(거짓양성 차단). */
export function normalizeSurroundingDoc(
  doc: KakaoCatDoc,
  userLat: number,
  userLng: number,
): SurroundingPlace | null {
  const category = CATEGORY_GROUPS[doc.category_group_code];
  if (!category) return null;
  const lat = Number(doc.y);
  const lng = Number(doc.x);
  const kakaoDist = numOrNaN(doc.distance);
  // distanceMeters는 항상 정수(m)로 통일 — 카카오 raw(문자열 정수)·haversine 폴백
  // 양쪽 모두 round해 필드 계약을 명확히 한다(표시는 formatDistance가 다시 round).
  const distanceMeters = Number.isNaN(kakaoDist)
    ? Math.round(haversineMeters(userLat, userLng, lat, lng))
    : Math.round(kakaoDist);
  const bearing = bearingToCompass8(bearingDegrees(userLat, userLng, lat, lng));
  return {
    id: `kakao-${doc.id}`,
    name: doc.place_name,
    category,
    categoryRaw: doc.category_name ?? "",
    distanceMeters,
    bearing,
    lat,
    lng,
    phone: doc.phone || undefined,
    link: doc.place_url || undefined,
  };
}

/** 여러 카테고리 응답 → dedupe(id)·거리순·cap. */
export function rankSurroundings(
  docLists: KakaoCatDoc[][],
  userLat: number,
  userLng: number,
  cap: number,
): SurroundingPlace[] {
  const byId = new Map<string, SurroundingPlace>();
  for (const list of docLists) {
    for (const doc of list) {
      const p = normalizeSurroundingDoc(doc, userLat, userLng);
      if (!p) continue;
      if (!byId.has(p.id)) byId.set(p.id, p);
    }
  }
  return [...byId.values()]
    .sort((a, b) => a.distanceMeters - b.distanceMeters)
    .slice(0, cap);
}

async function fetchKakaoCategory(
  code: string,
  lat: number,
  lng: number,
): Promise<KakaoCatDoc[]> {
  const url = new URL(ENDPOINT);
  url.searchParams.set("category_group_code", code);
  url.searchParams.set("x", String(lng));
  url.searchParams.set("y", String(lat));
  url.searchParams.set("radius", String(RADIUS_METERS));
  url.searchParams.set("sort", "distance");
  url.searchParams.set("size", "15");
  const res = await fetch(url, {
    headers: { Authorization: `KakaoAK ${env.KAKAO_REST_API_KEY}` },
    // 주변 시설은 분 단위로 생멸하지 않음 → 동일 좌표 재방문 시 카카오 호출 절감
    // (kids-places 300초 좌표-키 캐시 동형, 버스/지하철 no-store와 구분).
    next: { revalidate: 300 },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`주변 검색 실패(${code}): HTTP ${res.status} ${body}`);
  }
  const data = (await res.json()) as { documents?: KakaoCatDoc[] };
  return Array.isArray(data?.documents) ? data.documents : [];
}

/**
 * 좌표 → 내 주변 시설(카테고리 8종 병렬 병합). 키 없으면 [].
 * 부분 실패 불변식(kids-places 동형): 일부 실패 보존, 전부 실패만 throw→502.
 */
export async function findSurroundingsNear(
  lat: number,
  lng: number,
): Promise<SurroundingPlace[]> {
  if (!env.KAKAO_REST_API_KEY) return [];
  const codes = Object.keys(CATEGORY_GROUPS);
  const settled = await Promise.allSettled(
    codes.map((c) => fetchKakaoCategory(c, lat, lng)),
  );
  const lists: KakaoCatDoc[][] = [];
  let anyFulfilled = false;
  for (const s of settled) {
    if (s.status === "fulfilled") {
      anyFulfilled = true;
      lists.push(s.value);
    }
  }
  if (!anyFulfilled) {
    const firstRej = settled.find(
      (s): s is PromiseRejectedResult => s.status === "rejected",
    );
    throw new Error(`주변 조회 실패: ${firstRej?.reason ?? "모든 카테고리 실패"}`);
  }
  return rankSurroundings(lists, lat, lng, SERVER_CAP);
}
