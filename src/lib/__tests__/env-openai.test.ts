import { afterEach, describe, expect, it, vi } from "vitest";

describe("길동무 OpenAI 키 격리", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("공용 키만 있으면 OpenAI 선택지와 세션을 닫는다", async () => {
    vi.stubEnv("OPENAI_API_KEY", "general-test");
    vi.stubEnv("GILDONGMU_OPENAI_API_KEY", undefined);
    const { hasOpenAiKey } = await import("../env");
    const { availableVergiliusProviders, createVergiliusSession } = await import("../vergilius/providers");

    expect(hasOpenAiKey()).toBe(false);
    for (const provider of ["openai", "openai-luna"] as const) {
      expect(availableVergiliusProviders()).not.toContain(provider);
      expect(createVergiliusSession({ provider, instruction: "지침", material: "질문", tools: [] })).toBeNull();
    }
  });

  it("두 키가 함께 있어도 답변 요청에는 길동무 전용 키만 보낸다", async () => {
    vi.stubEnv("OPENAI_API_KEY", "general-test");
    vi.stubEnv("GILDONGMU_OPENAI_API_KEY", "gildongmu-test");
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(
      'data: {"type":"response.completed","response":{"output":[]}}\n\n',
    ));
    vi.stubGlobal("fetch", fetchMock);
    const { hasOpenAiKey } = await import("../env");
    const { createVergiliusSession } = await import("../vergilius/providers");

    expect(hasOpenAiKey()).toBe(true);
    for (const provider of ["openai", "openai-luna"] as const) {
      fetchMock.mockClear();
      const session = createVergiliusSession({ provider, instruction: "지침", material: "질문", tools: [] });
      expect(session).not.toBeNull();
      await session!.round({ tools: true, onText: vi.fn(), onCall: vi.fn() });
      expect(fetchMock).toHaveBeenCalledOnce();
      const init = fetchMock.mock.calls[0][1] as RequestInit;
      expect((init.headers as Record<string, string>).Authorization).toBe("Bearer gildongmu-test");
    }
  });
});
