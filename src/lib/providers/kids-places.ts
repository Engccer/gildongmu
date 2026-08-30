import { env } from "../env";
import type { IndoorOutdoor, KidsPlace, KidsPlaceKind } from "../types";
import { romanNameOf } from "../romanize";

/**
 * 근처 아이 놀 곳(B3) provider — 카카오 로컬 키워드 검색 좌표 근접.
 *
 * 신규 API·게이트 없음. 기존 `KAKAO_REST_API_KEY`로 키워드 검색에 x/y/radius/
 * sort=distance를 더해 좌표 근접 검색. 설계 `docs/.../2026-06-18-kids-places-design.md`.
 *
 * ⚠ 핵심 불변식 — **키워드 매칭 ≠ 키즈 장소**:
 * "놀이터" 키워드 검색에 스킨스쿠버·노인복지시설·동우회·방탈출카페·당구장이 섞여
 * 나온다(실호출 검증). 시각장애인은 화면으로 노이즈를 못 거르므로, 키워드 신뢰가
 * 아니라 **category_name 계층 화이트리스트**(`classifyKidsPlace`)가 정본이다.
 *
 * 실내/실외는 3-state: 키즈카페=실내·공원=실외·놀이터=모호(이름 신호 없으면 unknown).
 * 잘못된 단정 금지(B1·B2 unknown 교훈). 거리는 카카오 `distance`(m) 정본.
 */

const ENDPOINT = "https://dapi.kakao.com/v2/local/search/keyword.json";
const KEYWORDS = ["키즈카페", "놀이터", "어린이공원"] as const;
const RADIUS_METERS = 2000; // 도보권 "근처"
/** 서버 반환 상한 — 표시 절단(초기 10, "더 보기" +10)은 웹·iOS 클라이언트 몫(V1 소아 진료 동형). */
const SERVER_CAP = 50;

interface KakaoDoc {
  id: string;
  place_name: string;
  category_name: string;
  address_name?: string;
  road_address_name?: string;
  phone?: string;
  x: string; // 경도(WGS84)
  y: string; // 위도(WGS84)
  place_url?: string;
  distance?: string; // x/y 제공 시 채워짐(m)
}

function numOrZero(v: unknown): number {
  if (v == null) return 0;
  const n = Number(String(v).trim());
  return Number.isFinite(n) ? n : 0;
}

interface KidsClassification {
  accept: boolean;
  kind: KidsPlaceKind | null;
  indoorOutdoor: IndoorOutdoor;
}

/**
 * 카카오 category_name 계층 + 장소명으로 키즈 장소 여부·종류·실내외를 결정적 분류.
 * 화이트리스트에 안 걸리면 거부(거짓양성 차단). 순수 함수.
 */
export function classifyKidsPlace(
  categoryName: string,
  placeName: string,
): KidsClassification {
  const cat = categoryName ?? "";
  const name = placeName ?? "";

  let kind: KidsPlaceKind | null = null;
  if (cat.includes("유아 > 놀이시설")) {
    kind = cat.includes("키즈카페") ? "kidscafe" : "playground";
  } else if (cat.includes("유아교육 > 놀이교육")) {
    kind = "playcenter"; // 유아교육 > 놀이교육(플레이타임 등 실내 놀이센터)
    // ⚠ "놀이교육" 단독 substring이 아니라 "유아교육 > 놀이교육" 계층으로 앵커링 —
    // 가상의 "학원 > 놀이교육학원" 등 비-유아 taxonomy 오통과 방지(설계 I1 정합).
  } else if (cat.includes("공원") && /어린이|놀이|유아/.test(name)) {
    kind = "park"; // 일반 근린공원 유입 차단 — 이름 키즈 신호 결합
  }

  if (!kind) return { accept: false, kind: null, indoorOutdoor: "unknown" };
  return { accept: true, kind, indoorOutdoor: deriveIndoorOutdoor(kind, name) };
}

/** 종류·이름으로 실내/실외 추정. 놀이터만 모호 → 이름 신호 없으면 unknown. */
function deriveIndoorOutdoor(kind: KidsPlaceKind, name: string): IndoorOutdoor {
  if (kind === "kidscafe" || kind === "playcenter") return "indoor";
  if (kind === "park") return "outdoor";
  // playground(유아>놀이시설>놀이터)는 실내/실외 양쪽 가능 — 이름 신호로만.
  if (name.includes("실내")) return "indoor";
  if (/공원|자연|산|광장/.test(name)) return "outdoor";
  return "unknown";
}

