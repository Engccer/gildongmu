import { stripStationSuffixKeepParens } from "../station-match";

/**
 * 문장 틀의 `{station}`에 넣는 표시용 역 이름(순수). 틀이 「…역」을 붙이므로 끝의 「역」을 한 글자 뗀다
 * (`서울역` → `서울`, 안 떼면 「서울역역」). 괄호 부기는 유지하고(`천호(풍납토성)`), 후행 노선 토큰은
 * 뗀다(`아현역 2호선` → `아현`). 이름이 「역」 하나뿐이면 비지 않게 그대로 둔다.
 */
export function displayStationName(name: string): string {
  const stripped = stripStationSuffixKeepParens(name);
  return stripped === "" ? name.trim() : stripped;
}
