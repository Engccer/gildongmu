# dodo-planet 전량 이식 spec — gildongmu 한국 API 스택 졸업 계획

> 2026-07-03 · **spec-only(구현 없음)**. gildongmu에 구현된 API/provider **전체**를 dodo-planet으로 이식하기 위한 확정 설계. 기존 계약을 **확장**한다(대체 아님):
> - **계약 정본**: `~/Mac-Projects/dodo-planet/docs/plans/2026-06-13-korea-local-provider-integration.md` §4 (PlaceProvider 어휘·selectPlacesProvider 시그니처·env 키) — 그대로 유효.
> - **수용측 지도**: `docs/research/RESEARCH-2026-07-dodo-planet-target-architecture.md` (dodo Round 148 실측) — 이 spec의 dodo측 파일 경로·체크리스트 근거. dodo 재탐색 불필요.
> - **선행 spec**: `2026-06-21-dodo-korea-api-port-design.md`(Spec B, 4계층 아키텍처) — 본 spec이 흡수·구체화한다. Spec B의 계층 구분(ToolResult/provider/도구·카드/env)은 유지하되, 이후 반 달간 추가된 자산(무장애·명소·where-am-i·날씨)과 검증 상태 변화, 그리고 **trip-less 한국 판정 설계(§4)** 를 반영해 본 문서가 최신 정본이다.

## 0. 목표

dodo-planet은 현재 국가별 차별성이 없다. gildongmu에서 실호출로 검증한 국내 API 스택을 전량 이식하면 **한국에 대해서는 매우 높은 퀄리티의 정보를 제공하는 여행 앱**으로 업그레이드된다. 요구 2가지:

1. 한국 여행(trip)을 생성해 작업할 때 한국 전용 도구가 동작한다.
2. **여행이 선택되어 있지 않아도 한국 관련 채팅이면 한국 전용 API로 라우팅**된다(§4 하이브리드 에스컬레이션 — 사용자 확정, 2026-07-03).

측정 가능한 성과: (a) trip-less 상태에서 "경복궁 근처 지하철 도착 알려줘"에 실시간 도착 정보가 답변된다. (b) 한국 trip 대화에서 공기질·소아진료·키즈 장소·무장애 정보가 도구 데이터 정본으로 답변된다. (c) 비한국 대화의 함수 노출 수·동작은 byte-identical(회귀 0).

## 1. 자산 전수 인벤토리 — 이식 판정표

전수 조사(2026-07-03, provider 26파일·API 라우트 27개·채팅 도구 15개·컴포넌트 40여 개) 결과. **React/Next 비의존 검증: `src/lib/` 전체에서 `react`/`next/`/`next-intl`/`"use client"`/`server-only` import 위반 0건** — "복사 + import 경로 수정" 전제가 전 항목에서 성립한다. 브라우저 API 결합은 `src/lib/geolocation.ts`(navigator)·`src/lib/beacon.ts`(Web Audio) 2개뿐이며 둘 다 이식 대상이 아니다(아래 제외 판정).

### 1.1 이식 대상 (provider + 함정 요약)

