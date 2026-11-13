---
paths:
  - "src/lib/**"
  - "src/app/api/**"
  - "src/__realcall__/**"
  - "scripts/**"
  - "ios/GildongmuKit/**"
  - "android/kit/**"
  - "packages/cli/src/**"
  - "packages/mcp/src/**"
  - "src/components/BusArrivals.tsx"
  - "src/components/PlaceHoursLine.tsx"
  - "src/components/SurroundingsScene.tsx"
  - "ios/Gildongmu/PlaceHoursLine.swift"
  - "ios/Gildongmu/StationSections.swift"
  - "ios/Gildongmu/Nearby/BusNearbyView.swift"
  - "ios/Gildongmu/Nearby/SubwayNearbyView.swift"
  - "ios/Gildongmu/Nearby/SurroundingsSceneSection.swift"
---

# 외부 통합 규칙 (provider · route · API 키)

Claude Code는 위 `paths`에 맞는 파일을 읽을 때 이 파일을 자동으로 싣는다. 설계 단계(파일을 열기 전)이거나 다른 에이전트라면 이 영역 작업 전에 직접 읽는다. 항목 끝의 `→ INTEGRATIONS`·`→ PATTERNS`는 `docs/INTEGRATIONS.md`·`docs/PATTERNS.md`의 같은 제목 절이다. 어디서나 통하는 원칙은 루트 `CLAUDE.md`에 있다.

## 횡단 함정 (반복 적용 — 새 통합마다 점검)

