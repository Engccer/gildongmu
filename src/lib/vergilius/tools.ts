/**
 * 베르길리우스가 여는 도구와 회사별 형식(OpenAI·Gemini·Anthropic)으로의 변환층(E82 spec V20·V22·§4). React/Next 비의존.
 *
 * 도구 선언의 정본은 채팅의 `declarations.ts`다(고치지 않는다). 여기서는 그중 이 끝점에 여는 이름만 고르고,
 * 종결 도구 `propose_guide`를 더한 뒤, 회사별 요청 형식으로 바꾼다.
 *
 * 표기 차이(변환층 테스트 `tools.test.ts`):
 * - 스키마: Gemini 선언은 `parametersJsonSchema`(표준 JSON Schema, 소문자 타입) 또는 `parameters`(Gemini Schema, 대문자 타입
 *   `OBJECT`·`STRING`)를 쓴다. OpenAI는 표준 JSON Schema만 받으므로 대문자 타입은 소문자로 내린다.
 * - 짝 맞춤: OpenAI는 호출 id(`call_id`), Anthropic은 `tool_use_id`, Gemini는 이름(과 있으면 id)이다 — 각 어댑터가 맡는다.
 */
import type Anthropic from "@anthropic-ai/sdk";
import type { FunctionDeclaration } from "@google/genai";
import { availableDeclarations, ORIGIN_NOTE } from "@/lib/chat/declarations";

/** 종결 도구 이름(V22). */
export const PROPOSE_GUIDE_NAME = "propose_guide";

/** 이 끝점에 여는 채팅 도구(V20): 주변 버스, 버스 노선(E87), 대중교통 경로, 도보 경로, 자동차 경로, 장소 검색. */
export const VERGILIUS_CHAT_TOOL_NAMES: readonly string[] = [
  "get_bus_arrivals",
  "get_bus_route",
  "get_transit_route",
  "get_walk_route",
  "get_car_route",
  "search_places",
];

/**
 * 이 끝점에서 닫는 채팅 도구 인자(E88 spec A3). 길찾기의 말한 출발지 `origin`: 이 끝점의 버튼은 실제 위치에서 시작하는
 * 안내뿐이라 다른 곳에서 출발하는 경로를 답하지 않는다. 선언에서 떼고(`closeArgs`), 실행 직전에도 뗀다(`withoutClosedArgs`).
 */
export const VERGILIUS_CLOSED_ARGS: readonly string[] = ["origin"];

/** 모델이 스키마에 없는 닫힌 인자를 보내도 실행부에 닿지 않게 뗀다. 닫힌 인자가 없으면 같은 객체를 돌려준다. */
export function withoutClosedArgs(args: Record<string, unknown>): Record<string, unknown> {
  if (!VERGILIUS_CLOSED_ARGS.some((k) => k in args)) return args;
  return Object.fromEntries(Object.entries(args).filter(([k]) => !VERGILIUS_CLOSED_ARGS.includes(k)));
}

/** 선언에서 닫힌 인자의 속성과 그 인자를 가리키는 설명 문장을 뗀다. */
function closeArgs(spec: VergiliusToolSpec): VergiliusToolSpec {
  const properties = spec.parameters.properties;
  if (!properties || typeof properties !== "object") return spec;
  if (!VERGILIUS_CLOSED_ARGS.some((k) => k in (properties as Record<string, unknown>))) return spec;
  return {
    ...spec,
    description: spec.description.replace(ORIGIN_NOTE, ""),
    parameters: { ...spec.parameters, properties: withoutClosedArgs(properties as Record<string, unknown>) },
  };
}