| # | 자산 (provider) | 검증 상태 | dodo행 판정 | 핵심 함정 (이식 시 보존할 지식) |
|---|---|---|---|---|
| 1 | 카카오 로컬 3종+딥링크 (`kakao-local`·`kakao-address`·`kakao-navi`·`deeplink*`) | ✅ prod | **졸업 완료** (dodo Round 141, PR #139) | 잔여 대조: gildongmu 이후 개선분(좌표 거리순 `buildKakaoSearchUrl`, radius 미지정) diff 확인만 |
| 2 | TourAPI (`tour-api.ts`) | ✅ prod (en 명소 2026-07-01) | **Phase A** (§5b-②) | dodo 휴면본은 라벨 맵 구버전 — gildongmu 최신본(contentTypeId=76 서버측 필터·en 좌표 시 거리순)으로 재동기 |
| 3 | NCP Directions (`ncp-directions.ts`) | ✅ (C1, en 턴바이턴) | **Phase A** (§5b-①③) | `duration`=**밀리초**(`normalizeNcpRoute`가 초 변환). ko=카카오/en=NCP lang 디스패치 구조째 이식 |
| 4 | NCP Geocoding (`ncp-geocode.ts`) + juso (`juso-address.ts`) | ✅ prod (juso 정본, NCP 폴백) | **Phase A** (§5b-⑤) | 영문주소 체인은 juso→NCP→한글 순(`enrichEnglishAddresses`). 2026-06-13 계약의 `getEnglishAddress()` NCP 단독 체인보다 juso 우선이 최신 정본 — 계약 문서에 이 개정을 명시 |
| 5 | 카카오 명소 (`kakao-attractions.ts`+`attractions.ts` 디스패처) | ✅ prod (2026-07-01) | **Phase A** (TourAPI와 동일 디스패처) | 판별은 `category_name.startsWith("여행 > 관광,명소")` — **AT4 group code 아님**(부속 명소는 빈 문자열). ko=정확도순/en=거리순 비대칭 |
| 6 | 서울 지하철 실시간 (`seoul-subway-arrival`·`subway-nearby`) | ✅ prod | **Phase C** | `arvlMsg2` 완성문장이 낭독 정본(`barvlDt` 슬롯 환산 금지 — 운행종료 오발화). envelope code 위치가 정상/에러에서 다름. 별도 키(`SEOUL_SUBWAY_REALTIME_KEY`, 일반키는 ERROR-338) |
| 7 | 도시철도역 메타 seed (`subway-stations.ts`+JSON 1,098역+`scripts/build-subway-stations.py`) | ✅ | **Phase C** (6의 받침대) | OpenAPI 아닌 연1회 XLSX seed. 서버 전용 import 유지. `findStationsNear`가 실시간 도착의 역 식별 기반 |
| 8 | 시내버스 병합 (`tago-bus`+`seoul-bus`+`lib/bus.ts`) | ✅ prod | **Phase C** | envelope 3형(TAGO=`items.item[]` / TOPIS=`msgHeader.headerCd`+`itemList`). `arrmsg1`·슬롯 페어(`arrmsg2`는 메시지 다를 때만). 저상버스 `vehicletp` 정본 |
| 9 | 코레일+서울 역 시설 (`korail-facilities`·`seoul-metro-facilities`) | ✅ | **Phase C** | 역명 필터 무시 → 406역 전체 수신 후 `normalizeStationName` 클라 매칭. "0대"≠"정보 없음" 3-state |
| 10 | 공기질+날씨 (`air-quality`·`weather`) | ✅ prod | **Phase C** | 좌표계 2종: 에어코리아=**TM중부 EPSG:2097**(카카오 5181 아님, Δ300m+)·기상청=격자 LCC(`dfs_xy_conv` 이식본). 에어코리아 envelope는 `body.items` 직접 배열. 등급 단어가 정본(Flag→unknown) |
| 11 | 소아 야간·휴일 진료 (`night-clinic.ts`) | ✅ | **Phase C** | NMC `getBabyListInfoInqire`가 좌표 보유 정본(HIRA 15001674는 좌표 없음). 진료 3-state(KST). 전국 일괄→Haversine 거리순은 코드 책임 |
| 12 | 키즈 장소 (`kids-places.ts`) | ✅ | **Phase C** | 키워드 매칭≠키즈 — `category_name` 계층 화이트리스트(`classifyKidsPlace`)가 정본. 실내/외 3-state |
| 13 | 둘러보기 (`surroundings.ts`+`geo/bearing.ts`) | ✅ | **Phase D** | heading 없어 정면-상대 방향 금지, 8방위만 |
| 14 | 무장애 여행 정보 (`tour-barrier-free.ts`) | ✅ prod (**2026-06-30 활용신청 자동승인+실호출 검증 완료** — "403 대기"는 stale) | **Phase D** | 편의시설 라벨 철자는 실호출 확정본(`brailepromotion` 등) 그대로. 장소 매칭 좌표50m∩이름. 게이트·인증 모두 `DATA_GO_KR_API_KEY`(split-brain 금지) |
| 15 | 따릉이 (`seoul-bike.ts`) | ✅ | **Phase D** | 전체 페이지 루프+서버 Haversine. `list_total_count` 신뢰 금지 — 종료조건은 받은 row 수 |
| 16 | 현재 위치 정위 (`where-am-i.ts`+`/api/where-am-i`) | ✅ prod | **Phase D** (§5b-⑤ 음성 "Where am I?" 연결) | 4조각 `allSettled` 조립, 산문은 **결정론 템플릿**(LLM 아님). `stripRegionPrefix` 중복 제거 |
| 17 | ODsay 대중교통 (`odsay.ts`) | ✅ prod (2026-07-04 URI(referer) 식별 전환) | **Phase E** — dodo 도메인용 URI 앱 등록+실호출이 선행(§7.1) | `totalTime`=분·`payment`=원. 환승도보 `{distance:0}` leg 제외. error -98→null 3-state. 서버 fetch에 도메인 Referer 명시 |

지원 모듈(위 provider가 의존, 함께 이식): `format.ts`(`joinText`)·`geo.ts`(Haversine 정렬)·`data-locale.ts`(`dataLocale`/`prefersEnglish`)·`station-match.ts`·`nearby-place.ts`·`env.ts` 게이트 패턴(dodo `providers/env.ts` lazy 관례로 변환 — §6).

### 1.2 제외·보류 판정 (미니멀리즘 — "뺄 이유" 기록)

| 자산 | 판정 | 근거 |
|---|---|---|
| `search_web`(Perplexity)·채팅 셸(`ChatOverlay`·`ChatInterface`·`MessageBubble` 등) | **제외** | dodo가 자체 Perplexity 통합·채팅 UI 보유(2026-02-28). 중복. 단 `remarkTightLists`·`SourceList` 출처 패턴은 **역수입 후보**(Spec B §5 유지) |
| STT(`deepgram.ts`·`stt-validate.ts`·`VoiceRecordButton`) | **제외** | dodo는 Gemini Live 음성 대화 보유 — 검색창 받아쓰기는 dodo UX에 없음 |
| PWA 서비스워커·`SWRegister` | **제외** | dodo 자체 PWA 보유 |
| `geolocation.ts` 싱글턴·`nearby-panel-store.ts`·홈 "내 주변" 패널 UI | **제외** | dodo의 정보 진입은 채팅(함수 호출)이지 홈 패널이 아님. 위치는 dodo 기존 위치 파이프라인 사용 |
| `naver-local.ts` | **제외** | 키 미발급·실호출 미검증 — 가짜 실데이터 금지 원칙상 미검증 provider는 보내지 않음 |
| `mock.ts` | **제외** | dodo는 mock 조용 폴백 금지 관례. 키 없음=도구 미노출(게이트)로 충분 |
| `DistanceBeacon`·`beacon*.ts`·tones | **제외** | gildongmu 자체에서도 보류 코드(마운트 해제 상태) |
| `get_bus_route`(노선 경유 정류소) | **보류** | gildongmu 채팅 V1에서도 제외했던 저빈도 도구. 여행 대화 가치 낮음 |
| 검색창 3섹션·주소 검색 UI(`SearchBar`·`AddressResultList` 등) | **제외** | dodo는 채팅 중심 — 검색창 UI 없음. juso provider는 영문주소 보강 체인(§1.1-4)으로만 합류 |
| `search_address` 채팅 도구 | **보류** | 주소·우편번호 단건 검색은 여행 대화에서 빈도 낮음. juso 가치의 대부분은 en 장소 카드 주소 보강으로 흡수됨. 수요 확인 후 후속 |
| KRIC 교통약자·가족 행사·공공시설 예약 등 SPEC.md 백로그 "조사됨/후보/승인 대기" 항목 | **비대상** | gildongmu에 미구현 — 이식 대상은 "구현+검증" 자산만. gildongmu 백로그에 잔류 |

## 2. dodo Gemini 함수 매핑

dodo 함수 계층(49개, `declarations.ts`+`router.ts`+카탈로그 3-mirror)에 **신규 한국 도메인 모듈 `src/lib/gemini/korea-local.ts`** 를 신설하고 아래 함수를 추가한다. gildongmu `src/lib/chat/router.ts`의 도구→provider 디스패치가 원형이며, dodo `executeFunction` switch에 case로 편입한다.

| dodo 함수 (신규/기존) | gildongmu 원형 | provider | 음성 subset | Phase |
|---|---|---|---|---|
| `search_nearby_places` (기존) | `search_places` | places 디스패처 — 이미 카카오 라우팅 완결 | 이미 포함 | — |
| `get_car_route_briefing` (기존, locale 라우팅 추가) | `get_car_route` | kakao-navi / ncp-directions(en) | 이미 포함 | A |
| `get_place_overview` (신규, §5b-④) | — (TourAPI `detailCommon2`) | tour-api | 포함 | A |
| `get_subway_arrivals` (신규) | 동명 | subway-nearby(+seed) | **포함** (실시간 즉답) | C |
| `get_bus_arrivals` (신규) | 동명 | lib/bus 병합 | **포함** | C |
| `get_station_info` (신규) | `get_station_meta`+`get_station_facilities` **통합** | subway-stations+korail/seoul-metro-facilities | 포함 | C |
| `get_air_quality` (신규) | 동명 | air-quality (+weather 병합은 아래 결정) | **포함** | C |
| `get_night_clinics` (신규) | 동명 | night-clinic | **포함** (아이 아플 때 음성이 1순위) | C |
| `get_kids_places` (신규) | 동명 | kids-places | 포함 | C |
| `get_surroundings` (신규) | 동명 | surroundings | 포함 | D |
| `get_barrier_free_info` (신규) | `get_nearby_barrier_free` | tour-barrier-free | 제외 (장문 목록 — 텍스트 정독이 정합) | D |
| `get_bike_stations` (신규) | 동명 | seoul-bike | 포함 | D |
| `where_am_i` (신규 또는 기존 위치 함수 강화) | — (`/api/where-am-i`) | where-am-i 조립 | **포함** (음성 1급 시나리오) | D |
| `get_transit_route` (신규) | 동명 | odsay | 포함 예정 | **E (조건부)** |

- **함수 수 영향**: 신규 약 11개 → 한국 컨텍스트에서만 declaration 포함(§4)이므로 비한국 대화는 49개 유지, 한국 대화는 ~60개. Gemini 권장 상한 초과분은 §4의 컨텍스트 게이팅이 흡수한다.
- **통합 결정 2건(미니멀리즘)**: ① 역 메타+시설을 `get_station_info` 하나로 — gildongmu에선 진입 UI가 달라 분리했지만 dodo 채팅에선 "이 역 정보"가 한 질문이다. ② 날씨는 독립 함수를 만들지 않는다 — dodo 기존 날씨 함수 존재 여부를 plan 단계에서 확인해, 있으면 한국 좌표일 때 기상청 provider로 내부 라우팅, 없으면 `get_air_quality`를 `get_local_conditions`(공기질+날씨, gildongmu `LocalConditions` 동형)로 확장. **어느 쪽이든 함수 신설이 아니라 기존 계약에 얹는다.**
- **명명**: dodo 카탈로그의 동사 관례(get_/search_)를 따르되 최종 이름은 plan 단계에서 기존 49개와 충돌 검사 후 확정.
- **dodo측 파일 체크리스트**: 함수 1개당 10파일(declarations→도메인 모듈→router→카탈로그 3-mirror byte 일치→음성 subset→카탈로그 테스트 하드코딩 수치→도메인 테스트) — 수용측 지도 §8-A 그대로. **3-라우트(채팅·음성·CLI) 동등성**이 대표 리스크: 어느 한 라우트에만 배선하지 말 것.

### 카드(RenderPayload) 이식

Spec B 계층 1·3 유지: dodo `executeFunction` 반환을 `ToolResult{data, render?, source?}`로 확장(기존 49개 함수는 `{data}` 최소 래핑 어댑터 — 파급 차단), gildongmu 카드 중 **도구 대응 카드만** 이식한다(`SubwayArrivalList`·`BusArrivals`·`AirQuality`/`LocalConditions`·`NightClinicsNearby`·`KidsPlacesNearby`·`BarrierFreeNearby`·`StationFacilities`류·`CarRouteBriefing`·`TransitRouteBriefing`·`SourceList`). gildongmu 훅 의존(useGeolocation·nearby-panel)은 이식 시 props 주입으로 치환한다(카드가 스토어를 직접 읽지 않게 — dodo 위치 파이프라인과 결합).

## 3. 아키텍처 — 안착 지점 (수용측 지도 기준)

```
dodo 채팅/음성/CLI 3-라우트
   └─ createToolDeclarations(context)      ← §4 koreaSignal로 한국 함수군 포함/제외
        └─ executeFunction() switch        ← korea-local.ts 도메인 모듈 case 편입
             └─ src/lib/providers/korea/*  ← gildongmu provider 복사(+ env lazy 변환)
                  └─ 외부 API (서버 전용 키)
```

- provider 배치: dodo `src/lib/providers/` 아래 **`korea/` 서브디렉터리**로 격리(기존 kakao-*·tour-api와 나란히 두면 13→35+ 파일로 평면 비대). `selectPlacesProvider` 등 기존 라우팅 계약은 무변경.
- gildongmu의 API 라우트(`/api/...` 27개)는 **이식하지 않는다** — dodo의 정보 진입은 Gemini 함수이므로 provider를 도메인 모듈이 직접 호출한다(gildongmu 채팅 도구가 이미 이 구조 — self-fetch 아님). 예외: 카드가 클라이언트에서 재조회해야 하는 실시간 갱신(지하철 도착 새로고침)만 최소 프록시 라우트 신설, **반드시 `requireAuth()`**(dodo는 서버 키 프록시에 인증 필수 — gildongmu는 공개 데모라 무인증이었음).

## 4. 한국 컨텍스트 감지 — 하이브리드 에스컬레이션 (확정 설계)

**공백**: 현재 dodo의 한국 판정(`isKoreaContext`)은 좌표 우선 + trip countryCode 보조. trip-less 채팅은 GPS가 유일한 신호라, 해외(또는 위치 미허용)에서 한국 여행을 계획하며 묻는 대화에 한국 도구가 declaration에 아예 없어 모델이 호출 자체를 못 한다.

**확정안(사용자 승인 2026-07-03)**: 결정론 신호 OR-결합 에스컬레이션 + 도구 내부 좌표 최종 판정.

1. **`koreaSignal(ctx)` — 세션 단위 래치**. 아래 중 하나라도 참이 되는 턴부터 한국 함수군을 declaration에 포함하고, 세션 내내 유지(래치 해제 없음 — 대화가 한국을 떠나도 함수가 남는 비용은 무해, 노출만 늘 뿐):
   - trip 선택 + `countryCode === "KR"` (기존 신호)
   - 사용자 GPS 좌표가 `isInKorea()` (기존 신호)
   - **대화 텍스트의 한국 지명·키워드 결정론 사전 매칭** (신규): 사용자 메시지에 대해 (a) "한국/Korea/Korean/Seoul/서울/부산/제주…" 국가·광역 키워드, (b) 1,098역 seed 역명 + 주요 관광지명 사전. 정규화(소문자·공백 제거) 후 부분 문자열 매칭 — LLM 분류가 아니라 사전 조회(결정론, 라우터 폐기 교훈의 안티패턴 회피: **재해석 없이 포함 여부만 판정**하고 쿼리는 건드리지 않는다)
   - **이전 도구 결과가 한국 좌표를 반환** (신규): `search_nearby_places` 등 상시 노출 함수의 결과 좌표가 `isInKorea()`면 다음 턴부터 래치 on — 사전이 못 잡는 지명("길동 카페")도 장소 검색이 한국 좌표를 반환하는 순간 열림
2. **도구 내부는 항상 좌표로 최종 판정** — 래치는 "노출"만 결정하고, 각 도구는 인자/컨텍스트 좌표가 한국일 때만 한국 provider를 호출, 아니면 3-state "이 지역 미지원" 반환. 사전 오탐(예: 영어 문장 속 "Seoul food" 언급)이 잘못된 데이터로 이어지지 않는 안전핀.
3. **시스템 프롬프트 동기**: 래치 on이면 trip-less여도 `koreaGuidance`(기존 `prompt-messages.ts` 문구) 부착 — 함수만 열고 사용 지침이 없으면 모델이 활용을 못 한다.
4. **비용·한계 명시**: 지명 사전은 seed 재활용이라 유지비 0에 가깝고, 첫 턴에 사전이 못 잡는 표현은 전문 도구가 1턴 지연된다(에스컬레이션 경로가 흡수). 함수 수는 비한국 대화에서 현행 유지.

**구현 위치**: `koreaSignal` 판정은 `src/lib/providers/index.ts`(isKoreaContext 곁) 순수 함수 + 래치 상태는 대화 컨텍스트(chat route가 메시지 이력에서 매 요청 재계산 — 서버 무상태 유지, 별도 저장 없음). 판정 함수는 결정론이므로 단위 테스트로 완전 커버.

## 5. Phase 구성과 순서 근거

| Phase | 내용 | 게이트 (착수/완료 조건) |
|---|---|---|
| **A** | **§5b 다국어 활성화 흡수** — ① ncp-directions 이식+locale 라우팅 ② tour-api 재동기+`TOUR_API_KEY`+라우팅 v2 ③ 명소 디스패처 ④ `get_place_overview` ⑤ juso 우선 영문주소 체인+where-am-i 음성 연결 준비 | dodo PROGRESS "가장 가까운 다음 작업" 그대로 — 이식 인프라 없이도 독립 가치. 완료: en 실호출 검증 |
| **B** | **이식 기반 공사** — ToolResult 어댑터(§2 카드), `koreaSignal` 하이브리드 에스컬레이션(§4), `providers/korea/` 골격, env 키 등록(§6) | A와 병행 가능. 완료: 비한국 대화 byte-identical 회귀 테스트 + trip-less 한국 질의에 함수 노출 확인 |
| **C** | **코어 정보 도구 1차** — 지하철 실시간+역 정보, 버스, 공기질(±날씨), 소아진료, 키즈 (§2 표) | B 완료 후. 도구별 실호출 verify 스크립트(§8) PASS가 머지 게이트 |
| **D** | **2차** — 둘러보기, 무장애, 따릉이, where-am-i 음성 | C와 같은 패턴. 무장애는 dodo 키로 실호출 재검증 후 라우팅 연결 |
| **E** | **ODsay 대중교통** — 방식은 해소됨(§7.1 URI 식별, gildongmu prod 검증 완료). 선행 조건은 dodo 도메인용 ODsay URI 앱 콘솔 등록(URI는 앱 간 중복 불가). 등록·실호출 검증 전 declaration 연결 금지(휴면 — dodo tour-api 휴면 선례와 동형) | dodo URI 앱 등록 + prod 실호출 검증 |

순서 근거: A가 먼저인 이유는 dodo 로드맵이 이미 최우선으로 지정했고 이식 인프라와 독립적으로 가치를 배달하기 때문. B는 C·D 전부의 전제(함수 노출 경로). C/D는 dodo 여행 도메인 가치 순(전국 커버·가족 안전망 우선, 서울 한정·저빈도 후순). E는 외부 콘솔 절차(dodo 도메인 URI 앱 등록)가 선행하는 유일한 항목이라 맨 뒤. ⚠ dodo P0(Amadeus 폐쇄 2026-07-17 대응)과 리소스 경합 시 P0 우선.

## 6. env·키 이식 목록 (Vercel 3환경)

전부 서버 전용. dodo 관례는 **호출 시점 lazy 읽기**(`providers/env.ts` 헬퍼) — gildongmu `env.ts`의 게이트 함수 13종을 dodo 헬퍼 스타일로 변환해 합류시킨다(module-scope parse 금지).

| 키 | dodo 현황 | 조치 |
|---|---|---|
| `KAKAO_REST_API_KEY` | ✅ 등록됨 | 없음. ⚠ 2026-07-21 카카오 정책 변경(무료쿼터=개발자계정 첫 활성화 앱만) — dodo 앱이 해당 계정 첫 앱인지 plan 단계 확인 |
| `TOUR_API_KEY` = `DATA_GO_KR_API_KEY` | 값 미등록 (헬퍼만 존재) | 동일값 2이름 등록(게이트/인증 split-brain 금지). **활용신청은 계정 단위라 gildongmu에서 승인받은 API(무장애 포함) 전부 같은 키로 즉시 유효** — 재신청 불필요, 단 실호출로 재확인 |
| `NCP_MAPS_CLIENT_ID`/`SECRET` | 없음 | Phase A 등록 |
| `JUSO_CONFM_KEY` | 없음 | Phase A 등록 (무료·무제한) |
| `SEOUL_SUBWAY_REALTIME_KEY` | 없음 | Phase C 등록. ⚠ 일반키 아님("실시간 데이터 인증키" 별도 계열). 일 1,000회/키 — dodo 트래픽 기준 상향(갤러리 등록) 검토 |
| `SEOUL_OPEN_DATA_KEY` | 없음 | Phase D 등록 (따릉이) |
| `ODSAY_API_KEY` | 없음 | Phase E 등록 — **dodo 도메인용 URI 전용 앱을 새로 만들어 그 키를 URL 인코딩 형태로**(§7.1, gildongmu 키 재사용 불가) |
| `GEMINI`·`PERPLEXITY`·`DEEPGRAM` | ✅ 기존 공유 | 없음 |

공통 함정: env 추가 후 **반드시 재배포**(키는 배포 시점 주입), 등록 검증은 `env pull` 길이가 아니라 실호출로.

## 7. 미해결 전제 해소 계획

### 7.1 ODsay Server IP 화이트리스트 — 해소 완료 (정정, 2026-07-04)

당초 "유일한 실질 차단"이었으나 gildongmu에서 해소·prod 실호출 검증 완료. 채택안은 당시 1순위 후보였던 **URI(도메인) 식별**인데, 우려했던 "키 노출형"이 아니었다 — **키를 클라이언트에 노출하지 않고 서버 fetch가 `Referer` 헤더로 도메인을 자기 식별**하면 되고, referer 식별은 IP 무관이라 Vercel 가변 egress IP 문제가 사라진다. 상세 판별 기록은 gildongmu PROGRESS.md(2026-07-04)와 [[odsay-transit-server-ip-vercel]].

dodo 이식(Phase E) 시 그대로 반복할 절차:

1. ODsay 콘솔에 **dodo 도메인용 URI 전용 앱 신규 등록**(www.dodoplanet.space). ⚠ apiKey는 발급 시점 플랫폼에 묶이므로 기존 Server 앱에 URI를 추가하는 방식은 불가(gildongmu 실측 — 전 referer variant `ApiKeyAuthFailed`). ⚠ 앱 이름 하이픈 불가(에러 표시 없이 404), URI는 앱 간 중복 등록 불가.
2. 새 키를 **URL 인코딩 형태로** env 등록(`+`/`/` 포함 — provider는 raw로 URL에 붙임).
3. provider fetch의 Referer를 dodo 도메인으로(gildongmu 하드코딩 상수를 이식 시 도메인 파라미터화).
4. **비화이트리스트 IP에서 referer 유/무 대조 실호출**로 검증 후 declaration 연결(화이트리스트 IP에서의 성공은 URI 증명이 아님).

폐기된 후보(기록 보존): 자택 프록시(가용성 종속) · Vercel 고정 IP(월 $100, 비용 하드 스톱) · ODsay 유료 플랜(비용 하드 스톱). 전부 불필요해짐.

### 7.2 무장애 여행 정보 403 — 해소 완료 (정정)

요청문의 "활용신청 대기 중, 403"은 stale. **2026-06-30 활용신청 자동승인 + prod 실호출 검증 완료**(서울도서관·덕수궁, PROGRESS.md). dodo 이식 시 같은 data.go.kr 계정 키를 쓰므로 재신청 불필요 — Phase D에서 dodo 환경 실호출 재확인만.

## 8. 실호출 머지 게이트 계획

dodo `scripts/verify-*.mjs` 패턴(Travelpayouts 4/4 PASS 선례)을 provider별로 동반한다 — **fixture green ≠ 실계약 검증**, 특히 이 스택은 envelope 이형·좌표계·필드 철자가 전부 실호출로만 드러났던 이력이 있다.

- Phase C/D의 각 provider마다 `scripts/verify-korea-<domain>.mjs` 1개: 실 키로 대표 케이스 2~3건(정상·빈결과·경계) 호출→불변식 assert(3-state 구분, 거리순, 완성문장 필드 존재). 머지 게이트.
- 채팅 통합 검증: trip-less "경복궁 근처 지하철 도착"류 시나리오를 dodo eval 레인(`npm run eval:fc`)에 추가 — 함수 선택 품질(한국 함수군이 열렸을 때 올바른 도구 호출) 측정.
- gildongmu에서 이미 검증된 지식(§1.1 함정 열)은 이식 시 **단위 테스트로 고정**(예: NCP ms→s, TM 좌표 변환 정본값, envelope 3형 fixture) — 실호출 게이트와 2-레인.

## 9. 접근성 인수 조건 (이식 후에도 유지 — 각 Phase 완료 판정 기준)

1. **3-state 불변식**: "0건/없음" ≠ "정보 없음(unknown)" ≠ "조회 실패"를 도구 데이터·카드·산문 모두에서 구분. 도착·진료·공기질·시설 전 도메인.
2. **낭독 정본은 완성 문장 필드**: `arvlMsg2`/`arrmsg1`을 슬롯형으로 재조립하지 않는다.
3. **한 줄 = 한 접근성 객체**: 이식 카드의 시각용 인라인 span 분절 금지 — `joinText` 헬퍼 동반 이식, 구분자 쉼표(가운뎃점 금지). 인터랙티브 요소는 합치지 않는다.
4. **단일 polite live region**: 카드 마운트·상태 통지는 dodo 채팅의 기존 단일 채널에 편입 — 카드별 live region 신설 금지. 이미 보이는 콘텐츠의 sr-only 복제 금지.
5. **도구가 준 필드만**: systemInstruction에 "장소 특징 날조 금지" 명시(gildongmu `place-prompts.ts` 문구 이식) — 시각장애 사용자는 날조를 검증할 수 없다.
6. **`remarkTightLists`** 역수입(loose list iOS VoiceOver 이중 낭독 방지).
7. Phase C·D 완료 시 `a11y-auditor` 관점 점검(과잉 ARIA 없이 위 항목 충족).

## 10. 이 문서의 지위와 다음 단계

- **spec-only.** 각 Phase 착수 시점에 이 spec을 입력으로 `writing-plans`를 돌려 dodo 저장소에서 단계별 plan을 만든 뒤 구현한다(수용측 체크리스트 §8-A/B 기준). Phase A는 dodo PROGRESS의 §5b 항목이 이미 착수 단위다.
- dodo측 대응 문서: `~/Mac-Projects/dodo-planet/docs/plans/2026-07-03-gildongmu-full-port-plan.md` (본 spec의 dodo 시점 요약+Phase 추적). 2026-06-13 계약 문서·PROGRESS.md 로드맵과 상호 참조.
- gildongmu는 이식 후에도 인큐베이터로 존속 — 신규 국내 API는 여기서 검증 후 같은 경로로 졸업.