- **앱의 상세 진입 재료는 옵트인으로만 싣는다**(E65 overview `places=1`·근접 역 `coords=1`): 채팅 도구가 응답 객체를 Gemini 입력에 펼치고 CLI·MCP가 원문을 출력하므로, 새 필드는 `src/lib/chat/router.ts`의 소비 자리부터 확인한다. → INTEGRATIONS
- **좌표 쿼리 파라미터는 `src/lib/coord-param.ts`를 쓴다**(`latParam`/`lngParam`, 선택 좌표는 `.optional().catch(undefined)`): `Number("")===0`이라 누락이 (0,0) `outOfCoverage`로 위장한다. 가드 `coord-param-usage.test.ts`, CLI에도 같은 함정. → INTEGRATIONS
- **서비스 커버리지 마커**: 좌표 의존 라우트는 파싱 → `isInKorea`(`src/lib/coverage.ts`, 국경 폴리곤 한 벌, Kit은 바이트 동일 사본) → 키 게이트 → upstream 순서. 한국 밖이면 200 `{"outOfCoverage":true}`(upstream 미호출), 프리필터 사각형은 링에서 유도(상수 금지). → INTEGRATIONS
- **국내 지역별 미제공은 커버리지와 다른 층이다**: 한국 안이면 200 `{"unavailableHere":"seoulOnly"}`, 판정선은 그 도메인의 조회 반경(`metersOutsideSeoul`) — 행정경계로 자르지 말고, 연속량 도메인(지하철역 거리)엔 쓰지 말고 `nearest`를 싣는다. → INTEGRATIONS
- **역 seed는 타 역 좌표 혼입을 의심한다**: `scripts/build-subway-stations.py`의 `COORD_FIXES` + 가드 3축이 빌드를 중단하고, 좌표 이동은 실좌표로 확인한 것만 `ACCEPTED_COORD_SHIFTS`로 받는다. → INTEGRATIONS
- **좌표는 WGS84 십진 통일.** 변환 함정: 에어코리아 측정소=**TM중부원점 EPSG:2097**(proj4, ⚠ 카카오/네이버의 EPSG:5181 아님, Δ300m+) / 기상청=**격자 nx,ny LCC**(`dfs_xy_conv` 이식) / 네이버 `mapx/mapy`(×10⁷ 정수)는 provider 내부만.
- **data.go.kr envelope는 공용 파서를 쓴다**(`datagokr-envelope.ts`: `readItems`·`readResultCode`·`fetchDataGoKrJson`, 자체 추출 함수 금지, 정책은 provider). `apis.data.go.kr`은 https만(http는 hang, 가드 `datagokr-https-usage.test.ts`). → INTEGRATIONS
- **TAGO는 동시 세션 한도를 HTTP 200 + resultCode 99로 준다**(「가용한 세션이 존재하지 않습니다」): 공용 파서가 throw로 읽으니 0건으로 접지 말고, 실호출 게이트 corpus는 resultCode 비"00" 봉투를 저장하지 않는다. → INTEGRATIONS
- **Tmap 응답 본문은 `readTmapJson`으로 읽는다**(`tmap-json.ts`, 보행자·자동차 공용): POI 이름 구분자로 날 NUL이 문자열 안에 와서 `res.json()`이 실패한다(A62). 새 Tmap 호출 자리도 같다. → INTEGRATIONS §봉투·폴백
- **서울 열린데이터(`openapi.seoul.go.kr`) 본문은 `readSeoulOpenJson`으로 읽는다**(`seoul-open-json.ts` — 무효 키가 200+XML로 온다). 실시간 지하철은 호스트·키가 달라 계약 밖. → INTEGRATIONS
- **envelope 비표준 주의(공용 파서 스코프 밖 — `response` 래퍼가 없다)**: 서울버스(TOPIS)·서울지하철 실시간·서울 열린데이터는 봉투가 각각 다르다. **봉투가 다르면 파서도 다르다** — 공용 모듈에 넣지 말 것. → INTEGRATIONS
- **단위 함정**: NCP Directions `duration`=**밀리초**(카카오·`durationSeconds`=초, 미변환 시 28분→468시간). ODsay `totalTime`=분·`payment`=원·`totalWalk`=미터.
- **도착 낭독 정본은 완성 문장 필드**(서울버스 `arrmsg1`·지하철 `arvlMsg2`, 지하철 도착 목록은 E37 예외): `traTime1`/`barvlDt` 슬롯형 환산 금지(운행종료에도 비0), 슬롯 페어(`arrmsg1`·`arrmsg2`)는 둘 다 투영(슬롯2는 메시지가 다를 때만). → INTEGRATIONS
- **도착 한 줄의 현재역 꼬리는 값 포함으로 가르고 축은 그 줄의 언어다**(A32, `subwayShowsCurrentLocationTail` 웹 ↔ Kit, E37 뒤로는 원문 경로 한정): 완성 문장이 `arvlMsg3` 값을 담으면 꼬리를 뺀다. 글자 패턴·한국어 축 en 판정 금지. → INTEGRATIONS
- **지하철 도착 목록의 줄은 완성 문장을 읽어 쓴 우리 문장이고, 못 알아본 문장만 원문이다**(E37, `subwayArrivalProse`+`arrivalProseSegments` 웹 ↔ Kit 공유 fixture): `barvlDt`·`arvlCd`는 판정·값에 쓰지 않는다. → INTEGRATIONS
- **역명 매칭은 확장 정규화가 정본**(`station-match.ts` `normalizeStationName`+`lineHintMatches` 재사용, 자체 정규화 금지). → INTEGRATIONS
- **ODsay는 승차역을 지정받지 못한다 — 지정 역 경로는 선정 전 후보(`getTransitCandidates`)에서 이름 키 + 정류 좌표 500m + (있으면) 노선으로 찾는다**(E70, 반경 근거 fixture `journey-station-pairs.json`, `maasRP`도 지정 없음). → INTEGRATIONS §여정 조립과 출구 수집
- **"내 주변" 거리순 정렬은 코드 책임**(Haversine, `totalCount` 신뢰 금지). ⚠ 검색 탭은 거리순이 아니라 정확도순+근접 블렌딩 — 거리 표기만 `annotateDistances`, 재정렬 금지. → INTEGRATIONS
- **캐시**: 실시간=`no-store`(라우트는 Cache Components라 `use cache` 없이 요청 시 실행 — 라우트에 `use cache`를 두지 말 것, 버스 도착은 provider 기본 `no-store`), 준정적=`revalidate`(공기질 600·날씨 1800·juso 주소 3600, 카카오 응답은 300이 상한 — `kakao-cache-ttl.test.ts`).
- **실시간 안내의 표시는 조인과 타입 수준에서 갈려 있다**(E27): 조인 필드(노선·역명)는 en에서도 한국어로 동결, 문장 계층은 조인 필드 없는 투영(`transit-display.ts` ↔ `TransitDisplayProjection.swift`)만, 문장 판정은 `transit-guide-text.ts` ↔ `TransitGuideText.swift`. → INTEGRATIONS
- **대중교통·역 정보의 영문은 `lang=en` 응답의 additive `*En`이고 한국어 필드는 어느 응답에서도 그대로다**(E27, `langParam()` — 누락=ko·미지 값 400, 자체 `catch("ko")` 금지). 표 미지·미매칭은 필드 부재(폴백 금지), 한 줄 안에서 언어를 섞지 않는다(`pickLine`). → INTEGRATIONS

