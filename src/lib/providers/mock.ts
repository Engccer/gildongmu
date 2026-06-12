import type { Place, PlaceSearchParams, PlaceSearchResult } from "../types";

/**
 * Mock 장소 provider.
 *
 * API 키가 없는 환경(키 발급 전, CI, 데모)에서도 전체 UI 흐름이
 * 동작하도록 서울 주요 장소를 하드코딩해 둔다.
 * 좌표는 실제 WGS84 값이라 딥링크(nmap://)까지 실기기에서 검증 가능하다.
 */
const MOCK_PLACES: Place[] = [
  {
    id: "mock-gyeongbokgung",
    name: "경복궁",
    category: "여행,명소>고궁,문화유산",
    address: "서울특별시 종로구 세종로 1-91",
    roadAddress: "서울특별시 종로구 사직로 161",
    lat: 37.579617,
    lng: 126.977041,
    phone: "02-3700-3900",
  },
  {
    id: "mock-seoul-station",
    name: "서울역",
    category: "교통,운수>기차역",
    address: "서울특별시 용산구 동자동 43-205",
    roadAddress: "서울특별시 용산구 한강대로 405",
    lat: 37.554648,
    lng: 126.970697,
  },
  {
    id: "mock-namsan-tower",
    name: "N서울타워",
    category: "여행,명소>전망대",
    address: "서울특별시 용산구 용산동2가 산1-3",
    roadAddress: "서울특별시 용산구 남산공원길 105",
    lat: 37.551169,
    lng: 126.988227,
    phone: "02-3455-9277",
  },
  {
    id: "mock-myeongdong",
    name: "명동거리",
    category: "여행,명소>거리,골목",
    address: "서울특별시 중구 명동2가",
    roadAddress: "서울특별시 중구 명동길",
    lat: 37.563757,
    lng: 126.98268,
  },
  {
    id: "mock-gildong-station",
    name: "길동역 5호선",
    category: "교통,운수>지하철역",
    address: "서울특별시 강동구 길동 415",
    roadAddress: "서울특별시 강동구 양재대로 1480",
    lat: 37.537801,
    lng: 127.140003,
  },
];

/** 검색어가 비어 있지 않으면 이름/카테고리/주소에 부분 일치하는 mock 장소를 돌려준다. */
export async function searchPlacesMock(
  params: PlaceSearchParams,
): Promise<PlaceSearchResult> {
  const q = params.query.trim().toLowerCase();
  const limit = params.limit ?? 5;
  const matched = MOCK_PLACES.filter(
    (p) =>
      p.name.toLowerCase().includes(q) ||
      p.category.toLowerCase().includes(q) ||
      p.address.toLowerCase().includes(q),
  );
  // 일치가 없으면 전체 목록을 보여줘서 "빈 화면"으로 UI 검증이 막히지 않게 한다
  const places = (matched.length > 0 ? matched : MOCK_PLACES).slice(0, limit);
  return { places, provider: "mock", query: params.query };
}
