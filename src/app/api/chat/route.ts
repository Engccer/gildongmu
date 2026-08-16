// /api/chat — Gemini multi-turn 에이전트 루프 + NDJSON 스트리밍
import type { Content } from "@google/genai";
import { getGeminiClient, GEMINI_MODEL } from "@/lib/gemini/client";
import { availableDeclarations } from "@/lib/chat/declarations";
import { buildChatSystemInstruction } from "@/lib/chat/system-instruction";
import { runAgentLoop } from "@/lib/chat/agent-loop";
import { dataLocale } from "@/lib/data-locale";
import { checkChatRateLimit, clientIpFromHeaders } from "@/lib/rate-limit";
import type { ExecutionContext, ChatStreamEvent } from "@/lib/chat/types";

export const dynamic = "force-dynamic";
export const maxDuration = 120; // 적극 연쇄 + 여러 Gemini 호출 — 조기 중단 방지

interface ChatRequest {
  messages: { role: "user" | "assistant"; text: string }[];
  userLocation?: { lat: number; lng: number };
  locale?: string;
  /** 장소 상세에서 연 채팅일 때 — 좌표 도구의 장소 앵커(I-1) + LLM 지시(I-3). */
  placeContext?: { name: string; lat: number; lng: number; category?: string; isStation?: boolean };
}

export async function POST(request: Request) {
  // 무인증 공개 API의 유료 호출(Gemini·Perplexity) 비용 방어 — 스펙 §5.
  if (!checkChatRateLimit(clientIpFromHeaders(request.headers), Date.now())) {
    return new Response(JSON.stringify({ error: "rate_limited" }), {
      status: 429, headers: { "Content-Type": "application/json" },
    });
  }

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
  const pc = body.placeContext;
  const ctx: ExecutionContext = {
    userLocation: body.userLocation,
    placeAnchor: pc ? { lat: pc.lat, lng: pc.lng, name: pc.name } : undefined,
    locale,
    dataLocale: dataLocale(locale),
  };

  const systemInstruction = buildChatSystemInstruction(locale, pc);

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
