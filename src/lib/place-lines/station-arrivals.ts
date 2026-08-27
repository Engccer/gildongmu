/**
 * 실시간 도착 열차(`SubwayArrivalList` 컴포넌트) 항목 조립 — 두 줄(편성/메시지)이 화면과 동일.
 */
import { joinText } from "../format";
import type { SubwayArrival } from "../types";
import type { TranslateFn } from "./translate";

export interface ArrivalItem {
  /** 편성 줄: 노선 방향, 행선 안내, 급행(있을 때) */
  line: string;
  direction: string;
  /** 메시지 줄: arvlMsg2 완성 문장 + 현재 위치(있을 때) */
  message: string;
  /** 도착 항목이 있다는 것 자체가 ok — 역 단위 4-state는 상위 봉투가 든다 */
  state: { kind: "ok" };
}

export function arrivalItems(arrivals: SubwayArrival[], t: TranslateFn): ArrivalItem[] {
  return arrivals.map((a) => ({
    line: joinText(
      `${a.line ? `${a.line} ` : ""}${a.direction}`,
      a.trainLineNm,
      a.express && t("express"),
    ),
    direction: a.direction,
    message: joinText(
      a.message,
      a.currentLocation && t("currentLocation", { location: a.currentLocation }),
    ),
    state: { kind: "ok" },
  }));
}
