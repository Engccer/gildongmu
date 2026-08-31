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
  it("장소·주소를 병렬 조회해 2섹션으로 출력한다", async () => {
    apiRequest.mockImplementation(async (path: string) => {
      if (path === "/api/places") {
        return { places: [{ name: "장소1", category: "음식점", address: "", roadAddress: "서울 강남구" }] };
      }
      if (path === "/api/address/search") {
        return { addresses: [{ roadAddr: "서울 강남구 x", jibunAddr: "", zipNo: "", engAddr: "" }] };
      }
      throw new Error(`unexpected path ${path}`);
    });

    await runSearch({ query: "강남", output: "text" });

    expect(apiRequest).toHaveBeenCalledTimes(2);
    // --lang 미지정이면 파라미터 자체를 싣지 않는다(서버 기본 ko). 종전엔 CLI가 "ko"를
    // 채워 보내며 미지 값까지 ko로 접었다 — 그 정규화가 오타의 조용한 강등이었다.
    expect(apiRequest).toHaveBeenCalledWith("/api/places", { query: { query: "강남" } });
    expect(apiRequest).toHaveBeenCalledWith("/api/address/search", { query: { query: "강남" } });

    const output = stdoutSpy.mock.calls.map((c: unknown[]) => c[0]).join("");
    expect(output).toContain("장소 1건");
    expect(output).toContain("주소 1건");
    expect(output).toContain("장소1");
  });

  it("--lang en을 그대로 싣는다", async () => {
    apiRequest.mockImplementation(async (path: string) => {
      if (path === "/api/places") return { places: [] };
      if (path === "/api/address/search") return { addresses: [] };
      if (path === "/api/search/web") return { web: [] };
      throw new Error(`unexpected path ${path}`);
    });

    await runSearch({ query: "강남", lang: "en", output: "text" });

    expect(apiRequest).toHaveBeenCalledWith("/api/places", { query: { query: "강남", lang: "en" } });
  });

  /**
   * 실호출로 검출한 결함(2026-09-01): 값 정규화를 뗀 뒤 `--lang eng`가 /api/places를
   * 400으로 만드는데, allSettled가 그 거절을 흡수해 **주소 섹션만 있는 exit 0**이 나왔다.
   * 사용자는 "장소가 0건"인지 "요청이 거절됐다"인지 구분할 수 없다 — 정규화가 만들던
   * 조용한 ko 강등을 조용한 섹션 소실로 바꾼 셈이라 400은 즉시 종료로 가른다.
   */
  it("한 섹션이 400으로 거절되면 다른 섹션이 성공해도 exit 2로 종료한다(조용한 섹션 소실 금지)", async () => {
    apiRequest.mockImplementation(async (path: string) => {
      if (path === "/api/places") throw new MockApiError('Invalid option: expected one of "ko"|"en"', 400, 2);
      if (path === "/api/address/search") {
        return { addresses: [{ roadAddr: "서울 강남구 x", jibunAddr: "", zipNo: "", engAddr: "" }] };
      }
      throw new Error(`unexpected path ${path}`);
    });

    await expect(runSearch({ query: "강남", lang: "eng", output: "text" })).rejects.toThrow("EXIT_2");
    const stderrOut = stderrSpy.mock.calls.map((c: unknown[]) => c[0]).join("");
    expect(stderrOut).toContain("expected one of");
  });

  it("502(업스트림 장애)는 종전대로 부분 성공을 유지한다", async () => {
    apiRequest.mockImplementation(async (path: string) => {
      if (path === "/api/places") throw new MockApiError("장소 검색에 실패했습니다.", 502, 1);
      if (path === "/api/address/search") {
        return { addresses: [{ roadAddr: "서울 강남구 x", jibunAddr: "", zipNo: "", engAddr: "" }] };
      }
      throw new Error(`unexpected path ${path}`);
    });

    await runSearch({ query: "강남", output: "text" });

    expect(exitSpy).not.toHaveBeenCalled();
    const output = stdoutSpy.mock.calls.map((c: unknown[]) => c[0]).join("");
    expect(output).toContain("주소 1건");
  });

  it("전 섹션 0건이면 웹 검색으로 폴백한다(envelope은 { web } — { results } 아님)", async () => {
    apiRequest.mockImplementation(async (path: string) => {
      if (path === "/api/places") return { places: [] };
      if (path === "/api/address/search") return { addresses: [] };
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
      throw new Error(`unexpected path ${path}`);
    });

    await expect(runSearch({ query: "실패", output: "text" })).rejects.toThrow("EXIT_1");
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(stderrSpy).toHaveBeenCalled();
  });
});
