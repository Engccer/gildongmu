/**
 * 베르길리우스 답변 루프(E82 spec §4). 회사 어댑터와 도구 실행부를 주입받는다(테스트 가능, React/Next 비의존).
 *
 * - 도구 왕복은 `maxToolRounds`회까지다(spec: 2). 다 쓰면 다음 회차는 도구 없이 글만 받는다.
 * - 한 회차에 실행하는 도구는 `VERGILIUS_MAX_CALLS_PER_ROUND`건까지다. 넘친 호출은 실행하지 않고 오류로 돌려준다
 *   (경로 도구는 유료 upstream을 부른다 — 모델이 한 회차에 호출을 쏟아 내도 팬아웃이 여기서 멎는다).
 * - `text` 이벤트의 `final`은 「이 회차에 아직 도구 호출이 없다」이다. 회차 안에서 글 뒤에 도구 호출이 오면 `reset`을 보낸다.
 * - `propose_guide`는 종결 도구다: 요청에 있던 id 하나를 가리키면 그 자리에서 끝내고(`text`와 `renders`는 비운다), 아니면
 *   버리고 모델에 오류로 돌려준다. 한 회차에 서로 다른 id를 가리키는 제안이 둘 이상이면 전부 버린다.
 * - 열어 준 이름이 아닌 도구 호출은 실행하지 않는다(채팅 실행부는 25개 도구를 다 실행할 수 있다).
 * - 경로 도구의 도착지가 요청 목록의 가게 이름과 같으면 실행하지 않는다. 그 가게는 앱이 좌표를 쥐고 있어 제안 도구로 가야 한다
 *   (경로 도구는 이름을 다시 검색해 다른 지점의 같은 이름으로 갈 수 있다).
 * - 도구 실패는 모델에 `error`로 돌려준다(루프를 죽이지 않는다, 채팅 루프와 같다).
 * - 도구 결과는 좌표 키를 뗀 뒤 모델에 준다(`withoutCoordinates`). 렌더는 그대로 앱에 간다.
 */
import type { ExecutionContext, RenderPayload, RouteStartRenderPayload, ToolResult } from "@/lib/chat/types";
import { routeStartRendersOnly, validateProposal, withoutCoordinates } from "./guard";
import { PROPOSE_GUIDE_NAME } from "./tools";
import type { VergiliusModelSession, VergiliusStreamEvent, VergiliusToolCall, VergiliusToolOutcome } from "./types";

/** 한 질문의 도구 왕복 상한(spec §4). */
export const VERGILIUS_MAX_TOOL_ROUNDS = 2;
/** 한 회차에 실행하는 도구 호출 상한. 수단 비교(도보·대중교통·자동차)가 셋이다. */
export const VERGILIUS_MAX_CALLS_PER_ROUND = 3;

/** 도착지 이름을 받아 다시 검색하는 경로 도구(인자 `destination`). */
const ROUTE_TOOL_NAMES: ReadonlySet<string> = new Set(["get_walk_route", "get_transit_route", "get_car_route"]);

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
  /** 요청 목록의 가게 이름(`places[].name`). 경로 도구의 도착지가 이 중 하나면 실행하지 않는다. */
  listedPlaceNames: ReadonlySet<string>;
  emit: (event: VergiliusStreamEvent) => void;
  maxToolRounds?: number;
}

export interface VergiliusLoopResult {
  text: string;
  renders: RouteStartRenderPayload[];
  proposal: { placeId: string } | null;
}

/** 한 회차의 제안 호출들을 판정한다: 통과한 id 하나, 또는 모델에 돌려줄 거절 사유. */
function judgeProposals(
  calls: readonly VergiliusToolCall[],
  allowed: ReadonlySet<string>,
): { placeId: string } | { error: string } {
  const ids = calls.map((c) => validateProposal(c.args, allowed));
  const raw = new Set(calls.map((c) => (typeof c.args.placeId === "string" ? c.args.placeId.trim() : "")));
  if (raw.size > 1) return { error: "한 번에 한 곳만 제안할 수 있습니다. 제안하지 말고 어느 곳인지 되물으세요." };
  const placeId = ids[0];
  if (placeId === null) return { error: "목록에 없는 id입니다. 제안하지 말고 글로 답하세요." };
  return { placeId };
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

    const proposalCalls = turn.calls.filter((c) => c.name === PROPOSE_GUIDE_NAME);
    let proposalError = "";
    if (proposalCalls.length > 0) {
      const verdict = judgeProposals(proposalCalls, opts.proposableIds);
      // 제안으로 끝나는 답에는 수단 버튼을 싣지 않는다(앞 회차의 경로 조회가 남긴 렌더가 제안 버튼과 겨루지 않게).
      if ("placeId" in verdict) return { text: "", renders: [], proposal: verdict };
      proposalError = verdict.error;
    }

    let granted = 0;
    // map의 콜백은 호출 순서대로 동기 실행되므로 `granted`는 앞에서부터 센다.
    const outcomes = await Promise.all(
      turn.calls.map((call): VergiliusToolOutcome | Promise<VergiliusToolOutcome> => {
        const refusal = refuse(call, proposalError);
        if (refusal !== null) return { call, response: { error: refusal } };
        if (granted >= VERGILIUS_MAX_CALLS_PER_ROUND) {
          return { call, response: { error: "한 번에 부를 수 있는 도구 수를 넘었습니다. 받은 결과로 답하세요." } };
        }
        granted++;
        return runCall(call);
      }),
    );
    session.pushToolResults(outcomes);
  }

  /** 실행하지 않을 호출이면 모델에 돌려줄 사유를, 실행할 호출이면 null을 낸다. */
  function refuse(call: VergiliusToolCall, proposalError: string): string | null {
    // 여기 온 제안은 판정에서 떨어진 것이다.
    if (call.name === PROPOSE_GUIDE_NAME) return proposalError;
    if (!allowedTools.has(call.name)) return "쓸 수 없는 도구입니다.";
    const destination = call.args.destination;
    if (
      ROUTE_TOOL_NAMES.has(call.name) &&
      typeof destination === "string" &&
      opts.listedPlaceNames.has(destination.trim())
    ) {
      return `목록에 있는 가게입니다. 경로 도구를 쓰지 말고 ${PROPOSE_GUIDE_NAME}를 그 가게의 id로 부르세요.`;
    }
    return null;
  }

  async function runCall(call: VergiliusToolCall): Promise<VergiliusToolOutcome> {
    try {
      const result = await execute(call.name, call.args, ctx);
      if (result.render) renders.push(result.render);
      return { call, response: withoutCoordinates(result.data) };
    } catch (e) {
      return { call, response: { error: e instanceof Error ? e.message : String(e) } };
    }
  }
}
