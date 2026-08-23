// /api/chat/suggestions — 답변 뒤 follow-up 칩 3개(spec 2026-08-24 §3.1).
// 본 채팅 스트림과 분리된 경량 호출(thinking low·도구 없음 — 3.6-flash는 thinkingBudget 0을 400으로 거부한다, 실호출 2026-08-24). 키 없음·실패·타임아웃·파싱 불가
// 전부 `{ suggestions: [] }` 200 — 칩 부재는 정상 상태라 오류가 아니다(본 대화 무영향).
import { NextResponse } from "next/server";
import { ThinkingLevel } from "@google/genai";
import { z } from "zod";
import { getGeminiClient, GEMINI_MODEL } from "@/lib/gemini/client";
import { buildFollowUpPrompt, parseFollowUps } from "@/lib/chat/follow-up";
import { checkSuggestionsRateLimit, clientIpFromHeaders } from "@/lib/rate-limit";
import { routing } from "@/i18n/routing";

export const dynamic = "force-dynamic";

// 길이는 400이 아니라 절단 — 클라이언트는 원문을 그대로 보내고, 긴 답변(카드 13곳 + 출처)일수록
// 칩이 유용한데 정확히 그 답변에서만 칩이 사라지는 것을 막는다. 앞부분이 대화 맥락의 핵심이다.
const schema = z.object({
  lastUserMessage: z.string().min(1).transform((s) => s.slice(0, 4000)),
  lastAssistantMessage: z.string().min(1).transform((s) => s.slice(0, 8000)),
  locale: z.enum(routing.locales),
  placeName: z.string().max(200).optional(),
});

const EMPTY = { suggestions: [] as string[] };

export async function POST(request: Request) {
  if (!checkSuggestionsRateLimit(clientIpFromHeaders(request.headers), Date.now())) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: "invalid_body" }, { status: 400 });

  const ai = getGeminiClient();
  if (!ai) return NextResponse.json(EMPTY);

  try {
    const res = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: buildFollowUpPrompt(parsed.data),
      // 클라이언트가 6초에 abort하므로 서버도 같은 상한 — 람다가 버려진 응답을 끝까지 기다리지 않게.
      config: { thinkingConfig: { thinkingLevel: ThinkingLevel.LOW }, abortSignal: AbortSignal.timeout(6000) },
    });
    return NextResponse.json({ suggestions: parseFollowUps(res.text) });
  } catch (e) {
    console.error("[chat/suggestions] 생성 실패:", e);
    return NextResponse.json(EMPTY);
  }
}
