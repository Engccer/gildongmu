import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * nearby 8종 명령 테스트 — 카탈로그 팩토리(Task 8)가 만든 서브커맨드의
 * 위치 필수 안내·엔드포인트 매핑을 검증한다. api-client.js·config.js만 모킹.
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

function isOutOfCoverage(body: unknown): boolean {
  return typeof body === "object" && body !== null && (body as { outOfCoverage?: unknown }).outOfCoverage === true;
}
const OUT_OF_COVERAGE_NOTICE = "서비스 지역(대한민국) 밖 좌표입니다. 장소 검색, 역 정보, 길찾기는 계속 사용할 수 있습니다.";

vi.mock("../lib/api-client.js", () => ({ apiRequest, ApiError: MockApiError, isOutOfCoverage, OUT_OF_COVERAGE_NOTICE }));
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

async function runNearby(verb: string, args: Record<string, unknown>): Promise<void> {
  const { nearbyCommand } = await import("../commands/nearby.js");
  const sub = (nearbyCommand.subCommands as Record<string, { run?: (...a: never[]) => unknown }>)[verb];
  await sub.run!({ args, rawArgs: [], cmd: sub } as never);
}

const EXPECTED_VERBS = ["subway", "bus", "bike", "clinic", "kids", "around", "barrier-free", "walk"];

describe("nearby 명령", () => {
  it("8개 서브커맨드가 NEARBY 카탈로그 키와 일치한다", async () => {
    const { nearbyCommand } = await import("../commands/nearby.js");
    expect(Object.keys(nearbyCommand.subCommands ?? {}).sort()).toEqual([...EXPECTED_VERBS].sort());
  });

  it("위치를 지정하지 않으면 LocationError 안내와 함께 exit 2로 종료한다", async () => {
    readConfig.mockResolvedValue({ apiUrl: "https://example.test" }); // location 없음
    await expect(runNearby("subway", { output: "text" })).rejects.toThrow("EXIT_2");
    expect(exitSpy).toHaveBeenCalledWith(2);
    expect(stderrSpy).toHaveBeenCalled();
    const stderrOut = stderrSpy.mock.calls.map((c: unknown[]) => c[0]).join("");
    expect(stderrOut).toContain("위치를 지정하세요");
  });

  it("지오코딩 실패(plain Error)는 스택 트레이스 없이 exit 2 한 줄로 처리한다", async () => {
    apiRequest.mockImplementation(async (path: string) => {
      if (path === "/api/geocode") return { matches: [] };
      if (path === "/api/places") return { places: [] }; // geocode·places 모두 0건 → plain Error
      throw new Error(`unexpected path ${path}`);
    });

    await expect(
      runNearby("subway", { near: "존재하지않는곳12345", output: "text" }),
    ).rejects.toThrow("EXIT_2");
    expect(exitSpy).toHaveBeenCalledWith(2);

    const stderrCalls = stderrSpy.mock.calls.map((c: unknown[]) => c[0] as string);
    expect(stderrCalls).toHaveLength(1); // 한 줄만 — 스택 트레이스가 별도로 출력되지 않는다
    expect(stderrCalls[0]).toContain("찾지 못했습니다");
    expect(stderrCalls[0]).not.toContain("\n    at "); // 스택 프레임 노출 없음
  });

  it("mock 위치로 subway 호출 시 apiRequest가 올바른 엔드포인트에 lat/lng 문자열로 나간다", async () => {
    apiRequest.mockImplementation(async (path: string) => {
      if (path === "/api/station/subway-arrival/nearby") return { stations: [] };
      throw new Error(`unexpected path ${path}`);
    });

    await runNearby("subway", { lat: "37.5", lng: "127.1", output: "text" });

    expect(apiRequest).toHaveBeenCalledWith(
      "/api/station/subway-arrival/nearby",
      { query: { lat: "37.5", lng: "127.1" } },
    );
  });

  it("서버가 outOfCoverage 마커를 반환하면 안내 문구를 출력하고 exit 0로 정상 종료한다(오류 아님)", async () => {
    apiRequest.mockImplementation(async () => ({ outOfCoverage: true }));

    await runNearby("subway", { lat: "1.0", lng: "1.0", output: "text" });

    expect(stdoutSpy).toHaveBeenCalled();
    const output = stdoutSpy.mock.calls.map((c: unknown[]) => c[0]).join("");
    expect(output).toContain(OUT_OF_COVERAGE_NOTICE);
    expect(exitSpy).not.toHaveBeenCalled();
    expect(stderrSpy).not.toHaveBeenCalled();
  });

  it("outOfCoverage 마커의 json 모드는 마커 바디를 그대로 구조화 출력한다", async () => {
    apiRequest.mockImplementation(async () => ({ outOfCoverage: true }));

    await runNearby("subway", { lat: "1.0", lng: "1.0", output: "json" });

    const jsonOut = JSON.parse(stdoutSpy.mock.calls[0][0] as string);
    expect(jsonOut).toEqual({ outOfCoverage: true });
    expect(exitSpy).not.toHaveBeenCalled();
  });
});
