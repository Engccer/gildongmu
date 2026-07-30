import { describe, it, expect, beforeEach } from "vitest";
import {
  requestOpenPlace,
  subscribeOpenPlace,
  __resetOpenPlaceForTest,
} from "../place-open-request";
import type { Place } from "../types";

const PLACE: Place = {
  id: "p1",
  name: "테스트 장소",
  category: "",
  address: "서울시 강동구",
  roadAddress: "서울시 강동구",
  lat: 37.5,
  lng: 127.1,
};

beforeEach(() => {
  __resetOpenPlaceForTest();
});

describe("place-open-request 브릿지", () => {
  it("구독 후 발행하면 구독자가 place를 받는다", () => {
    let received: Place | null = null;
    subscribeOpenPlace((place) => {
      received = place;
    });
    requestOpenPlace(PLACE);
    expect(received).toEqual(PLACE);
  });

  it("unsubscribe 후에는 발행해도 호출되지 않는다", () => {
    let calls = 0;
    const unsubscribe = subscribeOpenPlace(() => {
      calls++;
    });
    unsubscribe();
    requestOpenPlace(PLACE);
    expect(calls).toBe(0);
  });

  it("구독자가 없는 상태에서 발행해도 throw하지 않는다", () => {
    expect(() => requestOpenPlace(PLACE)).not.toThrow();
  });
});
