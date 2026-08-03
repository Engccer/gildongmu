import { describe, it, expect, vi, afterEach } from "vitest";
import type { BusRouteStop, BusStop } from "../types";
import {
  parseSeoulTrackSlots,
  remainingFromArrmsg,
} from "../providers/seoul-bus";
import {
  pickAlightOrd,
  pickTagoStop,
  remainingFromArvlMsg,
} from "../transit-track";

/** 서울 TOPIS 도착 응답 골격(getStationByUid·getArrInfoByRoute 공통 형태). */
function seoulRaw(items: Record<string, unknown>[]): unknown {
  return { msgHeader: { headerCd: "0" }, msgBody: { itemList: items } };
}

describe("parseSeoulTrackSlots — 추적 슬롯(B2 §5.1·§5.2)", () => {
  it("vehId 보존 + staOrd−sectOrd 구조 필드로 잔여 계산", () => {
    const slots = parseSeoulTrackSlots(
      seoulRaw([
        {
          busRouteId: "227000006",
          vehId1: "111033479",
          arrmsg1: "6분47초후[4번째 전]",
          staOrd: "20",
          sectOrd1: "16",
          busType1: "1",
          vehId2: "111033480",
          arrmsg2: "15분후[9번째 전]",
          sectOrd2: "11",
        },
      ]),
    );
    expect(slots).toHaveLength(2);
    expect(slots[0]).toEqual({
      vehicleId: "111033479",
      message: "6분47초후[4번째 전]",
      remainingStops: 4,
      lowFloor: true,
    });
    expect(slots[1].remainingStops).toBe(9);
  });

  it("구조 필드 부재 시 arrmsg 패턴 폴백, 둘 다 없으면 null(사다리만 비활성)", () => {
    const slots = parseSeoulTrackSlots(
      seoulRaw([
        { busRouteId: "1", vehId1: "77", arrmsg1: "3분54초후[2번째 전]" },
        { busRouteId: "2", vehId1: "78", arrmsg1: "출발대기" },
      ]),
    );
    expect(slots[0].remainingStops).toBe(2);
    expect(slots[1].remainingStops).toBeNull();
  });

  it("routeId 필터 + vehId 없음('0'·'')은 null(잠금 불가 슬롯)", () => {
    const slots = parseSeoulTrackSlots(
      seoulRaw([
        { busRouteId: "227000006", vehId1: "0", arrmsg1: "운행종료" },
        { busRouteId: "999", vehId1: "5", arrmsg1: "곧 도착" },
      ]),
      "227000006",
    );
    expect(slots).toHaveLength(1);
    expect(slots[0].vehicleId).toBeNull();
  });

  it("vehId 없는 슬롯은 구조 필드를 불신한다(운행종료 + 낡은 sectOrd = 쓰레기 잔여)", () => {
    // 심야 실호출(2026-08-04): "운행종료"인데 staOrd−sectOrd가 27로 계산됐다.
    const slots = parseSeoulTrackSlots(
      seoulRaw([{ busRouteId: "1", vehId1: "0", arrmsg1: "운행종료", staOrd: "28", sectOrd1: "1" }]),
    );
    expect(slots[0].remainingStops).toBeNull();
  });

  it("슬롯2는 메시지가 슬롯1과 다를 때만(운행종료 중복 제거 관례)", () => {
    const slots = parseSeoulTrackSlots(
      seoulRaw([{ busRouteId: "1", vehId1: "7", arrmsg1: "운행종료", vehId2: "8", arrmsg2: "운행종료" }]),
    );
    expect(slots).toHaveLength(1);
  });

  it("'곧 도착'은 잔여 0(하차 구간 진입 = 도착 관측 축)", () => {
    expect(remainingFromArrmsg("곧 도착")).toBe(0);
    expect(remainingFromArrmsg("6분47초후[4번째 전]")).toBe(4);
    expect(remainingFromArrmsg("출발대기")).toBeNull();
  });
});

describe("pickAlightOrd — 순환·왕복 중복 정류소 대응(§5.2)", () => {
  const stop = (nodeId: string, order: number): BusRouteStop => ({
    nodeId,
    name: nodeId,
    order,
    lat: 37.5,
    lng: 127.1,
  });

  it("승차 순번보다 큰 것 중 최소를 택한다(같은 정류소 2회 경유)", () => {
    const stops = [stop("A", 1), stop("B", 5), stop("C", 9), stop("B", 20)];
    expect(pickAlightOrd(stops, "A", "B")).toBe(5);
    expect(pickAlightOrd(stops, "C", "B")).toBe(20); // 첫 경유는 이미 지나침
  });

  it("승차·하차 미발견 또는 순서 역전이면 null(정직한 추적 불가)", () => {
    const stops = [stop("A", 3), stop("B", 7)];
    expect(pickAlightOrd(stops, "X", "B")).toBeNull();
    expect(pickAlightOrd(stops, "A", "X")).toBeNull();
    expect(pickAlightOrd(stops, "B", "A")).toBeNull();
  });
});

