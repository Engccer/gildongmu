import { describe, expect, it } from "vitest";
import type { CarRouteBriefing, EgressOption, JourneyResult, JourneyVariant, TransitLeg } from "../../types";
import {
  journeyEgressLine,
  journeyLineHint,
  journeyLineLabel,
  journeyLineQualifiers,
  journeyMissingLines,
  journeyNeedsLineQualifier,
  journeyTaxiInLine,
  journeyTotalsLine,
  journeyVariantHeading,
  recentJourneyLabel,
  type JourneyStationPick,
  type JourneyT,
} from "../journey-lines";

/** 키와 인자를 그대로 보이는 번역기 — 어느 문장 키를 어떤 값으로 골랐는지 단언한다. */
const t: JourneyT = (key, args) => (args ? `${key}(${Object.entries(args).map(([k, v]) => `${k}=${v}`).join(",")})` : key);

const car = (minutes: number, fare: number) => ({ durationSeconds: minutes * 60, taxiFare: fare }) as CarRouteBriefing;
const subway = (from: string, to: string, line: string, stops?: { lat: number; lng: number }[]) =>
  ({ mode: "subway", fromName: from, toName: to, lineName: line, stops }) as TransitLeg;
const bus = (from: string, to: string) => ({ mode: "bus", fromName: from, toName: to, lineName: "420" }) as TransitLeg;

function variant(kind: "designated" | "recommended", legs: TransitLeg[], extra: Partial<JourneyVariant> = {}): JourneyVariant {
  return {
    kind,
    transit: { legs, summary: {} } as unknown as JourneyVariant["transit"],
    totals: { minutes: 40, taxiFare: 15600, transitFare: 1550 },
    ...extra,
  } as JourneyVariant;
}

const ahyeon: JourneyStationPick = { label: "아현역", lat: 37.5577, lng: 126.9562, line: "수도권2호선" };

describe("journeyVariantHeading", () => {
  it("지정 역 경로는 고른 쪽 역 이름, 끝 「역」은 뗀다", () => {
    const v = variant("designated", [subway("아현", "광화문", "수도권 2호선")]);
    expect(journeyVariantHeading(v, ahyeon, null, { board: false, alight: false }, t)).toBe(
      "designatedHeading(station=아현)",
    );
  });

  it("하차 역만 지정한 지정 경로는 「…에서 내리는 경로」(판정 18)", () => {
    const v = variant("designated", [subway("노량진", "역곡", "수도권 1호선")]);
    const yeokgok: JourneyStationPick = { label: "역곡역", lat: 37.485, lng: 126.811 };
    expect(journeyVariantHeading(v, null, yeokgok, { board: false, alight: false }, t)).toBe(
      "designatedHeadingAlight(station=역곡)",
    );
  });

  it("추천 경로가 승차 쪽이 다르면 그 역, 버스로 시작하면 정류장 문장", () => {
    const v = variant("recommended", [subway("애오개", "광화문", "수도권 5호선")]);
    expect(journeyVariantHeading(v, ahyeon, null, { board: false, alight: false }, t)).toBe(
      "recommendedHeading(station=애오개)",
    );
    const b = variant("recommended", [bus("아현동", "광화문")]);
    expect(journeyVariantHeading(b, ahyeon, null, { board: false, alight: false }, t)).toBe(
      "recommendedHeadingBus(stop=아현동)",
    );
  });

  it("하차 쪽만 다르고 버스로 끝나면 「{정류장}에서 버스에서 내리는 추천 경로」(판정 17)", () => {
    const yeokgok: JourneyStationPick = { label: "역곡역", lat: 37.485, lng: 126.811 };
    const v = variant("recommended", [subway("아현", "신촌", "수도권 2호선"), bus("신촌", "역곡남부")]);
    expect(journeyVariantHeading(v, ahyeon, yeokgok, { board: false, alight: false }, t)).toBe(
      "recommendedHeadingBusAlight(stop=역곡남부)",
    );
  });
});

describe("동명 이역 노선 머리말(판정 26)", () => {
  it("노선 표기 정규화", () => {
    expect(journeyLineLabel("수도권 2호선")).toBe("2호선");
    expect(journeyLineLabel("수도권 수인.분당선")).toBe("수인분당선");
    expect(journeyLineLabel("수도권 1호선(급행)")).toBe("1호선");
    expect(journeyLineLabel("")).toBeNull();
  });

  it("이름이 같고 노선이 다르면 붙이고, 노선을 모르면 좌표 500m로 가른다", () => {
    const gyeongui = { name: "신촌", line: "경의중앙선", lat: 37.5598, lng: 126.9425 };
    const line2 = { name: "신촌", line: "수도권 2호선", lat: 37.5552, lng: 126.9368 };
    expect(journeyNeedsLineQualifier(gyeongui, line2)).toBe(true);
    expect(journeyNeedsLineQualifier({ ...gyeongui, line: undefined }, line2)).toBe(true); // 약 680m
    expect(journeyNeedsLineQualifier({ ...line2, line: "수도권2호선" }, line2)).toBe(false);
    expect(journeyNeedsLineQualifier({ name: "아현", lat: 0, lng: 0 }, line2)).toBe(false);
  });

  it("추천 변형의 승차 정류가 고른 역과 동명 이역이면 승차 쪽에 붙는다", () => {
    const picked: JourneyStationPick = { label: "신촌역", lat: 37.5598, lng: 126.9425, line: "경의중앙선" };
    const result: JourneyResult = {
      variants: [variant("recommended", [subway("신촌", "광화문", "수도권 2호선", [{ lat: 37.5552, lng: 126.9368 }])])],
      designatedMissing: { side: "board" },
    };
    expect(journeyLineQualifiers(result, picked, null)).toEqual({ board: true, alight: false });
    expect(journeyMissingLines(result, picked, null, t)).toEqual(["designatedMissing(station=경의중앙선 신촌)"]);
  });
});

