/**
 * 회사 중립 채팅 도구 루프(E89 spec C5). Gemini 밖 회사(OpenAI·Anthropic)의 채팅이 지난다. React/Next 비의존.
 *
 * 모양은 `runAgentLoop`(agent-loop.ts, Gemini 전용)의 거울이다: 도구는 `Promise.allSettled` 병렬이고 실패는 `{ error }`로 모델에
 * 전달해 루프를 죽이지 않는다. 상한 `maxIterations`(6)를 지나면 멈추고, 답이 비면 도구를 닫고 1회 더 돌린다(I-2, 빈 버블 차단).
 * 루프 모양을 바꾸면 `agent-loop.ts`와 평가 하네스 러너(`src/__ab__/openai-runner.ts`·`claude-runner.ts`)를 함께 본다 —
 * 하네스가 잰 루프와 같은 모양이어야 E86 측정이 실사용 견주기의 근거가 된다.
 *
 * Gemini 경로는 이 파일을 지나지 않는다(정식판 봉인: 선택 값이 없는 요청은 종전 코드 그대로).
 */
import { executeFunction } from "./router";
import { dedupeSources } from "./sources";
import type { ExecutionContext, RenderPayload, SourceAttribution } from "./types";
import type { AgentLoopResult } from "./agent-loop";

export interface ChatToolCall {
  /** 회사가 준 짝 id(OpenAI `call_id`, Anthropic `tool_use.id`). 같은 도구를 한 회차에 두 번 불러도 섞이지 않는다. */
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export interface ChatRoundResult {
  text: string;
  calls: ChatToolCall[];
}

export interface ChatToolOutcome {
  call: ChatToolCall;
  ok: boolean;
  /** 성공이면 도구 결과 `data`, 실패면 `{ error }`. */
  response: unknown;
}

/**
 * 회사별 대화 세션. 지침·도구 선언·앞선 이력은 세션이 들고 있고, 회차마다 바이트 그대로 다시 보낸다(추가만 한다).
 * - `round(toolsOpen)`: 한 회차를 돌린다. 응답은 아직 이력에 넣지 않는다. `toolsOpen=false`면 도구를 닫는다(선언은 그대로 두고 선택만 닫는다).
 * - `addToolResults`: 직전 회차의 응답(생각·추론 항목 포함)을 받은 그대로 이력에 넣고 그 호출들의 결과를 붙인다.
 * 실패(API 오류·거절·잘림·시한)는 throw한다. 다른 모델로 돌리지 않는다(spec C4).
 */
export interface ChatModelSession {
  round(toolsOpen: boolean): Promise<ChatRoundResult>;
  addToolResults(outcomes: ChatToolOutcome[]): void;
}

export interface ChatModelLoopOptions {
  session: ChatModelSession;
  ctx: ExecutionContext;
  onStatus?: (toolNames: string[]) => void;
  maxIterations?: number;
  /** 테스트 주입용. 기본은 채팅 실행부(`executeFunction`). */
  execute?: typeof executeFunction;
}

export async function runChatModelLoop(opts: ChatModelLoopOptions): Promise<AgentLoopResult> {
  const { session, ctx, onStatus } = opts;
  const execute = opts.execute ?? executeFunction;
  const maxIterations = opts.maxIterations ?? 6;
  const renders: RenderPayload[] = [];
  const sources: SourceAttribution[] = [];

  let r = await session.round(true);
  for (let iter = 0; iter < maxIterations; iter++) {
    if (r.calls.length === 0) break;
    onStatus?.(r.calls.map((c) => c.name));
    const settled = await Promise.allSettled(r.calls.map((c) => execute(c.name, c.args, ctx)));
    const outcomes: ChatToolOutcome[] = settled.map((s, i) => {
      const call = r.calls[i];
      if (s.status === "fulfilled") {
        if (s.value.render) renders.push(s.value.render);
        if (s.value.source) sources.push(...s.value.source);
        return { call, ok: true, response: s.value.data ?? null };
      }
      // I-1: 실패를 모델에 전달, 루프 유지
      return { call, ok: false, response: { error: String(s.reason) } };
    });
    session.addToolResults(outcomes);
    r = await session.round(true);
  }

  let text = r.text;
  if (text.trim() === "") {
    // I-2: 도구를 닫고 1회 강제 산문. 상한을 다 써 마지막 응답의 호출이 실행되지 않았으면 그 응답은 이력에 넣지 않는다
    // (Gemini 루프도 실행한 회차만 이력에 넣는다).
    text = (await session.round(false)).text;
  }
  return { text, renders, sources: dedupeSources(sources) };
}
