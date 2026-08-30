/**
 * 실시간 도착 열차(`SubwayArrivalList` 컴포넌트) 항목 조립 — 두 줄(편성/메시지)이 화면과 동일.
 *
 * en 계열 로케일은 서버 영문 필드(`*En`, E27)로 줄을 만들되 **줄 단위 원자성**(`pickLine`)을 지킨다 —
 * 편성 줄은 노선·방향·행선 셋이 다 영문일 때만, 메시지 줄은 문장(+현재역이 있으면 그 영문까지)이
 * 있을 때만 영어이고, 아니면 그 줄 전체가 한국어 원문(`lang: "ko"`)이다.
 */
import { joinText } from "../format";
import type { SubwayArrival } from "../types";
import { pickLine } from "./pick-line";
import type { TranslateFn } from "./translate";

export interface ArrivalItem {
  /** 편성 줄: 노선 방향, 행선 안내, 급행(있을 때) */
  line: string;
  /** 편성 줄 언어 태그(한국어 폴백 `ko`, 비-en 로케일의 영어 줄 `en`, 그 외 없음) */
  lineLang?: "ko" | "en";
  direction: string;
  /** 메시지 줄: arvlMsg2 완성 문장 + 현재 위치(있을 때) */
  message: string;
  messageLang?: "ko" | "en";
  /** 도착 항목이 있다는 것 자체가 ok — 역 단위 4-state는 상위 봉투가 든다 */
  state: { kind: "ok" };
}

export function arrivalItems(
  arrivals: SubwayArrival[],
  t: TranslateFn,
  locale: string = "ko",
): ArrivalItem[] {
  return arrivals.map((a) => {
    const express = a.express ? t("express") : undefined;
    const lineKo = joinText(`${a.line ? `${a.line} ` : ""}${a.direction}`, a.trainLineNm, express);
    // 노선 미매핑(`line` 부재)은 ko도 방향만 쓴다 — en은 그 자리를 빈 조각으로 두면 원자성에 걸리므로
    // "노선 없음"을 영문 줄에서도 허용한다(`lineEn`은 `line`이 있을 때만 요구).
    const line = pickLine(
      locale,
      lineKo,
      [a.line ? a.lineEn : "", a.directionEn, a.trainLineNmEn],
      ([lineEn, dir, train]) => joinText(`${lineEn ? `${lineEn} ` : ""}${dir}`, train, express),
    );
    const messageKo = joinText(
      a.message,
      a.currentLocation && t("currentLocation", { location: a.currentLocation }),
    );
    const message = pickLine(
      locale,
      messageKo,
      [a.messageEn, a.currentLocation ? a.currentLocationEn : ""],
      ([msg, loc]) => joinText(msg, loc && t("currentLocation", { location: loc })),
      // 현재역 문장은 UI 템플릿(`Now at {location}`)이라 혼합 줄 — 태그하지 않는다
      { pure: !a.currentLocation },
    );
    return {
      line: line.text,
      ...(line.lang ? { lineLang: line.lang } : {}),
      direction: a.direction,
      message: message.text,
      ...(message.lang ? { messageLang: message.lang } : {}),
      state: { kind: "ok" },
    };
  });
}
