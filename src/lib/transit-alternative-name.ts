import type { TransitRoute } from "./types";

/**
 * 대안 경로의 표시 이름 키(spec §4.1). 서버가 준 축(`highlight`)과 표시 번호
 * (`displayIndex`)를 문구 키로 옮기기만 한다. 판정은 전부 서버가 끝냈다.
 *
 * disclosure 라벨·안내 시작 버튼·스크린 리더 로터가 같은 이름을 써야 하므로
 * 산출을 한 곳에 모은다.
 * ⚠ 대안 disclosure는 길찾기 뷰(DirectionsView)와 채팅 카드(TransitRouteBriefing)
 *   두 곳에 있다. 이 함수를 공유하지 않으면 두 화면의 이름이 갈린다.
 */
export function alternativeNameKey(route: TransitRoute): {
  key: string;
  values: Record<string, string | number>;
} {
  const h = route.highlight ?? [];
  const fast = h.includes("fastest");
  const few = h.includes("fewestTransfers");
  if (fast && few) return { key: "alternativeFastestFewestTransfers", values: {} };
  if (few) return { key: "alternativeFewestTransfers", values: {} };
  if (fast) return { key: "alternativeFastest", values: {} };
  return { key: "alternativeHeading", values: { index: route.displayIndex ?? 1 } };
}
