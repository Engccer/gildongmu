/**
 * CLI / MCP 공유 엔드포인트 카탈로그 — 프로덕션 REST 라우트의 정적 메타데이터.
 *
 * ⚠ byte-mirror: 이 파일의 정본은 packages/cli, packages/mcp/src/endpoint-catalog-shared.ts는
 * 복사본이다. 수정 시 両쪽을 동일하게 유지한다(catalog-drift 테스트가 해시로 강제).
 *
 * envelope: 응답 최상위 키(예 "stations"). threeState 처리는 formatters가 담당.
 * ⚠ envelope: "" (빈 문자열)인 항목(route-car)은 래퍼 키 없이 응답 본문 자체가
 * 데이터다 — `NextResponse.json(briefing)`처럼 최상위에 직접 필드를 흩뿌리는
 * 라우트. 소비자는 `envelope === "" ? body : body[envelope]`로 분기해야 한다.
 * locationParam: lat/lng를 위치 해석(resolve-location) 경유로 받는 항목.
 * mcp: MCP 도구로 노출할지(챗·웹검색은 호스트 LLM 몫이라 제외 — 스펙 §8).
 *
 * ⚠ 각 envelope·params는 src/app/api/**\/route.ts의 `NextResponse.json({...})`
 * 정본과 전수 대조 완료(2026-07-15, Task 4). 대조 중 발견된 초안 대비 수정 4건은
 * .superpowers/sdd/task-4-report.md 참조.
 */
export interface ParamSpec {
  key: string;
  type: "string" | "number";
  required: boolean;
  description: string;
}

export interface EndpointSpec {
  name: string;
  description: string;
  path: string;
  method: "GET";
  params: ParamSpec[];
  envelope: string;
  locationParam: boolean;
  mcp: boolean;
}

const LATLNG: ParamSpec[] = [
  { key: "lat", type: "number", required: true, description: "위도(WGS84)" },
  { key: "lng", type: "number", required: true, description: "경도(WGS84)" },
];

