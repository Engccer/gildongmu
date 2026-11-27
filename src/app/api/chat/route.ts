// /api/chat — Gemini multi-turn 에이전트 루프 + NDJSON 스트리밍
import type { Content } from "@google/genai";
import { getGeminiClient, GEMINI_MODEL } from "@/lib/gemini/client";
import { availableDeclarations } from "@/lib/chat/declarations";
import { buildChatSystemInstruction } from "@/lib/chat/system-instruction";
import { runAgentLoop } from "@/lib/chat/agent-loop";
import { dataLocale } from "@/lib/data-locale";
import { routing } from "@/i18n/routing";
import { checkChatRateLimit, clientIpFromHeaders } from "@/lib/rate-limit";
import type { ChatCapability, ExecutionContext, ChatStreamEvent } from "@/lib/chat/types";
import {
  availableChatModels,
  boundChatHistory,
  CHAT_MODEL_REQUEST_TIMEOUT_MS,
  createChatModelSession,
  isDailyCapped,
  parseChatModel,
  reserveChatModelDaily,
  type ChatModelId,
} from "@/lib/chat/chat-models";
import { ChatModelError } from "@/lib/chat/chat-model-error";
import { runChatModelLoop } from "@/lib/chat/model-loop";

export const maxDuration = 120; // 적극 연쇄 + 여러 Gemini 호출 — 조기 중단 방지

interface ChatRequest {
  messages: { role: "user" | "assistant"; text: string }[];
  userLocation?: { lat: number; lng: number };
  locale?: string;
  /** 장소 상세에서 연 채팅일 때 — 좌표 도구의 장소 앵커(I-1) + LLM 지시(I-3). */
  placeContext?: { name: string; lat: number; lng: number; category?: string; isStation?: boolean };
  /** 클라이언트가 그릴 수 있는 것의 신고(E70-b D7·E83 R2). 알려진 값 `"journey"`·`"route-start"`, 모르는 값은 버린다. 없으면 종전과 동일. */
  capabilities?: string[];
  /** `userLocation`이 수동 지정 위치인가(E70-b D2·E83 R6) — 카드의 `manualOrigin`으로 돌려준다(그 카드는 실제 위치로 다시 조회한다). */
  userLocationManual?: boolean;
  /**
   * 「채팅 답변 모델」(E89, 3.0 정식판 E92). 알려진 다섯 값(`chat-models.ts`)만 다른 회사로 간다. 없거나 모르는 값이면 종전 Gemini 경로 그대로다
   * (2.8 이하 앱 보호. 3.0 앱은 Terra를 고르면 `openai`를 싣고, 웹·CLI는 2026-11-28부터 `openai`를 고정으로 싣는다. 가드 `chat-model-seal.test.ts`).
   */
  chatModel?: unknown;
}

/**
 * 요청의 능력 신고를 서버가 아는 값으로 거른다(E70-b D7). 여정은 ko 전용이라(택시 안내 기하가 Tmap ko 경로에만 있다)
 * 다른 로케일의 신고는 버린다. 키 게이트는 선언 쪽(`availableDeclarations`)이 건다.
 * 경로 안내 시작 카드(`route-start`, E83 R2)는 전 로케일이다 — 수단별로 시작할 수 있는지는 카드를 그리는 클라이언트가 가른다(R10).
 */
