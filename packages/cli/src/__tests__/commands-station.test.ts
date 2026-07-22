import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * station / bus route / place barrier-free 명령 테스트.
 * api-client.js·config.js만 모킹해 실제 apiRequest 호출 경로(URL·쿼리)를 그대로 관찰한다.
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

async function runSub(
  mod: string,
  exportName: string,
  path: string[],
  args: Record<string, unknown>,
): Promise<void> {
  const imported = (await import(mod)) as Record<string, unknown>;
  let cmd = imported[exportName] as { subCommands?: Record<string, unknown>; run?: (...a: never[]) => unknown };
  for (const p of path) {
    cmd = (cmd.subCommands as Record<string, typeof cmd>)[p];
  }
  await cmd.run!({ args, rawArgs: [], cmd } as never);
}

describe("station 명령", () => {
  it("info: 네 apiRequest를 병렬로 올바른 경로·쿼리에 발사한다", async () => {
    apiRequest.mockImplementation(async (path: string) => {
      if (path === "/api/station/meta") return { meta: { name: "강남", nameEn: "Gangnam", lines: ["2호선"], isTransfer: false, operator: "서울교통공사" } };
      if (path === "/api/station/timetable") return { timetable: null };
      if (path === "/api/station/facilities") return { facilities: null };
      if (path === "/api/station/metro-facilities") return { facilities: null };
      throw new Error(`unexpected path ${path}`);
    });

    await runSub("../commands/station.js", "stationCommand", ["info"], { station: "강남", output: "text" });

    expect(apiRequest).toHaveBeenCalledWith("/api/station/meta", { query: { station: "강남" } });
    expect(apiRequest).toHaveBeenCalledWith("/api/station/timetable", { query: { station: "강남" } });
    expect(apiRequest).toHaveBeenCalledWith("/api/station/facilities", { query: { station: "강남" } });
    expect(apiRequest).toHaveBeenCalledWith("/api/station/metro-facilities", { query: { station: "강남" } });
  });

  it("info: 부분 실패(메타 성공+철도역 시설 rejected)에서 '조회 실패' 줄과 성공 섹션이 공존하고 null 섹션은 생략된다", async () => {
    apiRequest.mockImplementation(async (path: string) => {
      if (path === "/api/station/meta") {
        return { meta: { name: "강남", nameEn: "Gangnam", lines: ["2호선"], isTransfer: false, operator: "서울교통공사" } };
      }
      if (path === "/api/station/timetable") return { timetable: null };
      if (path === "/api/station/facilities") throw new Error("upstream down");
      if (path === "/api/station/metro-facilities") return { facilities: null };
      throw new Error(`unexpected path ${path}`);
    });

    await runSub("../commands/station.js", "stationCommand", ["info"], { station: "강남", output: "text" });

    const output = stdoutSpy.mock.calls.map((c: unknown[]) => c[0]).join("");
    expect(output).toContain("역 정보");
    expect(output).toContain("강남역 (Gangnam)");
    expect(output).toContain("철도역 교통약자 시설 조회 실패");
    // null 섹션(서울 지하철 교통약자 시설·첫차·막차)은 생략 — 제목 줄 자체가 안 나온다.
    expect(output).not.toContain("서울 지하철 교통약자 시설");
    expect(output).not.toContain("첫차·막차");
  });

  it("info: 네 섹션 모두 fulfilled인데 값이 전부 null이면 미발견 안내를 출력하고 exit 하지 않는다(3-state 침묵 금지)", async () => {
    apiRequest.mockImplementation(async (path: string) => {
      if (path === "/api/station/meta") return { meta: null };
      if (path === "/api/station/timetable") return { timetable: null };
      if (path === "/api/station/facilities") return { facilities: null };
      if (path === "/api/station/metro-facilities") return { facilities: null };
      throw new Error(`unexpected path ${path}`);
    });

    await runSub("../commands/station.js", "stationCommand", ["info"], { station: "없는역", output: "text" });

    const output = stdoutSpy.mock.calls.map((c: unknown[]) => c[0]).join("");
    expect(output).toContain("찾을 수 없습니다");
    expect(output).toContain("없는역");
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it("info: 네 요청이 모두 실패하면 exit 1로 종료한다", async () => {
    apiRequest.mockImplementation(async () => {
      throw new Error("network down");
    });

    await expect(
      runSub("../commands/station.js", "stationCommand", ["info"], { station: "강남", output: "text" }),
    ).rejects.toThrow("EXIT_1");
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(stderrSpy).toHaveBeenCalled();
  });

  it("info: json 모드에서 네 결과를 {meta, timetable, facilities, metroFacilities}로 합성한다", async () => {
    apiRequest.mockImplementation(async (path: string) => {
      if (path === "/api/station/meta") return { meta: { name: "강남", nameEn: "Gangnam", lines: ["2호선"], isTransfer: false, operator: "서울교통공사" } };
      if (path === "/api/station/timetable") return { timetable: null };
      if (path === "/api/station/facilities") throw new Error("upstream down");
      if (path === "/api/station/metro-facilities") return { facilities: null };
      throw new Error(`unexpected path ${path}`);
    });

    await runSub("../commands/station.js", "stationCommand", ["info"], { station: "강남", output: "json" });

    const jsonOut = JSON.parse(stdoutSpy.mock.calls[0][0] as string);
    expect(jsonOut).toHaveProperty("meta");
    expect(jsonOut).toHaveProperty("timetable");
    expect(jsonOut).toHaveProperty("facilities");
    expect(jsonOut).toHaveProperty("metroFacilities");
    expect(jsonOut.meta).toMatchObject({ name: "강남" });
    expect(jsonOut.timetable).toBeNull();
    expect(jsonOut.facilities).toBeNull();
    expect(jsonOut.metroFacilities).toBeNull();
  });

  it("arrivals: subway-arrival 엔드포인트로 위임한다", async () => {
    apiRequest.mockImplementation(async (path: string) => {
      if (path === "/api/station/subway-arrival") return { arrivals: null };
      throw new Error(`unexpected path ${path}`);
    });

    await runSub("../commands/station.js", "stationCommand", ["arrivals"], { station: "강남", output: "text" });

    expect(apiRequest).toHaveBeenCalledWith("/api/station/subway-arrival", { query: { station: "강남" } });
  });

  it("timetable: station-timetable 엔드포인트로 위임한다", async () => {
    apiRequest.mockImplementation(async (path: string) => {
      if (path === "/api/station/timetable") return { timetable: null };
      throw new Error(`unexpected path ${path}`);
    });

    await runSub("../commands/station.js", "stationCommand", ["timetable"], { station: "강동", output: "text" });

    expect(apiRequest).toHaveBeenCalledWith("/api/station/timetable", { query: { station: "강동" } });
  });

  it("info: 4섹션(meta·facilities·metro-facilities·timetable)을 병렬 호출하고 timetable rejected 시 '첫차·막차 조회 실패' 한 줄을 낸다", async () => {
    apiRequest.mockImplementation(async (path: string) => {
      if (path === "/api/station/meta") {
        return { meta: { name: "강남", nameEn: "Gangnam", lines: ["2호선"], isTransfer: false, operator: "서울교통공사" } };
      }
      if (path === "/api/station/facilities") return { facilities: null };
      if (path === "/api/station/metro-facilities") return { facilities: null };
      if (path === "/api/station/timetable") throw new Error("upstream down");
      throw new Error(`unexpected path ${path}`);
    });

    await runSub("../commands/station.js", "stationCommand", ["info"], { station: "강남", output: "text" });

    expect(apiRequest).toHaveBeenCalledWith("/api/station/meta", { query: { station: "강남" } });
    expect(apiRequest).toHaveBeenCalledWith("/api/station/facilities", { query: { station: "강남" } });
    expect(apiRequest).toHaveBeenCalledWith("/api/station/metro-facilities", { query: { station: "강남" } });
    expect(apiRequest).toHaveBeenCalledWith("/api/station/timetable", { query: { station: "강남" } });

    const output = stdoutSpy.mock.calls.map((c: unknown[]) => c[0]).join("");
    expect(output).toContain("첫차·막차 조회 실패");
  });
});

describe("bus route 명령", () => {
  it("--source tago인데 --city-code가 없으면 exit 2로 종료한다(라우트 400 전에 클라이언트에서 잡음)", async () => {
    await expect(
      runSub("../commands/bus.js", "busCommand", ["route"], { source: "tago", routeId: "12345", output: "text" }),
    ).rejects.toThrow("EXIT_2");
    expect(exitSpy).toHaveBeenCalledWith(2);
    expect(apiRequest).not.toHaveBeenCalled();
  });

  it("정상 인자면 bus-route-stops 엔드포인트로 위임한다", async () => {
    apiRequest.mockImplementation(async (path: string) => {
      if (path === "/api/bus/route") return { stops: [] };
      throw new Error(`unexpected path ${path}`);
    });

    await runSub("../commands/bus.js", "busCommand", ["route"], {
      source: "tago",
      routeId: "12345",
      cityCode: "37050",
      output: "text",
    });

    expect(apiRequest).toHaveBeenCalledWith("/api/bus/route", {
      query: { source: "tago", routeId: "12345", cityCode: "37050" },
    });
  });

  it("--source seoul이면 --city-code 없이도 통과한다", async () => {
    apiRequest.mockImplementation(async (path: string) => {
      if (path === "/api/bus/route") return { stops: [] };
      throw new Error(`unexpected path ${path}`);
    });

    await runSub("../commands/bus.js", "busCommand", ["route"], {
      source: "seoul",
      routeId: "100100120",
      output: "text",
    });

    expect(apiRequest).toHaveBeenCalledWith("/api/bus/route", {
      query: { source: "seoul", routeId: "100100120", cityCode: undefined },
    });
  });
});

describe("place barrier-free 명령", () => {
  it("contentId를 올바른 path로 전달한다", async () => {
    apiRequest.mockImplementation(async (path: string) => {
      if (path === "/api/places/barrier-free/detail") return { detail: null };
      throw new Error(`unexpected path ${path}`);
    });

    await runSub("../commands/place.js", "placeCommand", ["barrier-free"], { contentId: "126508", output: "text" });

    expect(apiRequest).toHaveBeenCalledWith("/api/places/barrier-free/detail", {
      query: { contentId: "126508" },
    });
  });
});
