/**
 * 거리·시간 표시 포맷 (deterministic 유틸 — React/Next 비의존).
 * 단위 기호(m, km)는 국제 공통이라 로케일 분기 없이 쓴다.
 */

/**
 * 미터 → "850m" 또는 "3km 600m" (1,000m 이상은 km 아래 자리를 m으로).
 *
 * 소수 km("3.6km")를 쓰지 않는 이유는 낭독이다. 스크린 리더가 "삼 점 육 킬로미터"로
 * 읽는 것보다 "3km 600m"가 짧고, 1,000m 정각이 "1.0km"("일 점 영 킬로미터")로
 * 읽히던 것도 함께 사라진다(위원장 실보행 피드백 2026-08-02).
 *
 * ⚠ **100m 단위 반올림을 먼저 하고 나서 km과 나머지로 가른다.** 따로 반올림하면
 * 1,999m에서 나머지가 1,000으로 올라가 "1km 1000m"이 된다. 자리올림을 분기로
 * 처리하지 않고 산술이 흡수하게 만드는 것이 이 함수의 전부다.
 *
 * 정밀도는 종전과 같다(소수 1자리 == 100m 단위). 바뀐 것은 표기뿐이다.
 *
 * 미러 3벌: Kit `Format.swift` · CLI `formatters.ts` `dist()`.
 * 드리프트 가드는 `__tests__/format.test.ts`.
 */
export function formatDistance(meters: number): string {
  // 1,000 미만 판정을 반올림 **뒤에** 한다. 앞에서 하면 999.6이 "1000m"가 된다.
  const rounded = Math.round(meters);
  if (rounded < 1000) return `${rounded}m`;
  // 1km 이상은 소수 km(위원장 지시 2026-08-02: "1km 200m" 나눠쓰기 폐기,
  // 원값 그대로 후행 0 없이: 1.1km·10.6km·6.285km). VoiceOver가 km는
  // 오류 없이 kilometers로 발화하므로 낭독 별도 조치 불필요(실기기 확인).
  // 숫자→문자열 최단 표현이 후행 0 제거를 자동으로 해 준다(1000→"1km").
  return `${rounded / 1000}km`;
}

/** 초 → 올림한 분 (최소 1분) — "약 N분" 문구의 N */
export function durationToMinutes(seconds: number): number {
  return Math.max(1, Math.ceil(seconds / 60));
}

/**
 * 한 항목의 여러 정보 조각을 단일 문자열로 합친다 — 스크린 리더 "한 줄 = 한
 * 접근성 객체" 정본. 시각 목적 인라인 <span>(거리·부가정보·배지)으로 줄을
 * 쪼개면 VoiceOver가 조각마다 멈춰(가운뎃점까지 별도 객체) 한 항목 읽는 데
 * 여러 번 스와이프가 필요하다 — 그 분절을 코드에서 구조적으로 막는다.
 *
 * - falsy 조각(빈 문자열·null·undefined·false)은 버린다 — 선택 항목(급행·환승·
 *   현재위치)을 `cond && text`로 그대로 넘길 수 있다.
 * - 구분자는 쉼표+공백: 확실한 휴지를 주고 어떤 SR 발성 설정에서도 단어로
 *   낭독되지 않는다. 가운뎃점(·)은 일부 SR이 단어로 읽으므로 합친 텍스트에 쓰지 않는다.
 */
export function joinText(
  ...parts: Array<string | false | null | undefined>
): string {
  return parts.filter((p): p is string => Boolean(p)).join(", ");
}

/**
 * 한글(음절·호환 자모)이 하나라도 있는가 — 비-ko 페이지(`<html lang="en">`)에 놓이는 한국어
 * 데이터 블록(장소명·분류)에 `lang="ko"`를 달 판정(A26). 영어 엔진은 한글을 읽지 못하고(철자
 * 낭독·침묵), 한국어 엔진은 영어 낱말을 그런대로 읽으므로 판정은 "한글이 있는가" 한 축이다.
 * ⚠ 이미 별도 블록·줄인 곳에만 쓴다 — 속성을 주려고 줄 중간을 span으로 쪼개지 말 것.
 */
export function hasHangul(text: string): boolean {
  return /[\u3131-\u318E\uAC00-\uD7A3]/.test(text);
}

/**
 * 음성 전사를 검색어로 쓰기 전 후행 문장부호를 제거한다(iOS `VoiceQuery.swift` 미러).
 *
 * STT는 발화를 문장으로 보고 끝에 마침표를 붙이는데, 검색 API는 그 마침표를
 * 질의어의 일부로 받아 매칭이 무너진다. 실호출 확정(2026-07-26):
 * - juso: "강동구 성내로 12" 15건 → "강동구 성내로 12." **0건**. 마지막 토큰을
 *   건물번호로 파싱하는데 "12."가 유효 번호가 아니라 전멸한다. 주소는 대부분
 *   숫자로 끝나므로 주소 검색만 유독 결과가 사라졌다("강동구청."은 6건 그대로).
 * - 카카오 키워드: "강동구 길동 맛집" 4,663건 → 마침표 붙이면 19건(전멸은 아니라
 *   "가끔 되는 것처럼" 보였던 이유).
 *
 * 엔진 쪽에서 끄지 않고 여기서 지우는 이유: iOS 온디바이스 `SpeechTranscriber`는
 * 문장부호 옵션 자체가 없고(`TranscriptionOption`은 etiquetteReplacements 하나뿐),
 * Deepgram의 `punctuate=false`는 같은 STT 라우트를 쓰는 채팅 입력까지 망가뜨린다.
 * 마침표가 노이즈인 곳은 검색 질의뿐이므로 소비 지점에서 지우는 것이 정확한 계층이다.
 *
 * 후행만 제거한다. 중간 문장부호는 사용자가 실제로 발화한 구분일 수 있다.
 * 전부 지워 빈 문자열이 되면 원문을 되돌린다(정규화는 개선이지 파괴가 아니다).
 */
export function normalizeVoiceQuery(text: string): string {
  // 문자 클래스에 공백을 포함해 "부호와 공백이 섞여 끝나는" 꼬리도 한 번에 걷는다
  // (`[부호]+\s*$`는 "…, " 같은 꼬리를 한 겹만 벗겨 iOS 미러와 결과가 갈렸다).
  const stripped = text.replace(/[\s.,!?…。、．，！？·]+$/u, "").trim();
  return stripped || text.trim();
}
