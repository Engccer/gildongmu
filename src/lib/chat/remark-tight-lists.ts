/**
 * remark 플러그인: 마크다운 목록을 tight로 정규화(spread=false).
 *
 * 왜: Gemini가 목록 항목을 빈 줄로 분리해 출력하면 CommonMark는 이를 loose list로
 * 보고 react-markdown이 각 <li> 내용을 <p>로 감싼다(<li><p>텍스트</p></li>).
 * iOS VoiceOver(WebKit)는 이때 <li>(리스트 항목)를 읽고 그 안의 <p>(문단)를 또 읽어
 * 같은 텍스트를 이중 낭독한다(위원장 신고: 목록 답변의 각 줄이 두 번 읽힘). DOM 텍스트는
 * 한 벌이지만 시맨틱 노드가 항목당 둘(listitem + paragraph)인 게 원인.
 *
 * 해결: 모든 list/listItem의 spread를 false로 강제하면 mdast→hast 변환에서 단락 래핑이
 * 사라져 <li>텍스트</li> tight 구조가 되고 이중 낭독이 사라진다. 중첩 목록(<ul> 안의
 * <ul>) 구조 자체는 보존된다.
 *
 * React/Next 비의존(순수 mdast 변환) — src/lib/chat 이식성 정책 정합. dodo-planet도
 * 동일 react-markdown을 쓰므로 역수입 후보.
 */
interface MdastNode {
  type?: string;
  spread?: boolean;
  children?: MdastNode[];
}

export function remarkTightLists() {
  return (tree: MdastNode) => {
    const walk = (node: MdastNode) => {
      if (node.type === "list" || node.type === "listItem") node.spread = false;
      node.children?.forEach(walk);
    };
    walk(tree);
  };
}
