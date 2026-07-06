# 길동무 iOS M3 구현 계획: 역 상세 자동 섹션 + 날씨·공기질

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 장소 상세에서 역이면 역 정보·실시간 도착·교통약자 시설이 자동 등장하고, 내 주변 허브에 "날씨·공기질" 화면이 추가된다.

**Architecture:** M0~M2 패턴 연장. 웹 미러: `PlaceDetail`이 `isStation(place)`이면 `place.name`을 그대로 station 파라미터로 4개 API에 전달(매칭은 서버 몫). 날씨·공기질은 두 fetch 독립(allSettled 미러).

## Global Constraints (M0~M2 유지 + 추가)

- **자동 등장 섹션은 heading이 발견 경로**(접근성 헌장 §3): 역 섹션·날씨·공기질 섹션 헤더 텍스트에 `.accessibilityAddTraits(.isHeader)` 필수.
- **등급·상태 단어가 낭독 정본, 수치는 보강**: 공기질 grade(good=좋음·moderate=보통·bad=나쁨·veryBad=매우 나쁨·unknown=정보 없음), 하늘(clear=맑음·partlyCloudy=구름 조금·cloudy=흐림·unknown=정보 없음), 강수(none=강수 없음·rain=비·rainSnow=비 또는 눈·snow=눈·shower=소나기·unknown=정보 없음). value가 null이면 단어만.
- **정수 3-state**: 시설 수 `nil`="정보 없음" ≠ `0`="없음" ≠ `n`="n대". 절대 뭉개지 않는다.
- 도착 낭독 정본 `message`(arvlMsg2), 급행 텍스트 흡수(M2와 동일).
- 라벨-값은 dl 금지 원칙의 iOS 판: 평문 단일 텍스트("현재 기온 21도").

## API 계약 (fixture 6종 커밋됨: station-meta·station-facilities·station-metro-facilities·station-arrival·air-nearby·weather-nearby)

| 라우트 | 파라미터 | envelope | 비고 |
|---|---|---|---|
| `/api/station/meta` | `?station=<place.name>` | `{meta: StationMeta?}` | 미커버 역 null(graceful) |
| `/api/station/facilities` | `?station=` | `{facilities: StationFacilities?}` | 코레일 406역, 미커버 null. wheelchairLifts·elevators는 Int?(3-state) |
| `/api/station/metro-facilities` | `?station=` | `{facilities: SeoulMetroFacilities?}` | 서울 1~8호선. groups[{kind, facilities[{name, location?, floors?, operatingStatus?("normal"/"stopped"), detail?}]}] |
| `/api/station/subway-arrival` | `?station=` | `{arrivals: {stationName, arrivals:[SubwayArrival]}?}` | SubwayArrival은 NearbyModels 기존 타입 재사용 |
| `/api/air-quality/nearby` | `?lat=&lng=` | `{air: AirQuality?}` | khai/pm10/pm25: {value: Double?, grade: String}. distanceKm Double |
| `/api/weather/nearby` | `?lat=&lng=` | `{weather: Weather?}` | sky/precipitation: {code: Int?, label: String}. temp들 Double?, grid{nx,ny} |

null 여부·옵셔널은 fixture + 웹 `src/lib/types.ts` 대조가 정본. 각 라우트 실패(4xx/5xx)와 null은 "섹션 미노출"로 동일 처리(자동 등장 보조 정보의 graceful degrade, 웹 미러) — 단 도착은 fetch 성공 시 0건도 "도착 예정 열차가 없습니다"로 노출.

### Task 1 (Kit): StationMatch + 모델 + 서비스

- `StationMatch.swift`: 웹 `src/lib/station-match.ts` 미러. `isStation(_ place: Place) -> Bool`(카테고리 정규식 `지하철|전철|철도|기차|Subway|Metro|Railway|Train`(대소문자 무시, "Station"은 카테고리에서 제외: Stationery 오판) 또는 이름이 "역"/"station"(대소문자 무시)으로 끝남), `normalizeStationName(_:) -> String`. 테스트: "강동역 5호선"(카테고리 지하철)=true, "문구점 Stationery"=false, "서울역"=true.
- `Models/StationModels.swift`: 위 표의 모델 전부(Codable+Sendable). enum 없이 String(기존 원칙). 응답 envelope 6종(옵셔널 필드).
- `StationService.swift`: `meta(station:)`·`korailFacilities(station:)`·`metroFacilities(station:)`·`arrivals(station:)` (throw). `ConditionsService`: `air(lat:lng:)`·`weather(lat:lng:)` (같은 파일, 별도 struct).
- 테스트: fixture 6종 디코딩 + isStation 3케이스 + 등급·null 심층 검증 각 1개.