function chatCapabilities(raw: unknown, locale: string): Set<ChatCapability> {
  const out = new Set<ChatCapability>();
  if (!Array.isArray(raw)) return out;
  if (raw.includes("journey") && locale === "ko") out.add("journey");
  if (raw.includes("route-start")) out.add("route-start");
  return out;
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
  const clientIp = clientIpFromHeaders(request.headers);
  if (!checkChatRateLimit(clientIp, Date.now())) {
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
  // 선언 목록이 정본이다: `plan_journey`가 실제로 선언됐을 때만(능력 신고 ∧ ko ∧ 키 셋) 실행 컨텍스트와 지침을 연다.
  // 장소 상세에서 연 채팅(`placeContext`)에는 여정을 열지 않는다(첫 판 비목표) — 클라이언트가 신고해도 서버가 닫는다.
  // 경로 안내 시작 카드(E83)도 같은 자리에서 닫는다 — 장소 채팅은 빈 집합이다.
  const capabilities: Set<ChatCapability> = pc ? new Set() : chatCapabilities(body.capabilities, locale);
  const declarations = availableDeclarations(capabilities);
  const journeyOpen = declarations.some((d) => d.name === "plan_journey");
  const ctx: ExecutionContext = {
    userLocation: body.userLocation,
    placeAnchor: pc ? { lat: pc.lat, lng: pc.lng, name: pc.name } : undefined,
    ...(journeyOpen
      ? { journey: { clientIp, manualOrigin: body.userLocationManual === true, turn: { asked: false, queried: false } } }
      : {}),
    // 신고가 없으면 키 자체가 없다(실행 컨텍스트가 종전과 같다).
    ...(capabilities.has("route-start") ? { routeStart: { manualOrigin: body.userLocationManual === true } } : {}),
    locale,
    dataLocale: dataLocale(locale),
  };

  const systemInstruction = buildChatSystemInstruction(locale, pc, { journey: journeyOpen });

  // E89: 알려진 값이면 그 회사로 간다. 여기서 갈라진 뒤 아래 Gemini 줄은 종전 그대로다(값이 없으면 이 분기에 들지 않는다).
  const chatModel = parseChatModel(body.chatModel);
  if (chatModel) {
    return otherModelResponse(request, chatModel, { systemInstruction, declarations, ctx, messages: body.messages });
  }

  const tools = [{ functionDeclarations: declarations }];
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

function jsonError(error: string, status: number): Response {
  return new Response(JSON.stringify({ error }), { status, headers: { "Content-Type": "application/json" } });
}

/** 로그에 남길 종류와 상태 코드. 메시지 본문은 넣지 않는다(요청 글이 되비칠 수 있다, spec C12). */
function errorKind(e: unknown): string {
  if (e instanceof ChatModelError) return e.status === null ? e.kind : `${e.kind} ${e.status}`;
  return e instanceof Error ? e.name : "unknown";
}

/**
 * Gemini 밖 회사의 채팅(E89 spec C3·C4·C9·C10). 응답 계약(NDJSON `status`·`done`·`error`)은 Gemini 경로와 같다.
 * 키 없음은 502(스트림 전), 하루 상한(Terra 제외, E92 A5)은 503, 그 밖의 실패는 기존 `chat_failed`다. Gemini로 돌리지 않는다.
 */
function otherModelResponse(
  request: Request,
  id: ChatModelId,
  input: {
    systemInstruction: string;
    declarations: ReturnType<typeof availableDeclarations>;
    ctx: ExecutionContext;
    messages: ChatRequest["messages"];
  },
): Response {
  if (!availableChatModels().includes(id)) return jsonError("chat_model_unavailable", 502);
  const session = createChatModelSession({
    id,
    systemInstruction: input.systemInstruction,
    declarations: input.declarations,
    history: boundChatHistory(input.messages),
    signal: AbortSignal.any([request.signal, AbortSignal.timeout(CHAT_MODEL_REQUEST_TIMEOUT_MS)]),
  });
  if (!session) return jsonError("chat_model_unavailable", 502);
  if (isDailyCapped(id) && !reserveChatModelDaily(Date.now())) return jsonError("daily_budget_exhausted", 503);

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (e: ChatStreamEvent) => controller.enqueue(encoder.encode(toNdjsonLine(e)));
      try {
        const result = await runChatModelLoop({
          session,
          ctx: input.ctx,
          onStatus: (names) => send({ type: "status", categories: names }),
        });
        send({ type: "done", text: result.text, renders: result.renders, sources: result.sources });
      } catch (e) {
        // 앱이 요청을 거뒀으면(연결 끊김) 받을 곳이 없다 — 오류로 세지 않고 조용히 끝낸다.
        if (!request.signal.aborted) {
          console.error(`[chat] ${id} 오류:`, errorKind(e));
          try {
            send({ type: "error", code: "chat_failed" });
          } catch {
            // 스트림이 이미 닫혔다.
          }
        }
      } finally {
        try {
          controller.close();
        } catch {
          // 거둬진 스트림은 이미 닫혀 있다.
        }
      }
    },
  });
  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-cache" },
  });
}
