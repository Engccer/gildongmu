import { describe, expect, it } from "vitest";
import type { KakaoLocalDocument } from "../../providers/kakao-local";
import type { CarRouteBriefing, EgressOption } from "../../types";
import { chooseFastest, exitsForLine, parseExitDoc, pickStand, prefilterExits } from "../egress";

function doc(name: string, over: Partial<KakaoLocalDocument> = {}): KakaoLocalDocument {
  return {
    id: "1",
    place_name: name,
    category_name: "교통,수송 > 지하철,전철 > 지하철출구",
    category_group_code: "SW8",
    phone: "",
    address_name: "",
    road_address_name: "",
    x: "126.9",
    y: "37.5",
    place_url: "",
    distance: "",
    ...over,
  };
}

describe("parseExitDoc", () => {
  it("노선이 있는 출구 이름에서 노선과 번호를 뽑는다", () => {
    const r = parseExitDoc(doc("노량진역 1호선 9번출구", { x: "126.94", y: "37.51" }), "노량진")!;
    expect(r.label).toBe("9");
    expect(r.lineName).toBe("1호선");
    expect(r.placeName).toBe("노량진역 1호선 9번출구");
    expect(r.coord).toEqual({ lat: 37.51, lng: 126.94 });
  });

  it("노선 표기가 없는 출구는 lineName 부재", () => {
    const r = parseExitDoc(doc("아현역 3번출구"), "아현")!;
    expect(r.label).toBe("3");
    expect("lineName" in r).toBe(false);
  });

  it("가지 번호(3-1)와 공백이 낀 번 출구", () => {
    expect(parseExitDoc(doc("강남역 3-1번출구"), "강남")?.label).toBe("3-1");
    expect(parseExitDoc(doc("강남역 2호선 12번 출구"), "강남")?.label).toBe("12");
  });

  it("서울역처럼 「역」으로 끝나는 장소도 표시 이름(서울)으로 찾는다", () => {
    const r = parseExitDoc(doc("서울역 1번출구"), "서울")!;
    expect(r.label).toBe("1");
    expect("lineName" in r).toBe(false);
  });

  it("카테고리 끝이 지하철출구가 아니면 null", () => {
    expect(parseExitDoc(doc("아현역 3번출구", { category_name: "교통,수송 > 지하철,전철 > 수도권2호선" }), "아현")).toBeNull();
  });

  it("다른 역 이름이면 null(노량진수산시장 등)", () => {
    expect(parseExitDoc(doc("노량진수산시장 1번출구"), "노량진")).toBeNull();
    expect(parseExitDoc(doc("신촌역 3번출구"), "아현")).toBeNull();
  });

  it("역 이름 뒤가 공백이 아닌 이름(서울역사 …)은 같은 역의 출구가 아니다", () => {
    expect(parseExitDoc(doc("서울역사 1번출구"), "서울")).toBeNull();
  });

  it("출구 번호가 없는 이름은 null", () => {
    expect(parseExitDoc(doc("아현역 택시승강장"), "아현")).toBeNull();
  });

  it("좌표가 유한하지 않으면 null", () => {
    expect(parseExitDoc(doc("아현역 3번출구", { x: "", y: "abc" }), "아현")).toBeNull();
  });
});

describe("exitsForLine", () => {
  const e = (label: string, lineName?: string) => ({
    label, placeName: "", coord: { lat: 37.5, lng: 127 }, ...(lineName ? { lineName } : {}),
  });

  it("마지막 탈것과 같은 노선의 출구만 받는다", () => {
    const exits = [e("1", "2호선"), e("2", "수도권2호선"), e("3", "신분당선")];
    expect(exitsForLine(exits, "수도권 2호선").map((x) => x.label)).toEqual(["1", "2"]);
  });

  it("노선 표기 없는 출구는 그 역의 출구가 모두 무표기일 때만 받는다", () => {
    const allBare = [e("1"), e("2")];
    expect(exitsForLine(allBare, "수도권 2호선")).toHaveLength(2);
    const mixed = [e("1"), e("2", "2호선"), e("3", "신분당선")];
    expect(exitsForLine(mixed, "수도권 2호선").map((x) => x.label)).toEqual(["2"]);
  });

  it("노선이 섞여 있고 맞는 노선이 없으면 빈 배열(무표기로 폴백하지 않는다)", () => {
    const mixed = [e("1"), e("2", "신분당선")];
    expect(exitsForLine(mixed, "수도권 2호선")).toEqual([]);
  });

  it("하차 노선을 모르면(undefined) 전부 받는다", () => {
    const exits = [e("1", "2호선"), e("2", "신분당선")];
    expect(exitsForLine(exits, undefined)).toHaveLength(2);
  });
});

