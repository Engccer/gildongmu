/**
 * Tmap 응답 본문 파서(보행자·자동차 공용).
 *
 * Tmap은 POI 이름 둘을 날 NUL(U+0000)로 이어 문자열 안에 넣는다
 * (`"청담역 14번출구\u0000CU 청담자이점"`, A62 실호출 2026-10-17). JSON 규격상
 * 문자열 안의 날 제어 문자는 무효라 `res.json()`이 통째로 실패하고 라우트가 502가 된다.
 *
 * 날 U+0000~U+001F를 전부 공백으로 바꾼 뒤 파싱한다. 구조상 무손실이다:
 * 토큰 사이에서는 공백도 유효한 공백 문자이고, 문자열 안에서는 원래 무효였던 문자다.
 * 이스케이프된 `\n`·`\u0000`(두 글자 이상)은 날 문자가 아니라 건드리지 않는다.
 */
const RAW_CONTROL = /[\u0000-\u001F]/g;

export function parseTmapJson(text: string): unknown {
  return JSON.parse(text.replace(RAW_CONTROL, " "));
}

export async function readTmapJson(res: Response): Promise<unknown> {
  return parseTmapJson(await res.text());
}
