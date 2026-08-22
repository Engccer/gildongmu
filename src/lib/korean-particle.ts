/**
 * 한국어 조사 판정(순수 함수, ko 전용). Kit `KoreanParticle.swift` 미러 —
 * 표 대조는 `__tests__/korean-particle-drift.test.ts`가 강제한다.
 *
 * 한국어 조사는 앞 글자의 받침 유무로 갈린다(`성내로를`/`양재대로116길을`). 낭독 문장을 우리가 만드는 이상 이 판정을
 * 피할 수 없다 — 종전에는 조사를 아예 쓰지 않고 쉼표로 잇는 방식으로 우회했는데,
 * 그 결과 "강동구청, 왼쪽 약 16m"처럼 관계를 듣는 사람이 복원해야 하는
 * 명사구 나열이 나갔다(위원장 판정 2026-08-09).
 *
 * ⚠ **한글이 아니면 `null`이다.** 영문·숫자·기호로 끝나는 고유명사는 읽는 법이
 * 정해지지 않아 받침을 알 수 없다("R점"은 "알점"인가 "아르점"인가). 호출자는
 * `null`을 받으면 **그 자리의 조사 삽입만 포기**하고 조사 없이도 문법적인 형태로
 * 물러난다. 조사를 못 정하는 것이 낭독 불능이 되어서는 안 된다.
 */

const HANGUL_FIRST = 0xac00;
const HANGUL_LAST = 0xd7a3;
const JONGSEONG_COUNT = 28;

/** ㄹ 받침의 종성 인덱스 — "(으)로"만 이 받침을 받침 없음과 같이 다룬다(서울로·길동으로). */
const JONGSEONG_RIEUL = 8;

/**
 * 마지막 글자의 종성 인덱스(0 = 받침 없음). 한글 음절이 아니면 `null`.
 *
 * 한글 음절은 `0xAC00 + (초성 × 21 + 중성) × 28 + 종성`으로 배열되므로
 * 종성 인덱스는 `(code - 0xAC00) % 28`이고 0이면 받침이 없다.
 */
function jongseongIndex(word: string): number | null {
  if (!word) return null;
  const code = word.charCodeAt(word.length - 1);
  if (Number.isNaN(code) || code < HANGUL_FIRST || code > HANGUL_LAST) return null;
  return (code - HANGUL_FIRST) % JONGSEONG_COUNT;
}

/** 마지막 글자에 받침이 있는가. 한글 음절이 아니면 `null`. */
export function hasFinalConsonant(word: string): boolean | null {
  const index = jongseongIndex(word);
  return index === null ? null : index !== 0;
}

/** 목적격 조사 `을`/`를`. 판정 불가면 `null`. */
export function objectParticle(word: string): string | null {
  const final = hasFinalConsonant(word);
  if (final === null) return null;
  return final ? "을" : "를";
}

/** 주격 조사 `이`/`가`. 판정 불가면 `null`. */
export function subjectParticle(word: string): string | null {
  const final = hasFinalConsonant(word);
  if (final === null) return null;
  return final ? "이" : "가";
}

/** 보조사 `은`/`는`. 판정 불가면 `null`. */
export function topicParticle(word: string): string | null {
  const final = hasFinalConsonant(word);
  if (final === null) return null;
  return final ? "은" : "는";
}

/** 방향·자격 조사 `으로`/`로`. ㄹ 받침은 `로`(서울로). 판정 불가면 `null`. */
export function directionParticle(word: string): string | null {
  const index = jongseongIndex(word);
  if (index === null) return null;
  return index === 0 || index === JONGSEONG_RIEUL ? "로" : "으로";
}

