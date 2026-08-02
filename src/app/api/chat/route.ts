// /api/chat — Gemini multi-turn 에이전트 루프 + NDJSON 스트리밍
import type { Content } from "@google/genai";
import { unstable_cache } from "next/cache";
import { getGeminiClient, GEMINI_MODEL } from "@/lib/gemini/client";
import { availableDeclarations } from "@/lib/chat/declarations";
import { runAgentLoop } from "@/lib/chat/agent-loop";
import { dataLocale } from "@/lib/data-locale";
import { checkChatRateLimit, clientIpFromHeaders } from "@/lib/rate-limit";
import { configureWalkInfraTileCache } from "@/lib/walk-infra";
import type { ExecutionContext, ChatStreamEvent } from "@/lib/chat/types";

// Overpass 타일 1시간 지속 캐시 주입 — walk-infra는 Next 비의존 유지(이식성 규칙).
configureWalkInfraTileCache((fetcher, key) =>
  unstable_cache(fetcher, [key], { revalidate: 3600 })(),
);

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

  const placeInstruction = pc
    ? `\n[장소 컨텍스트]\n` +
      `- 사용자는 지금 '${pc.name}'${pc.category ? `(${pc.category})` : ""}에 관해 묻고 있다. "여기/이곳/근처/주변"은 이 장소를 가리킨다.\n` +
      `- 주변 시설·교통·공기질 등 위치 기반 조회는 이 장소를 기준으로 한다(지명을 따로 주지 않아도 이 장소가 기본 위치다).\n` +
      `- 단 "여기까지 가는 법" 같은 길찾기는 사용자의 현재 위치에서 '${pc.name}'(으)로 가는 경로다 — 길찾기 도구의 목적지로 '${pc.name}'을(를) 넘겨라.`
    : "";

  const systemInstruction =
    `너는 한국 로컬 정보 에이전트다. 사용자 언어(${locale})로 답한다.\n` +
    `[도구 사용]\n` +
    `- 사용자 의도를 충족하는 데 필요한 도구를 충분히 호출하라. 관련 정보는 자율적으로 연쇄 조회하되, 명백히 무관한 건 호출하지 마라.\n` +
    `- "확인 중", "잠시만요" 같은 대기 멘트로 턴을 끝내지 마라. 이 채팅엔 자동 후속이 없다 — 도구를 쓸 거면 같은 턴에 호출하고, 충분한 결과를 모은 뒤에만 최종 답변하라.\n` +
    `- 최신·실시간 웹 정보(뉴스·정책·환율·임시 운영시간 등)는 search_web으로 조회하라. 단 국내 장소·교통·공기질·날씨는 전용 도구가 정본이니 그쪽을 우선하고, 전용 도구가 못 다루는 시의성 정보일 때만 search_web을 쓴다.\n` +
    `[신뢰성]\n` +
    `- 도구가 돌려준 필드(이름·분류·주소·수치·등급·경로 등)만 사실로 전달하라. 장소의 분위기·평판·메뉴·인테리어처럼 도구가 주지 않은 특징은 네 사전지식으로라도 지어내지 마라(사용자는 시각으로 검증할 수 없다). 더 알아야 하면 도구를 호출하고, 없으면 그 한계를 인정하라.\n` +
    `- 도구가 실패하거나 빈 결과면 지어내지 말고, 실패를 분명히 알려라. 대안은 이 앱 안에서 사용자가 할 수 있는 행동 한 가지로 제시하라(다른 지도·내비 앱 안내는 대안이 아니다).\n` +
    `- 출처·딥링크는 시스템이 응답 하단에 자동으로 붙인다. 본문엔 URL을 나열하지 말고 간결하게 핵심만 종합하라.` +
    placeInstruction;

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
