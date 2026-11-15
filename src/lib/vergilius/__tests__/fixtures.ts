import type { VergiliusAskRequest } from "../types";

/** 테스트용 요청(서울 도심의 공공 장소 좌표). 좌표 숫자열은 일부러 다른 필드와 겹치지 않게 골랐다. */
export function askFixture(overrides: Partial<VergiliusAskRequest> = {}): VergiliusAskRequest {
  return {
    question: "지금 내 앞에 뭐가 있어?",
    locale: "ko",
    provider: "openai",
    location: { lat: 37.570412, lng: 126.983177 },
    headingKnown: true,
    places: [
      { id: "k101", name: "가나카페", category: "카페", zone: "ahead", side: "left", distance: 12, lat: 37.570533, lng: 126.983288 },
      { id: "k102", name: "다라식당", category: "음식점", zone: "beside", side: "right", distance: 8, lat: 37.570399, lng: 126.983099 },
      { id: "k103", name: "마바약국", category: "약국", zone: "behind", side: "left", distance: 45, lat: 37.570111, lng: 126.982866 },
    ],
    junctionAhead: { meters: 60, branches: 3 },
    nextCrosswalkMeters: 40,
    roadName: "종로",
    log: [
      { kind: "place", text: "왼쪽에 사아서점", agoSeconds: 30, placeId: "k200" },
      { kind: "crosswalk", text: "30미터 앞 횡단보도", agoSeconds: 95 },
    ],
    ...overrides,
  };
}
