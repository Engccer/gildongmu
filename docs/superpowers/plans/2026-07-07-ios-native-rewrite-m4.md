# 길동무 iOS M4 구현 계획: 자동차·대중교통 경로 텍스트 브리핑

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 장소 상세에서 "출발 전 미리 듣기" 텍스트 브리핑(자동차·대중교통)을 제공한다. 실주행은 딥링크 위임 유지(브리핑은 보완재).

## Global Constraints (M0~M3 유지 + 추가)

- **출발지 = 실제 사용자 위치 불변식**: origin은 LocationService 좌표만. 장소 좌표로 덮지 않는다(웹 장소 앵커 불변식).
- **단위 함정 회귀**: `durationSeconds`=초·`totalMinutes`=분·`fare/taxiFare/tollFare`=원·`totalWalk` 파생 `walkMinutes`=분. fixture 심층 테스트로 상식 범위 검증(강동→강남 자동차 600~7,200초).
- guidance·lineName·정류장명은 provider 한국어 원문이 낭독 정본. 행은 joinText 단일 텍스트.

## API 계약 (fixture route-car.json·route-transit.json 커밋, prod 실캡처)

| 라우트 | 파라미터 | 응답 |
|---|---|---|
| `/api/route/car` | `?origin=lat,lng&dest=lat,lng&lang=`(lang 선택) | **envelope 없음**: CarRouteBriefing 직접 `{distanceMeters, durationSeconds, taxiFare, tollFare, guides:[{name, guidance, distanceMeters, durationSeconds}]}` |
| `/api/route/transit` | `?origin=lat,lng&dest=lat,lng` | `{result: {recommended: TransitRoute, alternatives: [TransitRoute]}}`. TransitRoute={summary:{totalMinutes,fare,transfers,walkMinutes,departName?,arriveName?}, legs:[{mode("walk"/"bus"/"subway"), lineName?, fromName?, toName?, stationCount?, minutes}]} |

### Task 1 (Kit): RouteModels + RouteService + fixture 테스트

- `Models/RouteModels.swift`: 위 모델 전부(Codable+Sendable, mode는 String 원칙). envelope `TransitRouteEnvelope{result: TransitRouteResult}`.
- `RouteService.swift`: `car(originLat:originLng:destLat:destLng:lang:) -> CarRouteBriefing`(coord는 "lat,lng" 문자열 합성), `transit(originLat:originLng:destLat:destLng:) -> TransitRouteResult`. throw.
- 테스트: fixture 2종 디코딩 + 단위 회귀(car durationSeconds 600...7200, transit recommended.summary.totalMinutes 20...180, fare > 0) + guides 비어있지 않음 + walk leg에 lineName 없음 확인.

### Task 2 (앱): 브리핑 화면 2종 + PlaceDetail 진입

- `RouteBriefing.swift` 신규: `CarBriefingView(place:)`·`TransitBriefingView(place:)` + 각 @Observable 모델(공용 파일 하나). 로드: LocationService 좌표(origin) → RouteService. 상태: NearbyLoadState 유사(denied/failed/loaded, 실패 "경로를 가져오지 못했습니다", 권한 거부 M2 공통 문장). 완료 통지 1회("자동차 경로를 불러왔습니다, 약 N분" / "대중교통 경로를 불러왔습니다, 약 N분").
- PlaceDetailView 길찾기 Section에 NavigationLink 2개 추가: "자동차 경로 미리 듣기" → CarBriefingView, "대중교통 경로 미리 듣기" → TransitBriefingView (딥링크 버튼들 아래).
- **CarBriefingView**: 요약 1행 joinText("총 \(km 소수1자리)km", "약 \(durationSeconds/60)분", "택시 요금 약 \(taxiFare)원", tollFare > 0 ? "통행료 \(tollFare)원" : nil) 헤더(.isHeader). guides 행: joinText(guidance, "\(distanceMeters)m")(guidance 빈 문자열이면 name으로 폴백, 둘 다 비면 행 생략). navigationTitle "자동차 경로".
- **TransitBriefingView**: 추천 Section(헤더 "추천 경로" .isHeader): 요약 1행 joinText("약 \(totalMinutes)분", "요금 \(fare)원", "환승 \(transfers)회", "도보 \(walkMinutes)분"), legs 행: walk→"도보 \(minutes)분", bus/subway→joinText(lineName, fromName.map{"\($0) 승차"}, toName.map{"\($0) 하차"}, stationCount.map{"\($0)개 역"}(bus는 "\($0)개 정류장"), "\(minutes)분"). 대안 Section(헤더 "다른 경로" .isHeader, 있을 때만): 각 대안 요약 1행씩(legs 미표시, 미니멀). navigationTitle "대중교통 경로".
- 숫자 포맷: 요금은 천 단위 구분(NumberFormatter 또는 formatted()).

### Task 3 (통합, 오케스트레이터): 빌드·테스트·커밋·push·설치. 게이트: 상세→자동차/대중교통 브리핑 진입·요약 헤더·구간 낭독, 위치 거부 상태 문장.

## Self-Review: 로드맵 M4 항목(자동차 ko·대중교통·출발지 불변식·단위 회귀) 전부 매핑. en NCP 분기는 서버 몫이라 클라 무관(lang 파라미터만 전달, M8 i18n에서 en 연결). 타입·서비스 시그니처 Task 1↔2 일치.
