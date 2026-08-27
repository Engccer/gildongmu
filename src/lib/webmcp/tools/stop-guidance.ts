import {
  hasActiveGuideSession,
  readGuideSnapshot,
  stopActiveGuideSession,
} from "@/lib/guide-session-store";
import { finish, withFailure } from "../output";
import { failure, type WebMcpTool } from "../types";

const EMPTY_SCHEMA = { type: "object", properties: {}, additionalProperties: false } as const;
export const SHAPE = withFailure({ ok: true, previousStatus: true });

/**
 * #9 `stop_guidance`(spec §3.9). `stopActiveGuideSession()`(기존 전역 함수)을 부른다 —
 * `starting` 중이면 소유자가 진행 중 시작을 취소한다(세대 증가로 대기 중 조회 폐기).
 * 포커스 복귀·중지 통지는 화면 중지 핸들러의 몫이라 여기서 더하지 않는다.
 */
export function stopGuidanceTool(): WebMcpTool {
  return {
    name: "stop_guidance",
    description:
      "Stop the live guidance session, including one that is still starting. Same as the user pressing the stop button.",
    inputSchema: EMPTY_SCHEMA,
    annotations: { readOnlyHint: false, untrustedContentHint: false },
    execute: async () => {
      const previous = readGuideSnapshot();
      if (!hasActiveGuideSession()) return finish(failure("noSession"), SHAPE);
      stopActiveGuideSession();
      return finish({ ok: true, previousStatus: previous.status }, SHAPE);
    },
  };
}
