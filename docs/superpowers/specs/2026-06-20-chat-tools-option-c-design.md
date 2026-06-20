# Phase 3 옵션 C 설계 — self-fetch 컴포넌트 파라미터 마운트

위원장 결정(2026-06-20): 나머지 11개 도구의 리치 컴포넌트는 대부분 좌표를 받아 스스로 fetch하는 self-fetching이므로, 채팅 router가 데이터를 가져오지 않고 **컴포넌트를 파라미터로 마운트**해 컴포넌트가 직접 fetch한다.

## RenderPayload 재정의 (types.ts, `src/lib/chat/types.ts`)

`places`·`addresses`는 props-driven 컴포넌트(ResultList·AddressResultList) 재사용이라 **데이터 유지**. 나머지는 **마운트 파라미터**로 교체:

```ts
export type RenderPayload =
  // props-driven 재사용 (데이터 그대로):
  | { type: "places"; places: Place[] }
  | { type: "addresses"; results: JusoAddress[] }
  // self-fetch 컴포넌트 마운트 (파라미터만 — 컴포넌트가 직접 fetch):
  | { type: "subway-nearby" }                                  // <SubwayArrivalsNearby/>
  | { type: "clinics-nearby" }                                 // <NightClinicsNearby/>
  | { type: "kids-nearby" }                                    // <KidsPlacesNearby/>
  | { type: "surroundings-nearby" }                            // <SurroundingsNearby/>
  | { type: "bus"; mode: "current" }
  | { type: "bus"; mode: "place"; lat: number; lng: number }   // <BusArrivals mode.../>
  | { type: "bike"; mode: "current" }
  | { type: "bike"; mode: "place"; lat: number; lng: number }  // <BikeStations mode.../>
  | { type: "air-quality"; lat: number; lng: number }          // <AirQuality lat lng/>
  | { type: "station-meta"; stationName: string }              // <StationMeta stationName/>
  | { type: "station-facilities"; stationName: string }        // <StationFacilities/> + <SeoulMetroFacilities/>
  | { type: "car-route"; dest: { lat: number; lng: number; name: string } }     // <CarRouteBriefing dest/>
  | { type: "transit-route"; dest: { lat: number; lng: number; name: string } };// <TransitRouteBriefing dest/>
```

⚠ 기존 데이터 기반 변종(subway-arrivals·bus-arrivals·bike-stations·night-clinics·station-facilities·station-meta·surroundings·kids-places·car-route·transit-route·air-quality)을 위 형태로 **교체**한다. `render.ts`의 데이터 변환 헬퍼는 이 도구들엔 불필요(places/addresses만 유지).

## 컴포넌트 마운트 인터페이스(실측)

| 컴포넌트 | 마운트 형태 | fetch 경로 |
|---|---|---|
| `SubwayArrivalsNearby` | `<.../>`(props 0, 현재위치 자동) | 내부 geolocation |
| `NightClinicsNearby` | `<.../>`(props 0) | 내부 geolocation |
| `KidsPlacesNearby` | `<.../>`(props 0) | 내부 geolocation |
| `SurroundingsNearby` | `<.../>`(props 0) | 내부 geolocation |
| `BusArrivals` | `{mode:"current"}` 또는 `{mode:"place",lat,lng}` | props 좌표 |
| `BikeStations` | `{mode:"current"}` 또는 `{mode:"place",lat,lng}` | props 좌표 |
| `AirQuality` | `{lat,lng}` | props 좌표 |
| `StationMeta` | `{stationName}` | props 역명 |
| `StationFacilities` | `{stationName}` | props 역명 |
| `SeoulMetroFacilities` | `{stationName}` | props 역명 |
| `CarRouteBriefing` | `{dest:{lat,lng,name}}` | props dest, origin은 내부 현재위치 |
| `TransitRouteBriefing` | `{dest:{lat,lng,name}}` | props dest, origin 내부 현재위치/검색 |

## router 역할(C 방식)

router는 **데이터를 fetch하지 않는다**. 파라미터만 추출 + 일반 안내 summary + render(마운트 지시):
- **현재위치 nearby**(지하철·소아진료·아이놀곳·둘러보기): 파라미터 0. summary="주변 X 정보를 아래에 표시했어요". render={type:"...-nearby"}.
- **좌표 도구**(버스·따릉이·공기질): args의 optional `place`(지명) 있으면 `searchPlaces({query:place})` 첫 결과 좌표로, 없으면 `ctx.userLocation`. 좌표 못 구하면 summary="위치를 알 수 없어요"+render 없음.
- **역명 도구**(역메타·역시설): args.stationName(필수). render={type:"station-...",stationName}.
- **dest 도구**(자동차·대중교통): `searchPlaces({query:destination})` 첫 결과로 dest={lat,lng,name}. 못 찾으면 summary 안내+render 없음.

`searchPlaces`는 `{places:Place[],...}` 반환 — 첫 항목의 `lat`/`lng`/`name` 사용(Place 필드 실측 확인).

## 도구 그룹 태스크 재편(plan Task 16~20 → 아래로)

- **Task 16**: RenderPayload C 재정의(types.ts) + 현재위치 nearby 4도구(get_subway_arrivals·get_night_clinics·get_kids_places·get_surroundings). declaration+router(summary만)+MessageBubble 마운트.
- **Task 17**: 좌표 도구 3종(get_bus_arrivals·get_bike_stations·get_air_quality). place geocode(searchPlaces) 또는 ctx.userLocation.
- **Task 18**: 역명 도구 2종(get_station_meta·get_station_facilities). args.stationName.
- **Task 19**: dest 도구 2종(get_car_route·get_transit_route). destination geocode→dest.

각 도구: declaration(`parametersJsonSchema`·게이트) + router case(파라미터 추출+summary+render) + MessageBubble RenderBlock case(컴포넌트 마운트) + 테스트. 게이트: subway=hasSeoulSubwayRealtimeKey, clinic/air/bus=hasDataGoKrKey, kids/surroundings/car=hasKakaoKey, bike=hasSeoulOpenDataKey, station-meta=없음(seed), station-facilities=hasDataGoKrKey, transit=hasOdsayKey, car(en)=hasNcpMapsKeys.

## 주의
- get_bus_route(노선 경유정류소)는 **V1 제외**(BusRouteStops는 routeId 기반이라 채팅 자연어 진입이 모호 — 후속). 도구 수 14→13.
- 좌표/역명 못 구한 graceful: summary 안내 + render 생략(컴포넌트 미마운트).
- self-fetch 컴포넌트는 채팅 버블 안에서도 자체 버튼(예: "내 주변 지하철 도착" 트리거)을 노출할 수 있음 — 홈과 동일 UX. a11y 그대로 계승.
