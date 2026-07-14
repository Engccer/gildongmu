import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * search 명령 테스트 — 웹 UI 결정론 병렬 검색(스펙 §4)의 CLI 동형 검증.
 * api-client.js만 모킹해 실제 apiRequest 호출 경로(URL·쿼리)를 그대로 관찰한다.
 */

class MockApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public exitCode: number,
    public body?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

const apiRequest = vi.fn();
const readConfig = vi.fn();

vi.mock("../lib/api-client.js", () => ({ apiRequest, ApiError: MockApiError }));
vi.mock("../lib/config.js", () => ({ readConfig }));

let stdoutSpy: ReturnType<typeof vi.spyOn>;
let stderrSpy: ReturnType<typeof vi.spyOn>;
let exitSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  apiRequest.mockReset();
  readConfig.mockReset();
  readConfig.mockResolvedValue({ apiUrl: "https://example.test" });
  stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  exitSpy = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
    throw new Error(`EXIT_${code}`);
  }) as never);
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function runSearch(args: Record<string, unknown>): Promise<void> {
  const { searchCommand } = await import("../commands/search.js");
  await searchCommand.run!({ args, rawArgs: [], cmd: searchCommand } as never);
}

describe("search 명령", () => {
  it("장소·주소·명소를 병렬 조회해 3섹션으로 출력한다", async () => {
    apiRequest.mockImplementation(async (path: string) => {
      if (path === "/api/places") {
        return { places: [{ name: "장소1", category: "음식점", address: "", roadAddress: "서울 강남구" }] };
      }
      if (path === "/api/address/search") {
        return { addresses: [{ roadAddr: "서울 강남구 x", jibunAddr: "", zipNo: "", engAddr: "" }] };
      }
      if (path === "/api/places/attractions") {
        return { places: [{ name: "명소1", category: "관광,명소", address: "", roadAddress: "서울" }] };
      }
      throw new Error(`unexpected path ${path}`);
    });

    await runSearch({ query: "강남", output: "text" });

    expect(apiRequest).toHaveBeenCalledTimes(3);
    expect(apiRequest).toHaveBeenCalledWith("/api/places", { query: { query: "강남", lang: "ko" } });
    expect(apiRequest).toHaveBeenCalledWith("/api/address/search", { query: { query: "강남" } });
    expect(apiRequest).toHaveBeenCalledWith("/api/places/attractions", { query: { query: "강남" } });

    const output = stdoutSpy.mock.calls.map((c: unknown[]) => c[0]).join("");
    expect(output).toContain("명소 1건");
    expect(output).toContain("장소 1건");
    expect(output).toContain("주소 1건");
    expect(output).toContain("장소1");
    expect(output).toContain("명소1");
  });

  it("전 섹션 0건이면 웹 검색으로 폴백한다(envelope은 { web } — { results } 아님)", async () => {
    apiRequest.mockImplementation(async (path: string) => {
      if (path === "/api/places") return { places: [] };
      if (path === "/api/address/search") return { addresses: [] };
      if (path === "/api/places/attractions") return { places: [] };
      if (path === "/api/search/web") {
        return { web: [{ title: "웹결과", url: "https://x.test", snippet: "요약" }] };
      }
      throw new Error(`unexpected path ${path}`);
    });

    await runSearch({ query: "존재하지않는곳", output: "json" });

    expect(apiRequest).toHaveBeenCalledWith("/api/search/web", { query: { query: "존재하지않는곳" } });
    const jsonOut = JSON.parse(stdoutSpy.mock.calls[0][0] as string);
    expect(jsonOut.web).toHaveLength(1);
    expect(jsonOut.web[0]).toMatchObject({ title: "웹결과" });
    expect(jsonOut.places).toEqual([]);
  });

  it("장소·주소 조회가 모두 실패하면 exit 1로 종료한다", async () => {
    apiRequest.mockImplementation(async (path: string) => {
      if (path === "/api/places") throw new Error("network down");
      if (path === "/api/address/search") throw new Error("network down");
      if (path === "/api/places/attractions") return { places: [] };
      throw new Error(`unexpected path ${path}`);
    });

    await expect(runSearch({ query: "실패", output: "text" })).rejects.toThrow("EXIT_1");
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(stderrSpy).toHaveBeenCalled();
  });
});
