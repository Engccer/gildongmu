import { describe, expect, it } from "vitest";
import { trackTargetUrl } from "../useTransitGuide";
import type { TransitGuideLeg } from "@/lib/transit-guide";

/**
 * 폴링 URL의 `lang`(E27 잔여 ①, spec 2026-09-01 §3.3).
 *
 * 파라미터 **이름 오타는 서버가 400도 내지 않고 그냥 무시**한다 — 그러면 실시간 줄만
 * 조용히 한국어로 떨어지고 서버 테스트는 계속 통과한다. 그래서 여기서는 URL 문자열
 * 전체를 단언한다(포함 검사가 아니라 완전 일치).
 */
function leg(over: Partial<TransitGuideLeg> = {}): TransitGuideLeg {
  return {
    mode: "subway",
    lineName: "수도권 5호선",
    trackMode: "subway",
    boardName: "천호",
    alightName: "광화문",
    boardStop: { name: "천호", lat: 37.5, lng: 127.1 },
    alightStop: { name: "광화문", lat: 37.57, lng: 126.97 },
    viaStops: [],
    stationCount: 8,
    routeId: null,
    wayCode: 1,
    walkBeforeMinutes: null,
    ...over,
  } as TransitGuideLeg;
}

describe("trackTargetUrl — lang", () => {
  it("지하철(대기·승차)", () => {
    expect(trackTargetUrl(leg(), "waiting", null, null, "en")).toBe(
      "/api/transit/track?mode=subway&phase=track&station=%EC%B2%9C%ED%98%B8&line=%EC%88%98%EB%8F%84%EA%B6%8C%205%ED%98%B8%EC%84%A0&lang=en",
    );
    expect(trackTargetUrl(leg(), "riding", null, null, "ko")).toBe(
      "/api/transit/track?mode=subway&phase=track&station=%EA%B4%91%ED%99%94%EB%AC%B8&line=%EC%88%98%EB%8F%84%EA%B6%8C%205%ED%98%B8%EC%84%A0&lang=ko",
    );
  });

  it("서울버스 대기·승차", () => {
    const bus = leg({
      mode: "bus",
      trackMode: "seoulBus",
      lineName: "3318",
      routeId: "227000006",
      boardStop: { name: "길동사거리", lat: 37.5, lng: 127.1, arsId: "24101", localId: "123000017" },
      alightStop: { name: "천호역", lat: 37.53, lng: 127.12, localId: "123000043" },
    } as Partial<TransitGuideLeg>);
    expect(trackTargetUrl(bus, "waiting", null, null, "en")).toBe(
      "/api/transit/track?mode=seoulBus&phase=wait&arsId=24101&routeId=227000006&lang=en",
    );
    expect(trackTargetUrl(bus, "riding", null, null, "en")).toBe(
      "/api/transit/track?mode=seoulBus&phase=ride&routeId=227000006&boardId=123000017&alightId=123000043&lang=en",
    );
  });

  it("지방버스(TAGO)", () => {
    const bus = leg({ mode: "bus", trackMode: "tagoBus", lineName: "301" } as Partial<TransitGuideLeg>);
    expect(trackTargetUrl(bus, "waiting", { nodeId: "DJB1", cityCode: "25" }, null, "en")).toBe(
      "/api/transit/track?mode=tagoBus&phase=track&cityCode=25&nodeId=DJB1&routeNo=301&lang=en",
    );
  });

  it("재선택 인덱스가 가리키는 역으로 조회한다 — 조인 값은 한국어 원문", () => {
    const withStops = leg({
      viaStops: [
        { name: "천호", lat: 37.5, lng: 127.1, nameEn: "Cheonho" },
        { name: "왕십리", lat: 37.56, lng: 127.03, nameEn: "Wangsimni" },
      ],
    } as Partial<TransitGuideLeg>);
    expect(trackTargetUrl(withStops, "waiting", null, 1, "en")).toBe(
      "/api/transit/track?mode=subway&phase=track&station=%EC%99%95%EC%8B%AD%EB%A6%AC&line=%EC%88%98%EB%8F%84%EA%B6%8C%205%ED%98%B8%EC%84%A0&lang=en",
    );
  });

  it("범위 밖 인덱스는 원래 승차역으로 떨어진다(조용한 빈 쿼리 금지)", () => {
    expect(trackTargetUrl(leg(), "waiting", null, 9, "en")).toBe(
      "/api/transit/track?mode=subway&phase=track&station=%EC%B2%9C%ED%98%B8&line=%EC%88%98%EB%8F%84%EA%B6%8C%205%ED%98%B8%EC%84%A0&lang=en",
    );
  });
});
