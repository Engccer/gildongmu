/**
 * Anthropic Claude 어댑터 — 공식 SDK(`@anthropic-ai/sdk`)의 `messages.stream`을 부른다(E82 spec §4, 2026-11-14 위원장 요청으로 추가).
 * `client`는 주입형이다(테스트 가능, 다른 두 어댑터와 같은 관례). React/Next 비의존.
 *
 * 계약(claude-api 스킬의 TypeScript 문서와 설치된 SDK 1.6.0의 타입으로 확인, 2026-11-14):
 * - **생각 설정은 모델마다 다르다.** Opus 5.5는 생각을 끌 수 없다(`thinking`의 `disabled`·`budget_tokens`는 400): `thinking`을
 *   보내지 않고 effort를 `low`로 낮춘다. Sonnet 5.5는 `{type:"between_tools"}`가 생각을 끄는 유일한 값이고(effort `high` 이하,
 *   다른 필드를 같이 보내면 400) effort `low`와 함께 쓴다. 첫 문장까지의 시간이 이 기능의 품질이라 둘 다 가장 낮은 값이다.
 * - **도구 선택은 `auto`(열린 회차)와 `none`(닫힌 회차)뿐이다.** 두 모델 다 강제 선택(`any`·`tool`)이 400이다.
 *   닫힌 회차도 선언은 그대로 둔다(이력의 `tool_use`가 가리키는 도구가 요청에 있어야 하고, 선언이 바뀌면 캐시와 생각 블록이 깨진다).
 * - **도구를 부른 회차의 응답 내용은 받은 그대로 이력에 넣는다.** 생각 블록(빈 글과 서명)은 모델과 대화에 묶여 있어 바꾸거나
 *   빼면 다음 요청에서 버려지거나 400이다. 지침·도구·앞선 메시지는 회차 사이에 바이트 그대로다(추가만 한다).
 * - 도구 결과의 **짝은 `tool_use_id`다.** 한 회차의 결과는 호출 순서 그대로 한 `user` 메시지에 담는다.
 * - **`stop_reason`은 엄격하게 본다.** `end_turn`·`tool_use`만 정상이다. `refusal`(안전 분류기 거절)·`max_tokens`(잘린 글)와 그 밖의
 *   값은 던진다(Google 어댑터의 `finishReason`과 같은 3-state: 잘린 글이나 거절을 답으로 읽히지 않는다).
 * - **서버 측 `fallbacks`(거절 시 다른 모델로 다시 돌리기)는 쓰지 않는다.** 사용자가 설정에서 고른 모델이 답한다는 계약이라,
 *   거절되면 다른 모델이 몰래 대신 답하지 않고 실패로 끝난다(앱은 실패 문장을 읽는다, V17).
 * - **지침(system)에 캐시 표시를 둔다.** 도구 선언과 지침은 요청마다 같고(요청 순서 tools → system), 재료와 질문만 바뀐다.
 *   표시 앞의 도구 선언과 지침은 합쳐 두 모델의 최소 캐시 길이(512토큰)를 넘는다. 효과는 `usage.cache_read_input_tokens`로 본다.
 *   재료에는 표시를 두지 않는다: 질문마다 바뀌어 쓰기 값(1.25배)만 치르고 다시 읽히지 않는다.
 * - **eager input streaming과 strict는 쓰지 않는다.** 도구 인자가 이름 몇 글자라 eager로 앞당길 시간이 없고, 끄면 API가 인자를
 *   검증해 준다. strict는 채팅 선언(선택 인자·enum)의 스키마 조건을 실호출 전에 보장할 수 없고 첫 요청에 문법 컴파일 시간이 붙는다.
 *   인자가 객체가 아니면 빈 인자로 넘긴다(실행부가 「목적지가 필요합니다」 같은 오류로 답한다, OpenAI 어댑터와 같다).
 * - **재시도는 시한 안에서만 의미가 있게 둔다.** SDK 기본(2회, 지수 대기)은 25초 요청 시한과 겹친다. 1회만 다시 하고, 응답 머리까지의
 *   시한(SDK `timeout`은 fetch가 머리를 받을 때까지만 잰다)을 짧게 둔다: 8초 + 대기 0.5초 + 8초가 25초 안에 든다.
 * - 로그에는 모델·회차·`stop_reason`·지연·토큰 수만 남긴다. 질문 글·재료·답 글은 쓰지 않는다.
 */