## 통합 카탈로그 (provider · route · 핵심 함정)
세부 구현·검증은 각 spec(`docs/superpowers/specs`) 참조. 새 통합 추가 시 위 횡단 함정과 `CLAUDE.md`의 게이트 패턴을 적용.

| 도메인 | provider / route | 핵심 함정·정본 |
|---|---|---|
| 장소 검색 | kakao-local(+naver-local ko 병합) / `/api/places` | **정확도순+좌표 블렌딩**(`sort` 미지정), ko 병합은 재정렬 금지, 리뷰순(`sort=review`)은 네이버 단독·3금지. → INTEGRATIONS |
| 목적지 출입구 승격 | kakao-local `searchEntranceCandidatesKakao` + `entrance.ts`(순수) / `/api/places/entrance` | 넓은 부지는 정문으로 승격(질의 `"{목적지명} 출입구"`, 잔여 토큰이 비면 후보 아님=멱등). 승격 고지 문장 재도입 금지. → INTEGRATIONS |
| en 장소 | `searchPlacesMergedEn` | 카카오+TourAPI 병렬 병합, 중복=좌표 4자리. 영문주소 juso→NCP 폴백 |
| 주소·우편번호 | juso `searchJusoAddresses` / `/api/address/search` | 좌표는 카카오 `/api/geocode` 재사용. `engAddr`는 국가명 미포함 |
| 역지오코딩(현위치 주소) | kakao-address `coordToAddress`+ncp-geocode `reverseRoadAddress` / `/api/geocode/reverse` | **도로명 보장 3단 체인**(카카오 road → NCP 최근접 도로명 → 지번). 지번 우선 회귀 금지. → INTEGRATIONS |
| 코레일 역시설 | korail-facilities / `/api/station/facilities` | 406역 전체 받아 `normalizeStationName` 클라 매칭, `stn_cd` 조인 |
| 서울 지하철역 시설 | seoul-metro-facilities (9 op)+voice-guides seed+seoul-elevator / `/api/station/metro-facilities` | 도시철도 보완, `totalCount>300` throw, 보강 실패는 `supplementFailed`로 표기(은폐 금지). → INTEGRATIONS |
| 역 첫차·막차 (전국) | tago-subway (SubwayInfo 15098554) / `/api/station/timetable` | ⚠ `00`+`totalCount 0`은 "없음"의 증거가 아니다 — `coverage` 4값으로 가른다(A19). 00시대 심야는 배열 앞(03:00 경계). 실호출 게이트 `verify-korea-subway-timetable.mjs`. → INTEGRATIONS |
| 도시철도역 메타 | subway-stations (정적 seed) / `/api/station/meta` | XLSX→JSON 연1회 갱신(`scripts/build-subway-stations.py`), 서버 전용 import |
| 서울 지하철 실시간 | seoul-subway-arrival / `…/subway-arrival[/nearby]` | `arvlMsg2` 정본, 부분실패 보존. ⚠ `INFO-200`은 "운행 시간 밖"과 "미제공 역"이 공유하는 코드 — 역은 어떤 상태에서도 빼지 않고 4-state로 가른다. 옵트인 `coords=1`은 역 좌표(E65). → INTEGRATIONS |
| 지하철 열차 위치(E35) | seoul-subway-position → `transit-position.ts` / `/api/transit/position` | 노선 단위 20초 인메모리 캐시(Next 데이터 캐시 금지 — SWR이 낡은 목록을 준다), `updnLine` 미사용, INFO-200 = 0행(`중앙선` 미제공), 조회 창 끝 번호 = 행 수. → INTEGRATIONS |
| 시내버스 | tago-bus + seoul-bus → `src/lib/bus.ts` 병합 / `/api/bus/nearby`·`/api/bus/route` | 지방=TAGO·서울=TOPIS `mergeBusStops`. 미커버 정본 `isUncoveredBusRegion` — **이 마커만 upstream 뒤에 온다**. ⚠ `arrmsg1` 원문은 서버가 변형하지 않는다(E39, 조립은 클라 `parseBusArrmsg`, 국면 인자에 기본값 없음). → INTEGRATIONS |
| 따릉이 | seoul-bike / `/api/bike/nearby` | 전체 페이지루프+서버 Haversine, row 수<1000이 종료조건 |
| 실시간 혼잡도 | seoul-congestion + `congestion-area.ts`(순수 판정) → `congestion.ts` / `/api/congestion/nearby` | ⚠ **중심-반경 원 금지**(최근접 구성 지점 ≤300m). 공용 파서 밖, 캐시는 **영역 코드** 단위, `area:null`은 오류가 아니다. → INTEGRATIONS |
| 문화행사 | seoul-culture-events → `culture-events.ts` / `/api/events/nearby` | ⚠ `DATE` 파라미터 금지(부분일치), 진행 판정은 코드. 안전한 절단선이 없어 전수 20페이지를 일자 키 `unstable_cache`(6h)로, 거리·반경은 캐시 바깥. `INFO-200`은 끝 신호. → INTEGRATIONS |
| 소아 야간진료 | night-clinic NMC / `/api/clinic/nearby` | 달빛 명부(20km)+일반 소아과 보완(3km) 병합(`clinics.ts`), `findNightClinicsNow` 진료중 우선 정렬 후 캡 50, 절단 전 수 `total`. 공휴일 `fetchIsHoliday`, 실패는 요일 폴백+`basis`. → INTEGRATIONS |
| 공기질·날씨 | air-quality + weather → `LocalConditions` / `/api/air-quality/nearby`·`/api/weather/nearby` | 단일 region, 두 fetch 독립(allSettled), 좌표계 TM/격자(위 참조) |
| 아이 놀 곳 | kids-places / `/api/places/kids` | 카카오 키워드→`category_name` 화이트리스트(키워드 매칭≠키즈), 실내/외 3-state |
| 둘러보기 | surroundings / `/api/places/around` | 카카오 카테고리(10종)+8방위(`bearing.ts`), ⚠ heading 없어 정면-상대 방향 금지. 나들이만 옵트인 `groups=all`(18종·상한 100, E58), 미지정 응답 불변 |
| 보행 인프라 | audio-signals(정적 seed)+osm-walk-nodes(정적 seed) → `walk-infra.ts` / `/api/walk/nearby` | 음향신호기 OA-15543(EPSG:5186)+OSM 정적 seed. 두 seed를 한 파일로 합치지 않는다(ODbL). `getWalkInfrastructure()`만 호출. 나들이 옵트인 `nodes=1`은 교차점 seed를 더한다(미지정 응답 불변). → INTEGRATIONS |
| 카카오 도보 탐침(E58) | kakao-walk 직접 → `walk-probe.ts` / `/api/walk/probe` | 나들이 전용. ⚠ 결과 저장 금지(no-store·세션 메모리·로그는 개수만), `getWalkRoute`를 타지 않는다(Tmap 폴백이 자동차 쿼터를 먹는다), 간격은 앱이 직선 100m. → INTEGRATIONS §보행 인프라 |
| 현재 위치 정위 | where-am-i / `/api/where-am-i` | 4조각 allSettled 조립, 산문은 결정론 템플릿(LLM 아님), `stripRegionPrefix` 중복제거 |
| 부근 상황 재구성(M1) | road-address+geo/road-axis(순수)+road-axis-service → `surroundings-scene.ts` / `/api/surroundings/scene` | 좌우는 도로명 홀짝+juso 건물 축(POI로 세우지 말 것). `SurroundingsScene`은 live region 없음. → INTEGRATIONS |
| 무장애 여행 정보 | tour-barrier-free / `/api/places/barrier-free[/detail\|/match]` | KorWithService2(B551011). **게이트·인증 모두 `DATA_GO_KR_API_KEY`**(split-brain 금지), 활용신청 별도. → INTEGRATIONS |
| 자동차 경로 | **tmap-car(기본)+kakao-navi(폴백)** → `car-route.ts`(ko) / `ncp-directions`(en) / `/api/route/car` | ko 기본 Tmap(완성 문장), 낭독 문장은 `rewriteCarGuidance`(117/118은 회전이 아니라 갈래, 거리 꼬리는 `formatDistance` 원값 km). 수치 0은 미제공. 게이트 `hasCarRouteKey`. → INTEGRATIONS |
| 도보 경로 | **kakao-walk(기본)+tmap-pedestrian(폴백)** → `walk-route.ts` / `/api/route/walk` | `getWalkRoute`만 호출, 문장은 서버 `rewriteWalkGuidance`(소비자 재조합 금지), 옵트인 `wording=2`는 `rewriteWalkBriefingV2`(미지정 응답 불변), `action`은 `attachStepActions`. 비-ko는 Tmap 단독 en(`lang` 필수 인자), 조회 화면은 `lines=2` 줄 목록(`lines` 값은 판본 번호). 기하 응답은 카카오 첫 점 30m 밖이면 Tmap 재시도(A70). → INTEGRATIONS |
| 횡단보도 차로 수·도로 폭 | crosswalks(정적 seed 15028201) → `walk-route.ts` `annotateCrosswalkInfo` / 별도 라우트 없음 | 단일 횡단보도 스텝 끝에 `, N차로, 도로 폭 Mm` — 있는 곳만, 3중 게이트 전부 통과일 때만, Tmap·병합 스텝·분해된 연속 횡단 조각은 침묵. → INTEGRATIONS |
| 대중교통 | odsay + odsay-select + bus-service-hours + subway-service-hours + odsay-express-stops(급행 정차역, ODsay 추가 호출·7일 캐시) / `/api/route/transit` | **파이프라인 순서가 계약: 정규화 → 강등 → 선정 → 축 라벨.** 재조회 제안(`requeryAxes`)은 강등 뒤 전체 후보로 판정. iOS `routeKey` 필수 디코딩이라 **웹 배포가 앱보다 먼저**. → INTEGRATIONS |
| 여정(E70, 웹·iOS ko) | `journey/*` / `/api/route/journey` | 조회 셋 조립(ko 전용). ⚠ 카카오 출구 질의는 괄호 뗀 `exitQueryStationName`(표시 이름 함수와 분리 — 섞으면 「출구 없음」 위장), `lookupFailed`는 카카오 출구 실패만, Tmap은 호출 수 팬아웃 전 예약(IP 16·인스턴스 일 200). 정류장 지정(E70-e)은 옵트인 `stops=1`, 이름은 TOPIS·TAGO 검색(`/api/route/journey/stops`). → INTEGRATIONS |
| 지하철 빠른하차 | subway-quick-exit(정적 seed) → `quick-exit.ts` / 별도 라우트 없음(`TransitLeg.quickExit`) | 거리는 열차 선형 위치, 엘베×계단 쌍 최적화, 방향은 방면 1개 확정일 때만. ⚠ 환승 leg는 ODsay `subPath.door`가 정본(A20, 긍정 정규식만 통과). → INTEGRATIONS |
| 장소 영업시간(E24, 웹·iOS 장소 상세) | google-places → `place-hours.ts`(순수) / `/api/places/hours` | 어떤 실패도 `{hours:null}`. `place_id`만 캐시, 영업시간은 캐시 금지. ⚠ 약관 TTS 금지(`place-hours-tts-drift.test.ts`), 좌표만으로 매칭하지 않는다. attribution "Google Maps"는 번역·변형 금지. → INTEGRATIONS |
| STT | Deepgram nova-3 / `/api/speech-to-text` | ⚠ `detect_language` 금지(ko→vi 오인식), `language` 명시. 효과음으로 시작/정지 통지 |
| 대중교통 추적 | `transit-track.ts`(TOPIS·TAGO·서울 지하철) / `/api/transit/track` | 판별 union으로 봉투 차이 흡수, 3-state, `no-store`(라우트 `use cache` 없음), IP 60초 20회. ⚠ 지하철 `arvlCd`는 문장과 맞춘 뒤에만 싣는다(`reconcileArvlCd` — 8호선은 「[N]번째 전역」에 코드 1을 싣는다, A73) |
| 한눈에 보기 | `nearby-overview.ts` / `/api/nearby/overview` | 주변 6종을 반경 1km로 집계, 키 게이트는 불릿 단위, 조각 실패는 불릿 `failed`로 200(3-state), 옵트인 `places=1`(E65) |
| 채팅 웹검색 | perplexity-search / `search_web` 도구 + `/api/search/web`(검색창 웹섹션, 1시간 캐시) | `ToolResult{data,render,source}`, 결과 카드+출처 노출 |

