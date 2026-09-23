// /api/chat — Gemini multi-turn 에이전트 루프 + NDJSON 스트리밍
import type { Content } from "@google/genai";
import { getGeminiClient, GEMINI_MODEL } from "@/lib/gemini/client";
import { availableDeclarations } from "@/lib/chat/declarations";
import { buildChatSystemInstruction } from "@/lib/chat/system-instruction";
import { runAgentLoop } from "@/lib/chat/agent-loop";
import { dataLocale } from "@/lib/data-locale";
import { routing } from "@/i18n/routing";
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

// A44: JSON.stringify는 U+2028·U+2029·U+0085를 날 문자로 둔다. Swift `bytes.lines`(와 Kotlin 미러)는
// 그 문자를 줄 경계로 읽어 이벤트 한 줄을 쪼개고, 깨진 조각은 디코딩 실패 → 답변 전체 유실이다.
// 직렬화 뒤 `\uXXXX` 이스케이프로 바꾼다 — 같은 JSON 값이라 구버전 클라이언트도 그대로 읽는다.
// (소스에 날 문자·이스케이프 표기를 두지 않으려고 코드 포인트로 조립한다.)
const LINE_BREAKING_CODE_POINTS = [0x2028, 0x2029, 0x0085];

function toNdjsonLine(event: ChatStreamEvent): string {
  let json = JSON.stringify(event);
  for (const cp of LINE_BREAKING_CODE_POINTS) {
    json = json.split(String.fromCharCode(cp)).join("\\" + "u" + cp.toString(16).padStart(4, "0"));
  }
  return json + "\n";
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

  // 지원 6로케일만(E27 원칙, 2026-09-02 통일): 누락=ko, 미지 값은 400. 종전엔 무검증이라
  // `EN`·`ko-KR`이 그대로 systemInstruction("사용자 언어(EN)")과 dataLocale 판정에 들어갔다 —
  // 오류도 빈 결과도 아니라 CLI `--lang` 오타가 영문 답변으로 위장했다.
  const locale = body.locale ?? "ko";
  if (!(routing.locales as readonly string[]).includes(locale)) {
    return new Response(JSON.stringify({ error: "invalid_locale" }), {
      status: 400, headers: { "Content-Type": "application/json" },
    });
  }
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
      const send = (e: ChatStreamEvent) => controller.enqueue(encoder.encode(toNdjsonLine(e)));
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