import Anthropic from "@anthropic-ai/sdk";
import { VergiliusModelError, type ClaudeVergiliusProvider } from "./types";
import type {
  VergiliusModelSession,
  VergiliusRoundOptions,
  VergiliusRoundResult,
  VergiliusToolCall,
  VergiliusToolOutcome,
} from "./types";

/** 모델 이름의 정본. 바꿀 때는 `docs/evals/2026-11-14-vergilius-claude.md`의 표를 다시 낸다. */
export const CLAUDE_VERGILIUS_MODELS: Record<ClaudeVergiliusProvider, string> = {
  "claude-opus": "claude-opus-5-5",
  "claude-sonnet": "claude-sonnet-5-5",
};

interface ClaudeRequestSettings {
  thinking?: Anthropic.ThinkingConfigParam;
  effort: NonNullable<Anthropic.OutputConfig["effort"]>;
}

/** 회사 문서의 모델별 제약을 따른 생각 설정(위 머리말). */
export const CLAUDE_VERGILIUS_SETTINGS: Record<ClaudeVergiliusProvider, ClaudeRequestSettings> = {
  "claude-opus": { effort: "low" },
  "claude-sonnet": { thinking: { type: "between_tools" }, effort: "low" },
};

const ROUND_TIMEOUT_MS = 20_000;
/**
 * 답은 한두 문장이지만 Opus 5.5의 생각도 이 상한에 든다(생각 글이 돌아오지 않아도 센다). 상한에 닿으면 실패이므로 넉넉히 둔다 —
 * 실제 지출은 쓴 만큼이고 시간은 요청 시한이 묶는다.
 */
const MAX_TOKENS = 4096;
/** 응답 머리까지의 시도당 시한과 재시도 횟수(위 머리말). */
export const CLAUDE_ATTEMPT_TIMEOUT_MS = 8_000;
export const CLAUDE_MAX_RETRIES = 1;

/** 어댑터가 쓰는 SDK의 면(테스트에서 가짜로 바꾼다). */
export interface ClaudeMessagesClient {
  messages: {
    stream(
      body: Anthropic.MessageStreamParams,
      options?: Anthropic.RequestOptions,
    ): AsyncIterable<Anthropic.MessageStreamEvent> & { finalMessage(): Promise<Anthropic.Message> };
  };
}

export function createAnthropicClient(apiKey: string): ClaudeMessagesClient {
  return new Anthropic({ apiKey, maxRetries: CLAUDE_MAX_RETRIES, timeout: CLAUDE_ATTEMPT_TIMEOUT_MS });
}

export interface ClaudeSessionOptions {
  client: ClaudeMessagesClient;
  provider: ClaudeVergiliusProvider;
  instruction: string;
  /** 첫 사용자 글(재료 + 질문). */
  material: string;
  tools: Anthropic.Tool[];
  signal?: AbortSignal;
  /** 회차 기록(토큰·지연·stop_reason). 기본은 `console.info`. */
  log?: (line: string) => void;
}

/** SDK 오류를 고정 낱말의 종류로 바꾼다(회사 응답의 메시지 본문에는 요청 글이 되비칠 수 있어 넣지 않는다). */
function toModelError(e: unknown): unknown {
  if (e instanceof VergiliusModelError) return e;
  if (e instanceof Anthropic.APIUserAbortError) return new VergiliusModelError("claude aborted");
  if (e instanceof Anthropic.APIConnectionTimeoutError) return new VergiliusModelError("claude timeout");
  if (e instanceof Anthropic.APIConnectionError) return new VergiliusModelError("claude connection");
  if (e instanceof Anthropic.APIError) return new VergiliusModelError("claude messages", e.status ?? null);
  // 끝맺음 없이 끊긴 스트림 등 SDK 자체 오류.
  if (e instanceof Anthropic.AnthropicError) return new VergiliusModelError("claude stream");
  return e;
}