## API 키 현황

전부 **서버 전용 env**(클라 노출 금지). 게이트 함수가 키 유무를 판정해 死기능을 막는다.

| 키 | 게이트 | 용도·비고 |
|---|---|---|
| `KAKAO_REST_API_KEY` | `hasKakaoKey` | 로컬검색+지오코딩+도보 경로(ko 기본)·나들이 도보 탐침+카카오모빌리티 자동차 폴백 (dodo 앱 공유, 1개로 전부) |
| `TOUR_API_KEY` = `DATA_GO_KR_API_KEY` | `hasDataGoKrKey` · `hasTourApiKey`(en 장소 TourAPI 병합 분기만) | **동일값**(data.go.kr 계정당 단일키, 신규 추가는 활용신청만). ⚠ 신규 provider 인증은 게이트와 같은 `DATA_GO_KR_API_KEY`로(split-brain 금지). → INTEGRATIONS |
| `NCP_MAPS_CLIENT_ID/SECRET` | `hasNcpMapsKeys` | en 영문주소 보강 폴백 + en 자동차경로 + 역지오코딩 도로명 2단 폴백. 헤더 `x-ncp-apigw-api-key-id`/`-key` |
| `JUSO_CONFM_KEY` | `hasJusoKey` | 행안부 도로명주소 검색(영문주소+우편번호)·부근 재구성 건물 축·역지오코딩 en·비-ko 도보 도로명 로마자, 무료·무제한 |
| `SEOUL_OPEN_DATA_KEY` | `hasSeoulOpenDataKey` | 서울 열린데이터(따릉이·문화행사·실시간 혼잡도). 일 1,000회를 셋이 **공유**하므로 신규 소비자는 캐시 설계가 필수. ⚠ 실시간 지하철은 별도 키 |
| `SEOUL_SUBWAY_REALTIME_KEY` | `hasSeoulSubwayRealtimeKey` | "실시간 데이터 인증키"(일반키로 호출 시 `ERROR-338`), 일 1,000회를 도착·열차 위치(E35)가 나눈다 |
| `ODSAY_API_KEY` | `hasOdsayKey` | Flex(후불 종량제) 앱 `gildongmuflex`, Referer `gildongmu.dodoplanet.space`에 묶인다. ⚠ **호출 수가 곧 비용** — 새 호출 경로는 캐시 뒤, 실호출 게이트는 `--from-corpus` 우선·실호출은 `--out`. 옛 Basic 앱 `gildongmuweb` 금지(약관). → INTEGRATIONS |
| `DEEPGRAM_API_KEY` | `hasDeepgramKey` | STT nova-3 (dodo 공유). ⚠ prod 502면 키 유효성 먼저([[deepgram-prod-key-401]]) |
| `GOOGLE_CLOUD_TTS_API_KEY` | — (게이트 함수 없음) | `/api/tts`(Chirp 3 HD)는 **폴백**이다. 정본은 기기 음성이고 서버 경로는 현재 로케일 보이스가 기기에 없을 때만 탄다. → INTEGRATIONS |
| `GEMINI_API_KEY` | `hasGeminiKey` | 채팅 FC 엔진(모델은 env가 아니라 코드 상수 `GEMINI_MODEL`). `gildongmu-prod` API 제한 키, ⚠ dodo와 공유하지 않는다. 키 교체 시 3곳 동조. → INTEGRATIONS |
| `GOOGLE_PLACES_API_KEY` | `hasGooglePlacesKey` | 장소 상세 영업시간(E24). 무료분을 GCP 일일 쿼터로 상한(초과는 429라 과금 0). → INTEGRATIONS |
| `PERPLEXITY_API_KEY` | `hasPerplexityKey` | 검색창 웹섹션 + 채팅 `search_web`. 유료($5/1,000req). dodo 공유 |
| `NAVER_LOCAL_CLIENT_ID/SECRET` | `hasNaverLocalKeys` | 네이버 지역검색(ko 장소 병합 보강). ⚠ 2027-06-30 NAVER API Hub(NCP 키) 이관 데드라인. → INTEGRATIONS |
| `TMAP_APP_KEY` | `hasTmapKey`(도보 노출 게이트는 `hasWalkRouteKeyFor(lang)`: ko=`hasWalkRouteKey`, 비-ko=`hasTmapKey` / 자동차 노출 게이트는 `hasCarRouteKey`) | 보행자 ko 폴백·비-ko 단독 + 자동차 ko 기본. 일 1,000건 무료를 둘이 공유(길동무 단독), IPS "Any IP allowed" 유지(IP 제한 금지). → INTEGRATIONS |

키가 아닌 env: `PLACES_PROVIDER`(장소 provider 강제 지정, 실험용 — `mock`도 받는다), `NEXT_PUBLIC_APP_IDENTIFIER`(딥링크 appname, 공개 값).

상세 키 발급 경로·실호출 검증 이력은 `PROGRESS.md`, API 생태계 조사는 `docs/research/RESEARCH-2026-06-*.md`.

⚠ **prod 채팅/STT가 502면 코드보다 키 등록 유효성을 먼저 의심**([[vercel-env-add-noninteractive-bug]]·[[deepgram-prod-key-401]]). 검증은 `env pull` 길이가 아니라 실호출로([[vercel-prod-env-pull-redacts-encrypted]]).
