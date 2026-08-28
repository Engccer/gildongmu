# 길동무 설계 스펙

## 0. 프로젝트 정체성

네이버 전용이 아니라 **대한민국 로컬 서비스 API 전반의 연동 실험실**이다. 지도·내비게이션·장소·예약·관광 등 국내 서비스를 계속 발굴하고, 접근성 우선 미니멀 UI로 구현한다. 검증된 기능은 dodo-planet과 **양방향으로** 오간다(§5).

## 1. 문제 정의

한국의 지도/내비게이션 앱(네이버지도, 카카오맵)은 정보량이 많은 대신:
- 스크린 리더 사용자가 핵심 흐름(장소 검색 → 정보 확인 → 길찾기)을 완주하기 어렵고,
- 한국어 비사용자(외국인 여행자)에게는 UI가 과밀하다.

길동무는 **"검색 → 장소 정보 → 길찾기"의 흐름을** 접근성과 다국어를 1급으로 두고 다시 구현한다. 도보는 실시간 안내까지 자체 구현하고, 자동차 실주행은 딥링크로 위임한다. 풍부한 지도 경험은 목표가 아니다.

## 2. 측정 가능한 성과 (빌드 전 명명)

| 성과 | 측정 방법 |
|------|----------|
| 스크린 리더만으로 검색→길찾기 완주 | VoiceOver 수동 테스트 시나리오 통과 |
| 영어 UI 완결성 | 비-ko 로케일에 한글 잔존 0건(`i18n-messages.test.ts`). 예외는 자국어 표기 하나(`nav.korean` = "한국어")이며, 언어 메뉴가 각 언어를 자국어로 보여 주기 때문이다 |
| 키 없이도 개발·테스트가 성립 | 키 없이 `npm run build`·`npm run test:run` 통과(장소 검색만 mock 폴백, 나머지는 게이트로 미노출) |
| 길찾기 연결 정확도 | 딥링크 단위 테스트 + 실기기 nmap:// 검증 |

## 3. 데이터 소스 전략

최초 조사 전문: `research/RESEARCH-2026-06-naver-api-ecosystem.md`

**어떤 provider가 지금 어떤 기능을 담당하는지는 [`../CLAUDE.md`](../CLAUDE.md) 통합 카탈로그가 정본이다.** 이 절은 그 목록을 복제하지 않고, 소스 선택을 구속하는 설계 결정과 발굴 대장만 담는다.

**의도적 결정**: 지도 렌더링을 넣지 않는다. 지도 없이 완결되는 흐름이 먼저 완성되어야 "지도는 enhancement" 원칙이 구조적으로 보장된다. 네이버플레이스 공식 API가 없다는 것도 확정 사실이라, 장소 상세는 여러 공공·상용 소스를 우리가 합성한다.

### 실험 백로그 (국내 서비스 발굴 — 계속 추가)

> **아래 표는 조사한 국내 서비스의 대장(臺帳)이지 작업 목록이 아니다.** 실제로 진행할 항목은 `docs/BACKLOG.md`가 정본(2026-08-01 분리).

> **2026-06-14 대규모 확장 조사 완료** — 우편번호·시내버스·지하철·맛집·예약·접근성/여행 6개 도메인 심층 조사(deep-research 워크플로 102 에이전트 + 직접 검증 2라운드). 전문: `research/RESEARCH-2026-06-domestic-api-expansion.md`. 핵심: TAGO 버스 패밀리(최대 공백 메움)·전국도시철도역사정보표준데이터(외국인 정합 최강)·행안부 도로명주소 공식 API(ePost 대체)·KRIC 교통약자(접근성 차별화).

> **서울 데이터·가족 데이터 조사**: 서울 열린데이터광장(`research/RESEARCH-2026-06-seoul-open-data.md`) + 가족·육아 데이터(`../child-care/docs/research/RESEARCH-2026-06-seoul-family-data.md`). 가족 데이터 중 **'여행·외출 중 위치 기반' 항목만 길동무 대상**이다(행정성 지원금·입소대기는 child-care 전용). 판별: 좌표 근접 + 외출·여행 + 텍스트-우선.

> **2026-07-21 길찾기 강화 조사 완료**: 도보·실시간 교통·교통약자·자전거/택시 4축 병렬 조사. 전문: `research/RESEARCH-2026-07-routing-enhancement.md`(우선순위 로드맵·미확정 게이트 5건 포함). 핵심: 택시요금·ODsay 정류장 리스트(키 0 필드 투영)·Tmap 보행자 경로(한국어 완성 문장 턴바이턴)·ITS 돌발상황 브리핑(기보유 data.go.kr 키). 자전거 라우팅·점자블록 턴바이턴은 데이터 부재로 보류. 부수 확인 2건: 카카오 신규 경로 API 4종(무료 쿼터 "첫 활성화 앱" 정책 리스크)·네이버 Search API의 NAVER API Hub 이관(지역검색 2027-06-30 데드라인).

> **커버리지 계약**: 아래 표의 데이터 소스는 사실상 전부 대한민국 전용이다. 한국 밖 좌표는 오류가 아니라 200 `{"outOfCoverage":true}`로 답하고(술어 정본 `src/lib/coverage.ts` ↔ iOS Kit `Coverage.swift`), 이름 기반 기능(장소 검색·역 정보·목적지 길찾기·장소 앵커 채팅)은 전 세계 유효하다. 계약 상세는 `../CLAUDE.md` 횡단 함정과 `superpowers/specs/2026-07-29-coverage-contract-dictation-design.md`.

