import { env } from "../env";
import type { AddressMatch, Coord } from "../types";

/**
 * 카카오 로컬 주소 API provider — 주소→좌표(지오코딩), 좌표→주소(역지오코딩).
 *
 * 두 엔드포인트 모두 카카오맵(OPEN_MAP_AND_LOCAL) 제품에 포함되어
 * 키워드 검색과 같은 REST 키·같은 활성화로 동작한다 (2026-06-12 실호출 검증).
 *
 * - 주소 검색: https://dapi.kakao.com/v2/local/search/address.json
 * - 좌표→주소: https://dapi.kakao.com/v2/local/geo/coord2address.json
 *   (x=경도, y=위도 — 카카오는 x/y 순서이므로 이 파일 밖으로 새지 않게 한다)
 */

const ADDRESS_ENDPOINT = "https://dapi.kakao.com/v2/local/search/address.json";
const COORD2ADDRESS_ENDPOINT =
  "https://dapi.kakao.com/v2/local/geo/coord2address.json";

interface KakaoAddressDocument {
  address_name: string;
  address_type: "REGION" | "ROAD" | "REGION_ADDR" | "ROAD_ADDR";
  /** 경도 */
  x: string;
  /** 위도 */
  y: string;
  address: {
    address_name: string;
  } | null;
  road_address: {
    address_name: string;
    building_name: string;
    zone_no: string;
  } | null;
}

interface KakaoCoord2AddressDocument {
  road_address: { address_name: string; building_name: string } | null;
  address: { address_name: string } | null;
}

export function normalizeAddressDocument(
  doc: KakaoAddressDocument,
): AddressMatch {
  return {
    addressName: doc.address_name,
    roadAddress: doc.road_address?.address_name || undefined,
    jibunAddress: doc.address?.address_name || undefined,
    postalCode: doc.road_address?.zone_no || undefined,
    lat: Number(doc.y),
    lng: Number(doc.x),
  };
}

/** 주소 문자열 → 좌표 (지오코딩). 매칭 없으면 빈 배열. */
export async function searchAddress(
  query: string,
  limit = 5,
): Promise<AddressMatch[]> {
  const url = new URL(ADDRESS_ENDPOINT);
  url.searchParams.set("query", query);
  url.searchParams.set("size", String(Math.min(limit, 30)));

  const res = await fetch(url, {
    headers: { Authorization: `KakaoAK ${env.KAKAO_REST_API_KEY}` },
    next: { revalidate: 3600 },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`카카오 주소 검색 실패: HTTP ${res.status} ${body}`);
  }

  const data = (await res.json()) as { documents: KakaoAddressDocument[] };
  return data.documents.map(normalizeAddressDocument);
}

/** 좌표 → 주소 (역지오코딩). 도로명 우선, 없으면 지번. 둘 다 없으면 null. */
export async function coordToAddress(coord: Coord): Promise<{
  roadAddress?: string;
  jibunAddress?: string;
  /** 낭독/표시용 대표 문자열 (도로명 우선) */
  display: string;
} | null> {
  const url = new URL(COORD2ADDRESS_ENDPOINT);
  url.searchParams.set("x", String(coord.lng));
  url.searchParams.set("y", String(coord.lat));

  const res = await fetch(url, {
    headers: { Authorization: `KakaoAK ${env.KAKAO_REST_API_KEY}` },
    next: { revalidate: 3600 },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`카카오 좌표→주소 변환 실패: HTTP ${res.status} ${body}`);
  }

  const data = (await res.json()) as {
    documents: KakaoCoord2AddressDocument[];
  };
  const doc = data.documents[0];
  if (!doc) return null;

  const roadAddress = doc.road_address?.address_name || undefined;
  const jibunAddress = doc.address?.address_name || undefined;
  const display = roadAddress ?? jibunAddress;
  if (!display) return null;
  return { roadAddress, jibunAddress, display };
}

const COORD2REGION_ENDPOINT =
  "https://dapi.kakao.com/v2/local/geo/coord2regioncode.json";

export interface KakaoRegionDocument {
  /** "H"=행정동, "B"=법정동 */
  region_type: "H" | "B";
  /** "서울특별시 강동구 길동" */
  address_name: string;
  /** 시도. 예 "강원특별자치도"·"전남광주통합특별시" */
  region_1depth_name?: string;
  /** 시군구. 예 "강릉시"·"수원시 영통구". 세종은 빈 문자열 */
  region_2depth_name?: string;
}

/** 행정동(H) 우선, 없으면 법정동(B) 첫 항목, 없으면 null. */
export function pickRegionDocument(
  docs: KakaoRegionDocument[],
): KakaoRegionDocument | null {
  return (
    docs.find((d) => d.region_type === "H") ?? docs[0] ?? null
  );
}

/** 좌표 → 행정동 표시 문자열(예 "서울특별시 강동구 길동"). 없으면 null. */
export async function coordToRegion(coord: Coord): Promise<string | null> {
  const url = new URL(COORD2REGION_ENDPOINT);
  url.searchParams.set("x", String(coord.lng));
  url.searchParams.set("y", String(coord.lat));

  const res = await fetch(url, {
    headers: { Authorization: `KakaoAK ${env.KAKAO_REST_API_KEY}` },
    next: { revalidate: 3600 },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`카카오 좌표→행정동 변환 실패: HTTP ${res.status} ${body}`);
  }
  const data = (await res.json()) as { documents: KakaoRegionDocument[] };
  const doc = pickRegionDocument(data.documents ?? []);
  return doc?.address_name || null;
}

/** 좌표 → 시도·시군구 이름. 커버리지 판정용이라 표시 문자열이 아니라 조각으로 준다. */
export interface RegionNames {
  /** 시도. 예 "강원특별자치도" */
  province: string;
  /** 시군구. 예 "강릉시"·"수원시 영통구". 세종은 빈 문자열 */
  city: string;
}

/**
 * 좌표 → 시도·시군구 이름. 판정 불가는 null(throw하지 않는다: 부가 판정 때문에
 * 정류소 화면이 죽으면 안 된다. 호출부가 null을 "판정 못 함"으로 다룬다).
 *
 * ⚠ `coordToRegion`(표시 문자열)과 나누어 둔 이유: 표시 문자열을 공백으로 쪼개 쓰면
 * `수원시 영통구 매탄동`처럼 토큰 수가 지역마다 달라 조용히 어긋난다.
 */
export async function coordToRegionNames(coord: Coord): Promise<RegionNames | null> {
  const url = new URL(COORD2REGION_ENDPOINT);
  url.searchParams.set("x", String(coord.lng));
  url.searchParams.set("y", String(coord.lat));

  const res = await fetch(url, {
    headers: { Authorization: `KakaoAK ${env.KAKAO_REST_API_KEY}` },
    next: { revalidate: 3600 },
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { documents: KakaoRegionDocument[] };
  const doc = pickRegionDocument(data.documents ?? []);
  const province = doc?.region_1depth_name;
  if (!province) return null;
  return { province, city: doc.region_2depth_name ?? "" };
}