describe("못 찾음·합계·구간 줄", () => {
  it("양쪽을 못 찾으면 두 줄, 정류장은 원문", () => {
    const stop: JourneyStationPick = { label: "역곡역.가톨릭대", lat: 37.48, lng: 126.81, kind: "stop" };
    const result: JourneyResult = { variants: [variant("recommended", [])], designatedMissing: { side: "both" } };
    expect(journeyMissingLines(result, ahyeon, stop, t)).toEqual([
      "designatedMissing(station=아현)",
      "designatedMissingStopAlight(stop=역곡역.가톨릭대)",
    ]);
  });

  it("다른 출구를 고르면 합계가 그 택시 구간 차이만큼 바뀐다", () => {
    const exit = { kind: "exit", label: "1", coord: { lat: 0, lng: 0 }, placeName: "x", taxiOut: car(13, 7800) } as EgressOption;
    const stand = { kind: "stand", label: "택시승강장", coord: { lat: 0, lng: 0 }, placeName: "y", taxiOut: car(19, 9800) } as EgressOption;
    const v = variant("designated", [subway("아현", "서울역", "수도권 1호선")], { egress: { options: [exit, stand] } });
    expect(journeyTotalsLine(v, 0, t)).toBe("totals(minutes=40,taxiFare=15,600,transitFare=1,550)");
    expect(journeyTotalsLine(v, 1, t)).toBe("totals(minutes=46,taxiFare=17,600,transitFare=1,550)");
    expect(journeyEgressLine(v, exit, t)).toBe("egressExit(exit=1,minutes=13,fare=7,800)");
    expect(journeyEgressLine(v, stand, t)).toBe("egressStand(minutes=19,fare=9,800)");
  });

  it("출구 3-state: 없음 ≠ 조회 실패, 버스로 끝나면 정류장 문장", () => {
    const none = { kind: "none", label: "", coord: { lat: 0, lng: 0 }, placeName: "", taxiOut: car(9, 5000) } as EgressOption;
    const v = variant("designated", [subway("아현", "역곡", "수도권 1호선")], { egress: { options: [none] } });
    expect(journeyEgressLine(v, none, t)).toBe("egressNone(minutes=9,fare=5,000)");
    const failed = { ...v, egress: { options: [none], lookupFailed: true as const } };
    expect(journeyEgressLine(failed, none, t)).toBe("egressLookupFailed(minutes=9,fare=5,000)");
    const busEnd = variant("recommended", [bus("아현동", "역곡남부")], { egress: { options: [none] } });
    expect(journeyEgressLine(busEnd, none, t)).toBe("egressNoneStop(minutes=9,fare=5,000)");
  });

  it("택시 앞 줄: 역이면 「역」 틀, 버스로 시작하면 정류장 이름 그대로", () => {
    const station = { name: "아현역", coord: { lat: 0, lng: 0 } };
    const v = variant("designated", [subway("아현", "광화문", "수도권 2호선")], { taxiIn: car(8, 7800), boardStation: station });
    expect(journeyTaxiInLine(v, t)).toBe("taxiIn(station=아현,minutes=8,fare=7,800)");
    const b = variant("recommended", [bus("아현동", "광화문")], {
      taxiIn: car(8, 7800),
      boardStation: { name: "아현동", coord: { lat: 0, lng: 0 } },
    });
    expect(journeyTaxiInLine(b, t)).toBe("taxiInStop(stop=아현동,minutes=8,fare=7,800)");
    expect(journeyTaxiInLine(variant("designated", []), t)).toBeNull();
  });
});

describe("노선 힌트·최근 경로 줄", () => {
  it("카테고리 끝 조각, 아니면 이름 꼬리", () => {
    expect(journeyLineHint({ name: "아현역", category: "교통,수송 > 지하철,전철 > 수도권2호선" })).toBe("수도권2호선");
    expect(journeyLineHint({ name: "노량진역 1호선", category: "교통,수송 > 지하철,전철" })).toBe("1호선");
    expect(journeyLineHint({ name: "서울역", category: "교통,수송 > 기차역" })).toBeUndefined();
  });

  it("판정 20 문장(역 하나·둘·정류장 섞임)", () => {
    const yeokgok: JourneyStationPick = { label: "역곡역", lat: 1, lng: 1 };
    const stop: JourneyStationPick = { label: "부천시청", lat: 2, lng: 2, kind: "stop" };
    expect(recentJourneyLabel(ahyeon, null, "현재 위치", "광화문", t)).toBe(
      "recentRoute(from=현재 위치,to=광화문,station=아현)",
    );
    expect(recentJourneyLabel(ahyeon, yeokgok, "a", "b", t)).toBe("recentRouteBoth(from=a,to=b,board=아현,alight=역곡)");
    expect(recentJourneyLabel(null, stop, "a", "b", t)).toBe("recentRouteStop(from=a,to=b,stop=부천시청)");
    expect(recentJourneyLabel(ahyeon, stop, "a", "b", t)).toBe(
      "recentRouteBothPlaces(from=a,to=b,board=stationPlace(station=아현),alight=부천시청)",
    );
    expect(recentJourneyLabel(null, null, "a", "b", t)).toBeNull();
  });
});