| 서비스/API | 도메인 | 상태 | 이식 가치(dodo-planet) |
|------------|--------|------|----------------------|
| 카카오 로컬 | 장소 검색 | **운영 중** — 카카오맵 활성화 + 실데이터 검증 완료 (2026-06-12) | 높음 — 장소 검색 코어 |
| 카카오 로컬 주소 API | 지오코딩/역지오코딩 | **운영 중 (2026-06-13)** — `/api/geocode`, `coordToAddress()`. 같은 키·같은 활성화로 동작. ⚠ 도로명 보장은 **3단 체인**(카카오 road → NCP 최근접 도로명 → 지번)이다. 카카오 coord2address는 도로명 건물이 매핑되지 않은 좌표(공터·블록 내부, GPS에서 흔하다)에서 `road_address`가 null이라 지번 우선으로 되돌리면 회귀 | 중상 — 출발지 주소 입력, 현위치 주소 낭독 |
| Tmap 자동차 경로(기본) + 카카오모빌리티 directions(폴백) | 자동차 경로 텍스트 브리핑 | **운영 중** — `/api/route/car`. ko 기본은 Tmap(`description`이 도로명을 포함한 완성 문장, 카카오 `guidance`는 도로명 없는 조각), 실패 시 카카오모빌리티 폴백. 낭독 문장은 `rewriteCarGuidance`가 다듬는다. 게이트 `hasCarRouteKey`(tmap∥kakao) | 높음 — "지도 없이 완결되는 경로"의 코어 |
| 네이버 지역 검색 | 장소 검색 | **운영 중 (2026-07-18 키 발급)** — ko에서 카카오와 병합(`searchPlacesMergedKo`: 카카오 15건 primary + 네이버 5건 보강을 뒤에 이어붙임, 재정렬 금지). 일 25,000회·결과 최대 5건. ⚠ NAVER API Hub 이관 데드라인 2027-06-30 | 중 — 카카오 보완(미등록 가게) |
| 카카오맵/네이버지도 딥링크 | 내비 연결 | **운영 중 (2026-06-13)** — `nmap://`·`kakaomap://`. 자체 구현은 텍스트 브리핑·도보 실시간 안내이고, 자동차 실주행은 여기로 위임한다 | 높음 — 길찾기 코어 |
| 한국관광공사 TourAPI 4.0 | 관광정보 (다국어) | **운영 중 (2026-06-13)** — en 로케일 자동 우선, 실응답·프로덕션 검증 완료. 개발계정 기능당 일 1,000건. 미소비 오퍼레이션: `locationBasedList2`(반경·dist·거리순)·`detailCommon2`(영문 overview 1,300자) | **높음** — 외국인 여행자 + dodo 여행 도메인 정합. 카카오·네이버의 다국어 공백을 메우는 유일한 공식 소스 |
| **도보 경로**(카카오 도보 기본 + Tmap 폴백) | 도보 길찾기 | **운영 중 (2026-07-22 Tmap 출시 → 2026-07-29 카카오 기본 전환)**: `kakao-walk`(기본, 기존 `KAKAO_REST_API_KEY`)와 `tmap-pedestrian`(카카오 throw 시에만 폴백)을 `walk-route.ts`가 합성, `/api/route/walk`+길찾기 뷰(웹)/길찾기 탭(iOS). 카카오 채택 근거는 동좌표 문체 대조에서 확인한 의미 단위 스텝·역사 내 이동·계단/지하보도 명시. **낭독 문장은 서버 `rewriteWalkGuidance`가 만든다**(2026-08-07 판정으로 종전 "provider 원문이 정본"을 대체, 소비자 재조합 금지). 경로 축은 추천·최단 2행(`variant`/`alternatives`), ⚠ **경로는 목적지까지 가지 않는다**(종점→목적지 오프셋 실측 16~89m = `finalApproach`). 계단 회피 모드(`accessible=true`→`stepFree` 3-state, 미적용 시 안전 문장을 서버가 삽입, 웹 토글), 횡단보도 스텝에 음향신호기 주석(seed 40m 대조, 병합 스텝은 침묵). V1 ko 전용, 게이트 `hasWalkRouteKey()`. 유료 전환 미신청이라 비용 상한 0원 | **높음**: dodo 이식 시 카카오 키는 공유, Tmap만 dodo용 appKey 발급 |
| NCP Directions 5/15 | 자동차 경로 (영문!) | **운영 중 (C1, 2026-06-17)** — `ncp-directions.ts` + `/api/route/car` lang 디스패치. `lang=en`+NCP 키면 NCP 영문 턴바이턴(`instructions`), 그 외 카카오 한국어 graceful 폴백. 두 provider 동일 `CarRouteBriefing` shape(컴포넌트 불변). ⚠ NCP `duration` 밀리초→초 변환(`normalizeNcpRoute`). 실호출 검증(en 14단계 영문·ko 8단계 한국어, durSec 단위 정합) | **높음** — dodo 외국인 시나리오의 영문 경로 정본 |
| NCP Geocoding/Reverse | 주소↔좌표 (영문 보완) | **운영 중 (폴백 역할)**: 영문주소는 juso가 정본이고 NCP는 그 폴백(`enrichEnglishAddresses` juso→NCP→한글), 역지오코딩에서는 도로명 3단 체인의 2단(`reverseRoadAddress`). ⚠ NCP `englishAddress`는 국가명을 포함하고, 영문 입력 질의는 미수용(0건) | 중상 — 영문 주소 표기·현위치 낭독 |
| 카카오톡 메시지(위치 템플릿) | 공유 | 조사됨 — `talk_message` 동의만으로 "나에게 보내기" 가능 | 중상 — 가족 공유 시나리오, dodo 카카오 로그인과 정합 |
| 상업 예약 (캐치테이블/네이버예약/야놀자) | 예약 | **재검증 완료 (2026-06-14) — 공개 API 여전히 전무** | 낮음 — 딥링크 링크아웃만 가능 |
| 카카오 T | 택시 | 조사됨 — 공개 호출 API 없음 | 낮음 — 앱 링크 수준 |
| **TAGO 버스 패밀리** (도착 15098530·정류소근접 15098534·노선 15098529) | 시내버스 | **운영 중 (2026-06-14)** — `tago-bus.ts`(경기·지방·부산) + `seoul-bus.ts`(TOPIS, 2026-06-24 병합)를 `src/lib/bus.ts`가 `allSettled` 병합(좌표 dedup·거리순·상위5). `DATA_GO_KR_API_KEY` 공유, 무료·개발 일 10,000건. 서울은 `arrmsg1` 완성문장이 낭독 정본이고 한 항목이 1·2번째 버스를 슬롯 페어로 준다. ⚠ 봉투가 TAGO와 달라(msgHeader/msgBody) 공용 파서 스코프 밖이고, **TAGO 근접 조회는 ~700m 고정 반경이라 0건 대부분이 미커버가 아니라 반경 밖**이다(판정 정본 `isUncoveredBusRegion`) | **높음** — "가까운 정류장→버스 도착 텍스트 안내"가 지도 없이 완결. 실시간이라 딥링크 대체 불가 |
| **전국도시철도역사정보표준데이터** (15013205) | 지하철 | **운영 중 (A3, 2026-06-17)** — `subway-stations.ts` + `/api/station/meta` + `StationMeta`. **OpenAPI 아닌 연간 XLSX로 판명**(국가철도공단 레일포털 `data.kric.go.kr`, 활용신청·키 게이트 없음) → **정적 seed 번들**(1,098역, `scripts/build-subway-stations.py`로 XLSX→JSON). 순수 조회 로직(정규화 매칭·Haversine 근접·노선 집계) + seed 바인딩, 서버 전용 import. 장소 상세가 역이면 영문역명·노선·환승 노출(en 영문 메인). 실호출 검증(강남·서울역·부산역·대전 전국 커버·고속터미널 환승). 16개 단위 테스트 | **높음** — 좌표+영문 동시 충족 유일 데이터셋. A1/A2 받침대 + 외국인 정합 실현 |
| **행안부 도로명주소 API** (검색 API, business.juso.go.kr) | 우편번호/주소 | **운영 중 (C2, 2026-06-19)** — `JUSO_CONFM_KEY` 하나로 영문주소+우편번호를 모두 커버(무료·무제한). en 카드 영문주소의 정본(NCP는 폴백)이자 주소·우편번호 검색 진입점(`searchJusoAddresses` + `/api/address/search`, 좌표는 카카오 `/api/geocode` 재사용). ⚠ 음성 전사의 후행 마침표에 **0건으로 전멸**하므로 소비 전 `normalizeVoiceQuery` 필수. 설계 `docs/superpowers/{specs,plans}/2026-06-19-juso-official-address*` | **중상** — ePost 비공식 웹폼·NCP `englishAddress`(국가명 포함) 대체. 공식 영문주소 정본화 |
| **KRIC 교통약자 이동경로** (transferMovement·stationMovement) | 접근성/철도 | **동결**: 2026-06-14 가입 후 수동 승인이 오지 않았고, 그사이 코레일 편의시설·서교공 wksn·엘리베이터·음성유도기 4겹이 같은 필요를 채웠다(`docs/BACKLOG.md` 폐기·보류 목록). 승인 통보가 오면 재평가. 엔드포인트 1차 확정: `openapi.kric.go.kr/openapi/vulnerableUserInfo/transferMovement`·`/handicapped/stationMovement`, 무료·무제한·단일키, 역식별 railOprIsttCd+lnCd+stinCd | 중: 4겹 충족 이후로 차별화 폭이 줄었다 |
| **한국철도공사 편의시설정보** (data.go.kr 15125774) | 접근성/철도 | **운영 중 (UI 통합, 2026-06-14)** — `src/lib/providers/korail-facilities.ts` + `/api/station/facilities` + `StationFacilities` 컴포넌트로 장소 상세에 노출. `/weekPersonFacilities`(교통약자: 장애인화장실 `pwdbs_tolt_estnc`·경사로 `pwdbs_slwy_estnc`·휠체어리프트 `whlch_liftt_cnt`) + `/stationFacilities`(엘리베이터 `elevt_cnt`)를 **`stn_cd` 조인**. API가 역명 필터를 무시해 406역 전체를 받아 `normalizeStationName` 클라이언트 매칭(일 1회 revalidate). 정본 정확성: "0대"≠"정보 없음"(`num→number\|undefined`), 주 fetch 장애는 502(미커버 null과 구분). 도시철도(지하철) 미포함 → graceful degrade. `DATA_GO_KR_API_KEY`(=`TOUR_API_KEY`), 프로덕션 env 등록 완료 | **높음** — KRIC 가입 없이 data.go.kr로 확보한 역 교통약자 시설 정본 |
| **무장애 안내 보조 데이터** (서울 키오스크 점자·음성 XLSX id=985 / 승강기안전공단 실시간 15070652) | 접근성/철도 | **조사됨 (3라운드)** — 점자·음성 특화필드는 서울 키오스크 정적파일에만. 실시간 승강기는 승강기안전공단(건물단위→역 매핑 필요)·서울 후속. KRIC 환각 엔드포인트 2종 반증(코드 금지). 빠른하차(15143840)는 전용 행 참조 | **높음** — 편의시설(15125774, 발급완료)과 3층 스택 구성. seed+조회+실시간 조합 |
| KORAIL/TAGO 열차 운행정보 (15125762 / 15098552) | 철도 | **검증 완료 (2026-06-14, 3-0)** — 무료·개발 10,000건. 둘 중 택1 | 중 — KTX/SRT 딥링크와 별개 "운행현황 텍스트 안내" |
| 공공시설 예약 (서울 OA-2271·인천 15085804) | 예약 | **신규 발견 (2026-06-14)** — 체육·문화·진료·공간대관 예약 오픈데이터. 링크아웃형(yeyak.seoul.go.kr) | 중 — 상업 예약과 달리 공공시설은 열림 |
| TourAPI 음식점 콘텐츠 (영문 contenttype 82) | 맛집 | **확인 (2026-06-14)** — "신규 영문 맛집 소스"는 곧 보유한 TourAPI English였음. 신규 키 불필요 | 중 — en 음식 카드 보강(기존 provider 확장) |
| 무장애여행(15134352)·공중화장실(15012892)·전기차충전소·심평원 병원약국 | 접근성/여행 보강 | **조사됨 (2026-06-14)** — 모두 무료 data.go.kr/열린데이터. 미착수 | 중하 — 선택적. 무장애·공중화장실은 접근성 정합 |
| **장소 영업시간·"지금 영업 중"** | 맛집/장소 | **조사 완료 (2026-08-24, 보강 2026-08-28) — 국내 공식 소스 전무.** 카카오·네이버·Tmap POI·Apple Maps는 필터는커녕 필드 자체가 없고, 공공데이터의 "영업상태"는 인허가 상태다. 필터 파라미터는 Google Places (New) `openNow`와 Foursquare `open_now` 둘뿐(⚠ 후자는 영업시간 미보유 장소를 결과에서 빼 3-state 위반). 무료 소스 3종은 실측 탈락 — TourAPI `opentimefood`는 채움률 100%(표본 40)인데 전국 등록이 음식점 13,498건뿐이고 값이 자연어, OSM `opening_hours`는 91,248곳 중 3,024곳(3.3%), Overture places는 영업시간 필드 자체가 스키마에 없다. 해외 provider 중 TomTom은 필터가 있으나 한국 좌표 표시 금지·한국 밖 캐시 금지 조항으로 탈락, HERE·Mapbox는 필드 보유·한국 채움률 미판정. **실호출 게이트 실행(2026-08-28)** — 구글 자체 표본 채움률 82.7%(428곳)이나 카카오 장소를 되찾아 영업시간까지 도달하는 비율은 모집단의 함수다 — 균일 무작위 33%, **검색 결과 상위(실사용 근사) 61.3%**. 배달 업종은 거의 0, 착석 업종은 85~100%. `openNow`는 주간 시간표의 결정론적 함수라 캐시 후 자체 계산 가능(354/354 일치). 영업시간 필드는 Enterprise SKU 월 1,000회 무료. 남은 축은 정확도 육안 대조. 착수 판정은 `docs/BACKLOG.md` E24 | 낮음 — 국내 소스가 없어 이식할 것이 없다 |
| 맛집 검색 코어 | 맛집 | **결론 (2026-06-14)** — 카카오 로컬(보유) 능가 신규 소스 없음. localdata 인허가는 검증용 보조 | — 카카오 유지 |
| **서울 지하철 실시간 도착** (A2, data.seoul.go.kr OA-12764) | 지하철 | **운영 중 (2026-06-17)** — `seoul-subway-arrival.ts` + `/api/station/subway-arrival` + `SeoulSubwayArrival`. 차단이던 **실시간 데이터 인증키 발급 완료**(데이터셋 OA-12764 → "인증키 신청 (지하철)", 일반키와 별도 계열 — 일반키는 `ERROR-338`). `SEOUL_SUBWAY_REALTIME_KEY`(즉시 발급·일 1,000회/키·갤러리 등록 시 무제한). `http://swopenapi.seoul.go.kr/api/subway/{KEY}/json/realtimeStationArrival/0/20/{역명}`. **응답 envelope가 정상/에러에서 다름**(정상 `errorMessage.code` 중첩 / 데이터없음 `INFO-200` 최상위 code) → `resultCode()`가 두 위치 모두 읽음. INFO-000 파싱·그외 코드/HTTP실패→throw→502(seoul-metro-facilities 정책 동형). ⚠ **`INFO-200`은 '운행 시간 밖'과 '실시간 미제공 역'이 공유하는 코드다**: 미커버로만 읽고 역을 숨기면 심야에 근접역이 전부 사라지므로, 역은 어떤 상태에서도 목록에 남기고 4-state(`ok`/`unavailable`/`closed`+`firstTime`/`unknown`)로 가른다(상세 계약 `INTEGRATIONS.md` §서울 지하철 실시간). `arvlMsg2`(완성 한국어 도착 문장 — 낭독 정본)·`barvlDt`(초)·`bstatnNm`(종착)·`subwayId`→노선명 매핑·`updnLine`·`btrainSttus`(급행). 실시간이라 no-store + force-dynamic, 컴포넌트는 BusArrivals 동형(수동 새로고침+조회시각). `canShowSubway` 게이트(키 없으면 버튼 미노출). 역 식별은 A3 seed가 받침대. 실호출 검증(강남 2호선+신분당선·서울역 1·4·경의중앙·공항철도·부산/없는역 null). **+ 내 주변 진입점(2026-06-17)**: `subway-nearby.ts` + `/api/station/subway-arrival/nearby` + `SubwayArrivalsNearby`("내 주변" 허브의 한 패널). 역명 기반이라 좌표를 직접 못 써 A3 seed `findStationsNear`(1km·상위 3역)로 근접역 식별 후 역별 실시간 `Promise.allSettled` 합성. 부분 실패는 역별 `arrivalStatus`(BusStop 동형, "조회 실패"≠"열차 없음"), 전부 실패만 502. 순수 `buildNearbyArrivals`/합성 `fetchNearbySubwayArrivals` 분리·`SubwayArrivalList` 상세 공유. 실호출 검증(강남 좌표→강남 31m·신논현·역삼 실시간, 부산→빈배열, 범위밖→400). 정본 plan `docs/superpowers/plans/2026-06-17-seoul-subway-realtime.md` | **높음** — 역 상세 "다음 열차 N분/현재 위치" 텍스트 + "내 주변" 허브. 도시철도 공백 메움 |
| **역 첫차·막차 시간표** (TAGO SubwayInfo 15098554 + 특일정보 15012690) | 지하철 | **운영 중**: `tago-subway.ts` + `/api/station/timetable`. 전국 도시철도역의 첫·막차. ⚠ **00시대 심야열차가 배열 앞**이라 03:00 경계로 서비스데이 +24h 보정이 필요하고(요일 타입도 KST-3h 기준), 당역종착·포함검색 오탐은 코드가 거른다. 공휴일 보정은 특일정보 게이트형(미신청·실패 시 요일 폴백 + 기준 라벨 명시) | 중상: "지금 가면 탈 수 있나"를 텍스트로 |
| **지하철 빠른하차 출입문** (서울교통공사 data.go.kr 15143840, `B553766/inout/getFstExit`) | 접근성/지하철 | **운영 중 (E5, 2026-08-08)** — 정적 seed `src/lib/data/subway-quick-exit.json`(1,806행·276역·542방향) + 판정 `src/lib/quick-exit.ts` + `TransitLeg.quickExit`. 하차역·방향별로 **계단·엘리베이터에 가장 가까운 칸·문**을 승차 전에 알려, 내린 뒤 승강장을 흰지팡이로 훑는 탐색을 없앤다. 별도 라우트 없이 대중교통 경로에 실린다(웹 브리핑·안내 세션 대기·CLI·iOS 4소비자). ⚠ **이 엔드포인트만 `dataType=json`**(다른 provider 9종의 `_type=json`은 무시되고 XML이 오는데 `resultCode 00`에 실데이터가 실려 키 문제로 오진하기 쉽다). ⚠ `crtrYmd` 전 행 `20241231`인 **연 1회 스냅숏**이라 런타임 호출 0(공유 쿼터 소비 없음). 갱신은 `scripts/build-subway-quick-exit.mjs`(가드 11종). 에스컬레이터는 위원장 판정으로 제외(진입 타이밍 판단이 흰지팡이 사용자에게 선택지가 아니다). 방향은 직전역으로 긍정 확정하고 분기·급행·미확정은 침묵. 거리는 **열차 선형 위치**(`(칸−1)×4+문`)로 재고 엘베×계단 **쌍**을 최적화한다(각자 최저면 같은 칸 근처가 55%인데 쌍이면 91%). 설계 `docs/superpowers/specs/2026-08-08-subway-quick-exit-design.md`(codex 적대적 리뷰 24건 + 구현 중 실측 정정 5건 + 독립 리뷰 2종 반영). 실호출 게이트 7종 통과, ⏳ 위원장 실승차 판정 대기(`docs/BACKLOG.md` §2) | **높음** — 시각장애인 1급 정합. dodo도 ODsay 대중교통을 쓰므로 그대로 얹힌다 |
| **서울 지하철역 교통약자 시설** (서울교통공사 data.go.kr 15143843, `B553766/wksn`) | 접근성/지하철 | **운영 중 (2026-06-17)** — `seoul-metro-facilities.ts` + `/api/station/metro-facilities` + `SeoulMetroFacilities`. 코레일 편의시설의 **서울 1~8호선 공백 보완**. 9 오퍼레이션(엘리베이터·에스컬레이터·휠체어리프트·무빙워크·휠체어급속충전기·안전발판·수어영상전화기·도우미·장애인화장실), 위치·층·가동현황 인스턴스 목록(카운트 아님). 코레일과 동형(공용 봉투 파서 `readItems` 재사용·`DATA_GO_KR_API_KEY` 공유·장애 throw→502). `stnNm` 포함필터+`normalizeStationName` 정확매칭(강동구청 제외), `oprtngSitu` M=정상/그외=점검 보수매핑, `totalCount>300` throw. 실호출 검증(강동 4종·신도림 18·서울역 23·없는역 null). 서울 포털 OA-22xxx(시설별 9종 개별)보다 data.go.kr 단일 통합 API 채택(view 버그 회피). 정본 plan `docs/superpowers/plans/2026-06-17-seoul-metro-facilities.md` | **높음** — 시각장애인 1급 정합. 도시철도 무장애 동선 |
| **역 보강 2종** (서울 음성유도기 OA-22526 정적 seed / 서울 엘리베이터 OA-21212 `tbTraficElvtr`) | 접근성/지하철 | **운영 중 (2026-07-22)**: 위 wksn 통합 API가 못 채우는 두 축. 음성유도기는 CSV(cp949) → `build-voice-guides.py` seed(1~8호선 211역), 엘리베이터는 **wksn에 엘베가 없을 때만** 폴백해 9호선·우이신설을 커버한다(최근접 seed 좌표 기준 방위·거리 ko 합성). 보강 실패는 `supplementFailed`로 표기해 숨기지 않는다 | **높음**: 시각장애인 1급 정합 |
| **무장애 여행 정보** (한국관광공사 KorWithService2, data.go.kr 15101897) | 접근성/관광 | **운영 중 (2026-06-30)** — `tour-barrier-free.ts` provider + route 3종(nearby·detail·match) + `BarrierFreeNearby`(편의시설 펼침) + `BarrierFreeInfo`(장소상세 자동등장 region) + 채팅 도구 `get_nearby_barrier_free` 5계층. 좌표50m∩이름 매칭(코드 거리 가드)·편의시설 화이트리스트 라벨링(⚠ 철자 실호출 확정)·게이트/인증 `DATA_GO_KR_API_KEY` 일치(split-brain 금지). ⚠ **data.go.kr은 API별 활용신청이 독립**이라 이 서비스만 따로 승인이 필요했다(신청 전 403). 정본 `docs/superpowers/plans/2026-06-30-barrier-free-travel.md` | **높음** — 시각장애·교통약자 1급 정합, dodo 여행 도메인 직행 |
| **근처 소아 야간·휴일 진료** (달빛어린이병원 NMC 15000736) | 가족/의료 | **운영 중 (B1, 2026-06-17)** — `night-clinic.ts` + `/api/clinic/nearby` + `NightClinicsNearby`("내 주변" 허브 패널). NMC `getBabyListInfoInqire`(달빛·소아전문센터, 좌표+요일별 진료시간+전화), 전국 152개 일괄→Haversine 20km→진료중 우선 상위10. ⚠ **HIRA 15001674는 좌표 없음**으로 판명(실호출)→NMC 달빛 목록이 정본. 진료상태 3-state(open/closed/unknown, KST 요일·시각), 공휴일 자동판정(2026-07-26 활성화). mock 없음(의료-실데이터). 단위테스트 동반. 설계 `docs/superpowers/specs/2026-06-17-nearby-night-clinic-design.md`. 실호출 검증(강동 길동 5곳 거리순). **2026-07-26 보강**: 진료중 우선 정렬(`prioritizeOpen`)+상위 10+절단 노출(`total`)+공휴일 판정(특일정보 `fetchIsHoliday` 재사용, `basis` 라벨)+채팅 도구에 `openStatus` 주입(LLM 추론 날조 차단). **커버리지 확장 완료(2026-07-26)**: 달빛 지정 명부(20km)만으로는 미지정 소아과가 통째로 빠져 일반 소아청소년과 보완 소스(`QD=D002`·3km)를 병합한다(`src/lib/clinics.ts`, 설계 `docs/superpowers/specs/2026-07-26-clinic-coverage-expansion-design.md`) | **높음** — 여행 중 아이 아플 때 안전망. dodo-planet 가족 여행 핵심 |
| **이 지역 공기질** (에어코리아 15073877 근접측정소 + 15073861 측정소 실시간) | 가족/환경 | **운영 중 (B2, 2026-06-17)** — `air-quality.ts` + `/api/air-quality/nearby` + `AirQuality`(장소 상세 enrich). 2-call: `getNearbyMsrstnList`(첫=최근접) → `getMsrstnAcctoRltmMesureDnsty`(측정소명 단건). KHAI·PM10·PM2.5 등급(낭독 정본)+수치. ⚠ **WGS84→TM EPSG:2097(Bessel) proj4 변환**(카카오 5181 아님, 정본값 대조 확정). ⚠ 에어코리아 envelope는 `body.items`가 **직접 배열**(다른 data.go.kr `items.item`과 다름). 3-state Flag→unknown(측정 장애 숫자 노출 금지), khai는 공식 통합지수라 Flag 독립. tago-bus 동형 방어(URLSearchParams·text+JSON.parse·인증 XML→throw). mock 없음(키없음→null·미커버 graceful·장애 502). 20개 단위테스트. 설계 `docs/superpowers/specs/2026-06-17-air-quality-design.md`. 실호출 검증(강동 길동→천호대로 0.5km·부산→전포동·범위밖 400) | **높음** — dodo 일정 추천과 연결. 시각장애인에게도 이동 판단 정보 |
| **이 지역 날씨** (기상청 단기예보) | 가족/환경 | **운영 중**: `weather.ts`가 공기질과 함께 `LocalConditions`를 구성한다(두 fetch 독립 `allSettled`). ⚠ 좌표는 **격자 nx,ny LCC 변환**(`dfs_xy_conv` 직접 이식)이라 공기질의 TM 변환과 다른 계열이다 | 중상: 이동 판단 정보 |
| **근처 아이 놀 곳 — 키즈 장소** (카카오 로컬 좌표 근접) | 가족/장소 | **운영 중 (B3, 2026-06-18)** — `kids-places.ts` + `/api/places/kids` + `KidsPlacesNearby`("내 주변" 허브 패널). 신규 API·게이트 없음(기존 `KAKAO_REST_API_KEY`). 키워드 3종(키즈카페·놀이터·어린이공원) 좌표 근접 `Promise.allSettled` 병렬→dedupe·거리순·상위8. ⚠ **데이터 현실(실호출 규명): 키워드 매칭 ≠ 키즈 장소** — "놀이터" 검색에 스킨스쿠버·노인복지시설·동우회·방탈출카페·당구장이 섞여 나옴. 시각장애인은 노이즈를 못 거르므로 **category_name 계층 화이트리스트**(`classifyKidsPlace`: 유아>놀이시설·놀이교육·공원+이름신호)가 정본. 실내/실외 3-state(놀이터 모호→이름 신호 없으면 unknown, 잘못된 단정 금지). 부분 실패 불변식(일부 키워드 실패해도 보존, 전부 실패만 502). 전화 `tel:` 링크(키즈카페 예약)+카카오맵 링크. 33개 단위테스트. code-reviewer 5건 검토(놀이교육 계층 앵커링·전화링크 2건 수정, 캐시주석·park 테스트 2건 보강, role=status 중복은 형제 동형 보류). 설계 `docs/superpowers/specs/2026-06-18-kids-places-design.md`. 실호출 검증(강동 길동 8건 노이즈 0·부산 서면·범위밖 400) | **높음** — 가족 여행 목적지 발굴. dodo 본질 |
| **근처 문화행사** (서울 문화행사 OA-15486) | 문화 | **운영 중**: `seoul-culture-events.ts` → `culture-events.ts` + `/api/events/nearby`. 오늘 진행 중인 행사를 반경 3km로. ⚠ `DATE` 파라미터는 문자열 부분일치라 쓰지 않고 `STRTDATE`/`END_DATE`로 코드가 판정한다. 안전한 페이지 절단선이 없어 전수 20페이지를 일자 키 `unstable_cache`(6h)로 감싼다. 이용대상(영유아) 필터·도서관(15013109)은 미착수 | 중상: 여행 중 즉흥 활동 |
| **실시간 인구 혼잡도** (서울 `citydata_ppltn`) | 생활 정보 | **운영 중**: `seoul-congestion.ts` + 순수 판정 `congestion-area.ts` + `/api/congestion/nearby`. 서울 116개 영역 seed. ⚠ **중심-반경 원으로 판정하지 않는다**(영역 모양이 제각각): 최근접 구성 지점 ≤300m, 중첩 시 중심 최근접 1개. 캐시는 좌표가 아니라 **영역 코드** 단위 5분이고 `area:null`은 오류가 아니다(서울의 91%) | 중: "지금 그 앞이 붐비나" |
| **보행 인프라** (서울 음향신호기 OA-15543 정적 seed + OSM 보행 노드 정적 seed) | 접근성/보행 | **운영 중 (2026-07-22, 2026-08-16 OSM 축 seed 전환)**: `walk-infra.ts`가 음향신호기 seed(EPSG:5186, golden 가드)와 OSM 횡단보도·점자블록 노드(전국 79,575 정적 seed, 종전 Overpass 실시간 호출을 E12에서 대체 — 429·504가 원인째 소멸, 조회 1.4~3.9초 → 4~8ms)를 합성, `/api/walk/nearby` + 채팅 도구. 상태는 discriminated union(0건 ≠ 제공 지역 밖 ≠ 조회 실패)이고 "등록 ≠ 작동" 각주를 단다. 제공 지역 판정은 사각형이 아니라 seed의 국경 폴리곤. 후속 후보: 무신호 횡단 안내·OSM way/area·음향신호기 전국(경찰청) 확장 | **높음**: 시각장애인 1급 정합 |
| **음향신호기 앱 조작** (경찰청 규격서 BLE 공용 프로토콜) | 접근성/보행 | **조사 완료·미착수 (2026-08-16)** — 서버형 API는 없고 「시각장애인용 음향신호기 규격서」(2022.4.27) `Ⅶ. 부가장치`가 **공개 BLE 공용 프로토콜**을 담는다: 이름 `AHG001+<MAC>+`로 검색, UART service `0003cdd0-…`에 3바이트(`0x31 0x00 0x01` 위치안내 / `0x02` 신호안내 / `0x03` 설치 위치 음성안내), 수신기 ACK/NAK 응답. 규격이 앱에 검색·유도·신호버튼 3기능을 **필수로 요구**한다. ⚠ **BLE는 선택 설치라 보급률이 미지**이고(서울 상한 실측: 2021년 이후 설치·교체 46.2%), ⚠ **웹 원천 불가·iOS 네이티브 전용**(Safari에 Web Bluetooth 없음). 착수 게이트는 `AHG001` 스캔 실측 1건. 조사 `research/RESEARCH-2026-08-16-audio-signal-ble-control.md`, 작업 큐 `BACKLOG.md` E20 | **중**: dodo는 보행 안내 도메인이 아니라 낮음. 길동무 1급 정합 |
| 따릉이 실시간 (data.seoul.go.kr OA-15493) | 공유 이동 | **운영 중 (2026-06-16)** — `seoul-bike.ts`+`/api/bike/nearby`+`BikeStations`. 전체(~2,720) 페이지 루프→Haversine 정렬→1km cap→상위 5, 60초 캐시. 장소 상세·"내 주변" 허브(`canShowBike` 게이트). 실호출 검증(길동 5건). 설계 `docs/superpowers/specs/2026-06-16-seoul-bike-design.md` | 중 — 이동 옵션 확장 |
| **대중교통 길찾기** (ODsay LAB `searchPubTransPathT`) | 경로 | **운영 중 (2026-06-18)** — 무료 일 1,000건·한국어 전용(영문 유료). `odsay.ts`+`/api/route/transit`+`TransitRouteBriefing`. 출발→도착 버스+지하철 환승 텍스트 브리핑("출발 전 미리 듣기", 자동차 브리핑 동형 — **딥링크 위임 원칙을 자체 텍스트로 확장**). 현재위치 기본 + "출발지 바꾸기" 인라인 검색(`/api/places` 재사용), 추천 1개 + 대안 펼치기. ODsay `path/subPath`→자체 `TransitRoute` 정규화(종속 격리). 실호출 확정: `trafficType` 1=지하철/2=버스/3=도보·지하철 `lane.name`·버스 `lane.busNo`·`totalTime`/`sectionTime`=분·`payment`=원. **환승 도보(`distance:0,sectionTime>0`)는 leg 제외·`walkMinutes`는 전체 도보 합**. 3-state(error `-98`=출도착 700m이내=경로없음 null·그외 throw→502, 순수 `normalizeOdsayRoute` 단일화). en은 t.rich `<line>/<from>/<name>` 태그로 **고유명만 `lang=ko`**(구조 영문). `canShowTransit`(`hasOdsayKey()`) 게이트·mock 없음·`revalidate:3600`. 8 단위테스트 + 라우트 3-state 실검증. ⚠ **apiKey는 발급 시점 플랫폼에 묶인다**: Server 방식 키는 공인 IP 화이트리스트라 Vercel 가변 IP에서 못 쓰고, **URI(Referer) 전용 앱 키**로 프로덕션을 열었다(2026-07-04). ⚠ ODsay는 출발 시각을 반영하지 않아 운행시간을 조인해 강등하며, **정규화(전체) → 강등(전체) → 선정(5) → 축 라벨** 순서가 계약이다. 설계 `docs/superpowers/specs/2026-06-18-odsay-transit-routing-design.md`·상세 계약 `INTEGRATIONS.md` §대중교통 | **높음** — 딥링크 위임뿐이던 대중교통을 자체 텍스트 경로로 메움. dodo 외국인·시각장애인 이동 코어 |

