/**
 * 서울 열린데이터광장(openapi.seoul.go.kr) 응답 본문을 JSON으로 읽되,
 * **JSON이 아닐 때 원인을 말하고 죽는다.**
 *
 * 인증키가 무효하면 `/json/` 경로로 요청해도 **HTTP 200 + XML 본문**이 온다
 * (실측 2026-08-01: `<RESULT><CODE>INFO-100</CODE><MESSAGE>인증키가 유효하지
 * 않습니다…`). `res.json()`을 그냥 부르면 `Unexpected token '<'`라는 원인 없는
 * SyntaxError가 되고, 그 502를 코드 결함으로 오진하게 된다
 * (data.go.kr의 같은 함정은 `fetchDataGoKrJson`이 막는다).
 *
 * ⚠ **이 모듈은 모양(shape)만 담당한다.** 서울 열린데이터는 봉투가 세 형태다:
 * 따릉이 `rentBikeStatus.RESULT.CODE`, 문화행사 `culturalEventInfo.RESULT.CODE`,
 * 혼잡도는 정상에 `RESULT`가 없고 오류만 평면 키 `"RESULT.CODE"`로 온다.
 * "무엇이 정상 코드인가"는 서비스 계약이라 provider에 남긴다. 여기에 합치면
 * `okCodes` 같은 분기 주머니가 된다(`datagokr-envelope`와 같은 경계).
 *
 * 키를 여러 서비스가 공유하므로(따릉이·문화행사·혼잡도·엘리베이터) 키가 죽으면
 * **동시에** 같은 방식으로 오진된다. 그래서 한 곳에서 막고, 새 소비자가 이 함수를
 * 우회하지 않는지는 정적 가드(`__tests__/seoul-open-json-usage.test.ts`)가 지킨다.
 * 소비자 수를 사람이 기억하게 두면 빠뜨린다 — 실제로 엘리베이터를 빠뜨렸다.
 */
export async function readSeoulOpenJson(res: Response, label: string): Promise<unknown> {
  const text = await res.text();
  const head = text.trimStart().slice(0, 1);
  if (head !== "{" && head !== "[") {
    const code = /<CODE>([^<]+)<\/CODE>/.exec(text)?.[1];
    throw new Error(
      code
        ? `${label} 비-JSON 응답(${code}) — 인증키 유효성을 먼저 확인할 것`
        : `${label} 비-JSON 응답 — 인증키 유효성을 먼저 확인할 것`,
    );
  }
  return JSON.parse(text);
}
