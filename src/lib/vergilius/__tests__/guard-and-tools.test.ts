import { describe, expect, it } from "vitest";
import type { FunctionDeclaration } from "@google/genai";
import type { RenderPayload, RouteStartRenderPayload } from "@/lib/chat/types";
import { proposableIds, routeStartRendersOnly, validateProposal } from "../guard";
import {
  PROPOSE_GUIDE_NAME,
  PROPOSE_GUIDE_TOOL,
  VERGILIUS_CHAT_TOOL_NAMES,
  lowerSchemaTypes,
  specFromGeminiDeclaration,
  toGeminiDeclarations,
  toOpenAiTools,
  vergiliusToolSpecs,
} from "../tools";
import { askFixture } from "./fixtures";

const routeStart: RouteStartRenderPayload = {
  type: "route-start",
  mode: "walk",
  dest: { lat: 37.5716, lng: 126.9769 },
  destLabel: "광화문역",
  destRoman: null,
  via: null,
  accessible: false,
  carProvider: null,
  transit: null,
};

describe("제안 검증", () => {
  const allowed = proposableIds(askFixture());

  it("지목할 수 있는 id는 places[].id와 log[].placeId의 합집합이다", () => {
    expect([...allowed].sort()).toEqual(["k101", "k102", "k103", "k200"]);
  });

  it("요청에 있던 id만 통과한다", () => {
    expect(validateProposal({ placeId: "k101" }, allowed)).toBe("k101");
    expect(validateProposal({ placeId: " k200 " }, allowed)).toBe("k200");
  });

  it("없는 id, 이름, 다른 타입은 버린다", () => {
    expect(validateProposal({ placeId: "k999" }, allowed)).toBeNull();
    expect(validateProposal({ placeId: "가나카페" }, allowed)).toBeNull();
    expect(validateProposal({ placeId: 101 }, allowed)).toBeNull();
    expect(validateProposal({}, allowed)).toBeNull();
    expect(validateProposal({ placeId: "K101" }, allowed)).toBeNull();
  });
});

describe("렌더 필터", () => {
  it("route-start만 통과시키고 순서를 지킨다", () => {
    const transit: RouteStartRenderPayload = { ...routeStart, mode: "car", carProvider: "tmap" };
    const renders: RenderPayload[] = [
      { type: "places", places: [] },
      routeStart,
      { type: "bus", mode: "current" },
      { type: "transit-route", dest: { lat: 1, lng: 2, name: "x" } },
      transit,
    ];
    expect(routeStartRendersOnly(renders)).toEqual([routeStart, transit]);
  });
});

describe("도구 선언 변환층", () => {
  it("여는 도구는 다섯 채팅 도구와 종결 도구뿐이다(여정·웹 검색 등은 열지 않는다)", () => {
    const names = vergiliusToolSpecs().map((s) => s.name);
    expect(names.at(-1)).toBe(PROPOSE_GUIDE_NAME);
    for (const n of names.slice(0, -1)) expect(VERGILIUS_CHAT_TOOL_NAMES).toContain(n);
    expect(names).not.toContain("plan_journey");
    expect(names).not.toContain("search_web");
  });

  it("스키마 타입 표기: Gemini Schema의 대문자 타입은 OpenAI용 소문자 JSON Schema가 된다", () => {
    const decl = {
      name: "t",
      description: "d",
      parameters: {
        type: "OBJECT",
        properties: {
          destination: { type: "STRING", description: "목적지" },
          accessible: { type: "BOOLEAN" },
          // 속성 이름이 type이어도 스키마로 내려간다.
          type: { type: "STRING", enum: ["BUS", "SUBWAY"] },
          stops: { type: "ARRAY", items: { type: "NUMBER" } },
        },
        required: ["destination"],
      },
    } as unknown as FunctionDeclaration;
    const spec = specFromGeminiDeclaration(decl);
    expect(spec.parameters).toEqual({
      type: "object",
      properties: {
        destination: { type: "string", description: "목적지" },
        accessible: { type: "boolean" },
        type: { type: "string", enum: ["BUS", "SUBWAY"] },
        stops: { type: "array", items: { type: "number" } },
      },
      required: ["destination"],
    });
  });

  it("parametersJsonSchema(이미 소문자)는 그대로 쓰고, 인자 없는 도구는 빈 객체 스키마가 된다", () => {
    const schema = { type: "object", properties: { place: { type: "string" } } };
    expect(specFromGeminiDeclaration({ name: "a", description: "", parametersJsonSchema: schema }).parameters).toEqual(schema);
    expect(specFromGeminiDeclaration({ name: "b", description: "" }).parameters).toEqual({ type: "object", properties: {} });
    expect(lowerSchemaTypes({ type: "STRING", enum: ["A"] })).toEqual({ type: "string", enum: ["A"] });
  });

  it("OpenAI 형식은 평평한 function 도구(strict 끔)이고 Gemini 형식은 parametersJsonSchema다", () => {
    const openai = toOpenAiTools([PROPOSE_GUIDE_TOOL]);
    expect(openai).toEqual([
      {
        type: "function",
        name: PROPOSE_GUIDE_NAME,
        description: PROPOSE_GUIDE_TOOL.description,
        parameters: PROPOSE_GUIDE_TOOL.parameters,
        strict: false,
      },
    ]);
    const gemini = toGeminiDeclarations([PROPOSE_GUIDE_TOOL]);
    expect(gemini).toEqual([
      { name: PROPOSE_GUIDE_NAME, description: PROPOSE_GUIDE_TOOL.description, parametersJsonSchema: PROPOSE_GUIDE_TOOL.parameters },
    ]);
  });

  it("실제 채팅 선언을 바꾼 결과의 타입 표기는 전부 소문자다", () => {
    const walk = (node: unknown): string[] => {
      if (Array.isArray(node)) return node.flatMap(walk);
      if (node === null || typeof node !== "object") return [];
      return Object.entries(node as Record<string, unknown>).flatMap(([k, v]) =>
        k === "type" && typeof v === "string" ? [v] : walk(v),
      );
    };
    const types = toOpenAiTools(vergiliusToolSpecs()).flatMap((t) => walk(t.parameters));
    expect(types.length).toBeGreaterThan(0);
    for (const t of types) expect(t).toBe(t.toLowerCase());
  });
});
