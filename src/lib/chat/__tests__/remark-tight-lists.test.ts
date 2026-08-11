import { describe, it, expect } from "vitest";
import { remarkTightLists } from "../remark-tight-lists";

/** mdast 일부를 흉내낸 최소 트리(loose list = spread:true) */
function looseTree() {
  return {
    type: "root",
    children: [
      {
        type: "list",
        ordered: true,
        spread: true,
        children: [
          {
            type: "listItem",
            spread: true,
            children: [
              { type: "paragraph", children: [{ type: "text", value: "소과당" }] },
              {
                type: "list",
                spread: false,
                children: [
                  { type: "listItem", spread: false, children: [{ type: "text", value: "주소" }] },
                ],
              },
            ],
          },
        ],
      },
    ],
    // MdastNode에 없는 실전 필드(ordered·value)를 담은 fixture라 직접 캐스트가
    // 겹침 검사에 걸린다 — unknown 경유가 TS의 공식 우회다(테스트 전용).
  } as unknown as Parameters<ReturnType<typeof remarkTightLists>>[0];
}

describe("remarkTightLists", () => {
  it("모든 list/listItem의 spread를 false로 정규화", () => {
    const tree = looseTree();
    remarkTightLists()(tree);

    const list = tree.children![0];
    expect(list.spread).toBe(false);
    const item = list.children![0];
    expect(item.spread).toBe(false);
    // 중첩 목록도 정규화
    const nested = item.children![1];
    expect(nested.spread).toBe(false);
  });

  it("list가 아닌 노드의 spread는 건드리지 않음", () => {
    const tree = {
      type: "root",
      children: [{ type: "paragraph", spread: true, children: [] }],
    } as Parameters<ReturnType<typeof remarkTightLists>>[0];
    remarkTightLists()(tree);
    // paragraph는 list/listItem이 아니므로 그대로
    expect(tree.children![0].spread).toBe(true);
  });
});
