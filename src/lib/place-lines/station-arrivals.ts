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

/**
 * 도착 한 줄에 현재역 꼬리(`현재 {역}`)를 붙일 것인가(A32) — Kit `subwayShowsCurrentLocationTail` 미러.
 * 공유 fixture `src/lib/__tests__/fixtures/subway-arrival-tail-cases.json`이 두 구현을 한 표로 잠근다.
 *
 * 낭독 정본인 완성 문장(`arvlMsg2`)이 **이미 현재역을 담는 문법이 있다**(`6분 후 (강일)`·`강일 도착`).
 * 그 위에 꼬리를 또 이으면 한 접근성 객체 안에서 같은 역 이름이 두 번 낭독된다.
 *
 * ⚠ **판정 축은 값 포함이지 글자 패턴이 아니다** — 역 이름 자체에 괄호가 있어서
 * (`천호(풍납토성) 전역출발`) "괄호가 있으면 현재역이 들어 있다"는 규칙은 바로 어긋난다.
 * 알아보지 못하면 **붙이는 쪽**으로 실패한다(= 현행 동작, 정보 손실 0).
 *
 * ⚠ **언어마다 자기 값으로 판정한다.** 영문 문장은 괄호 현재역을 담지 않으므로
 * (`subway-arrival-en.ts`가 `currentLocationEn` 단일 채널로 뺀다 — E27 설계 리뷰 #5) 한국어 값으로
 * en을 판정하면 중복이 없는 줄에서 꼬리를 떼어 **en 사용자만 현재역을 잃는다**.
 */
export function subwayShowsCurrentLocationTail(
  message: string | undefined | null,
  currentLocation: string | undefined | null,
): boolean {
  const location = (currentLocation ?? "").trim();
  // 현재역이 애초에 없으면 붙일 것도 없다("정보 없음"이지 중복이 아니다).
  if (!location) return false;
  // 문장은 trim하지 않는다 — 찾는 값의 양끝 공백이 이미 없어 문장 양끝을 다듬어도 포함 여부가
  // 바뀌지 않는데, 두 언어의 trim 문자 집합이 다르다는 발산 표면만 들어온다.
  return !(message ?? "").includes(location);
}

export function arrivalItems(
  arrivals: SubwayArrival[],
  t: TranslateFn,
  locale: string = "ko",
): ArrivalItem[] {
  return arrivals.map((a) => {
    const express = a.express ? t("express") : undefined;
    const lineKo = joinText(`${a.line ? `${a.line} ` : ""}${a.direction}`, a.trainLineNm, express);
    // 노선 미매핑(`line` 부재)은 ko도 방향만 쓴다 — 그 자리는 `""`(자리 표시)라 영문 요구 대상이 아니다
    // (`lineEn`은 `line`이 있을 때만 결측으로 본다). 현재역도 같다.
    const line = pickLine(
      locale,
      lineKo,
      [a.line ? a.lineEn : "", a.directionEn, a.trainLineNmEn],
      ([lineEn, dir, train]) => joinText(`${lineEn ? `${lineEn} ` : ""}${dir}`, train, express),
    );
    // 꼬리 판정(A32)은 그 줄에 실제로 쓰는 값으로 한다 — ko는 원문, en은 영문.
    // ⚠ **판정에 먹이는 값이 곧 렌더되는 값이어야 한다.** 영문 자리는 ko에 현재역이 없으면 `""`(자리
    // 표시)로 접히므로, 판정에 `a.currentLocationEn`을 그대로 주면 "붙일 자격은 있는데 붙일 값이 없는"
    // 어긋남이 생겨 `pure`가 실제 줄과 갈린다(리뷰 3층 공통 검출).
    const enLoc = a.currentLocation ? a.currentLocationEn : "";
    const koTail = subwayShowsCurrentLocationTail(a.message, a.currentLocation);
    const enTail = subwayShowsCurrentLocationTail(a.messageEn, enLoc);
    const messageKo = joinText(
      a.message,
      koTail && a.currentLocation && t("currentLocation", { location: a.currentLocation }),
    );
    const message = pickLine(
      locale,
      messageKo,
      // ⚠ 영문 요구 자리는 꼬리 판정과 무관하게 ko 기준으로 둔다 — `currentLocationEn` 결측을 자리
      // 표시로 접으면 "ko에는 현재역이 있는데 영문 줄에서만 조용히 사라지는" 손실이 생긴다.
      // (반대 방향 손실 — ko `arvlMsg3`가 없고 현재역이 99 괄호로만 오는 도착에서 영문 줄이 현재역을
      //  잃는 것 — 은 이 변경 이전부터 있고 E27 계약 소관이다. `docs/BACKLOG.md` A32 "남은 것".)
      [a.messageEn, enLoc],
      ([msg, loc]) => joinText(msg, enTail && t("currentLocation", { location: loc })),
      // 현재역 문장은 UI 템플릿(`Now at {location}`)이라 영어 줄이면 혼합 줄 — en 태그를 달지 않는다.
      // 꼬리를 떼면 그 템플릿이 없으므로 순수 데이터 줄이다.
      { pure: !enTail },
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
