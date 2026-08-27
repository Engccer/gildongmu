import { finish, withFailure } from "../output";
import type { WebMcpTool } from "../types";
import type { HomeEntryBridge } from "./context";

export const SHAPE = withFailure({ ok: true, alreadyOpen: true });

/** #1 `open_directions`(spec §3.1) — 홈(검색 뷰)이 등록하는 진입 도구. */
export function openDirectionsTool(bridge: HomeEntryBridge): WebMcpTool {
  return {
    name: "open_directions",
    description:
      "Open the Gildongmu directions view from the home screen, optionally pre-filling the destination. Call plan_directions after this to run the search. If the directions view is already open this is a no-op.",
    inputSchema: {
      type: "object",
      properties: {
        to: {
          type: "string",
          description: "Destination place name or address to pre-fill. Optional.",
        },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, untrustedContentHint: true },
    execute: async (input) => {
      if (bridge.isDirectionsOpen()) return finish({ ok: true, alreadyOpen: true }, SHAPE);
      const to = typeof input.to === "string" ? input.to.trim() : "";
      // 필드 텍스트로만 채운다 — 해석·조회는 `plan_directions`의 책임(두 도구가 같은 해석을
      // 하면 겹친다). 포커스는 뷰 전환의 기존 착지(제목)를 그대로 따른다.
      bridge.openDirections(to || null);
      return finish({ ok: true, alreadyOpen: false }, SHAPE);
    },
  };
}
