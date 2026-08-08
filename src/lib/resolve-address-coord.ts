import type { AddressMatch } from "./types";

/**
 * 주소 문자열 → 좌표. 홈 검색(`PlaceSearch`)과 길찾기 검색(`DirectionsView`)에
 * **복붙 2벌**로 존재하던 로직의 단일 정본이다. 수동 위치 선택기가 세 번째
 * 소비자가 되므로 여기서 합친다.
 *
 * ⚠ 오류 계약까지 공용화한다. upstream 502를 빈 배열로 정규화하면 사용자가
 * 서비스 실패인데도 "검색 결과가 없습니다"를 듣는다.
 */
export type AddressResolution =
  | { kind: "resolved"; lat: number; lng: number }
  | { kind: "empty" }
  | { kind: "failed" }
  | { kind: "invalid" };

export async function resolveAddressCoord(
  roadAddr: string,
  signal?: AbortSignal,
): Promise<AddressResolution> {
  const query = roadAddr.trim();
  if (!query) return { kind: "invalid" };

  try {
    const res = await fetch(
      `/api/geocode?query=${encodeURIComponent(query)}&limit=1`,
      { signal },
    );
    if (!res.ok) return { kind: "failed" };
    const data = (await res.json()) as { matches?: AddressMatch[] };
    const first = data.matches?.[0];
    if (!first) return { kind: "empty" };
    return { kind: "resolved", lat: first.lat, lng: first.lng };
  } catch {
    return { kind: "failed" };
  }
}