## 4. 접근성 설계

**기준 정본은 글로벌 접근성 헌장이고, 이 저장소의 구현 디테일은 [`../CLAUDE.md`](../CLAUDE.md) "절대 원칙: 접근성"이다.** 여기엔 설계 층위의 약속만 둔다.

- **정보의 정본은 리스트·텍스트다.** 지도에만 존재하는 정보가 있으면 그것은 버그다.
- 접근성은 "더 많은 ARIA"가 아니라 **올바른 시맨틱**이다. WCAG 실질 요구(키보드 도달·접근 가능한 이름·`:focus-visible`·단일 polite live region·터치 타깃 44px·`prefers-reduced-motion`)는 100% 지키고, 과잉 ARIA는 탐색을 방해하므로 넣지 않는다.
- **한 줄 = 한 접근성 객체.** 시각 스타일용 인라인 `<span>`으로 한 줄을 쪼개지 않는다(`joinText`로 합친다). 인터랙티브 요소는 반대로 절대 합치지 않는다.
- **3-state를 뭉개지 않는다**(0건 ≠ 정보 없음 ≠ 조회 실패, + 서비스 지역 밖).
- 발견 경로가 판단 기준이다: 버튼으로 펼치는 패널은 `<div>`, 조용히 자동 등장하는 섹션은 region 랜드마크와 heading이 유일한 발견 수단이라 유지한다.

