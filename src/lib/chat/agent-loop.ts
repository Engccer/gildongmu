/**
 * multi-turn 함수호출 에이전트 루프. ai 클라이언트 주입형(테스트 가능), React/Next 비의존.
 *
 * functionCall → executeFunction(실데이터) → 결과 관찰을 maxIterations까지 반복하며
 * renders·sources를 누적한다. 도구 실패는 흡수해 LLM에 error로 전달(루프 안 죽임).
 * 루프 후 text가 비면 tools 없이 1회 강제(빈 버블 차단).
 */
import type { GoogleGenAI, Content, Part, FunctionCall } from "@google/genai";
import type { FunctionDeclaration } from "@google/genai";
import type { ExecutionContext, RenderPayload, SourceAttribution } from "./types";
import { executeFunction } from "./router";
import { dedupeSources } from "./sources";

export interface AgentLoopResult {
  text: string;
  renders: RenderPayload[];
  sources: SourceAttribution[];
}

export interface AgentLoopOptions {
  ai: GoogleGenAI;
  model: string;
  systemInstruction: string;
  tools: { functionDeclarations: FunctionDeclaration[] }[];
  history: Content[];
  ctx: ExecutionContext;
  onStatus?: (toolNames: string[]) => void;
  maxIterations?: number;
}

function functionCallParts(parts: Part[]): (Part & { functionCall: FunctionCall })[] {
  return parts.filter((p): p is Part & { functionCall: FunctionCall } => "functionCall" in p);
}

export async function runAgentLoop(opts: AgentLoopOptions): Promise<AgentLoopResult> {
  const { ai, model, systemInstruction, tools, ctx, onStatus } = opts;
  const maxIterations = opts.maxIterations ?? 6;
  const history = [...opts.history];
  const renders: RenderPayload[] = [];
  const sources: SourceAttribution[] = [];

  let response = await ai.models.generateContent({
    model, contents: history, config: { systemInstruction, tools },
  });

  for (let iter = 0; iter < maxIterations; iter++) {
    const parts: Part[] = response.candidates?.[0]?.content?.parts ?? [];
    const fcParts = functionCallParts(parts);
    if (fcParts.length === 0) break;

    // Gemini 3 규약: model content(thoughtSignature 포함) 보존
    history.push(response.candidates![0].content! as Content);
    onStatus?.(fcParts.map((p) => p.functionCall.name ?? "unknown"));

    const settled = await Promise.allSettled(
      fcParts.map((p) =>
        executeFunction(
          p.functionCall.name ?? "",
          (p.functionCall.args ?? {}) as Record<string, unknown>,
          ctx,
        ),
      ),
    );

    const responseParts: Part[] = settled.map((s, idx) => {
      const name = fcParts[idx].functionCall.name!;
      if (s.status === "fulfilled") {
        if (s.value.render) renders.push(s.value.render);
        if (s.value.source) sources.push(...s.value.source);
        return { functionResponse: { name, response: s.value.data } };
      }
      // I-1: 실패를 LLM에 전달, 루프 유지
      return { functionResponse: { name, response: { error: String(s.reason) } } };
    });
    history.push({ role: "user", parts: responseParts });

    response = await ai.models.generateContent({
      model, contents: history, config: { systemInstruction, tools },
    });
  }

  let text = response.text ?? "";
  if (text.trim() === "") {
    // I-2: tools 없이 1회 강제 산문 (빈 버블 차단)
    const retry = await ai.models.generateContent({
      model, contents: history, config: { systemInstruction },
    });
    text = retry.text ?? "";
  }

  return { text, renders, sources: dedupeSources(sources) };
}