/** 회사 중립 도구 선언. `parameters`는 표준 JSON Schema(소문자 타입)다. */
export interface VergiliusToolSpec {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export const PROPOSE_GUIDE_TOOL: VergiliusToolSpec = {
  name: PROPOSE_GUIDE_NAME,
  description:
    "사용자가 [주변 가게]나 [방금 말한 것]에 있는 곳으로 가자고 할 때, 그 가게로 도보 안내를 시작할지 묻는 버튼을 앱이 내게 한다. " +
    "placeId에는 목록에 적힌 id를 그대로 넣는다. 이 도구를 부르면 답이 끝난다(글을 덧붙이지 않는다). " +
    "목록에 없는 곳이나 여러 가게에 걸리는 이름에는 쓰지 않는다.",
  parameters: {
    type: "object",
    properties: {
      placeId: { type: "string", description: "[주변 가게]나 [방금 말한 것]에 적힌 가게 id" },
    },
    required: ["placeId"],
  },
};

const SCHEMA_TYPE_KEYS = new Set(["type"]);

/** Gemini Schema의 대문자 타입(`OBJECT`·`STRING`…)을 표준 JSON Schema의 소문자로 내린다. 그 밖의 키는 그대로 둔다. */
export function lowerSchemaTypes(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(lowerSchemaTypes);
  if (schema === null || typeof schema !== "object") return schema;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(schema as Record<string, unknown>)) {
    if (SCHEMA_TYPE_KEYS.has(key) && typeof value === "string") out[key] = value.toLowerCase();
    // `properties`의 값은 이름 → 스키마 사전이다: 속성 이름이 `type`이어도 스키마로 내려간다(위 분기는 문자열 값만 잡는다).
    else out[key] = lowerSchemaTypes(value);
  }
  return out;
}

/** Gemini 선언 하나 → 회사 중립 선언. 인자가 없는 도구는 빈 객체 스키마가 된다(OpenAI는 `parameters`가 객체여야 한다). */
export function specFromGeminiDeclaration(decl: FunctionDeclaration): VergiliusToolSpec {
  const raw = decl.parametersJsonSchema ?? (decl.parameters ? lowerSchemaTypes(decl.parameters) : undefined);
  const parameters: Record<string, unknown> =
    raw && typeof raw === "object" ? { ...(raw as Record<string, unknown>) } : { type: "object" };
  if (parameters.type === undefined) parameters.type = "object";
  if (parameters.type === "object" && parameters.properties === undefined) parameters.properties = {};
  return { name: decl.name ?? "", description: decl.description ?? "", parameters };
}

/**
 * 이 요청에 여는 도구 전부(키 게이트를 통과한 채팅 도구 + 종결 도구). 능력 집합은 비워 넘긴다 — 여정 도구는 열지 않는다.
 * `route-start` 렌더는 선언이 아니라 실행 컨텍스트(`ctx.routeStart`)가 연다.
 */
export function vergiliusToolSpecs(): VergiliusToolSpec[] {
  const chat = availableDeclarations(new Set())
    .filter((d) => d.name !== undefined && VERGILIUS_CHAT_TOOL_NAMES.includes(d.name))
    .map(specFromGeminiDeclaration)
    .map(closeArgs);
  return [...chat, PROPOSE_GUIDE_TOOL];
}

/** OpenAI Responses API의 함수 도구. `strict: false` — 채팅 선언은 선택 인자가 많아 strict 스키마 조건을 채우지 않는다. */
export interface OpenAiFunctionTool {
  type: "function";
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  strict: false;
}

export function toOpenAiTools(specs: readonly VergiliusToolSpec[]): OpenAiFunctionTool[] {
  return specs.map((s) => ({
    type: "function",
    name: s.name,
    description: s.description,
    parameters: s.parameters,
    strict: false,
  }));
}

/**
 * Anthropic Messages API의 사용자 정의 도구(`input_schema`는 표준 JSON Schema). strict와 eager input streaming은 켜지 않는다
 * (사유는 `claude.ts` 머리말). 순서와 내용은 요청마다 같아야 한다 — 도구 선언이 캐시 앞부분의 첫 조각이다.
 */
export function toAnthropicTools(specs: readonly VergiliusToolSpec[]): Anthropic.Tool[] {
  return specs.map((s) => ({
    name: s.name,
    description: s.description,
    input_schema: { ...s.parameters, type: "object" },
  }));
}

export function toGeminiDeclarations(specs: readonly VergiliusToolSpec[]): FunctionDeclaration[] {
  return specs.map((s) => ({ name: s.name, description: s.description, parametersJsonSchema: s.parameters }));
}
