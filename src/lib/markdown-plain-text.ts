/**
 * 마크다운 표시 문법을 벗겨 평문으로 만든다(채팅 답변의 복사·듣기 입력).
 *
 * dodo-planet `markdownToPlainText`의 이식본이지만 **정본은 Kit `MarkdownPlainText.strip`**이다 —
 * 두 결과가 같아야 하고 공유 fixture `__tests__/fixtures/markdown-plain-text-cases.json`이
 * 양쪽에서 그것을 잠근다. 규칙 순서가 결과를 바꾸므로(겹치는 패턴) 순서도 Kit와 같다.
 *
 * Kit는 ICU 정규식·Foundation 트림이라 JS 약칭 클래스를 그대로 쓰면 어긋난다:
 * `\s`는 `\p{White_Space}`(JS `\s`는 U+FEFF를 더하고 U+0085를 뺀다), `\w`는 한글까지 포함하는
 * ICU 정의, `\d`는 `\p{Nd}`, 끝 트림은 Foundation `whitespacesAndNewlines`(White_Space + U+200B)다.
 * 줄 머리·꼬리(`anchorsMatchLines`)도 ICU를 따른다: 줄 경계는 LF·CR·VT·FF·NEL·LS·PS이고
 * CRLF는 한 단위라 그 사이는 줄 경계가 아니다(JS `m` 플래그는 VT·FF·NEL을 모르고 CR 뒤에서도 선다).
 */

const ZWSP = String.fromCharCode(0x200b);
const ZWNJ = String.fromCharCode(0x200c);
const ZWJ = String.fromCharCode(0x200d);
/** ICU `\w` */
const WORD = `[\\p{Alphabetic}\\p{M}\\p{Nd}\\p{Pc}${ZWNJ}${ZWJ}]`;
/** Foundation `CharacterSet.whitespacesAndNewlines` */
const TRIM = new RegExp(`^[\\p{White_Space}${ZWSP}]+|[\\p{White_Space}${ZWSP}]+$`, "gu");
const LS = String.fromCharCode(0x2028);
const PS = String.fromCharCode(0x2029);
/** CR을 뺀 ICU 줄 경계 */
const EOL = `[\n\v\f\x85${LS}${PS}]`;
/** ICU 여러 줄 모드의 `^`·`$` */
const BOL = `(?:^|(?<=${EOL})|(?<=\r)(?!\n))`;
const EOLA = `(?:$|(?=${EOL}|\r)(?<!\r(?=\n)))`;
const line = (body: string) => new RegExp(`${BOL}${body}`, "gu");
const HEADING = line("#{1,6}\\p{White_Space}+");
const RULE = new RegExp(`${BOL}[-*_]{3,}\\p{White_Space}*${EOLA}`, "gu");
const QUOTE = line(">\\p{White_Space}+");
const BULLET = line("\\p{White_Space}*[-*+]\\p{White_Space}+");
const NUMBERED = line("\\p{White_Space}*\\p{Nd}+\\.\\p{White_Space}+");
const FENCE_HEAD = new RegExp(`\`\`\`${WORD}*\\n?`, "gu");

export function markdownToPlainText(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/gu, (block) => block.replace(FENCE_HEAD, "").replace(/```/gu, "").replace(TRIM, ""))
    .replace(/`([^`]+)`/gu, "$1")
    .replace(HEADING, "")
    .replace(/\*\*([^*]+)\*\*/gu, "$1")
    .replace(/__([^_]+)__/gu, "$1")
    .replace(/\*([^*]+)\*/gu, "$1")
    .replace(/_([^_]+)_/gu, "$1")
    .replace(/~~([^~]+)~~/gu, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/gu, "$1")
    .replace(/!\[([^\]]*)\]\([^)]+\)/gu, "$1")
    .replace(RULE, "")
    .replace(QUOTE, "")
    .replace(BULLET, "• ")
    .replace(NUMBERED, "")
    .replace(/\n{3,}/gu, "\n\n")
    .replace(TRIM, "");
}