export const ENDPOINT_CATALOG: EndpointSpec[] = [
  { name: "places-search", description: "장소 검색(카카오 로컬, 좌표 있으면 근접 블렌딩 정확도순)", path: "/api/places", method: "GET",
    params: [{ key: "query", type: "string", required: true, description: "검색어" },
             { key: "lang", type: "string", required: false, description: "ko|en" }, ...LATLNG.map(p => ({ ...p, required: false }))],
    envelope: "places", locationParam: false, mcp: true },
  { name: "address-search", description: "도로명·지번 주소와 우편번호 검색(juso)", path: "/api/address/search", method: "GET",
    params: [{ key: "query", type: "string", required: true, description: "주소 검색어" }],
    envelope: "addresses", locationParam: false, mcp: true },
  { name: "geocode", description: "장소·주소 문자열 → WGS84 좌표", path: "/api/geocode", method: "GET",
    params: [{ key: "query", type: "string", required: true, description: "장소명 또는 주소" }],
    envelope: "matches", locationParam: false, mcp: true },
  { name: "web-search", description: "웹 검색(Perplexity)", path: "/api/search/web", method: "GET",
    params: [{ key: "query", type: "string", required: true, description: "검색어" }],
    envelope: "web", locationParam: false, mcp: false },
  { name: "nearby-subway", description: "내 주변 지하철역 실시간 도착", path: "/api/station/subway-arrival/nearby", method: "GET",
    params: LATLNG, envelope: "stations", locationParam: true, mcp: true },
  { name: "nearby-bus", description: "내 주변 버스 정류소 실시간 도착", path: "/api/bus/nearby", method: "GET",
    params: LATLNG, envelope: "stops", locationParam: true, mcp: true },
  { name: "nearby-bike", description: "내 주변 따릉이 대여소(서울)", path: "/api/bike/nearby", method: "GET",
    params: LATLNG, envelope: "stations", locationParam: true, mcp: true },
  { name: "nearby-clinic", description: "내 주변 소아 야간·휴일 진료", path: "/api/clinic/nearby", method: "GET",
    params: LATLNG, envelope: "clinics", locationParam: true, mcp: true },
  { name: "nearby-kids", description: "내 주변 아이 놀 곳", path: "/api/places/kids", method: "GET",
    params: LATLNG, envelope: "kids", locationParam: true, mcp: true },
  { name: "nearby-around", description: "내 주변 둘러보기(편의점·카페 등 10종+8방위)", path: "/api/places/around", method: "GET",
    params: LATLNG, envelope: "places", locationParam: true, mcp: true },
  { name: "nearby-events", description: "내 주변 오늘 진행 중인 문화행사(서울)", path: "/api/events/nearby", method: "GET",
    params: LATLNG, envelope: "events", locationParam: true, mcp: true },
  { name: "nearby-barrier-free", description: "내 주변 무장애 관광지", path: "/api/places/barrier-free", method: "GET",
    params: LATLNG, envelope: "places", locationParam: true, mcp: true },
  { name: "nearby-walk-infra", description: "내 주변 보행 인프라(음향신호기·횡단보도·점자블록)", path: "/api/walk/nearby", method: "GET",
    params: LATLNG, envelope: "walk", locationParam: true, mcp: true },
  { name: "nearby-congestion", description: "지금 있는 곳의 실시간 인구 혼잡도(서울 핫스팟 116곳 한정, 대상 밖이면 오류가 아니라 area:null)", path: "/api/congestion/nearby", method: "GET",
    params: LATLNG, envelope: "area", locationParam: true, mcp: true },
  { name: "station-meta", description: "도시철도역 메타(영문명·노선·환승)", path: "/api/station/meta", method: "GET",
    params: [{ key: "station", type: "string", required: true, description: "역명" }], envelope: "meta", locationParam: false, mcp: true },
  { name: "station-facilities", description: "철도역 교통약자 시설(코레일)", path: "/api/station/facilities", method: "GET",
    params: [{ key: "station", type: "string", required: true, description: "역명" }], envelope: "facilities", locationParam: false, mcp: true },
  { name: "station-metro-facilities", description: "서울 지하철역 교통약자 시설", path: "/api/station/metro-facilities", method: "GET",
    params: [{ key: "station", type: "string", required: true, description: "역명" }], envelope: "facilities", locationParam: false, mcp: true },
  { name: "station-timetable", description: "역 첫차·막차 시간표(TAGO, 서비스데이 기준 라벨 포함)", path: "/api/station/timetable", method: "GET",
    params: [{ key: "station", type: "string", required: true, description: "역명" }], envelope: "timetable", locationParam: false, mcp: true },
  { name: "subway-arrival", description: "지하철역 실시간 도착(역명)", path: "/api/station/subway-arrival", method: "GET",
    params: [{ key: "station", type: "string", required: true, description: "역명" }], envelope: "arrivals", locationParam: false, mcp: true },
  { name: "bus-route-stops", description: "버스 노선 경유 정류소", path: "/api/bus/route", method: "GET",
    params: [{ key: "source", type: "string", required: true, description: "tago|seoul" },
             { key: "routeId", type: "string", required: true, description: "노선 ID(nearby-bus 결과의 arrivals[].routeId)" },
             { key: "cityCode", type: "string", required: false, description: "tago일 때 필수(nearby-bus 결과의 cityCode)" }],
    envelope: "stops", locationParam: false, mcp: true },
  { name: "route-car", description: "자동차 경로 텍스트 브리핑(턴바이턴, guide별 거리·시간 0=미제공·안내 문장에 거리 내장, 재조합 금지)", path: "/api/route/car", method: "GET",
    params: [{ key: "origin", type: "string", required: true, description: "출발 좌표 '위도,경도'" },
             { key: "dest", type: "string", required: true, description: "도착 좌표 '위도,경도'" },
             { key: "lang", type: "string", required: false, description: "en이면 영문 턴바이턴" },
             { key: "via", type: "string", required: false, description: "경유 좌표 '위도,경도' 1개(도보·자동차 — 응답 waypoint.stepIndex가 경유지 도착 뒤 첫 단계)" }],
    envelope: "", locationParam: false, mcp: true },
  { name: "route-transit", description: "대중교통 경로(추천+대안, ODsay)", path: "/api/route/transit", method: "GET",
    params: [{ key: "origin", type: "string", required: true, description: "출발 좌표 '위도,경도'" },
             { key: "dest", type: "string", required: true, description: "도착 좌표 '위도,경도'" },
             { key: "via", type: "string", required: false, description: "경유 좌표 '위도,경도' — 대중교통은 미지원이라 200 {unsupported:'waypoint'}로 정직 응답" }],
    envelope: "result", locationParam: false, mcp: true },
  { name: "route-walk", description: "도보 경로 텍스트 브리핑(기본 카카오·폴백 Tmap, 완성 문장 안내)", path: "/api/route/walk", method: "GET",
    params: [{ key: "origin", type: "string", required: true, description: "출발 좌표 '위도,경도'" },
             { key: "dest", type: "string", required: true, description: "도착 좌표 '위도,경도'" },
             { key: "accessible", type: "string", required: false, description: "true|false, 계단 회피 경로(카카오 전용)" },
             { key: "via", type: "string", required: false, description: "경유 좌표 '위도,경도' 1개(도보·자동차 — 응답 waypoint.stepIndex가 경유지 도착 뒤 첫 단계)" }],
    envelope: "result", locationParam: false, mcp: true },
  { name: "weather", description: "이 지역 날씨(기상청 실황+예보)", path: "/api/weather/nearby", method: "GET",
    params: LATLNG, envelope: "weather", locationParam: true, mcp: true },
  { name: "air-quality", description: "이 지역 공기질(에어코리아)", path: "/api/air-quality/nearby", method: "GET",
    params: LATLNG, envelope: "air", locationParam: true, mcp: true },
  { name: "where-am-i", description: "현재 위치 정위(주소·행정동·가까운 역·기준점)", path: "/api/where-am-i", method: "GET",
    params: LATLNG, envelope: "data", locationParam: true, mcp: true },
  { name: "barrier-free-detail", description: "무장애 관광지 편의시설 상세", path: "/api/places/barrier-free/detail", method: "GET",
    params: [{ key: "contentId", type: "string", required: true, description: "nearby-barrier-free 결과의 contentId" }],
    envelope: "detail", locationParam: false, mcp: true },
];
