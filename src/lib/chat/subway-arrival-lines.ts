/**
 * 채팅 도구 `get_subway_arrivals`가 LLM에 넘기는 도착 열차 투영(A42).
 *
 * 카드(`SubwayArrivalList`)와 **같은 함수**(`arrivalItems`, E37)로 두 줄(편성·메시지)을 만들어
 * 그것만 싣는다 — 한 답변 안에서 카드는 우리 문장, 산문은 서울시 원문(`[8]번째 전역 (구로)`)으로
 * 같은 열차를 두 표기로 말하던 것을 하나로 모은다. 못 알아본 문장은 E37 규칙대로 원문(+A32 꼬리)이다.
 *
 * 원재료 필드(`message` 원문·`messageEn`·`currentLocation*`·`arrivalSeconds`·`arrivalCode`·`trainNo`)는
 * 싣지 않는다. E37 불변식이 화면에서 지키는 것을 LLM이 우회하지 않게 하기 위해서다 — `barvlDt`는
 * 비시간형 행에도 비0으로 와서(I1) "20분 후"를 지어내게 하고, 위치를 말하지 않는 문법의 `arvlMsg3`(I2)는
 * 열차 위치로 읽힌다.
 *
 * 문장 언어는 데이터 로케일(ko|en)이다 — 비-ko 세션은 영문 데이터(`*En`, E27)를 받아야 영문 문장이 선다.
 */
// React 비의존(src/lib/chat 계약) — next-intl 루트가 아니라 그 코어(use-intl/core)에서 번역기만 가져온다.
import { createTranslator } from "use-intl/core";
import ko from "../../../messages/ko.json";
import en from "../../../messages/en.json";
import { arrivalItems } from "../place-lines/station-arrivals";
import type { TranslateFn } from "../place-lines/translate";
import type { SubwayArrival } from "../types";

export interface ChatArrivalLine {
  /** 편성 줄: 노선 방향, 행선 안내, 급행(있을 때) — 카드 첫 줄과 같은 문자열 */
  line: string;
  /** 메시지 줄: 우리 문장(E37) 또는 못 알아본 원문 — 카드 둘째 줄과 같은 문자열 */
  message: string;
}

const translators: Record<"ko" | "en", TranslateFn> = {
  ko: createTranslator({ locale: "ko", messages: ko, namespace: "subwayArrival" }) as unknown as TranslateFn,
  en: createTranslator({ locale: "en", messages: en, namespace: "subwayArrival" }) as unknown as TranslateFn,
};

export function chatArrivalLines(arrivals: SubwayArrival[], dataLocale: "ko" | "en"): ChatArrivalLine[] {
  return arrivalItems(arrivals, translators[dataLocale], dataLocale).map(({ line, message }) => ({ line, message }));
}
