/**
 * NDJSON 한 줄 직렬화. React/Next 비의존.
 *
 * A44(채팅 라우트와 같은 규칙): JSON.stringify는 U+2028·U+2029·U+0085를 날 문자로 둔다. Swift `bytes.lines`는 그 문자를
 * 줄 경계로 읽어 이벤트 한 줄을 쪼갠다. 직렬화 뒤 이스케이프 표기로 바꾼다(같은 JSON 값이다).
 * (소스에 날 문자·이스케이프 표기를 두지 않으려고 코드 포인트로 조립한다.)
 */
import type { VergiliusStreamEvent } from "./types";

const LINE_BREAKING_CODE_POINTS = [0x2028, 0x2029, 0x0085];

export function toVergiliusNdjsonLine(event: VergiliusStreamEvent): string {
  let json = JSON.stringify(event);
  for (const cp of LINE_BREAKING_CODE_POINTS) {
    json = json.split(String.fromCharCode(cp)).join("\\" + "u" + cp.toString(16).padStart(4, "0"));
  }
  return json + "\n";
}