## 5. dodo-planet과의 관계

길동무는 **독자 배포·독립 운영되는 앱**(웹 + iOS App Store + npm CLI/MCP)이고, dodo-planet(가족 여행 가이드 PWA)과는 **상호 보완적인 두 독립 프로젝트**다. 검증된 기능의 이식은 **양방향**으로 일어난다. ⚠ "dodo-planet 통합이 최종 목표"라는 부트스트랩 시점의 전제는 폐기됐다(되살리지 말 것).

- **이식 원장은 `~/Mac-Projects/PORTS.md`**(양쪽 repo 공용). 절차 정본은 `cross-port` 스킬.
- 그래도 **스택·컨벤션은 dodo-planet과 일치**시켜 둔다(next-intl 4 / zod 4 / Vitest 4 / App Router / proxy.ts). 양방향 이식의 비용이 그만큼 낮아진다.
- **`src/lib/`는 React·Next 비의존으로 유지**한다. 이것이 이식성의 실제 근거다.
- 수용측 코드베이스 지도는 `research/RESEARCH-2026-07-dodo-planet-target-architecture.md`(라인 번호보다 파일 경로·구조를 정본으로).

## 6. 미해결 항목

**정본은 `docs/BACKLOG.md`다.** 여기에 목록을 두지 않는다 — 두 곳에 적으면 어느 쪽이 참인지 판정할 수 없게 된다.
