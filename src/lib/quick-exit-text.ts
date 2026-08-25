import type { QuickExit, QuickExitDoor } from "./types";

/**
 * 빠른하차 값 → 한 문장.
 *
 * 서버는 값을, 클라이언트가 문장을 만든다(도보 경로와 규칙이 다른 이유: 도보는 provider가
 * 원문 문장을 주지만 여기는 구조화된 값뿐이라 로케일별 문장이 i18n의 몫이다).
 *
 * **3분기 × 2형태로 키를 나눈다.** 변수만 비우는 방식은 `undefined`·중복 쉼표를 노출하고,
 * 로케일마다 절 순서가 달라 성립하지 않는다. `between`이 별도 조각인 이유도 같다 —
 * `"3-2,3-3 사이"`를 문 번호 자리에 그대로 넣으면 "엘리베이터 3-2,3-3 사이 문"이 된다.
 *
 * ⚠ 결과는 **단일 문자열**이다. 역명이 한국어 고유명이라 비한국어 로케일에서 `lang="ko"`를
 *   씌우고 싶어지지만, 그 span이 문장을 세 객체로 쪼개 스와이프가 늘어난다(헌장 §4).
 *   한 줄은 한 객체로 두고 발음 정확도를 포기한다.
 */
type Translate = (key: string, values?: Record<string, string>) => string;

function doorPhrase(t: Translate, door: QuickExitDoor): string | null {
  if (door.kind === "between" && door.doors.length >= 2) {
    return t("quickExitBetween", { first: door.doors[0], second: door.doors[1] });
  }
  const single = door.doors[0];
  return single ? t("quickExitDoor", { door: single }) : null;
}

export function quickExitText(
  t: Translate,
  station: string,
  quickExit: QuickExit | undefined,
): string | null {
  if (!quickExit || !station) return null;
  // 환승 leg는 빠른환승 문 하나가 정본이다(A20) — seed 계단은 환승 통로가 아닐 수 있다.
  const transfer = quickExit.transfer ? doorPhrase(t, quickExit.transfer) : null;
  if (transfer) return t("quickExitTransfer", { station, transfer });
  const elevator = quickExit.elevator ? doorPhrase(t, quickExit.elevator) : null;
  const stairs = quickExit.stairs ? doorPhrase(t, quickExit.stairs) : null;
  if (elevator && stairs) return t("quickExitBoth", { station, elevator, stairs });
  if (elevator) return t("quickExitElevator", { station, elevator });
  if (stairs) return t("quickExitStairs", { station, stairs });
  return null;
}
