/**
 * OpenAI 어댑터 — Responses API(`POST /v1/responses`, 스트리밍)를 `fetch`로 부른다(E82 spec V23·V24). React/Next 비의존.
 *
 * 계약(공식 문서 function-calling·streaming 가이드, 2026-11-14 확인):
 * - 도구는 `{type:"function", name, description, parameters, strict}`.
 * - 스트림은 SSE이고, 글 조각은 `response.output_text.delta`, 출력 항목의 시작·끝은 `response.output_item.added`·`.done`이다.
 *   도구 호출은 `function_call` 항목(`call_id`·`name`·`arguments` JSON 문자열)으로 온다.
 * - 도구 결과는 다음 요청의 `input`에 `{type:"function_call_output", call_id, output}`으로 넣는다. **짝은 `call_id`다** —
 *   같은 도구를 한 회차에 두 번 불러도 id가 달라 섞이지 않는다.
 * - 저장하지 않는다(`store: false`). 이력은 매 회차 전량을 다시 보낸다.
 */
import type { OpenAiFunctionTool } from "./tools";
import type {
  VergiliusModelSession,
  VergiliusRoundOptions,
  VergiliusRoundResult,
  VergiliusToolCall,
  VergiliusToolOutcome,
} from "./types";

// 2026-11-14 모델 목록 API(`GET /v1/models`)에서 확인. 지연 조사(`RESEARCH-2026-11-14-e82-voice-latency.md` §2.2)에서
// 추론을 끈 채 첫 문장 1.2초였다. 바꿀 때는 `docs/evals/2026-11-14-e82-vergilius-ask.md`의 일곱 질문 표를 다시 낸다.
export const OPENAI_VERGILIUS_MODEL = "gpt-6.1-terra";

const RESPONSES_URL = "https://api.openai.com/v1/responses";
/** 한 회차의 상한. 걷는 사람은 8초 안에 첫 문장이 없으면 실패 문장을 듣는다(V17) — 그보다 오래 붙들 이유가 없다. */
const ROUND_TIMEOUT_MS = 20_000;
/** 답은 한두 문장이다. 도구 인자까지 넉넉히 잡는다. */
const MAX_OUTPUT_TOKENS = 600;

type InputItem = Record<string, unknown>;

export interface OpenAiSessionOptions {
  apiKey: string;
  instruction: string;
  /** 첫 사용자 글(재료 + 질문). */
  material: string;
  tools: OpenAiFunctionTool[];
  model?: string;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
}

/** SSE 본문을 `data:` 줄 단위 JSON으로 읽는다(이벤트 이름은 본문의 `type`과 같아 따로 읽지 않는다). */
export async function* readSseJson(body: ReadableStream<Uint8Array>): AsyncGenerator<Record<string, unknown>> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const parse = (lineText: string): Record<string, unknown> | null => {
    if (!lineText.startsWith("data:")) return null;
    const payload = lineText.slice(5).trim();
    if (payload === "" || payload === "[DONE]") return null;
    return JSON.parse(payload) as Record<string, unknown>;
  };
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let newline = buffer.indexOf("\n");
    while (newline !== -1) {
      const event = parse(buffer.slice(0, newline).replace(/\r$/, ""));
      buffer = buffer.slice(newline + 1);
      if (event) yield event;
      newline = buffer.indexOf("\n");
    }
  }
  const last = parse(buffer.trim());
  if (last) yield last;
}

function parseArguments(raw: unknown): Record<string, unknown> {
  if (typeof raw !== "string" || raw.trim() === "") return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    // 깨진 인자는 빈 인자로 실행부에 넘긴다 — 실행부가 「목적지가 필요합니다」 같은 오류로 답한다.
    return {};
  }
}

export function createOpenAiSession(opts: OpenAiSessionOptions): VergiliusModelSession {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const model = opts.model ?? OPENAI_VERGILIUS_MODEL;
  const input: InputItem[] = [{ role: "user", content: opts.material }];

  return {
    async round(roundOpts: VergiliusRoundOptions): Promise<VergiliusRoundResult> {
      const timeout = AbortSignal.timeout(ROUND_TIMEOUT_MS);
      const res = await fetchImpl(RESPONSES_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${opts.apiKey}` },
        body: JSON.stringify({
          model,
          instructions: opts.instruction,
          input,
          tools: opts.tools,
          // 도구를 닫은 회차도 선언은 그대로 둔다 — 이력의 `function_call` 항목이 가리키는 도구가 요청에 있어야 한다.
          tool_choice: roundOpts.tools ? "auto" : "none",
          parallel_tool_calls: true,
          reasoning: { effort: "none" },
          max_output_tokens: MAX_OUTPUT_TOKENS,
          stream: true,
          store: false,
        }),
        signal: opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout,
      });
      if (!res.ok || !res.body) {
        // 본문에는 요청 글이 되비칠 수 있어 상태만 남긴다(질문 글·재료를 로그에 쓰지 않는다).
        throw new Error(`openai responses ${res.status}`);
      }

      let text = "";
      const calls: VergiliusToolCall[] = [];
      const history: InputItem[] = [];
      let completed = false;

      for await (const event of readSseJson(res.body)) {
        const type = event.type;
        if (type === "response.output_text.delta") {
          const delta = typeof event.delta === "string" ? event.delta : "";
          text += delta;
          roundOpts.onText(delta);
        } else if (type === "response.output_item.added") {
          const item = event.item as Record<string, unknown> | undefined;
          if (item?.type === "function_call") roundOpts.onCall();
        } else if (type === "response.output_item.done") {
          const item = event.item as Record<string, unknown> | undefined;
          if (item?.type === "function_call") {
            const callId = String(item.call_id ?? "");
            const name = String(item.name ?? "");
            const args = typeof item.arguments === "string" ? item.arguments : "{}";
            calls.push({ id: callId, name, args: parseArguments(args) });
            history.push({ type: "function_call", call_id: callId, name, arguments: args });
          }
        } else if (type === "response.completed") {
          completed = true;
        } else if (type === "response.failed" || type === "response.incomplete" || type === "error") {
          throw new Error(`openai stream ${String(type)}`);
        }
      }
      if (!completed) throw new Error("openai stream ended early");

      // 도구 호출이 있는 회차의 글(군말)도 이력에는 남긴다 — 모델이 자기 말을 이어받는다.
      if (calls.length > 0 && text !== "") input.push({ role: "assistant", content: text });
      input.push(...history);
      return { text, calls };
    },

    pushToolResults(outcomes: VergiliusToolOutcome[]): void {
      for (const o of outcomes) {
        input.push({ type: "function_call_output", call_id: o.call.id ?? "", output: JSON.stringify(o.response) });
      }
    },
  };
}
