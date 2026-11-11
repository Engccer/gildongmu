import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Kit 채팅 여정 렌더 fixture ↔ 서버 렌더 모양 묶음(E70-b S6). fixture는 Kit 테스트(`JourneyChatTests.swift`)가 읽는데, 서버가 렌더 키를
 * 바꾸면 iOS는 조용히 `.unsupported`로 접혀 카드만 사라진다 — 그 드리프트를 여기서 잡는다.
 * 키 집합의 기준은 서버 소스(`types.ts`의 `JourneyRenderPayload`, `journey-tool.ts`의 render 리터럴)에서 읽는다.
 */
const root = join(__dirname, "../../..");
const FIXTURES = ["chat-journey-render", "chat-journey-render-stop-missing"].map((n) => ({
  name: n,
  json: JSON.parse(readFileSync(join(root, `ios/GildongmuKit/Tests/GildongmuKitTests/Fixtures/${n}.json`), "utf8")) as Record<string, unknown>,
}));

function interfaceKeys(source: string, name: string): string[] {
  const block = new RegExp(`export interface ${name} \\{([\\s\\S]*?)\\n\\}`).exec(source);
  if (!block) throw new Error(`${name} 선언을 찾지 못했다`);
  return [...block[1].matchAll(/^\s{2}(\w+)\??:/gm)].map((m) => m[1]);
}

const types = readFileSync(join(root, "src/lib/chat/types.ts"), "utf8");
const tool = readFileSync(join(root, "src/lib/chat/journey-tool.ts"), "utf8");
const renderKeys = interfaceKeys(types, "JourneyRenderPayload");
const stationKeys = interfaceKeys(types, "JourneyChatStation");

describe("Kit 채팅 여정 렌더 fixture = 서버 렌더 모양", () => {
  it("서버 render 리터럴의 키가 JourneyRenderPayload 키와 같다", () => {
    const literal = /render: \{\s*type: "journey",([\s\S]*?)\n\s{6}\},/.exec(tool);
    if (!literal) throw new Error("journey-tool.ts의 render 리터럴을 찾지 못했다");
    const keys = ["type", ...[...literal[1].matchAll(/^\s{8}(\w+)[:,]/gm)].map((m) => m[1])];
    expect(keys.sort()).toEqual([...renderKeys].sort());
  });

  for (const { name, json } of FIXTURES) {
    it(`${name}: 키 집합이 JourneyRenderPayload와 같다`, () => {
      expect(Object.keys(json).sort()).toEqual([...renderKeys].sort());
      expect(json.type).toBe("journey");
    });

    it(`${name}: 역 라벨이 서버 pickJourneyStation·pickJourneyStop 모양이다`, () => {
      for (const side of ["board", "alight"] as const) {
        const st = json[side] as Record<string, unknown> | null;
        if (st === null) continue;
        for (const key of Object.keys(st)) expect(stationKeys).toContain(key);
        if (st.kind === "stop") continue; // 정류장: 검색 결과 이름 그대로 + kind "stop"
        // 역: 노선을 말하지 않았으면 노선 없는 「…역」, 말했으면 검색 결과 이름 + line.
        if (st.line === undefined) expect(String(st.label)).toMatch(/역$/);
      }
    });
  }

  it("정류장 지정과 못 찾음 줄 사례가 든다", () => {
    const stop = FIXTURES[1].json;
    expect((stop.board as { kind?: string }).kind).toBe("stop");
    expect((stop.result as { designatedMissing?: unknown }).designatedMissing).toBeTruthy();
  });
});