/** 정상으로 받는 `stop_reason`. 나머지는 고정 낱말로 던진다(값을 그대로 싣지 않는다). */
const STOP_REASON_KIND: Partial<Record<string, string>> = {
  refusal: "claude stop refusal",
  max_tokens: "claude stop max_tokens",
  model_context_window_exceeded: "claude stop context",
  pause_turn: "claude stop pause_turn",
  stop_sequence: "claude stop stop_sequence",
};

function toArgs(input: unknown): Record<string, unknown> {
  return input !== null && typeof input === "object" && !Array.isArray(input) ? (input as Record<string, unknown>) : {};
}

export function createClaudeSession(opts: ClaudeSessionOptions): VergiliusModelSession {
  const model = CLAUDE_VERGILIUS_MODELS[opts.provider];
  const settings = CLAUDE_VERGILIUS_SETTINGS[opts.provider];
  const log = opts.log ?? ((line: string) => console.info(line));
  const system: Anthropic.TextBlockParam[] = [
    { type: "text", text: opts.instruction, cache_control: { type: "ephemeral" } },
  ];
  const messages: Anthropic.MessageParam[] = [{ role: "user", content: opts.material }];
  let roundNo = 0;

  return {
    async round(roundOpts: VergiliusRoundOptions): Promise<VergiliusRoundResult> {
      roundNo++;
      const timeout = AbortSignal.timeout(ROUND_TIMEOUT_MS);
      const started = performance.now();
      let firstTextMs: number | null = null;
      let text = "";
      let message: Anthropic.Message;
      try {
        const stream = opts.client.messages.stream(
          {
            model,
            max_tokens: MAX_TOKENS,
            system,
            messages,
            tools: opts.tools,
            tool_choice: roundOpts.tools ? { type: "auto" } : { type: "none" },
            ...(settings.thinking ? { thinking: settings.thinking } : {}),
            output_config: { effort: settings.effort },
          },
          { signal: opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout },
        );
        for await (const event of stream) {
          if (event.type === "content_block_start" && event.content_block.type === "tool_use") {
            roundOpts.onCall();
          } else if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
            if (firstTextMs === null) firstTextMs = Math.round(performance.now() - started);
            text += event.delta.text;
            roundOpts.onText(event.delta.text);
          }
          // 생각 블록(Opus의 빈 생각, Sonnet의 도구 사이 진행 메모)은 글로 내보내지 않는다.
        }
        message = await stream.finalMessage();
      } catch (e) {
        throw toModelError(e);
      }

      const u = message.usage;
      log(
        `[vergilius] ${model} round=${roundNo} stop=${message.stop_reason ?? "null"} ` +
          `first_text_ms=${firstTextMs ?? "-"} total_ms=${Math.round(performance.now() - started)} ` +
          `in=${u.input_tokens} cache_read=${u.cache_read_input_tokens ?? 0} cache_write=${u.cache_creation_input_tokens ?? 0} out=${u.output_tokens}`,
      );

      const reason = message.stop_reason;
      if (reason !== "end_turn" && reason !== "tool_use") {
        throw new VergiliusModelError(
          (reason !== null && STOP_REASON_KIND[reason]) || (reason === null ? "claude stop null" : "claude stop unexpected"),
        );
      }

      const calls: VergiliusToolCall[] = [];
      for (const block of message.content) {
        if (block.type === "tool_use") calls.push({ id: block.id, name: block.name, args: toArgs(block.input) });
      }
      // 생각 블록과 서명을 포함해 받은 그대로 넣는다(머리말).
      if (calls.length > 0) messages.push({ role: "assistant", content: message.content });
      return { text, calls };
    },

    pushToolResults(outcomes: VergiliusToolOutcome[]): void {
      messages.push({
        role: "user",
        content: outcomes.map(
          (o): Anthropic.ToolResultBlockParam => ({
            type: "tool_result",
            tool_use_id: o.call.id ?? "",
            content: JSON.stringify(o.response),
          }),
        ),
      });
    },
  };
}
