/**
 * 베르길리우스 답변 루프(E82 spec §4). 회사 어댑터와 도구 실행부를 주입받는다(테스트 가능, React/Next 비의존).
 *
 * - 도구 왕복은 `maxToolRounds`회까지다(spec: 2). 다 쓰면 다음 회차는 도구 없이 글만 받는다.
 * - `text` 이벤트의 `final`은 「이 회차에 아직 도구 호출이 없다」이다. 회차 안에서 글 뒤에 도구 호출이 오면 `reset`을 보낸다.
 * - `propose_guide`는 종결 도구다: 요청에 있던 id면 그 자리에서 끝내고(`text`는 비운다), 아니면 버리고 모델에 오류로 돌려준다.
 * - 열어 준 이름이 아닌 도구 호출은 실행하지 않는다(채팅 실행부는 25개 도구를 다 실행할 수 있다).
 * - 도구 실패는 모델에 `error`로 돌려준다(루프를 죽이지 않는다, 채팅 루프와 같다).
 */
import type { ExecutionContext, RenderPayload, RouteStartRenderPayload, ToolResult } from "@/lib/chat/types";
import { routeStartRendersOnly, validateProposal } from "./guard";
import { PROPOSE_GUIDE_NAME } from "./tools";
import type { VergiliusModelSession, VergiliusStreamEvent, VergiliusToolCall, VergiliusToolOutcome } from "./types";

/** 한 질문의 도구 왕복 상한(spec §4). */
export const VERGILIUS_MAX_TOOL_ROUNDS = 2;

export type VergiliusExecute = (
  name: string,
  args: Record<string, unknown>,
  ctx: ExecutionContext,
) => Promise<ToolResult>;

export interface VergiliusLoopOptions {
  session: VergiliusModelSession;
  /** 채팅 라우터의 실행부(`executeFunction`). */
  execute: VergiliusExecute;
  ctx: ExecutionContext;
  /** 실행을 허락한 채팅 도구 이름(종결 도구는 따로 다룬다). */
  allowedTools: ReadonlySet<string>;
  /** 제안이 지목할 수 있는 가게 id. */
  proposableIds: ReadonlySet<string>;
  emit: (event: VergiliusStreamEvent) => void;
  maxToolRounds?: number;
}

export interface VergiliusLoopResult {
  text: string;
  renders: RouteStartRenderPayload[];
  proposal: { placeId: string } | null;
}

export async function runVergiliusLoop(opts: VergiliusLoopOptions): Promise<VergiliusLoopResult> {
  const { session, execute, ctx, allowedTools, emit } = opts;
  const maxToolRounds = opts.maxToolRounds ?? VERGILIUS_MAX_TOOL_ROUNDS;
  const renders: RenderPayload[] = [];

  for (let round = 0; ; round++) {
    const toolsOpen = round < maxToolRounds;
    let sawCall = false;
    let sentFinal = false;
    const turn = await session.round({
      tools: toolsOpen,
      onText: (delta) => {
        if (delta === "") return;
        emit({ type: "text", delta, final: !sawCall });
        if (!sawCall) sentFinal = true;
      },
      onCall: () => {
        // 도구를 닫은 회차의 호출은 버려진다 — 그 회차의 글이 답이므로 final을 거두지 않는다.
        if (!toolsOpen) return;
        // 이 회차의 글을 이미 `final`로 보냈는데 도구 호출이 따라왔다 — 그 글은 답이 아니다.
        if (!sawCall && sentFinal) emit({ type: "reset" });
        sawCall = true;
      },
    });

    // 도구를 닫은 회차에 호출이 오면(회사 쪽 계약 위반) 무시하고 글로 끝낸다 — 상한을 넘겨 실행하지 않는다.
    if (turn.calls.length === 0 || !toolsOpen) {
      return { text: turn.text, renders: routeStartRendersOnly(renders), proposal: null };
    }
    // 스트림에서 `onCall`을 못 받은 어댑터여도 같은 결과가 되게 한다.
    if (!sawCall && sentFinal) emit({ type: "reset" });

    const proposalCall = turn.calls.find((c) => c.name === PROPOSE_GUIDE_NAME);
    if (proposalCall) {
      const placeId = validateProposal(proposalCall.args, opts.proposableIds);
      if (placeId !== null) {
        return { text: "", renders: routeStartRendersOnly(renders), proposal: { placeId } };
      }
    }

    const outcomes = await Promise.all(turn.calls.map((call) => runCall(call)));
    session.pushToolResults(outcomes);
  }

  async function runCall(call: VergiliusToolCall): Promise<VergiliusToolOutcome> {
    if (call.name === PROPOSE_GUIDE_NAME) {
      // 여기 왔다면 검증에서 떨어진 제안이다.
      return { call, response: { error: "목록에 없는 id입니다. 제안하지 말고 글로 답하세요." } };
    }
    if (!allowedTools.has(call.name)) {
      return { call, response: { error: "쓸 수 없는 도구입니다." } };
    }
    try {
      const result = await execute(call.name, call.args, ctx);
      if (result.render) renders.push(result.render);
      return { call, response: result.data };
    } catch (e) {
      return { call, response: { error: e instanceof Error ? e.message : String(e) } };
    }
  }
}
