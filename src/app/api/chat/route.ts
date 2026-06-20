// /api/chat — Gemini multi-turn 에이전트 루프 + NDJSON 스트리밍
import type { Content } from "@google/genai";
import { getGeminiClient, GEMINI_MODEL } from "@/lib/gemini/client";
import { availableDeclarations } from "@/lib/chat/declarations";
import { runAgentLoop } from "@/lib/chat/agent-loop";
import { dataLocale } from "@/lib/data-locale";
import type { ExecutionContext, ChatStreamEvent } from "@/lib/chat/types";

export const dynamic = "force-dynamic";
export const maxDuration = 120; // 적극 연쇄 + 여러 Gemini 호출 — 조기 중단 방지

interface ChatRequest {
  messages: { role: "user" | "assistant"; text: string }[];
  userLocation?: { lat: number; lng: number };
  locale?: string;
}

export async function POST(request: Request) {
  const ai = getGeminiClient();
  if (!ai) {
    return new Response(JSON.stringify({ error: "chat_unavailable" }), {
      status: 502, headers: { "Content-Type": "application/json" },
    });
  }

  let body: ChatRequest;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: "invalid_body" }), {
      status: 400, headers: { "Content-Type": "application/json" },
    });
  }

  const locale = body.locale ?? "ko";
  const ctx: ExecutionContext = { userLocation: body.userLocation, locale, dataLocale: dataLocale(locale) };

  const systemInstruction =
    `너는 한국 로컬 정보 에이전트다. 사용자 언어(${locale})로 답한다.\n` +
    `[도구 사용]\n` +
    `- 사용자 의도를 충족하는 데 필요한 도구를 충분히 호출하라. 관련 정보(경로 질문이면 날씨·공기질 등)는 자율적으로 연쇄 조회하되, 명백히 무관한 건 호출하지 마라.\n` +
    `- "확인 중", "잠시만요" 같은 대기 멘트로 턴을 끝내지 마라. 이 채팅엔 자동 후속이 없다 — 도구를 쓸 거면 같은 턴에 호출하고, 충분한 결과를 모은 뒤에만 최종 답변하라.\n` +
    `[신뢰성]\n` +
    `- 도구 결과 데이터에 근거해서만 사실을 말하라. 도구가 실패하거나 빈 결과면 지어내지 말고, 실패를 분명히 알린 뒤 구체적 대안 한 가지를 제시하라.\n` +
    `- 출처·딥링크는 시스템이 응답 하단에 자동으로 붙인다. 본문엔 URL을 나열하지 말고 간결하게 핵심만 종합하라.`;

  const tools = [{ functionDeclarations: availableDeclarations() }];
  const history: Content[] = body.messages.map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.text }],
  }));

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (e: ChatStreamEvent) => controller.enqueue(encoder.encode(JSON.stringify(e) + "\n"));
      try {
        const result = await runAgentLoop({
          ai, model: GEMINI_MODEL, systemInstruction, tools, history, ctx,
          onStatus: (names) => send({ type: "status", categories: names }),
        });
        send({ type: "done", text: result.text, renders: result.renders, sources: result.sources });
      } catch (e) {
        console.error("[chat] 에이전트 루프 오류:", e);
        send({ type: "error", code: "chat_failed" });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-cache" },
  });
}
