// 상태 화면용 최소 fixture — 우리 라우트의 응답 모양(`src/lib/types.ts` 등)만 흉내 낸다.
// 좌표·이름은 mock provider(`src/lib/providers/mock.ts`)의 공공 장소를 재사용한다.

export const GYEONGBOKGUNG = {
  id: "mock-gyeongbokgung",
  name: "경복궁",
  category: "여행,명소>고궁,문화유산",
  address: "서울특별시 종로구 세종로 1-91",
  roadAddress: "서울특별시 종로구 사직로 161",
  lat: 37.579617,
  lng: 126.977041,
  phone: "02-3700-3900",
};

export const SEOUL_STATION = {
  id: "mock-seoul-station",
  name: "서울역",
  category: "교통,운수>기차역",
  address: "서울특별시 용산구 동자동 43-205",
  roadAddress: "서울특별시 용산구 한강대로 405",
  lat: 37.554648,
  lng: 126.970697,
};

/** 검색 결과(`?q=`): 장소 2건, 주소 0건. */
export const SEARCH_FIXTURES = {
  "/api/places": { places: [GYEONGBOKGUNG, SEOUL_STATION], provider: "kakao-local", query: "경복궁" },
  "/api/address/search": { addresses: [] },
};

/** 도보 조회 결과(`lines=1` 줄 목록, E42). */
export const WALK_FIXTURES = {
  "/api/route/walk": {
    lines: [
      {
        kind: "shortest",
        route: {
          distanceMeters: 2900,
          durationSeconds: 2640,
          steps: [
            { description: "사직로를 따라 직진 400m" },
            { description: "세종대로에서 좌회전 후 2.5km 직진" },
          ],
        },
      },
    ],
  },
};
