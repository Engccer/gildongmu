// /api/chat — Gemini 2-pass function-calling 엔드포인트 (비스트리밍 단일 호출)
import { NextResponse } from "next/server";
import type { Content, Part, FunctionCall } from "@google/genai";
import { getGeminiClient, GEMINI_MODEL } from "@/lib/gemini/client";
import { availableDeclarations } from "@/lib/chat/declarations";
import { executeFunction } from "@/lib/chat/router";
import { dataLocale } from "@/lib/data-locale";
import type { ExecutionContext, RenderPayload } from "@/lib/chat/types";

export const dynamic = "force-dynamic";

interface ChatRequest {
  messages: { role: "user" | "assistant"; text: string }[];
  userLocation?: { lat: number; lng: number };
  locale?: string;
}

export async function POST(request: Request) {
  const ai = getGeminiClient();
  if (!ai) {
    return NextResponse.json({ error: "chat_unavailable" }, { status: 502 });
  }

  let body: ChatRequest;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  const locale = body.locale ?? "ko";
  const ctx: ExecutionContext = {
    userLocation: body.userLocation,
    locale,
    dataLocale: dataLocale(locale),
  };

  const systemInstruction =
    `너는 한국 로컬 정보 도우미다. 사용자의 언어(${locale})로 간결히 답한다. ` +
    `도구 결과(data)를 바탕으로만 사실을 말하고, 추측하지 않는다.`;
  const tools = [{ functionDeclarations: availableDeclarations() }];

  // messages → Gemini Contents (assistant → model 역할 변환)
  const history: Content[] = body.messages.map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.text }],
  }));

  try {
    let response = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: history,
      config: { systemInstruction, tools },
    });

    let render: RenderPayload | undefined;

    // 1차 응답에서 functionCall 파트 탐색
    const parts: Part[] = response.candidates?.[0]?.content?.parts ?? [];
    const fcPart = parts.find(
      (p): p is Part & { functionCall: FunctionCall } => "functionCall" in p
    );

    if (fcPart) {
      // Gemini 3 규약: model content(thoughtSignature 포함)를 history에 보존
      const modelContent = response.candidates![0].content!;
      history.push(modelContent as Content);

      const { name, args } = fcPart.functionCall;
      const result = await executeFunction(
        name ?? "",
        (args ?? {}) as Record<string, unknown>,
        ctx
      );
      render = result.render;

      // tool 응답(실데이터)을 user role로 되돌려 2차 generateContent 호출
      history.push({
        role: "user",
        parts: [
          {
            functionResponse: {
              name: name!,
              response: result.data,   // ← summary → 실데이터
            },
          },
        ],
      });

      // 2차 패스는 도구 결과(summary) 기반 산문 생성이 목적이므로 tools를 넘기지
      // 않는다 — 모델이 다시 functionCall을 반환해 text=""(빈 버블)이 되는 경로를
      // 구조적으로 차단한다(V1 단일 함수호출 설계).
      response = await ai.models.generateContent({
        model: GEMINI_MODEL,
        contents: history,
        config: { systemInstruction },
      });
    }

    return NextResponse.json({ text: response.text ?? "", render });
  } catch (e) {
    console.error("[chat] Gemini 오류:", e);
    return NextResponse.json({ error: "chat_failed" }, { status: 502 });
  }
}