describe("prefilterExits", () => {
  const to = { lat: 37.5, lng: 127.0 };
  const at = (label: string, dLat: number) => ({ label, placeName: "", coord: { lat: 37.5 + dLat, lng: 127.0 } });

  it("목적지까지 직선 오름차순 k개", () => {
    const exits = [at("a", 0.003), at("b", 0.001), at("c", 0.002), at("d", 0.004)];
    expect(prefilterExits(exits, to, 2).map((x) => x.label)).toEqual(["b", "c"]);
  });

  it("동점은 입력 순서를 유지한다(안정)", () => {
    const exits = [at("a", 0.001), at("b", 0.001), at("c", 0.001)];
    expect(prefilterExits(exits, to, 2).map((x) => x.label)).toEqual(["a", "b"]);
  });

  it("k가 0 이하이거나 입력보다 크면", () => {
    const exits = [at("a", 0.001)];
    expect(prefilterExits(exits, to, 0)).toEqual([]);
    expect(prefilterExits(exits, to, -3)).toEqual([]);
    expect(prefilterExits(exits, to, 5)).toHaveLength(1);
  });

  it("입력 배열을 변형하지 않는다", () => {
    const exits = [at("a", 0.003), at("b", 0.001)];
    prefilterExits(exits, to, 2);
    expect(exits.map((x) => x.label)).toEqual(["a", "b"]);
  });
});

describe("pickStand", () => {
  const alight = { lat: 37.5556, lng: 126.9723 };
  const stand = (name: string, dLat: number) =>
    doc(name, { category_name: "교통,수송 > 택시승강장", y: String(alight.lat + dLat), x: String(alight.lng) });

  it("이름에 택시가 든 POI 중 하차 좌표 300m 안 최근접 하나", () => {
    const r = pickStand([stand("서울역택시승강장", 0.002), stand("서울역 택시 승차장", 0.001)], alight)!;
    expect(r.label).toBe("서울역 택시 승차장");
    expect(r.placeName).toBe("서울역 택시 승차장");
  });

  it("300m 밖이면 null", () => {
    expect(pickStand([stand("먼 택시승강장", 0.004)], alight)).toBeNull();
  });

  it("이름에 택시가 없으면 건너뛴다", () => {
    expect(pickStand([stand("서울역 1번출구", 0.0005)], alight)).toBeNull();
  });

  it("후보가 없으면 null", () => {
    expect(pickStand([], alight)).toBeNull();
  });
});

describe("chooseFastest", () => {
  const taxi = (sec: number): CarRouteBriefing => ({ distanceMeters: 1000, durationSeconds: sec, taxiFare: 5000, tollFare: 0, guides: [] });
  const opt = (label: string, sec: number): EgressOption => ({
    kind: "exit", label, placeName: "", coord: { lat: 37.5, lng: 127 }, taxiOut: taxi(sec),
  });

  it("택시 시간(분, 반올림) 최단", () => {
    const r = chooseFastest([
      { option: opt("1", 600), walkFromStopM: 10 },
      { option: opt("2", 420), walkFromStopM: 90 },
      { option: opt("3", 540), walkFromStopM: 5 },
    ])!;
    expect(r.label).toBe("2");
  });

  it("분 단위로 같으면(반올림) 하차역에서 덜 걷는 쪽", () => {
    // 400초 → 7분, 419초 → 7분 (420 미만 반올림), 같은 분
    const r = chooseFastest([
      { option: opt("far", 400), walkFromStopM: 120 },
      { option: opt("near", 419), walkFromStopM: 30 },
    ])!;
    expect(r.label).toBe("near");
  });

  it("초 단위로는 더 빨라도 분이 더 크면 지는 쪽", () => {
    // 449초 → 7분, 451초 → 8분
    const r = chooseFastest([
      { option: opt("slowerMin", 451), walkFromStopM: 1 },
      { option: opt("fasterMin", 449), walkFromStopM: 500 },
    ])!;
    expect(r.label).toBe("fasterMin");
  });

  it("완전 동점이면 앞선 쪽, 빈 입력은 null", () => {
    expect(chooseFastest([{ option: opt("a", 300), walkFromStopM: 5 }, { option: opt("b", 300), walkFromStopM: 5 }])?.label).toBe("a");
    expect(chooseFastest([])).toBeNull();
  });
});