describe("pickTagoStop — 왕복쌍 모호 가드(§5.2)", () => {
  const stop = (name: string, distanceMeters: number): BusStop => ({
    nodeId: `id-${name}-${distanceMeters}`,
    cityCode: "25",
    name,
    lat: 36.3,
    lng: 127.4,
    distanceMeters,
    source: "tago",
    arrivalStatus: "ok",
    arrivals: [],
  });

  it("동명·거리차 40m 미만 왕복쌍은 ambiguous(반대편 오선택 판별 불가)", () => {
    expect(pickTagoStop([stop("시청", 12), stop("시청", 35)])).toBe("ambiguous");
  });

  it("왕복 짝 사이에 다른 이름 정류소가 끼어도 전체 스캔으로 잡는다(독립 리뷰)", () => {
    expect(pickTagoStop([stop("시청", 12), stop("시청앞교차로", 20), stop("시청", 30)])).toBe(
      "ambiguous",
    );
  });

  it("이름이 다르거나 거리차가 충분하면 최근접 채택, 빈 목록은 null", () => {
    const picked = pickTagoStop([stop("시청", 12), stop("시청앞", 30)]);
    expect(picked).not.toBe("ambiguous");
    expect((picked as BusStop).name).toBe("시청");
    const far = pickTagoStop([stop("시청", 12), stop("시청", 80)]);
    expect((far as BusStop).distanceMeters).toBe(12);
    expect(pickTagoStop([])).toBeNull();
  });
});

describe("remainingFromArvlMsg — 지하철 잔여 추출(§6.2)", () => {
  it("[N]번째 전역·전역 계열·실패 폴백", () => {
    expect(remainingFromArvlMsg("[2]번째 전역 (몽촌토성(평화의문))")).toBe(2);
    expect(remainingFromArvlMsg("전역 출발")).toBe(1);
    expect(remainingFromArvlMsg("전역 도착")).toBe(1);
    expect(remainingFromArvlMsg("4분 후 (길동)")).toBeNull();
    expect(remainingFromArvlMsg("여의도 도착")).toBeNull();
  });
});

describe("trackSubway — 노선 필터·3-state(모킹)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  async function withMockedArrivals(
    arrivals: unknown,
  ): Promise<typeof import("../transit-track")> {
    // 파일 상단 정적 import가 이미 실모듈을 캐싱했으므로, 레지스트리를 비운 뒤
    // 모킹 → 동적 import 순서여야 목이 실제로 주입된다.
    vi.resetModules();
    vi.doMock("../providers/seoul-subway-arrival", () => ({
      fetchSubwayArrivals: vi.fn(async () => arrivals),
      subwayLineNameForId: (id: string) =>
        ({ "1005": "5호선", "1002": "2호선" })[id],
    }));
    return import("../transit-track");
  }

  it("노선 일치 항목만 TrackItem으로(잠금 키 원문 보존)", async () => {
    const mod = await withMockedArrivals({
      stationName: "천호",
      arrivals: [
        { line: "5호선", direction: "하행", trainLineNm: "하남검단산행", destination: "하남검단산",
          message: "[3]번째 전역 (길동)", arrivalSeconds: 300, express: false, trainNo: "5696", arrivalCode: "99" },
        { line: "8호선", direction: "상행", trainLineNm: "별내행", destination: "별내",
          message: "곧 도착", arrivalSeconds: 30, express: false, trainNo: "8123", arrivalCode: "1" },
      ],
    });
    const r = await mod.trackSubway({ station: "천호", lineName: "수도권 5호선" });
    expect(r.status).toBe("ok");
    if (r.status === "ok") {
      expect(r.items).toHaveLength(1);
      expect(r.items[0]).toMatchObject({
        vehicleId: "5696",
        direction: "하행",
        remainingStops: 3,
        destinationName: "하남검단산",
        arrivalCode: "99",
      });
    }
  });

  it("미커버 노선(비수도권)은 unsupported, 도착 0건·INFO-200(null)은 empty", async () => {
    const mod = await withMockedArrivals({ stationName: "천호", arrivals: [] });
    expect((await mod.trackSubway({ station: "대전역", lineName: "대전 1호선" })).status).toBe(
      "unsupported",
    );
    expect((await mod.trackSubway({ station: "천호", lineName: "수도권 5호선" })).status).toBe(
      "empty",
    );
    // INFO-200은 "미커버"와 "접근 열차 없음(운행 밖)"이 같은 코드 — 노선 매핑표가
    // 수도권을 이미 걸렀으므로 empty가 정직(심야 실호출 2026-08-04 정정).
    const modNull = await withMockedArrivals(null);
    expect((await modNull.trackSubway({ station: "천호", lineName: "수도권 5호선" })).status).toBe(
      "empty",
    );
  });
});

describe("trackSeoulRide — ord 해석 실패의 정직 강등(모킹)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("캐시·fresh 모두 해석 실패면 unsupported(잘못된 ord 조회 금지)", async () => {
    vi.resetModules();
    const fetchStops = vi.fn(async () => [] as BusRouteStop[]);
    vi.doMock("../providers/seoul-bus", async (importOriginal) => ({
      ...(await importOriginal<typeof import("../providers/seoul-bus")>()),
      fetchSeoulRouteStops: fetchStops,
      fetchSeoulRideSlots: vi.fn(async () => []),
    }));
    const mod = await import("../transit-track");
    const r = await mod.trackSeoulRide({
      routeId: "227000006",
      boardLocalId: "123000017",
      alightLocalId: "123000043",
    });
    expect(r.status).toBe("unsupported");
    expect(fetchStops).toHaveBeenCalledTimes(2); // 캐시 1 + fresh 1
    expect(fetchStops).toHaveBeenNthCalledWith(2, "227000006", { fresh: true });
  });
});
