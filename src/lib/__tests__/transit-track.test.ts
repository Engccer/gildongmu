import { describe, it, expect, vi, afterEach } from "vitest";
import type { BusRouteStop, BusStop } from "../types";
import {
  parseSeoulTrackSlots,
  remainingFromArrmsg,
} from "../providers/seoul-bus";
import {
  parseRecptnDt,
  pickAlightOrd,
  pickTagoStop,
  remainingFromArvlCd,
  remainingFromArvlMsg,
  rewriteBusArrivalMessage,
  subwayDataAgeSeconds,
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

describe("rewriteBusArrivalMessage — 잔여 꼬리 제거·어미 정리", () => {
  it("잔여 정거장 꼬리를 떼고 '남음'으로 맺는다", () => {
    // 화면이 "남은 정거장 3개"를 이미 말하므로 "[3번째 전]"은 같은 정보 반복이다.
    expect(rewriteBusArrivalMessage("2분55초후[3번째 전]")).toBe("2분55초 남음");
    expect(rewriteBusArrivalMessage("55초후[1번째 전]")).toBe("55초 남음");
    expect(rewriteBusArrivalMessage("12분3초후[9번째 전]")).toBe("12분3초 남음");
  });

  it("실승차 로그의 실제 arrmsg 3건(강동01, 2026-08-16)", () => {
    // `docs/superpowers/specs/logs/transit-guide-diag-2026-08-16.log`의 countdown·
    // trackingStarted 이벤트 message 원문. 합성 표본이 아니라 그날 화면에 뜬 문자열이다.
    expect(rewriteBusArrivalMessage("6분18초후[5번째 전]")).toBe("6분18초 남음");
    expect(rewriteBusArrivalMessage("3분48초후[3번째 전]")).toBe("3분48초 남음");
    expect(rewriteBusArrivalMessage("1분32초후[1번째 전]")).toBe("1분32초 남음");
  });

  it("시간형이 아닌 상태 문장은 원문 그대로 둔다", () => {
    // upstream 완성 문장이 낭독 정본이라는 계약(CLAUDE.md)은 여기서도 유효하다 —
    // 다듬는 것은 잔여 꼬리와 어미뿐이고 상태 어휘는 우리가 만들지 않는다.
    for (const raw of ["곧 도착", "출발대기", "운행종료", "차고지 대기"]) {
      expect(rewriteBusArrivalMessage(raw)).toBe(raw);
    }
  });

  it("꼬리만 있고 어미가 없거나, 어미만 있고 꼬리가 없어도 각각 처리한다", () => {
    expect(rewriteBusArrivalMessage("3분후")).toBe("3분 남음");
    expect(rewriteBusArrivalMessage("곧 도착[1번째 전]")).toBe("곧 도착");
  });

  it("빈 문자열은 빈 문자열로 — 없는 문장을 만들지 않는다", () => {
    expect(rewriteBusArrivalMessage("")).toBe("");
  });
});

describe("remainingFromArvlCd — arvlCd 잔여 폴백(§12.2)", () => {
  it("당역(0·1·2)=0, 전역(3·4·5)=1, 운행중(99)·미지는 null", () => {
    expect(remainingFromArvlCd("0")).toBe(0);
    expect(remainingFromArvlCd("1")).toBe(0);
    expect(remainingFromArvlCd("2")).toBe(0);
    expect(remainingFromArvlCd("3")).toBe(1);
    expect(remainingFromArvlCd("4")).toBe(1);
    expect(remainingFromArvlCd("5")).toBe(1);
    expect(remainingFromArvlCd("99")).toBeNull();
    expect(remainingFromArvlCd(undefined)).toBeNull();
  });
});

describe("recptnDt 신선도 게이트(§12.1)", () => {
  // 2026-08-06 00:25:11 KST = 2026-08-05T15:25:11Z
  const KST_EPOCH = Date.parse("2026-08-05T15:25:11Z");

  it("parseRecptnDt는 KST 명시 오프셋으로 파싱, 형식 밖은 null", () => {
    expect(parseRecptnDt("2026-08-06 00:25:11")).toBe(KST_EPOCH);
    expect(parseRecptnDt("2026-08-06T00:25:11")).toBe(KST_EPOCH);
    expect(parseRecptnDt("")).toBeNull();
    expect(parseRecptnDt("어제")).toBeNull();
  });

  it("ⓐ 미래값(신분당선 고장)은 0 클램프, 정상 lag는 반올림 초", () => {
    expect(subwayDataAgeSeconds("2026-08-06 00:25:11", "99", KST_EPOCH + 22_000)).toBe(22);
    expect(subwayDataAgeSeconds("2026-08-06 00:25:11", "99", KST_EPOCH - 30_000)).toBe(0);
  });

  it("ⓑ lag>120초 ∧ 종착 상태(1·2·5)는 동결 — null(판정 불가)", () => {
    const late = KST_EPOCH + 300_000;
    expect(subwayDataAgeSeconds("2026-08-06 00:25:11", "1", late)).toBeNull();
    expect(subwayDataAgeSeconds("2026-08-06 00:25:11", "2", late)).toBeNull();
    expect(subwayDataAgeSeconds("2026-08-06 00:25:11", "5", late)).toBeNull();
    // 비종착 상태는 큰 lag여도 원값 유지(정직한 큰 수치가 은폐보다 낫다)
    expect(subwayDataAgeSeconds("2026-08-06 00:25:11", "99", late)).toBe(300);
    // 종착이어도 120초 이내는 정상
    expect(subwayDataAgeSeconds("2026-08-06 00:25:11", "1", KST_EPOCH + 60_000)).toBe(60);
  });

  it("미제공·파싱 불가는 null(버스와 동일 취급 — 표기 생략)", () => {
    expect(subwayDataAgeSeconds(undefined, "99", KST_EPOCH)).toBeNull();
    expect(subwayDataAgeSeconds("고장", "99", KST_EPOCH)).toBeNull();
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
          message: "[3]번째 전역 (길동)", arrivalSeconds: 300, express: false, trainNo: "5696", arrivalCode: "99",
          currentLocation: "길동", receivedAt: "2026-08-06 00:25:11" },
        { line: "8호선", direction: "상행", trainLineNm: "별내행", destination: "별내",
          message: "곧 도착", arrivalSeconds: 30, express: false, trainNo: "8123", arrivalCode: "1" },
      ],
    });
    const r = await mod.trackSubway({ station: "천호", lineName: "수도권 5호선" });
    expect(r.status).toBe("ok");
    if (r.status === "ok") {
      expect(r.items).toHaveLength(1);
      // rawCount = 노선 필터 전 원시 건수(§13.3 — 필터 전멸 판정 축).
      expect(r.rawCount).toBe(2);
      expect(r.items[0]).toMatchObject({
        vehicleId: "5696",
        direction: "하행",
        remainingStops: 3,
        destinationName: "하남검단산",
        arrivalCode: "99",
        // §12 투영: 현재 역·스냅숏 원문 보존, 나이는 서버 계산 정수
        currentLocation: "길동",
        dataStamp: "2026-08-06 00:25:11",
      });
      expect(typeof r.items[0].dataAgeSeconds).toBe("number");
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

  it("타 노선 도착만 있으면 empty + rawCount>0(필터 전멸, §13.3)", async () => {
    const mod = await withMockedArrivals({
      stationName: "천호",
      arrivals: [
        { line: "8호선", direction: "상행", trainLineNm: "별내행", destination: "별내",
          message: "곧 도착", arrivalSeconds: 30, express: false, trainNo: "8123", arrivalCode: "1" },
      ],
    });
    const r = await mod.trackSubway({ station: "천호", lineName: "수도권 5호선" });
    expect(r).toEqual({ status: "empty", rawCount: 1 });
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

describe("완성 문장 다듬기는 승차 국면만 — 대기 목록은 원문 유지(모킹)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  const slot = {
    vehicleId: "1234",
    message: "2분55초후[3번째 전]",
    remainingStops: 3,
    lowFloor: false,
  };

  it("대기 후보 목록은 잔여 꼬리를 남긴다 — 그 화면의 유일한 잔여 정보 채널이다", async () => {
    vi.resetModules();
    vi.doMock("../providers/seoul-bus", async (importOriginal) => ({
      ...(await importOriginal<typeof import("../providers/seoul-bus")>()),
      fetchSeoulWaitSlots: vi.fn(async () => ({ slots: [slot], rawCount: 1 })),
    }));
    const mod = await import("../transit-track");
    const r = await mod.trackSeoulWait({ arsId: "25107", routeId: "4130081" });
    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    // 후보 버튼은 remainingStops를 별도로 싣지 않는다(웹 TransitGuidePanel·iOS
    // TransitTrackingSheet 모두 item.message만 조립) — 여기서 꼬리를 지우면
    // "몇 정거장 전에 있는 버스인가"가 화면에서 사라진다.
    expect(r.items[0].message).toBe("2분55초후[3번째 전]");
  });

  it("승차 카운트다운은 꼬리를 떼고 '남음'으로 맺는다 — 상태줄이 잔여를 이미 말한다", async () => {
    vi.resetModules();
    vi.doMock("../providers/seoul-bus", async (importOriginal) => ({
      ...(await importOriginal<typeof import("../providers/seoul-bus")>()),
      fetchSeoulRouteStops: vi.fn(async () => [
        { nodeId: "123000017", order: 3 },
        { nodeId: "123000043", order: 8 },
      ]),
      fetchSeoulRideSlots: vi.fn(async () => [slot]),
    }));
    const mod = await import("../transit-track");
    const r = await mod.trackSeoulRide({
      routeId: "227000006",
      boardLocalId: "123000017",
      alightLocalId: "123000043",
    });
    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(r.items[0].message).toBe("2분55초 남음");
    // 다듬기가 잔여 추출보다 앞서면 여기서 살아남지 못한다.
    expect(r.items[0].remainingStops).toBe(3);
  });
});
