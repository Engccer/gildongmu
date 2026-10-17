import { describe, expect, it } from "vitest";
import type { TransitLeg, TransitRoute } from "../../types";
import { trimJourneyTransit } from "../trim";

const sub1: TransitLeg = {
  mode: "subway", lineName: "수도권 2호선", fromName: "아현", toName: "충정로", minutes: 10,
  stops: [{ name: "아현", lat: 37.5574, lng: 126.9561 }, { name: "충정로", lat: 37.5597, lng: 126.9643 }],
};
const sub2: TransitLeg = {
  mode: "subway", lineName: "수도권 5호선", fromName: "충정로", toName: "광화문", minutes: 12,
  stops: [{ name: "충정로", lat: 37.5603, lng: 126.963 }, { name: "광화문", lat: 37.5717, lng: 126.9765 }],
};

/** 앞 도보 5분, 탈것, (거리 0·3분 환승 통로는 legs에서 이미 빠져 summary에만 남는다), 탈것, 뒤 도보 4분. total 40, walk 12 = 5+4+3. */
function sample(): TransitRoute {
  return {
    summary: {
      totalMinutes: 40, fare: 1550, transfers: 1, walkMinutes: 12, walkMeters: 800,
      departName: "아현", arriveName: "광화문",
    },
    legs: [
      { mode: "walk", toName: "아현", minutes: 5, distanceMeters: 300 },
      sub1,
      sub2,
      { mode: "walk", minutes: 4, distanceMeters: 250 },
    ],
    routeKey: "p3",
  };
}

describe("trimJourneyTransit", () => {
  it("승차·하차 둘 다 자르면 총시간·도보시간에서 뗀 도보 분만 뺀다(환승 통로 3분 보존)", () => {
    const r = trimJourneyTransit(sample(), { trimBoard: true, trimAlight: true });
    expect(r.summary.totalMinutes).toBe(31);
    expect(r.summary.walkMinutes).toBe(3);
    expect(r.legs).toEqual([sub1, sub2]);
    expect(r.routeKey).toBe("p3");
    expect(r.summary.fare).toBe(1550);
    expect(r.summary.transfers).toBe(1);
    expect(r.summary.walkMeters).toBe(250);
    expect(r.summary.departName).toBe("아현");
    expect(r.summary.arriveName).toBe("광화문");
  });

  it("승차만 자르면 뒤 도보는 남는다", () => {
    const r = trimJourneyTransit(sample(), { trimBoard: true, trimAlight: false });
    expect(r.legs).toHaveLength(3);
    expect(r.legs[2]).toEqual({ mode: "walk", minutes: 4, distanceMeters: 250 });
    expect(r.summary.totalMinutes).toBe(35);
    expect(r.summary.walkMinutes).toBe(7);
    expect(r.summary.walkMeters).toBe(500);
  });

  it("하차만 자르면 앞 도보는 남는다", () => {
    const r = trimJourneyTransit(sample(), { trimBoard: false, trimAlight: true });
    expect(r.legs[0].mode).toBe("walk");
    expect(r.summary.totalMinutes).toBe(36);
    expect(r.summary.walkMinutes).toBe(8);
  });

  it("아무것도 안 자르면 값이 같다(복사본)", () => {
    const src = sample();
    const r = trimJourneyTransit(src, { trimBoard: false, trimAlight: false });
    expect(r).toEqual(src);
    expect(r).not.toBe(src);
  });

  it("입력을 변형하지 않는다", () => {
    const src = sample();
    const snapshot = JSON.parse(JSON.stringify(src));
    trimJourneyTransit(src, { trimBoard: true, trimAlight: true });
    expect(src).toEqual(snapshot);
  });

  it("뗀 도보 중 거리를 모르는 leg가 있으면 walkMeters를 지운다(모름을 틀린 값으로 남기지 않는다)", () => {
    const src = sample();
    src.legs[0] = { mode: "walk", toName: "아현", minutes: 5 };
    const r = trimJourneyTransit(src, { trimBoard: true, trimAlight: false });
    expect("walkMeters" in r.summary).toBe(false);
    expect(r.summary.walkMinutes).toBe(7);
  });

  it("원래 walkMeters가 없으면 그대로 없다", () => {
    const src = sample();
    delete src.summary.walkMeters;
    const r = trimJourneyTransit(src, { trimBoard: true, trimAlight: true });
    expect("walkMeters" in r.summary).toBe(false);
  });

  it("합계는 0 아래로 내려가지 않는다", () => {
    const src = sample();
    src.summary.totalMinutes = 4;
    src.summary.walkMinutes = 2;
    const r = trimJourneyTransit(src, { trimBoard: true, trimAlight: true });
    expect(r.summary.totalMinutes).toBe(0);
    expect(r.summary.walkMinutes).toBe(0);
  });

  it("승차를 자르면 departName이, 하차를 자르면 arriveName이 첫·마지막 탈것 이름이 된다", () => {
    const src = sample();
    src.summary.departName = "아현역버스정류장";
    src.summary.arriveName = "광화문역버스정류장";
    const r = trimJourneyTransit(src, { trimBoard: true, trimAlight: false });
    expect(r.summary.departName).toBe("아현");
    expect(r.summary.arriveName).toBe("광화문역버스정류장");
    const r2 = trimJourneyTransit(src, { trimBoard: false, trimAlight: true });
    expect(r2.summary.departName).toBe("아현역버스정류장");
    expect(r2.summary.arriveName).toBe("광화문");
  });

  it("탈것 사이의 도보(환승 도보)는 자르지 않는다", () => {
    const src = sample();
    src.legs.splice(2, 0, { mode: "walk", minutes: 1, distanceMeters: 31 });
    const r = trimJourneyTransit(src, { trimBoard: true, trimAlight: true });
    expect(r.legs.map((l) => l.mode)).toEqual(["subway", "walk", "subway"]);
  });

  it("탈것이 없는 경로는 그대로 둔다", () => {
    const src: TransitRoute = {
      summary: { totalMinutes: 3, fare: 0, transfers: 0, walkMinutes: 3 },
      legs: [{ mode: "walk", minutes: 3 }],
      routeKey: "w",
    };
    expect(trimJourneyTransit(src, { trimBoard: true, trimAlight: true })).toEqual(src);
  });

  it("highlight 등 다른 필드를 유지한다", () => {
    const src = { ...sample(), highlight: ["fastest" as const] };
    expect(trimJourneyTransit(src, { trimBoard: true, trimAlight: true }).highlight).toEqual(["fastest"]);
  });
});
