import { describe, expect, it, vi } from "vitest";

// 선언은 키 게이트를 지난 것만 나온다. 키가 없는 환경(CI)에서도 여는 도구의 집합을 못 박으려고 게이트를 전부 참으로 둔다.
vi.mock("@/lib/env", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/env")>();
  const open: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(actual)) {
    open[key] = typeof value === "function" && key.startsWith("has") ? () => true : value;
  }
  return open;
});

import type { FunctionDeclaration } from "@google/genai";
import type { RenderPayload, RouteStartRenderPayload } from "@/lib/chat/types";
import { proposableIds, routeStartRendersOnly, validateProposal } from "../guard";
import {
  PROPOSE_GUIDE_NAME,
  PROPOSE_GUIDE_TOOL,
  VERGILIUS_CHAT_TOOL_NAMES,
  lowerSchemaTypes,
  specFromGeminiDeclaration,
  toAnthropicTools,
  toGeminiDeclarations,
  toOpenAiTools,
  vergiliusToolSpecs,
  withoutClosedArgs,
} from "../tools";
import { availableDeclarations } from "@/lib/chat/declarations";
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
  it("여는 도구는 여섯 채팅 도구와 종결 도구뿐이다(여정·웹 검색 등은 열지 않는다)", () => {
    const names = vergiliusToolSpecs().map((s) => s.name);
    expect(names.at(-1)).toBe(PROPOSE_GUIDE_NAME);
    expect([...names].sort()).toEqual(
      ["get_bus_arrivals", "get_bus_route", "get_car_route", "get_transit_route", "get_walk_route", "propose_guide", "search_places"],
    );
    expect([...VERGILIUS_CHAT_TOOL_NAMES, PROPOSE_GUIDE_NAME].sort()).toEqual([...names].sort());
  });

  it("길찾기의 말한 출발지 인자는 닫는다(E88): 스키마에도 설명에도 origin이 없고, 채팅 선언에는 그대로 있다", () => {
    const routeTools = ["get_walk_route", "get_car_route", "get_transit_route"];
    const chat = availableDeclarations(new Set()).filter((d) => routeTools.includes(d.name ?? ""));
    expect(chat).toHaveLength(3);
    for (const d of chat) {
      // 전제: 채팅 선언에는 인자와 설명 문장이 있다(없으면 아래 단언이 헛돈다).
      expect((d.parametersJsonSchema as { properties: object }).properties).toHaveProperty("origin");
      expect(d.description).toContain("origin");
    }
    const specs = vergiliusToolSpecs().filter((s) => routeTools.includes(s.name));
    expect(specs).toHaveLength(3);
    for (const s of specs) {
      const properties = s.parameters.properties as Record<string, unknown>;
      expect(properties).not.toHaveProperty("origin");
      expect(properties).toHaveProperty("destination");
      expect(s.description).not.toContain("origin");
    }
    // 수단 한정은 답과 버튼이 같은 경로라 그대로 연다.
    const transit = specs.find((s) => s.name === "get_transit_route")!;
    expect(transit.parameters.properties).toHaveProperty("mode");
  });

  it("닫힌 인자는 실행 인자에서도 뗀다: 다른 인자는 그대로이고, 닫힌 인자가 없으면 같은 객체다", () => {
    expect(withoutClosedArgs({ destination: "서울역", origin: "부산역", via: "시청" })).toEqual({ destination: "서울역", via: "시청" });
    const plain = { destination: "서울역" };
    expect(withoutClosedArgs(plain)).toBe(plain);
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

  it("Anthropic 형식은 input_schema(객체 스키마) 도구이고 strict·eager input streaming을 켜지 않는다", () => {
    expect(toAnthropicTools([PROPOSE_GUIDE_TOOL])).toEqual([
      { name: PROPOSE_GUIDE_NAME, description: PROPOSE_GUIDE_TOOL.description, input_schema: PROPOSE_GUIDE_TOOL.parameters },
    ]);
    // 실제로 여는 도구 전부: 이름·순서가 회사 중립 선언과 같고, 스키마 최상위는 object다.
    const specs = vergiliusToolSpecs();
    const tools = toAnthropicTools(specs);
    expect(tools.map((t) => t.name)).toEqual(specs.map((s) => s.name));
    for (const t of tools) {
      expect(t.input_schema.type).toBe("object");
      expect(t).not.toHaveProperty("strict");
      expect(t).not.toHaveProperty("eager_input_streaming");
    }
    // 같은 입력이면 같은 출력이다(도구 선언이 캐시 앞부분의 첫 조각).
    expect(JSON.stringify(toAnthropicTools(vergiliusToolSpecs()))).toBe(JSON.stringify(tools));
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
