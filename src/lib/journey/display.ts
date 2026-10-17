import { stripStationDecorations, stripStationSuffixKeepParens } from "../station-match";

/**
 * 문장 틀의 `{station}`에 넣는 표시용 역 이름(순수). 틀이 「…역」을 붙이므로 끝의 「역」을 한 글자 뗀다
 * (`서울역` → `서울`, 안 떼면 「서울역역」). 괄호 부기는 유지하고(`천호(풍납토성)`), 후행 노선 토큰은
 * 뗀다(`아현역 2호선` → `아현`). 이름이 「역」 하나뿐이면 비지 않게 그대로 둔다.
 */
export function displayStationName(name: string): string {
  const stripped = stripStationSuffixKeepParens(name);
  return stripped === "" ? name.trim() : stripped;
}

/**
 * 카카오 출구·승강장 질의와 출구 이름 접두에 쓰는 역 이름(순수). 표시 이름과 달리 **괄호 부기도 뗀다** — ODsay
 * 정류 이름 `하남시청(덕풍.신장)`을 그대로 실으면 `하남시청(덕풍.신장)역 1번출구` 질의가 0건이 되고 결과가
 * 조회 실패가 아니라 「출구 없음」으로 위장한다(3-state 붕괴). 카카오 출구 POI는 `{역}역 N번출구` 꼴이다.
 */
export function exitQueryStationName(name: string): string {
  const stripped = stripStationDecorations(name);
  return stripped === "" ? name.trim() : stripped;
}