### Task 2 (앱): PlaceDetail 역 자동 섹션

- `StationSections.swift` 신규: `StationSectionsModel`(@Observable, 4개 API를 `async let` 독립 로드, 각각 실패·null → 해당 섹션 미노출) + `StationSectionsView(place:)`.
- PlaceDetailView에 `if isStation(place) { StationSectionsView(place: place) }` 삽입(길찾기 섹션 아래).
- 섹션 구성(각 헤더 Text에 `.isHeader`):
  - **역 정보**: joinText(meta.name+"역", nameEn, lines.joined(", "), isTransfer ? "환승역" : nil, operator) 단일 텍스트 1행.
  - **실시간 도착**: M2 지하철 도착행과 동일 형식. 0건 문장 포함.
  - **교통약자 시설(철도)**: 행 4개(있는 것만): "장애인 화장실 있음/없음", "휠체어 리프트 \(n)대"/"휠체어 리프트 없음"/"휠체어 리프트 정보 없음"(nil), "장애인 경사로 있음/없음", 엘리베이터 동일 3-state.
  - **교통약자 시설(서울 지하철)**: kind 라벨은 웹 `src/components/SeoulMetroFacilities.tsx`의 한국어 라벨을 읽어 그대로 미러. 시설 행: joinText(name, location, floors, operatingStatus "normal"→"정상 가동"·"stopped"→"운행 중지", detail).
- 로딩 중 표시는 없음(자동 등장 보조 정보, 조용히 나타남). 통지 없음(live 남발 금지).

### Task 3 (앱): 날씨·공기질 화면

- `Nearby/ConditionsView.swift` 신규 + NearbyHubView에 7번째 항목 "날씨·공기질".
- 모델: LocationService 좌표 → `async let` weather·air 독립(한쪽 실패가 다른 쪽 안 죽임). NearbyLoadState 대신 조각별 상태(weather: Weather?/failed, air: AirQuality?/failed) 커스텀. 권한 거부는 화면 공통 denied overlay(M2 미러).
- 날씨 섹션(헤더 .isHeader): 행 각각 단일 텍스트: "하늘, \(skyLabel)" / "강수, \(precipLabel)" / "현재 기온 \(t)도"(null 생략) / "최고 \(max)도, 최저 \(min)도"(둘 다 null이면 생략, 한쪽만이면 있는 쪽만) / "습도 \(h)%" / "강수확률 \(p)%" / "기준 시각 \(baseTime)". 전 조각 null이면 섹션 대신 "날씨 정보를 가져오지 못했습니다".
- 공기질 섹션(헤더 .isHeader): "\(stationName) 측정소, \(distanceKm)km" / "통합대기환경지수, \(grade단어)"+(value 있으면 " (\(value))") / 미세먼지·초미세먼지 동일 / "측정 시각 \(dataTime)". air null·실패면 "공기질 정보를 가져오지 못했습니다".
- 완료 통지 1회: "날씨와 공기질 정보를 불러왔습니다"(부분 실패 시 "일부 정보를 가져오지 못했습니다").
- `.refreshable` 정밀 재취득(M2 계약).

### Task 4 (통합, 오케스트레이터): 빌드·테스트·커밋·push·실기기 설치. M3 게이트: 지하철역 검색→상세에서 역 섹션 4종 자동 등장 heading 로터 발견, 날씨·공기질 등급 단어 낭독, 시설 수 3-state 문장.

## Self-Review: 로드맵 M3 전 항목(역 메타·도착·시설·날씨·공기질·heading 발견 경로·3-state) 태스크 매핑 확인. 형식·파라미터는 fixture 실캡처 정본. 타입·서비스명 Task 1 정의와 2·3 사용부 일치.
