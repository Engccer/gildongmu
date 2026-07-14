import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * route car/transit·whereami 명령 테스트(Task 10). route는 인자별 지오코딩 분기
 * (좌표 패턴이면 그대로, 아니면 geocodeQuery)를, whereami는 nearby 동형 위치
 * 필수 안내를 검증한다. api-client.js·config.js만 모킹 — resolveLocation·
 * geocodeQuery의 실제 구현이 모킹된 apiRequest를 그대로 통과한다.
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

async function runRoute(verb: "car" | "transit", args: Record<string, unknown>): Promise<void> {
  const { routeCommand } = await import("../commands/route.js");
  const sub = (routeCommand.subCommands as Record<string, { run?: (...a: never[]) => unknown }>)[verb];
  await sub.run!({ args, rawArgs: [], cmd: sub } as never);
}

async function runWhereami(args: Record<string, unknown>): Promise<void> {
  const { whereamiCommand } = await import("../commands/whereami.js");
  await whereamiCommand.run!({ args, rawArgs: [], cmd: whereamiCommand } as never);
}

describe("route 명령", () => {
  it("장소명 인자만 지오코딩하고 좌표 패턴 인자는 그대로 조립한다", async () => {
    apiRequest.mockImplementation(async (path: string) => {
      if (path === "/api/geocode") {
        return { matches: [{ addressName: "강동역", lat: 37.5301, lng: 127.1238 }] };
      }
      if (path === "/api/route/transit") return { result: null };
      throw new Error(`unexpected path ${path}`);
    });

    await runRoute("transit", { origin: "강동역", dest: "37.49,127.02", output: "text" });

    expect(apiRequest).toHaveBeenCalledWith("/api/geocode", { query: { query: "강동역" } });
    expect(apiRequest).toHaveBeenCalledWith(
      "/api/route/transit",
      { query: { origin: "37.5301,127.1238", dest: "37.49,127.02" } },
    );
    expect(apiRequest).not.toHaveBeenCalledWith("/api/geocode", { query: { query: "37.49,127.02" } });
  });

  it("지오코딩 0건이면 exit 2로 종료한다", async () => {
    apiRequest.mockImplementation(async (path: string) => {
      if (path === "/api/geocode") return { matches: [] };
      throw new Error(`unexpected path ${path}`);
    });

    await expect(
      runRoute("car", { origin: "존재하지않는곳", dest: "37.49,127.02", output: "text" }),
    ).rejects.toThrow("EXIT_2");
    expect(exitSpy).toHaveBeenCalledWith(2);
    const stderrOut = stderrSpy.mock.calls.map((c: unknown[]) => c[0]).join("");
    expect(stderrOut).toContain("찾지 못했습니다");
  });
});

describe("whereami 명령", () => {
  it("위치를 지정하지 않으면 LocationError 안내와 함께 exit 2로 종료한다", async () => {
    readConfig.mockResolvedValue({ apiUrl: "https://example.test" }); // location 없음
    await expect(runWhereami({ output: "text" })).rejects.toThrow("EXIT_2");
    expect(exitSpy).toHaveBeenCalledWith(2);
    const stderrOut = stderrSpy.mock.calls.map((c: unknown[]) => c[0]).join("");
    expect(stderrOut).toContain("위치를 지정하세요");
  });
});
