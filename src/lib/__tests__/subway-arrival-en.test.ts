import { describe, expect, it, vi } from "vitest";
import fixture from "./fixtures/subway-arrival-en-cases.json";
import { enrichArrivalEn, type ArrivalEnContext } from "../subway-arrival-en";
import { matchStationsByName } from "../subway-stations";
import type { SubwayArrival, SubwayStation } from "../types";

const STATIONS: SubwayStation[] = fixture.stations.map((s, i) => ({
  stationId: `T${i}`,
  name: s.name,
  nameEn: s.nameEn,
  lineName: s.lineName,
  lat: 37.5,
  lng: 127,
  operator: "test",
  roadAddress: "",
  isTransfer: false,
}));

const ctx: ArrivalEnContext = {
  findStations: (query, lineHint) => matchStationsByName(STATIONS, query, lineHint),
};

const EN_KEYS = ["lineEn", "directionEn", "trainLineNmEn", "messageEn", "currentLocationEn"] as const;

describe("enrichArrivalEn — arvlCd×문장 행렬·seed 영문(E27 §3.4)", () => {
  for (const c of fixture.cases) {
    it(c.name, () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const arrival: SubwayArrival = {
        direction: c.arrival.direction,
        trainLineNm: c.arrival.trainLineNm,
        destination: c.arrival.destination,
        message: c.arrival.message,
        arrivalSeconds: 0,
        express: c.arrival.express ?? false,
        ...(c.arrival.line ? { line: c.arrival.line } : {}),
        ...(c.arrival.arrivalCode ? { arrivalCode: c.arrival.arrivalCode } : {}),
        ...(c.arrival.currentLocation ? { currentLocation: c.arrival.currentLocation } : {}),
      };
      const out = enrichArrivalEn(arrival, ctx);
      const expected = c.expect as Partial<Record<(typeof EN_KEYS)[number], string>>;
      for (const key of EN_KEYS) {
        const want = expected[key];
        if (want === undefined) continue;
        if (want === "absent") expect(out[key], key).toBeUndefined();
        else expect(out[key], key).toBe(want);
      }
      // 한국어 원문은 어느 경우에도 불변(원칙 1).
      expect(out.message).toBe(arrival.message);
      expect(out.trainLineNm).toBe(arrival.trainLineNm);
      expect(out.direction).toBe(arrival.direction);
      warn.mockRestore();
    });
  }

  it("`barvlDt`(arrivalSeconds)는 문장 생성에 쓰이지 않는다", () => {
    const out = enrichArrivalEn(
      { direction: "상행", trainLineNm: "x", destination: "x", message: "전역 출발", arrivalSeconds: 999, express: false, arrivalCode: "3" },
      ctx,
    );
    expect(out.messageEn).toBe("Departed previous station");
  });

  it("행렬 밖 모양은 프로세스당 1회 계측된다(역명 없이 모양만)", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const bad = { direction: "상행", trainLineNm: "x", destination: "x", message: "잠실역에 곧 도착합니다", arrivalSeconds: 0, express: false, arrivalCode: "1" };
    enrichArrivalEn(bad, ctx);
    enrichArrivalEn(bad, ctx);
    const calls = warn.mock.calls.filter((c) => String(c[0]).includes("행렬 밖"));
    expect(calls.length).toBe(1);
    expect(String(calls[0][0])).not.toContain("잠실");
    warn.mockRestore();
  });
});
