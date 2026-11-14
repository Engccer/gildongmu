import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Kit 채팅 `route-start` 렌더 fixture ↔ 서버 렌더 모양 묶음(E83 spec §4). fixture는 Kit 테스트(`RouteStartChatTests.swift`)가 읽는데,
 * 서버가 렌더 키를 바꾸면 iOS는 조용히 `.unsupported`로 접혀 카드만 사라진다. 그 드리프트를 여기서 잡는다.
 * 키 집합의 기준은 서버 소스(`types.ts`의 `RouteStartRenderPayload`·`TransitRouteResult`)에서 읽는다.
 */
const root = join(__dirname, "../../..");
const fixture = JSON.parse(
  readFileSync(join(root, "ios/GildongmuKit/Tests/GildongmuKitTests/Fixtures/chat-route-start-render.json"), "utf8"),
) as Record<string, unknown>[];

function interfaceKeys(source: string, name: string): string[] {
  const block = new RegExp(`export interface ${name} \\{([\\s\\S]*?)\\n\\}`).exec(source);
  if (!block) throw new Error(`${name} 선언을 찾지 못했다`);
  return [...block[1].matchAll(/^\s{2}(\w+)\??:/gm)].map((m) => m[1]);
}

/** 선택 키(`?:`)를 뺀 필수 키. */
function requiredKeys(source: string, name: string): string[] {
  const block = new RegExp(`export interface ${name} \\{([\\s\\S]*?)\\n\\}`).exec(source);
  if (!block) throw new Error(`${name} 선언을 찾지 못했다`);
  return [...block[1].matchAll(/^\s{2}(\w+):/gm)].map((m) => m[1]);
}

const chatTypes = readFileSync(join(root, "src/lib/chat/types.ts"), "utf8");
const libTypes = readFileSync(join(root, "src/lib/types.ts"), "utf8");
const renderKeys = interfaceKeys(chatTypes, "RouteStartRenderPayload").sort();
const transitResultKeys = interfaceKeys(libTypes, "TransitRouteResult");
const transitResultRequired = requiredKeys(libTypes, "TransitRouteResult");

describe("Kit 채팅 route-start 렌더 fixture = 서버 렌더 모양", () => {
  it("타입에서 읽은 키가 계약의 아홉 개다", () => {
    expect(renderKeys).toEqual(
      ["accessible", "carProvider", "dest", "destLabel", "destRoman", "mode", "transit", "type", "via"],
    );
  });

  it("수단 셋이 한 건씩 든다", () => {
    expect(fixture.map((r) => r.mode).sort()).toEqual(["car", "transit", "walk"]);
  });

  for (const render of fixture) {
    const mode = String(render.mode);
    it(`${mode}: 키 집합이 RouteStartRenderPayload와 같다`, () => {
      expect(Object.keys(render).sort()).toEqual(renderKeys);
      expect(render.type).toBe("route-start");
    });
  }

  it("자동차 건은 경유지를 싣는다", () => {
    const car = fixture.find((r) => r.mode === "car");
    expect(Object.keys(car?.via as object).sort()).toEqual(["label", "lat", "lng"]);
  });

  it("대중교통 건의 조회 결과가 길찾기 화면의 결과 모양이다", () => {
    const transit = fixture.find((r) => r.mode === "transit")?.transit as Record<string, unknown>;
    expect(Object.keys(transit).sort()).toEqual(["manualOrigin", "origin", "queriedAt", "result"]);
    const resultKeys = Object.keys(transit.result as object);
    for (const key of resultKeys) expect(transitResultKeys).toContain(key);
    for (const key of transitResultRequired) expect(resultKeys).toContain(key);
    expect(transitResultRequired).toEqual(["recommended", "alternatives", "totalCandidates"]);
  });

  it("대중교통이 아닌 건은 transit이 null이다", () => {
    for (const render of fixture) if (render.mode !== "transit") expect(render.transit).toBeNull();
  });
});
