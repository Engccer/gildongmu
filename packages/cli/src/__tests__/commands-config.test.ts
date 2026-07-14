import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * config get/set/path 명령 테스트(Task 12). api-client.js만 모킹해 geocodeQuery의
 * 실제 구현이 모킹된 apiRequest를 그대로 통과하게 한다(route.test.ts 동형).
 * config.js는 모킹하지 않고 GILDONGMU_CONFIG_DIR 임시 디렉터리로 실제 왕복을 검증한다.
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
vi.mock("../lib/api-client.js", () => ({ apiRequest, ApiError: MockApiError }));

let stdoutSpy: ReturnType<typeof vi.spyOn>;
let stderrSpy: ReturnType<typeof vi.spyOn>;
let exitSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  process.env.GILDONGMU_CONFIG_DIR = mkdtempSync(join(tmpdir(), "gil-cfg-"));
  delete process.env.GILDONGMU_API_URL;
  apiRequest.mockReset();
  stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  exitSpy = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
    throw new Error(`EXIT_${code}`);
  }) as never);
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function runSub(path: string[], args: Record<string, unknown>): Promise<void> {
  const { configCommand } = await import("../commands/config.js");
  let cmd = configCommand as unknown as {
    subCommands?: Record<string, unknown>;
    run?: (...a: never[]) => unknown;
  };
  for (const p of path) {
    cmd = (cmd.subCommands as Record<string, typeof cmd>)[p];
  }
  await cmd.run!({ args, rawArgs: [], cmd } as never);
}

function stdout(): string {
  return stdoutSpy.mock.calls.map((c: unknown[]) => c[0]).join("");
}
function stderr(): string {
  return stderrSpy.mock.calls.map((c: unknown[]) => c[0]).join("");
}

describe("config 명령", () => {
  it("set apiUrl 후 get으로 왕복 확인", async () => {
    await runSub(["set"], { key: "apiUrl", value: "http://localhost:5000" });
    expect(stdout()).toContain("apiUrl = http://localhost:5000");

    stdoutSpy.mockClear();
    await runSub(["get"], { key: "apiUrl" });
    expect(stdout().trim()).toBe("http://localhost:5000");
  });

  it("set에 허용 외 키를 주면 exit 2로 종료하고 writeConfig가 호출되지 않는다", async () => {
    await expect(runSub(["set"], { key: "secret", value: "x" })).rejects.toThrow("EXIT_2");
    expect(exitSpy).toHaveBeenCalledWith(2);
    expect(stderr()).toContain("알 수 없는 설정 키");

    // 실제로 저장되지 않았는지 get으로 재확인(왕복 부작용 없음).
    stdoutSpy.mockClear();
    await runSub(["get"], {});
    expect(stdout()).not.toContain("secret");
  });

  it("get에 허용 외 키를 주면 exit 2로 종료한다", async () => {
    await expect(runSub(["get"], { key: "nope" })).rejects.toThrow("EXIT_2");
    expect(exitSpy).toHaveBeenCalledWith(2);
  });

  it("set output에 text|json 외 값을 주면 exit 2로 종료한다", async () => {
    await expect(runSub(["set"], { key: "output", value: "xml" })).rejects.toThrow("EXIT_2");
    expect(exitSpy).toHaveBeenCalledWith(2);
  });

  it("location은 geocodeQuery로 좌표화해 {label,lat,lng}로 저장하고 안내 문구를 출력한다", async () => {
    apiRequest.mockResolvedValue({ matches: [{ addressName: "길동", lat: 37.5384, lng: 127.1368 }] });

    await runSub(["set"], { key: "location", value: "길동" });

    expect(apiRequest).toHaveBeenCalledWith("/api/geocode", { query: { query: "길동" } });
    expect(stdout()).toContain("기본 위치를 '길동'(위도 37.5384, 경도 127.1368)로 저장했습니다");

    stdoutSpy.mockClear();
    await runSub(["get"], { key: "location" });
    expect(JSON.parse(stdout())).toMatchObject({ label: "길동", lat: 37.5384, lng: 127.1368 });
  });

  it("location 지오코딩 0건이면 exit 2로 종료하고 저장하지 않는다", async () => {
    apiRequest.mockResolvedValue({ matches: [] });

    await expect(runSub(["set"], { key: "location", value: "존재하지않는곳" })).rejects.toThrow("EXIT_2");
    expect(exitSpy).toHaveBeenCalledWith(2);

    stdoutSpy.mockClear();
    await runSub(["get"], { key: "location" });
    expect(stdout().trim()).toBe("null");
  });

  it("path는 configPath()를 출력한다", async () => {
    const { configPath } = await import("../lib/config.js");
    await runSub(["path"], {});
    expect(stdout().trim()).toBe(configPath());
  });
});
