import { chargeJourneyIp, journeyIpExhausted, journeyTmapExhausted, reserveJourneyTmap } from "../rate-limit";
import { getJourney, journeyDeps, type JourneyDeps, type JourneyOutcome, type JourneyRequest } from "./assemble";

/**
 * 여정 조회의 **하나뿐인 진입점**(E70-b D6): `/api/route/journey` 라우트와 채팅 도구 `plan_journey`가 함께 부른다.
 * 선판정(일 상한 소진 → IP 버킷 소진 → aboard 칸)과 `getJourney`의 Tmap 예약 콜백을 한 묶음으로 둬서, 복붙 진입점이
 * 하나만 누락하는 일을 막는다. 가드(`__tests__/query.test.ts`의 진입점 소스 가드)가 `src/` 전체에서 `getJourney`·`reserveJourneyTmap`을 이 파일
 * 밖에서 부르지 못하게 잠근다.
 *
 * 불변식: 예약하지 않은 Tmap 호출 0, 소진 상태에서 유료 ODsay(`deps.candidates`)·카카오 호출 0.
 * 조회 실패는 throw(호출부가 502·오류 결과로 감싼다). 한도 거절은 `rateLimited`·`budgetExhausted`로 가른다.
 */
/**
 * 한도 선판정만(무기록) — 여정 조회에 앞서 무료·유료 보조 조회(장소·정류장 검색)를 하는 호출부가 소진 상태에서 그 조회까지
 * 내보내지 않게 먼저 부른다(E70-b 리뷰 S2). 통과해도 `queryJourney`가 같은 판정을 다시 한다.
 */
export function journeyBudgetPrecheck(ip: string): "ok" | "rateLimited" | "budgetExhausted" {
  if (journeyTmapExhausted(Date.now())) return "budgetExhausted";
  if (journeyIpExhausted(ip, Date.now())) return "rateLimited";
  return "ok";
}

export async function queryJourney(req: JourneyRequest, ip: string, deps: JourneyDeps = journeyDeps): Promise<JourneyOutcome> {
  // 인스턴스 일 상한이 이미 소진됐으면 유료 ODsay·카카오를 부르기 전에 거절한다(Tmap 예약 거절과 같은 결과).
  if (journeyTmapExhausted(Date.now())) return { kind: "budgetExhausted" };
  // 이 IP의 버킷이 이미 찼으면 유료 ODsay를 부르기 전에 거절한다(남은 칸이 이번 비용보다 모자란 경우는 예약이 가른다).
  if (journeyIpExhausted(ip, Date.now())) return { kind: "rateLimited" };
  // aboard는 Tmap을 0회 부르는 경우가 있어 Tmap 예약이 IP를 세지 못한다 — 유료 ODsay 상한이 사라지지 않게 요청 단위로 한 칸을 쓴다.
  if (req.board?.kind === "aboard" && !chargeJourneyIp(ip, Date.now())) return { kind: "rateLimited" };
  return getJourney(req, deps, (cost) => reserveJourneyTmap(ip, Date.now(), cost));
}