/** 카카오 doc → KidsPlace. 화이트리스트 거부 시 null(거짓양성 제거). */
export function normalizeKidsDoc(doc: KakaoDoc): KidsPlace | null {
  const c = classifyKidsPlace(doc.category_name, doc.place_name);
  if (!c.accept || !c.kind) return null;
  return {
    id: `kakao-${doc.id}`,
    name: doc.place_name,
    nameRoman: romanNameOf(doc.place_name),
    category: doc.category_name,
    kind: c.kind,
    indoorOutdoor: c.indoorOutdoor,
    distanceMeters: numOrZero(doc.distance),
    address: doc.address_name ?? "",
    roadAddress: doc.road_address_name || undefined,
    lat: Number(doc.y),
    lng: Number(doc.x),
    phone: doc.phone || undefined,
    link: doc.place_url || undefined,
  };
}

/**
 * 여러 키워드 응답 doc 리스트 → 키즈 장소만 dedupe·거리 재정렬·상위 cap.
 * - 카카오 id로 dedupe(같은 장소가 여러 키워드 교집합).
 * - accept 필터(normalizeKidsDoc가 null 반환분 제거).
 * - 거리 오름차순 재정렬(쿼리별 정렬이 병합 후 깨지므로) → 상위 cap.
 */
export function rankKidsPlaces(docLists: KakaoDoc[][], cap: number): KidsPlace[] {
  const byId = new Map<string, KidsPlace>();
  for (const list of docLists) {
    for (const doc of list) {
      const k = normalizeKidsDoc(doc);
      if (!k) continue;
      if (!byId.has(k.id)) byId.set(k.id, k);
    }
  }
  return [...byId.values()]
    .sort((a, b) => a.distanceMeters - b.distanceMeters)
    .slice(0, cap);
}

/** 키워드 1종 좌표 근접 검색 → doc 배열. !ok → throw(상위 allSettled가 부분실패 흡수). */
async function fetchKakaoKeyword(
  query: string,
  lat: number,
  lng: number,
  radiusMeters: number,
): Promise<KakaoDoc[]> {
  const url = new URL(ENDPOINT);
  url.searchParams.set("query", query);
  url.searchParams.set("x", String(lng));
  url.searchParams.set("y", String(lat));
  url.searchParams.set("radius", String(radiusMeters));
  url.searchParams.set("sort", "distance");
  url.searchParams.set("size", "15");

  const res = await fetch(url, {
    headers: { Authorization: `KakaoAK ${env.KAKAO_REST_API_KEY}` },
    // 키즈 장소는 분 단위로 생기고 사라지지 않으므로 같은 좌표 재방문 시 카카오
    // 호출을 줄이는 300초 좌표-키 캐시(라우트는 force-dynamic이라 매 요청 평가되지만
    // 동일 좌표는 이 fetch 캐시가 흡수). 실시간성이 필요한 버스/지하철의 no-store와 구분.
    next: { revalidate: 300 },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`키즈 장소 검색 실패(${query}): HTTP ${res.status} ${body}`);
  }
  const data = (await res.json()) as { documents?: KakaoDoc[] };
  return Array.isArray(data?.documents) ? data.documents : [];
}

/**
 * 좌표 → 근처 아이 놀 곳(키워드 3종 병렬 병합). 키 없으면 [].
 *
 * 부분 실패 불변식(subway-nearby 동형): `Promise.allSettled`로 일부 키워드가
 * 실패해도 나머지 실데이터 보존. **전부 실패해야 throw → 502**("조회 실패"와
 * "근처에 없음"을 뭉개지 않는다). 빈 결과 → [](graceful).
 */
export async function findKidsPlacesNear(
  lat: number,
  lng: number,
  opts: { radiusMeters?: number } = {},
): Promise<KidsPlace[]> {
  if (!env.KAKAO_REST_API_KEY) return [];
  // 반경 옵션은 "한눈에 보기"(nearby-overview, 공통 1km)용. 미지정이면 현행 2km 유지.
  const radius = opts.radiusMeters ?? RADIUS_METERS;

  const settled = await Promise.allSettled(
    KEYWORDS.map((q) => fetchKakaoKeyword(q, lat, lng, radius)),
  );

  const lists: KakaoDoc[][] = [];
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
    throw new Error(
      `키즈 장소 조회 실패: ${firstRej?.reason ?? "모든 키워드 실패"}`,
    );
  }
  return rankKidsPlaces(lists, SERVER_CAP);
}
