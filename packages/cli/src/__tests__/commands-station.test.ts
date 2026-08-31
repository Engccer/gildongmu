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

/**
 * 마커 술어·문구는 구현(`lib/api-client.ts`)의 복제다. importOriginal로 실제
 * 모듈을 쓰면 config.js mock과 호이스팅 순환이 나므로 여기서는 복제를 유지한다.
 * ⚠ 구현에 마커를 추가하면 이 목록도 함께 갱신할 것(누락 시 이 파일이 실패한다).
 */
function isOutOfCoverage(body: unknown): boolean {
  return typeof body === "object" && body !== null && (body as { outOfCoverage?: unknown }).outOfCoverage === true;
}
const OUT_OF_COVERAGE_NOTICE = "서비스 지역(대한민국) 밖 좌표입니다. 장소 검색, 역 정보, 길찾기는 계속 사용할 수 있습니다.";
type UnavailableHereReason = "seoulOnly" | "noBusData";
function unavailableHereReason(body: unknown): UnavailableHereReason | null {
  if (typeof body !== "object" || body === null) return null;
  const reason = (body as { unavailableHere?: unknown }).unavailableHere;
  return reason === "seoulOnly" || reason === "noBusData" ? reason : null;
}
function unavailableHereNotice(reason: UnavailableHereReason): string {
  return reason === "seoulOnly"
    ? "서울 지역에서만 제공됩니다."
    : "이 지역은 정류소 정보가 제공되지 않습니다.";
}

vi.mock("../lib/api-client.js", () => ({
  apiRequest,
  ApiError: MockApiError,
  isOutOfCoverage,
  OUT_OF_COVERAGE_NOTICE,
  unavailableHereReason,
  unavailableHereNotice,
}));
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

  // E26/E27: 서버가 lang을 받는 역 라우트는 셋(meta·timetable·subway-arrival)이고
  // 시설 둘(코레일·서울지하철)은 받지 않는다. 합성 명령 info가 그 갈림을 카탈로그
  // 술어로 판정하는지 — 안 갈리면 시설 라우트에 무의미한 파라미터가 새거나,
  // 반대로 lang을 받는 두 섹션이 조용히 한국어로 떨어진다.
  it("arrivals·timetable은 --lang en을 쿼리에 싣는다", async () => {
    apiRequest.mockImplementation(async (path: string) => {
      if (path === "/api/station/subway-arrival") return { arrivals: null };
      if (path === "/api/station/timetable") return { timetable: null };
      throw new Error(`unexpected path ${path}`);
    });

    await runSub("../commands/station.js", "stationCommand", ["arrivals"], { station: "강남", lang: "en", output: "text" });
    expect(apiRequest).toHaveBeenCalledWith("/api/station/subway-arrival", { query: { station: "강남", lang: "en" } });

    await runSub("../commands/station.js", "stationCommand", ["timetable"], { station: "강동", lang: "en", output: "text" });
    expect(apiRequest).toHaveBeenCalledWith("/api/station/timetable", { query: { station: "강동", lang: "en" } });
  });

  it("info --lang en은 lang을 받는 섹션에만 싣고 시설 2종엔 싣지 않는다", async () => {
    apiRequest.mockImplementation(async (path: string) => {
      if (path === "/api/station/meta") {
        return { meta: { name: "강남", nameEn: "Gangnam", lines: ["2호선"], isTransfer: false, operator: "서울교통공사" } };
      }
      if (path === "/api/station/facilities") return { facilities: null };
      if (path === "/api/station/metro-facilities") return { facilities: null };
      if (path === "/api/station/timetable") return { timetable: null };
      throw new Error(`unexpected path ${path}`);
    });

    await runSub("../commands/station.js", "stationCommand", ["info"], { station: "강남", lang: "en", output: "text" });

    expect(apiRequest).toHaveBeenCalledWith("/api/station/meta", { query: { station: "강남", lang: "en" } });
    expect(apiRequest).toHaveBeenCalledWith("/api/station/timetable", { query: { station: "강남", lang: "en" } });
    expect(apiRequest).toHaveBeenCalledWith("/api/station/facilities", { query: { station: "강남" } });
    expect(apiRequest).toHaveBeenCalledWith("/api/station/metro-facilities", { query: { station: "강남" } });
  });

  /**
   * `search`와 같은 결함이 `info`에도 있었다(리뷰 검출 2026-09-01): 오타 lang이 meta·
   * timetable을 400으로 만드는데 allSettled가 흡수해 "조회 실패" 두 줄 + 시설 정상 렌더 +
   * exit 0이 나왔다 — 서버가 보낸 400 메시지는 어디에도 안 나온다.
   */
  it("info: 한 섹션이 400으로 거절되면 다른 섹션이 성공해도 exit 2로 종료한다", async () => {
    apiRequest.mockImplementation(async (path: string) => {
      if (path === "/api/station/meta" || path === "/api/station/timetable") {
        throw new MockApiError('Invalid option: expected one of "ko"|"en"', 400, 2);
      }
      if (path === "/api/station/facilities") return { facilities: { elevators: 2 } };
      if (path === "/api/station/metro-facilities") return { facilities: null };
      throw new Error(`unexpected path ${path}`);
    });

    await expect(
      runSub("../commands/station.js", "stationCommand", ["info"], { station: "강남", lang: "eng", output: "text" }),
    ).rejects.toThrow("EXIT_2");
    const stderrOut = stderrSpy.mock.calls.map((c: unknown[]) => c[0]).join("");
    expect(stderrOut).toContain("expected one of");
  });

  it("info: 502(업스트림 장애)는 종전대로 섹션별 부분 성공을 유지한다", async () => {
    apiRequest.mockImplementation(async (path: string) => {
      if (path === "/api/station/meta") throw new MockApiError("역 정보 조회에 실패했습니다.", 502, 1);
      if (path === "/api/station/facilities") return { facilities: { elevators: 2 } };
      if (path === "/api/station/metro-facilities") return { facilities: null };
      if (path === "/api/station/timetable") return { timetable: null };
      throw new Error(`unexpected path ${path}`);
    });

    await runSub("../commands/station.js", "stationCommand", ["info"], { station: "강남", output: "text" });

    expect(exitSpy).not.toHaveBeenCalled();
    const output = stdoutSpy.mock.calls.map((c: unknown[]) => c[0]).join("");
    expect(output).toContain("역 정보 조회 실패");
    expect(output).toContain("엘리베이터 2대");
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
