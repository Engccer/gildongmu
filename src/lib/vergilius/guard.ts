/**
 * 모델이 낸 것을 앱에 보내기 전의 두 관문(E82 spec V21·V22). React/Next 비의존, 순수 함수.
 */
import type { RenderPayload, RouteStartRenderPayload } from "@/lib/chat/types";
import type { VergiliusAskRequest } from "./types";

/** 제안이 지목할 수 있는 가게 id: 요청의 `places[].id` ∪ `log[].placeId`(V22). */
export function proposableIds(req: Pick<VergiliusAskRequest, "places" | "log">): Set<string> {
  const ids = new Set<string>();
  for (const p of req.places) ids.add(p.id);
  for (const entry of req.log) if (entry.placeId) ids.add(entry.placeId);
  return ids;
}

/**
 * `propose_guide`의 인자를 검증한다. 요청에 있던 id면 그 id를, 아니면 null을 돌려준다(없는 id의 제안은 버린다 —
 * 모델이 좌표와 이름을 만들지 않게 하는 관문이다). 앞뒤 공백만 떼고 그 밖의 정규화는 하지 않는다.
 */
export function validateProposal(args: Record<string, unknown>, allowed: ReadonlySet<string>): string | null {
  const raw = args.placeId;
  if (typeof raw !== "string") return null;
  const id = raw.trim();
  return allowed.has(id) ? id : null;
}

/** 앱에 보내는 렌더는 `route-start`뿐이다(V21). 그 밖의 채팅 카드(장소 목록·버스 도착…)는 버린다. */
export function routeStartRendersOnly(renders: readonly RenderPayload[]): RouteStartRenderPayload[] {
  return renders.filter((r): r is RouteStartRenderPayload => r.type === "route-start");
}

/**
 * 도구 결과에서 좌표 키(`lat`·`lng`)를 뗀다(spec §4: 모델에게 주는 글에 좌표를 넣지 않는다). 채팅 실행부의 결과는 주변 정류소·
 * 장소의 좌표를 싣는데, 그 좌표들은 사용자 위치를 수십 m 안으로 좁힌다. 답에 쓰이는 값도 아니다(거리는 `distanceMeters`로 온다).
 * 앱에 가는 렌더(`route-start`)는 이 함수를 지나지 않는다.
 */
export function withoutCoordinates<T>(value: T): T {
  if (Array.isArray(value)) return value.map(withoutCoordinates) as T;
  if (value === null || typeof value !== "object") return value;
  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
    if (key === "lat" || key === "lng") continue;
    out[key] = withoutCoordinates(v);
  }
  return out as T;
}
