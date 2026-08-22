/**
 * 한국어 조사 판정 — 웹 `src/lib/korean-particle.ts`의 미러(packages/cli는 웹 모듈을
 * import하지 않는다). 갈리면 같은 장소명이 웹·앱과 CLI에서 다른 조사로 낭독되므로
 * `__tests__/format-drift.test.ts`가 웹 정본을 실행해 대조한다.
 *
 * ⚠ 한글이 아니면 `null` — 읽는 법이 정해지지 않아 받침을 알 수 없다. 호출자는 그 자리의
 * 조사 삽입만 포기하고 조사 없이도 문법적인 형태로 물러난다.
 */
const HANGUL_FIRST = 0xac00;
const HANGUL_LAST = 0xd7a3;
const JONGSEONG_COUNT = 28;
const JONGSEONG_RIEUL = 8;

function jongseongIndex(word: string): number | null {
  if (!word) return null;
  const code = word.charCodeAt(word.length - 1);
  if (Number.isNaN(code) || code < HANGUL_FIRST || code > HANGUL_LAST) return null;
  return (code - HANGUL_FIRST) % JONGSEONG_COUNT;
}

/** 주격 조사 `이`/`가`. 판정 불가면 `null`. */
export function subjectParticle(word: string): string | null {
  const index = jongseongIndex(word);
  return index === null ? null : index !== 0 ? "이" : "가";
}

/** 보조사 `은`/`는`. 판정 불가면 `null`. */
export function topicParticle(word: string): string | null {
  const index = jongseongIndex(word);
  return index === null ? null : index !== 0 ? "은" : "는";
}

/** 방향·자격 조사 `으로`/`로`. ㄹ 받침은 `로`. 판정 불가면 `null`. */
export function directionParticle(word: string): string | null {
  const index = jongseongIndex(word);
  if (index === null) return null;
  return index === 0 || index === JONGSEONG_RIEUL ? "로" : "으로";
}
