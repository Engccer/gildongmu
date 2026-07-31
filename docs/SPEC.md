# 길동무 설계 스펙 (v0)

작성: 2026-06-12 (프로젝트 부트스트랩 시점) | 개정: 2026-06-12 (국내 서비스 연동 실험실로 정체성 확장)

## 0. 프로젝트 정체성 (2026-06-12 개정)

네이버 전용이 아니라 **대한민국 로컬 서비스 API 전반의 연동 실험실**이다. 지도·내비게이션·장소·예약·관광 등 dodo-planet에 통합할 가치가 있는 국내 서비스를 계속 발굴하고, 접근성 우선 미니멀 UI로 실험적으로 구현해 본다. 검증된 것만 dodo-planet으로 졸업시킨다.

## 1. 문제 정의

한국의 지도/내비게이션 앱(네이버지도, 카카오맵)은 정보량이 많은 대신:
- 스크린 리더 사용자가 핵심 흐름(장소 검색 → 정보 확인 → 길찾기)을 완주하기 어렵고,
- 한국어 비사용자(외국인 여행자)에게는 UI가 과밀하다.

길동무는 **"검색 → 장소 정보 → 길찾기 연결"의 최소 흐름만을** 접근성과 다국어를 1급으로 두고 다시 구현한다. 풍부한 지도 경험은 목표가 아니다 — 그건 네이버지도/카카오맵 앱에 위임한다.

## 2. 측정 가능한 성과 (빌드 전 명명)

| 성과 | 측정 방법 |
|------|----------|
| 스크린 리더만으로 검색→길찾기 완주 | VoiceOver 수동 테스트 시나리오 통과 |
| 영어 UI 완결성 | en 로케일에서 한국어 잔존 문자열 0건 |
| 키 없는 환경에서 전체 흐름 동작 | mock 모드 E2E (CI에서 키 없이 빌드+테스트 통과) |
| 길찾기 연결 정확도 | 딥링크 단위 테스트 + 실기기 nmap:// 검증 |

## 3. 데이터 소스 전략 (2026-06 조사 기반)

조사 전문: `RESEARCH-2026-06-naver-api-ecosystem.md`

| 기능 | v0 (현재) | v1 후보 | 비고 |
|------|-----------|---------|------|
| 장소 검색 | mock → **카카오 로컬(우선)** → 네이버 지역 검색. **en 로케일은 TourAPI 우선** (키 대기) | — | 카카오 15건 vs 네이버 5건. `PLACES_PROVIDER`로 A/B |
| 장소 상세 | 카카오 place_url 링크 위임 | — | 네이버플레이스 공식 API 없음 (확정) |
| 주소↔좌표 | **구현 완료 (2026-06-13)** — 카카오 로컬 주소 API (`/api/geocode`, `coordToAddress`) | NCP Geocoding 병행 검토 | 실호출 검증됨. 결제수단 불필요 |
| 지도 표시 | 없음 (리스트만) | NCP Dynamic Map 또는 Kakao Maps SDK | enhancement 레이어로만 |
| 자동차 경로 | nmap:// + kakaomap:// 딥링크 + **카카오모빌리티 텍스트 브리핑 (`/api/route/car`, 2026-06-13)** | NCP Directions 병행 검토 | guides[].guidance가 완성된 한국어 안내문 — 낭독 정본으로 그대로 사용 |
| 도보/대중교통 | nmap:// + kakaomap:// 딥링크 | TMAP 보행자 / ODsay 검토 | NCP·카카오내비 모두 자동차 전용 |

**의도적 결정**: v0에서 지도 렌더링을 아예 넣지 않는다. 지도 없이 완결되는 흐름을 먼저 완성해야 "지도는 enhancement" 원칙이 구조적으로 보장된다.

### 실험 백로그 (국내 서비스 발굴 — 계속 추가)

> **아래 표는 조사한 국내 서비스의 대장(臺帳)이지 작업 목록이 아니다.** 실제로 진행할 항목은 `docs/BACKLOG.md`가 정본(2026-08-01 분리).

> **2026-06-14 대규모 확장 조사 완료** — 우편번호·시내버스·지하철·맛집·예약·접근성/여행 6개 도메인 심층 조사(deep-research 워크플로 102 에이전트 + 직접 검증 2라운드). 전문: `RESEARCH-2026-06-domestic-api-expansion.md`. 핵심: TAGO 버스 패밀리(최대 공백 메움)·전국도시철도역사정보표준데이터(외국인 정합 최강)·행안부 도로명주소 공식 API(ePost 대체)·KRIC 교통약자(접근성 차별화).

> **2026-06-14 v2 UI 개편 출시** — 단일 검색창 → 결과(카테고리 칩 필터) → **장소 상세**(같은 페이지 뷰 전환 + History API, 백버튼 복귀·포커스 이동) 흐름으로 재편. ko/en 로케일별 단일 언어 페이지 + 언어 전환기(경로·`?q=`·쿠키 보존). 상세 화면에 길찾기 딥링크·자동차 경로 브리핑과 함께 **역 교통약자 편의시설**(철도공사 15125774)을 첫 노출. 설계/계획: `superpowers/specs/2026-06-14-gildongmu-v2-upgrade-design.md`·`superpowers/plans/2026-06-14-gildongmu-v2.md`. 채팅 인터페이스는 다음 패스(같은 검색 축에 얹을 구조 유지).

> **2026-06-14 v2.1 음성 받아쓰기 + PWA 출시** — 검색창에 **음성 받아쓰기**(dodo-planet Deepgram Nova-2 서버 STT 수입, 탭-토글 녹음→전사→자동검색, 언어 자동감지, aria-live 통지). **PWA**(manifest·아이콘·수제 서비스워커—Serwist가 Next 16 Turbopack 미지원이라 폴백—설치·앱셸·로케일별 오프라인 폴백, API/검색 비캐시). 설계/계획: `superpowers/specs/2026-06-14-gildongmu-v2.1-voice-pwa-design.md`·`superpowers/plans/2026-06-14-gildongmu-v2.1-voice-pwa.md`.

> **2026-06-16 서울 데이터 + 가족→dodo-planet 다리 조사** — 서울 열린데이터광장 심층 조사(`RESEARCH-2026-06-seoul-open-data.md`) + 가족/육아 데이터 조사(`../child-care/docs/RESEARCH-2026-06-seoul-family-data.md`). 핵심: 서울 시내버스(연동 중, plan 문서)·**서울 지하철 실시간 도착**(swopenapi, 도시철도 공백)·지하철역 교통약자 시설. **가족 데이터 중 '여행/외출 중 위치 기반' 항목만 길동무로 올려 dodo-planet 가족 여행 가이드 기능을 선검증**한다(행정성 지원금·입소대기는 child-care 전용). 판별: 좌표 근접 + 외출/여행 + 텍스트-우선. 아래 표에 dodo-planet 통합 태그로 후보 등록.

> **2026-06-24 검색창 자연어 라우터 출시 → 2026-06-27 폐기·결정론 3섹션 회귀** — Gemini 단발 분류(1왕복)가 자연어를 `search_places`/`search_web`으로 라우팅하는 구조로 시작했으나, 실측 결과 세 기능이 모두 순가치 음수로 확인돼 전면 폐기. (a) 키워드 재해석이 멀쩡한 검색을 악화(위스키바→바 축약으로 미용실 혼입), (b) 지역 앵커링은 카카오가 원문에서 자체 처리하는 중복, (c) 웹 분류 부정확. **latent를 deterministic 위에 잘못 얹은 안티패턴**으로 정리. 대체 구조: `runQuerySearch`가 `/api/places`·`/api/address/search`·`/api/search/web`을 항상 병렬 발사(결정론, Gemini 분류 없음). 설계·계획 `docs/superpowers/plans/2026-06-27-remove-search-router-parallel-web-section.md`. 2026-06-27 dev 실호출 검증(위스키바 장소+웹 공존·캐나다 음식점 웹 보완).

> **2026-07-21 길찾기 강화 조사 완료**: 도보·실시간 교통·교통약자·자전거/택시 4축 병렬 조사. 전문: `RESEARCH-2026-07-routing-enhancement.md`(우선순위 로드맵·미확정 게이트 5건 포함). 핵심: 택시요금·ODsay 정류장 리스트(키 0 필드 투영)·Tmap 보행자 경로(한국어 완성 문장 턴바이턴, 도보 최대 공백)·ITS 돌발상황 브리핑(기보유 data.go.kr 키). 자전거 라우팅·점자블록 턴바이턴은 데이터 부재로 보류. 부수 확인 2건: 카카오 신규 경로 API 4종(2026-07-21, 무료 쿼터 "첫 활성화 앱" 정책 리스크)·네이버 Search API의 NAVER API Hub 이관(지역검색 2027-06-30 데드라인). 다음: 이 조사를 입력으로 개발 spec.

> **2026-07-22 보행 인프라(둘러보기 기능 B) 출시** — 서울시 음향신호기(서울 열린데이터 OA-15543, 2026-05-28 기준 16,822기 정적 seed, EPSG:5186 golden 가드)+OSM Overpass(횡단보도·점자블록 노드, 타일 anchor 캐시)를 단일 서비스 `getWalkInfrastructure()`로 합성. 7번째 "내 주변" 패널+`/api/walk/nearby`+채팅 `get_walk_infrastructure`(17종). 상태는 discriminated union(0건 ≠ 서울 외 미제공 ≠ 조회 실패), 등록≠작동 각주. 설계 `superpowers/specs/2026-07-22-walk-infrastructure-design.md`(codex 적대적 리뷰 22건 반영)·plan 동일 날짜. 후속 후보: crossingSignal "no"(무신호 횡단) 안내 여부·OSM way/area 확장·전국(경찰청) 확장.

> **2026-07-29 서비스 지역 커버리지 계약**: 아래 표의 데이터 소스는 사실상 전부 대한민국 전용인데, 한국 밖 좌표에서 그 사실이 "데이터 없음"이 아니라 오류로 표현되던 공백이 App Store 심사 반려(2.1(a))로 드러났다. 좌표 의존 라우트 13종이 파싱 → 커버리지 마커 → 키 게이트 순서로 200 `{"outOfCoverage":true}`를 반환하고(upstream 미호출이라 쿼터도 보호), 웹·iOS·CLI/MCP·채팅이 각자 오류 아닌 안내로 렌더한다. 술어 정본은 `src/lib/coverage.ts` ↔ iOS Kit `Coverage.swift`. 이름 기반 기능(장소 검색·역 정보·목적지 길찾기·장소 앵커 채팅)은 전 세계 유효하므로 안내 문구도 "위치 기반 기능만 제한" 톤이다. 3-state(0건·정보 없음·조회 실패)에 더한 4번째 정직 상태. 설계 `superpowers/specs/2026-07-29-coverage-contract-dictation-design.md`.

| 서비스/API | 도메인 | 상태 | dodo-planet 통합 가치 |
|------------|--------|------|----------------------|
| 카카오 로컬 | 장소 검색 | **운영 중** — 카카오맵 활성화 + 실데이터 검증 완료 (2026-06-12) | 높음 — 장소 검색 코어 |
| 카카오 로컬 주소 API | 지오코딩/역지오코딩 | **운영 중 (2026-06-13)** — `/api/geocode`, `coordToAddress()`. 같은 키·같은 활성화로 동작 확인 | 중상 — 출발지 주소 입력, 현위치 주소 낭독 |
| 카카오모빌리티 directions | 자동차 경로 텍스트 브리핑 | **운영 중 (2026-06-13)** — `/api/route/car` + 검색 카드 "자동차 경로 미리 듣기". 같은 REST 키로 별도 활성화 없이 동작 | 높음 — "지도 없이 완결되는 경로" 실험의 코어 |
| 네이버 지역 검색 | 장소 검색 | 구현 완료 (키 대기) | 중 — 카카오 보완 |
| 카카오맵/네이버지도 딥링크 | 내비 연결 | **구현 완료 + UI 통합 (2026-06-13)** — 검색 카드에 네이버/카카오 두 그룹 | 높음 — 길찾기 코어 |
| 한국관광공사 TourAPI 4.0 | 관광정보 (다국어) | **운영 중 (2026-06-13)** — en 로케일 자동 우선, 실응답·프로덕션 검증 완료. 개발계정 기능당 일 1,000건. 추가 실측: `locationBasedList2`(반경·dist·거리순)·`detailCommon2`(영문 overview 1,300자) — provider 함수 추가는 Phase 0b 후보 | **높음** — 외국인 여행자 + dodo 여행 도메인 정합. 카카오·네이버의 다국어 공백을 메우는 유일한 공식 소스 |
| **도보 경로**(카카오 도보 기본 + Tmap 폴백) | 도보 길찾기 | **운영 중 (2026-07-22 Tmap 출시 → 2026-07-29 카카오 기본 전환)**: `kakao-walk`(기본, 기존 `KAKAO_REST_API_KEY`)와 `tmap-pedestrian`(카카오 throw 시에만 폴백)을 `walk-route.ts`가 합성, `/api/route/walk`+길찾기 뷰(웹)/길찾기 탭(iOS). 카카오 채택 근거는 동좌표 문체 대조에서 확인한 의미 단위 스텝·역사 내 이동·계단/지하보도 명시. 완성 문장 낭독 정본 유지, 계단 회피 모드(`accessible=true`→`stepFree` 3-state, 미적용 시 안전 문장을 서버가 삽입, 웹 토글), 횡단보도 스텝에 음향신호기 주석(seed 40m 대조, 병합 스텝은 침묵). V1 ko 전용, 게이트 `hasWalkRouteKey()`. 유료 전환 미신청이라 비용 상한 0원 | **높음**: dodo 이식 시 카카오 키는 공유, Tmap만 dodo용 appKey 발급 |
| NCP Directions 5/15 | 자동차 경로 (영문!) | **운영 중 (C1, 2026-06-17)** — `ncp-directions.ts` + `/api/route/car` lang 디스패치. `lang=en`+NCP 키면 NCP 영문 턴바이턴(`instructions`), 그 외 카카오 한국어 graceful 폴백. 두 provider 동일 `CarRouteBriefing` shape(컴포넌트 불변). ⚠ NCP `duration` 밀리초→초 변환(`normalizeNcpRoute`). 실호출 검증(en 14단계 영문·ko 8단계 한국어, durSec 단위 정합) | **높음** — dodo 외국인 시나리오의 영문 경로 정본 |
| NCP Geocoding/Reverse | 주소↔좌표 (영문 보완) | **키 확보 + 원시 실측 (2026-06-13)** — 정지오코딩이 `englishAddress` 반환. 역지오는 한국어 전용 → 영문 현위치는 역지오→정지오 **2-call 체인**(실측 동작 확인). 영문 입력 질의는 미수용(0건) | 중상 — 영문 주소 표기·현위치 낭독. juso.go.kr 불필요해짐 |
| 행안부 juso.go.kr | 영문 주소 변환 | 조사됨 | 중 — 외국인용 주소 표기 보완 |
| 카카오톡 메시지(위치 템플릿) | 공유 | 조사됨 — `talk_message` 동의만으로 "나에게 보내기" 가능 | 중상 — 가족 공유 시나리오, dodo 카카오 로그인과 정합 |
| ODsay / TMAP | 대중교통/도보 경로 | 조사됨 (네이버 보고서) | 중 — 텍스트 경로 안내용 |
| 상업 예약 (캐치테이블/네이버예약/야놀자) | 예약 | **재검증 완료 (2026-06-14) — 공개 API 여전히 전무** | 낮음 — 딥링크 링크아웃만 가능 |
| 카카오 T | 택시 | 조사됨 — 공개 호출 API 없음 | 낮음 — 앱 링크 수준 |
| **TAGO 버스 패밀리** (도착 15098530·정류소근접 15098534·노선 15098529) | 시내버스 | **구현 완료 (2026-06-14)** — `tago-bus.ts` provider + `/api/bus/*` + `BusArrivals`/`BusRouteStops`. 국토부 data.go.kr, `DATA_GO_KR_API_KEY` 공유, 무료·개발 일 10,000건. 근접정류소→Haversine 거리정렬→도착예정, `vehicletp`로 저상버스 정본 판정. 실호출로 envelope·필드명·저상버스 판정 검증(성남시청후문앞 등). TAGO는 경기·지방·부산 커버. **서울 시내버스(TOPIS) 병합 완료 (2026-06-24)** — `seoul-bus.ts` provider가 ws.bus.go.kr 서울 3종을 `src/lib/bus.ts`에서 TAGO와 병렬 병합(좌표 dedup·거리순·상위5). 서울은 arrmsg1 완성문장 정본·슬롯 페어 2버스·routeType 한글매핑. 키 전파 9일 대기 후 실호출 검증(강동 길동 서울 5정류소·N30 심야·경계 tago+seoul 병합). 메모리 seoul-bus-datagokr-sync-delay | **높음** — "가까운 정류장→버스 도착 텍스트 안내"가 지도 없이 완결. 실시간이라 딥링크 대체 불가 |
| **전국도시철도역사정보표준데이터** (15013205) | 지하철 | **운영 중 (A3, 2026-06-17)** — `subway-stations.ts` + `/api/station/meta` + `StationMeta`. **OpenAPI 아닌 연간 XLSX로 판명**(국가철도공단 레일포털 `data.kric.go.kr`, 활용신청·키 게이트 없음) → **정적 seed 번들**(1,098역, `scripts/build-subway-stations.py`로 XLSX→JSON). 순수 조회 로직(정규화 매칭·Haversine 근접·노선 집계) + seed 바인딩, 서버 전용 import. 장소 상세가 역이면 영문역명·노선·환승 노출(en 영문 메인). 실호출 검증(강남·서울역·부산역·대전 전국 커버·고속터미널 환승). 16개 단위 테스트 | **높음** — 좌표+영문 동시 충족 유일 데이터셋. A1/A2 받침대 + 외국인 정합 실현 |
| **행안부 도로명주소 API** (검색 API, business.juso.go.kr) | 우편번호/주소 | **구현 완료 (C2, 2026-06-19)** — `JUSO_CONFM_KEY`(검색 API 하나로 영문주소+우편번호 모두 커버, 무료·무제한). **C2-a**: en 카카오 카드 영문주소 소스를 juso로 교체(NCP는 폴백 강등, `enrichEnglishAddresses` juso→NCP→한글 체인). **C2-b**: 주소·우편번호 검색 진입점 신설(`searchJusoAddresses`+`/api/address/search`+`SearchKindToggle`/`AddressResultList`, 좌표는 카카오 `/api/geocode` 재사용). 실호출 머지 게이트 통과(세종대로 110→영문·우편번호). 설계/계획 `docs/superpowers/{specs,plans}/2026-06-19-juso-official-address*`. 프로덕션 배포 완료(2026-06-19, `JUSO_CONFM_KEY` Production 등록 + 자동배포, prod 실호출 검증) | **중상** — ePost 비공식 웹폼·NCP `englishAddress`(국가명 포함) 대체. 공식 영문주소 정본화 |
| **KRIC 교통약자 이동경로** (transferMovement·stationMovement) | 접근성/철도 | **회원가입 완료·승인 대기 (2026-06-14)** — KRIC는 data.go.kr과 달리 **수동 승인(수일 소요)**. 승인 후 로그인→2종 활용신청 재개 예정. 엔드포인트 1차 확정: `openapi.kric.go.kr/openapi/vulnerableUserInfo/transferMovement`·`/handicapped/stationMovement`, 무료·**무제한**·단일키, 역식별 railOprIsttCd+lnCd+stinCd. ⚠ 발급 후 실호출 게이트 2건(낭독 산문 여부·역코드 조인). 상세 RESEARCH §I | **높음** — 무장애 환승/역내 동선. **최대 차별화 축** |
| **한국철도공사 편의시설정보** (data.go.kr 15125774) | 접근성/철도 | **운영 중 (UI 통합, 2026-06-14)** — `src/lib/providers/korail-facilities.ts` + `/api/station/facilities` + `StationFacilities` 컴포넌트로 장소 상세에 노출. `/weekPersonFacilities`(교통약자: 장애인화장실 `pwdbs_tolt_estnc`·경사로 `pwdbs_slwy_estnc`·휠체어리프트 `whlch_liftt_cnt`) + `/stationFacilities`(엘리베이터 `elevt_cnt`)를 **`stn_cd` 조인**. API가 역명 필터를 무시해 406역 전체를 받아 `normalizeStationName` 클라이언트 매칭(일 1회 revalidate). 정본 정확성: "0대"≠"정보 없음"(`num→number\|undefined`), 주 fetch 장애는 502(미커버 null과 구분). 도시철도(지하철) 미포함 → graceful degrade. `DATA_GO_KR_API_KEY`(=`TOUR_API_KEY`), 프로덕션 env 등록 완료 | **높음** — KRIC 가입 없이 data.go.kr로 확보한 역 교통약자 시설 정본 |
| **무장애 안내 보조 데이터** (서울 키오스크 점자·음성 XLSX id=985 / 서울 빠른하차 15143840 / 승강기안전공단 실시간 15070652) | 접근성/철도 | **조사됨 (3라운드)** — 점자·음성 특화필드는 서울 키오스크 정적파일에만. 실시간 승강기는 승강기안전공단(건물단위→역 매핑 필요)·서울 후속. KRIC 환각 엔드포인트 2종 반증(코드 금지) | **높음** — 편의시설(15125774, 발급완료)과 3층 스택 구성. seed+조회+실시간 조합 |
| ODsay LAB 대중교통 길찾기 | 버스+지하철 경로 | **검증 완료 (2026-06-14, 3-0)** — TAGO에 없는 환승 경로계산 보완. 무료 일 1,000건·**6개월·한국어 전용**(영문 유료) | 중상 — ko 경로검색 코어. en은 보류/자체 구성 |
| KORAIL/TAGO 열차 운행정보 (15125762 / 15098552) | 철도 | **검증 완료 (2026-06-14, 3-0)** — 무료·개발 10,000건. 둘 중 택1 | 중 — KTX/SRT 딥링크와 별개 "운행현황 텍스트 안내" |
| 공공시설 예약 (서울 OA-2271·인천 15085804) | 예약 | **신규 발견 (2026-06-14)** — 체육·문화·진료·공간대관 예약 오픈데이터. 링크아웃형(yeyak.seoul.go.kr) | 중 — 상업 예약과 달리 공공시설은 열림 |
| TourAPI 음식점 콘텐츠 (영문 contenttype 82) | 맛집 | **확인 (2026-06-14)** — "신규 영문 맛집 소스"는 곧 보유한 TourAPI English였음. 신규 키 불필요 | 중 — en 음식 카드 보강(기존 provider 확장) |
| 무장애여행(15134352)·공중화장실(15012892)·따릉이·전기차충전소·심평원 병원약국·기상청 | 접근성/여행 보강 | **조사됨 (2026-06-14)** — 모두 무료 data.go.kr/열린데이터 | 중하 — 선택적. 무장애/공중화장실은 접근성 정합 |
| 맛집 검색 코어 | 맛집 | **결론 (2026-06-14)** — 카카오 로컬(보유) 능가 신규 소스 없음. localdata 인허가는 검증용 보조 | — 카카오 유지 |
| **서울 지하철 실시간 도착** (A2, data.seoul.go.kr OA-12764) | 지하철 | **운영 중 (2026-06-17)** — `seoul-subway-arrival.ts` + `/api/station/subway-arrival` + `SeoulSubwayArrival`. 차단이던 **실시간 데이터 인증키 발급 완료**(데이터셋 OA-12764 → "인증키 신청 (지하철)", 일반키와 별도 계열 — 일반키는 `ERROR-338`). `SEOUL_SUBWAY_REALTIME_KEY`(즉시 발급·일 1,000회/키·갤러리 등록 시 무제한). `http://swopenapi.seoul.go.kr/api/subway/{KEY}/json/realtimeStationArrival/0/20/{역명}`. **응답 envelope가 정상/에러에서 다름**(정상 `errorMessage.code` 중첩 / 데이터없음 `INFO-200` 최상위 code) → `resultCode()`가 두 위치 모두 읽음. INFO-000 파싱·`INFO-200`→null(미커버 graceful)·그외 코드/HTTP실패→throw→502(seoul-metro-facilities 정책 동형). `arvlMsg2`(완성 한국어 도착 문장 — 낭독 정본)·`barvlDt`(초)·`bstatnNm`(종착)·`subwayId`→노선명 매핑·`updnLine`·`btrainSttus`(급행). 실시간이라 no-store + force-dynamic, 컴포넌트는 BusArrivals 동형(수동 새로고침+조회시각). `canShowSubway` 게이트(키 없으면 버튼 미노출). 역 식별은 A3 seed가 받침대. 실호출 검증(강남 2호선+신분당선·서울역 1·4·경의중앙·공항철도·부산/없는역 null). **+ 내 주변 진입점(2026-06-17)**: `subway-nearby.ts` + `/api/station/subway-arrival/nearby` + `SubwayArrivalsNearby` — 홈(idle)에 지하철→버스→따릉이 순 "내 주변" 3종. 역명 기반이라 좌표를 직접 못 써 A3 seed `findStationsNear`(1km·상위 3역)로 근접역 식별 후 역별 실시간 `Promise.allSettled` 합성. 부분 실패는 역별 `arrivalStatus`(BusStop 동형, "조회 실패"≠"열차 없음"), 비서울 INFO-200은 제외(graceful), 전부 실패만 502. 순수 `buildNearbyArrivals`/합성 `fetchNearbySubwayArrivals` 분리·`SubwayArrivalList` 상세 공유. 실호출 검증(강남 좌표→강남 31m·신논현·역삼 실시간, 부산→빈배열, 범위밖→400). 정본 plan `docs/superpowers/plans/2026-06-17-seoul-subway-realtime.md` | **높음** — 역 상세 "다음 열차 N분/현재 위치" 텍스트 + 홈 내 주변. 도시철도 공백 메움 |
| **서울 지하철역 교통약자 시설** (서울교통공사 data.go.kr 15143843, `B553766/wksn`) | 접근성/지하철 | **운영 중 (2026-06-17)** — `seoul-metro-facilities.ts` + `/api/station/metro-facilities` + `SeoulMetroFacilities`. 코레일 편의시설의 **서울 1~8호선 공백 보완**. 9 오퍼레이션(엘리베이터·에스컬레이터·휠체어리프트·무빙워크·휠체어급속충전기·안전발판·수어영상전화기·도우미·장애인화장실), 위치·층·가동현황 인스턴스 목록(카운트 아님). 코레일과 동형(`parseStationItems` 재사용·`DATA_GO_KR_API_KEY` 공유·장애 throw→502). `stnNm` 포함필터+`normalizeStationName` 정확매칭(강동구청 제외), `oprtngSitu` M=정상/그외=점검 보수매핑, `totalCount>300` throw. 실호출 검증(강동 4종·신도림 18·서울역 23·없는역 null). 서울 포털 OA-22xxx(시설별 9종 개별)보다 data.go.kr 단일 통합 API 채택(view 버그 회피). 정본 plan `docs/superpowers/plans/2026-06-17-seoul-metro-facilities.md` | **높음** — 시각장애인 1급 정합. 도시철도 무장애 동선 |
| **무장애 여행 정보** (한국관광공사 KorWithService2, data.go.kr 15101897) | 접근성/관광 | **구현 완료·활용신청 대기 (2026-06-30)** — `tour-barrier-free.ts` provider + route 3종(nearby·detail·match) + `BarrierFreeNearby`(편의시설 펼침) + `BarrierFreeInfo`(장소상세 자동등장 region) + 채팅 도구 `get_nearby_barrier_free` 5계층. 좌표50m∩이름 매칭(코드 거리 가드)·편의시설 화이트리스트 라벨링(⚠ 철자 실호출 확정)·게이트/인증 `DATA_GO_KR_API_KEY` 일치(split-brain 금지). ⚠ KorWithService2 현재 403 → 활용신청 승인 후 실호출 검증(plan Task 6). 트리거: data.go.kr 메일(NOTICE_0000000004801) 발굴. 정본 `docs/superpowers/plans/2026-06-30-barrier-free-travel.md` | **높음** — 시각장애·교통약자 1급 정합, dodo 여행 도메인 직행 |
| **근처 소아 야간·휴일 진료** (달빛어린이병원 NMC 15000736) | 가족/의료 | **운영 중 (B1, 2026-06-17)** — `night-clinic.ts` + `/api/clinic/nearby` + `NightClinicsNearby`(홈 "내 주변" 4번째). NMC `getBabyListInfoInqire`(달빛·소아전문센터, 좌표+요일별 진료시간+전화), 전국 152개 일괄→Haversine 20km→진료중 우선 상위10. ⚠ **HIRA 15001674는 좌표 없음**으로 판명(실호출)→NMC 달빛 목록이 정본. 진료상태 3-state(open/closed/unknown, KST 요일·시각), 공휴일 자동판정(2026-07-26 활성화). mock 없음(의료-실데이터). 단위테스트 동반. 설계 `docs/superpowers/specs/2026-06-17-nearby-night-clinic-design.md`. 실호출 검증(강동 길동 5곳 거리순). **2026-07-26 보강**: 진료중 우선 정렬(`prioritizeOpen`)+상위 10+절단 노출(`total`)+공휴일 판정(특일정보 `fetchIsHoliday` 재사용, `basis` 라벨)+채팅 도구에 `openStatus` 주입(LLM 추론 날조 차단). ⚠ **잔여 한계: 달빛 지정 명부(152개)라 미지정 소아과 부재** — 커버리지 확장 설계 `docs/superpowers/specs/2026-07-26-clinic-coverage-expansion-design.md`(단계 1 착수 게이트 = `scripts/verify-clinic-sources.mjs` 실호출) | **높음** — 여행 중 아이 아플 때 안전망. dodo-planet 가족 여행 핵심 |
| **이 지역 공기질** (에어코리아 15073877 근접측정소 + 15073861 측정소 실시간) | 가족/환경 | **운영 중 (B2, 2026-06-17)** — `air-quality.ts` + `/api/air-quality/nearby` + `AirQuality`(장소 상세 enrich). 2-call: `getNearbyMsrstnList`(첫=최근접) → `getMsrstnAcctoRltmMesureDnsty`(측정소명 단건). KHAI·PM10·PM2.5 등급(낭독 정본)+수치. ⚠ **WGS84→TM EPSG:2097(Bessel) proj4 변환**(카카오 5181 아님, 정본값 대조 확정). ⚠ 에어코리아 envelope는 `body.items`가 **직접 배열**(다른 data.go.kr `items.item`과 다름). 3-state Flag→unknown(측정 장애 숫자 노출 금지), khai는 공식 통합지수라 Flag 독립. tago-bus 동형 방어(URLSearchParams·text+JSON.parse·인증 XML→throw). mock 없음(키없음→null·미커버 graceful·장애 502). 20개 단위테스트. 설계 `docs/superpowers/specs/2026-06-17-air-quality-design.md`. 실호출 검증(강동 길동→천호대로 0.5km·부산→전포동·범위밖 400) | **높음** — dodo 일정 추천과 연결. 시각장애인에게도 이동 판단 정보 |
| **근처 아이 놀 곳 — 키즈 장소** (카카오 로컬 좌표 근접) | 가족/장소 | **운영 중 (B3, 2026-06-18)** — `kids-places.ts` + `/api/places/kids` + `KidsPlacesNearby`(홈 "내 주변" 5번째). 신규 API·게이트 없음(기존 `KAKAO_REST_API_KEY`). 키워드 3종(키즈카페·놀이터·어린이공원) 좌표 근접 `Promise.allSettled` 병렬→dedupe·거리순·상위8. ⚠ **데이터 현실(실호출 규명): 키워드 매칭 ≠ 키즈 장소** — "놀이터" 검색에 스킨스쿠버·노인복지시설·동우회·방탈출카페·당구장이 섞여 나옴. 시각장애인은 노이즈를 못 거르므로 **category_name 계층 화이트리스트**(`classifyKidsPlace`: 유아>놀이시설·놀이교육·공원+이름신호)가 정본. 실내/실외 3-state(놀이터 모호→이름 신호 없으면 unknown, 잘못된 단정 금지). 부분 실패 불변식(일부 키워드 실패해도 보존, 전부 실패만 502). 전화 `tel:` 링크(키즈카페 예약)+카카오맵 링크. 33개 단위테스트. code-reviewer 5건 검토(놀이교육 계층 앵커링·전화링크 2건 수정, 캐시주석·park 테스트 2건 보강, role=status 중복은 형제 동형 보류). 설계 `docs/superpowers/specs/2026-06-18-kids-places-design.md`. 실호출 검증(강동 길동 8건 노이즈 0·부산 서면·범위밖 400) | **높음** — 가족 여행 목적지 발굴. dodo 본질 |
| 근처 가족 행사·프로그램 (서울 문화행사 OA-15486 `이용대상`=영유아 / 도서관 15013109) | 가족/문화 | **후보 (2026-06-16)** — 매일 갱신 + 좌표 + 이용대상 필터로 "오늘 근처 영유아 행사" 카드. 여행 중 즉흥 활동 | 중상 — dodo 일정 흡수 |
| 따릉이 실시간 (data.seoul.go.kr OA-15493) | 공유 이동 | **구현 완료 (2026-06-16)** — `seoul-bike.ts`+`/api/bike/nearby`+`BikeStations`. 전체(~2,720) 페이지 루프→Haversine 정렬→1km cap→상위 5, 60초 캐시. 장소상세·홈 두 곳(`canShowBike` 게이트). 실호출 검증(길동 5건). 설계 `docs/superpowers/specs/2026-06-16-seoul-bike-design.md` | 중 — 이동 옵션 확장 |
| **대중교통 길찾기** (ODsay LAB `searchPubTransPathT`) | 경로 | **개발 완료 (2026-06-18)** — `odsay.ts`+`/api/route/transit`+`TransitRouteBriefing`. 출발→도착 버스+지하철 환승 텍스트 브리핑("출발 전 미리 듣기", 자동차 브리핑 동형 — **딥링크 위임 원칙을 자체 텍스트로 확장**). 현재위치 기본 + "출발지 바꾸기" 인라인 검색(`/api/places` 재사용), 추천 1개 + 대안 펼치기. ODsay `path/subPath`→자체 `TransitRoute` 정규화(종속 격리). 실호출 확정: `trafficType` 1=지하철/2=버스/3=도보·지하철 `lane.name`·버스 `lane.busNo`·`totalTime`/`sectionTime`=분·`payment`=원. **환승 도보(`distance:0,sectionTime>0`)는 leg 제외·`walkMinutes`는 전체 도보 합**. 3-state(error `-98`=출도착 700m이내=경로없음 null·그외 throw→502, 순수 `normalizeOdsayRoute` 단일화). en은 t.rich `<line>/<from>/<name>` 태그로 **고유명만 `lang=ko`**(구조 영문). `canShowTransit`(`hasOdsayKey()`) 게이트·mock 없음·`revalidate:3600`. 8 단위테스트 + 라우트 3-state 실검증. ⚠ **ODsay Server 방식 공인 IP 화이트리스트라 Vercel 프로덕션(가변 IP) 미해결**(개발 머신 IP만 등록 — 별도 마일스톤). 설계 `docs/superpowers/specs/2026-06-18-odsay-transit-routing-design.md`·계획 `docs/superpowers/plans/2026-06-18-odsay-transit-routing.md`. 실호출 검증(길동→강남 33분·환승 2·대안 2(버스 30-3)·가까움 graceful null·범위밖 400) | **높음** — 도보·대중교통을 현재 딥링크 위임만 하던 한계를 자체 텍스트 경로로 메움. dodo 외국인·시각장애인 이동 코어 |

## 4. 접근성 설계

- 검색 폼: `<label>` 연결, `type="search"`, 큰 터치 타깃(min-h-12).
- 결과 통지: `role="status"` + `aria-live="polite"` — "검색 결과 N건".
- 결과 도착 시 결과 헤딩(`tabIndex={-1}`)으로 프로그래매틱 포커스 이동.
- 장소 카드: 시맨틱 `<ul>/<li>` + `<h3>` + `<dl>` 구조 — 스크린 리더 랜드마크/헤딩 내비게이션 활용 가능.
- 길찾기 액션: `<nav aria-label="...까지 길찾기">` 안의 실제 링크 — 커스텀 위젯 금지.
- 전화번호는 `tel:` 링크 + "OO에 전화 걸기" aria-label.
- `prefers-reduced-motion` 전역 대응, `:focus-visible` 전역 스타일.
- 향후 지도 추가 시: 지도 컨테이너는 `aria-hidden` 또는 `role="application"`+설명, 지도 위 컨트롤은 실제 `<button>`으로.

## 5. dodo-planet 통합 경로 (장기)

> **2026-06-13: 통합 계획 스펙 확정** — `~/Mac-Projects/dodo-planet/docs/plans/2026-06-13-korea-local-provider-integration.md`. 카카오 3종+딥링크는 검증 완료로 dodo Phase 1 직행 가능. 이 저장소의 잔여 역할은 **Phase 0 = TourAPI 키 발급 + 실응답 검증** (dodo 착수의 전제조건 아님, 병행).
>
> **2026-07-03: 수용측 아키텍처 지도 확보** — dodo-planet Round 148 기준 타깃 코드베이스(49개 Gemini 함수·카탈로그 3-mirror·`isKoreaContext` 좌표 우선 라우팅·이식 1건당 수정 파일 체크리스트) 정밀 조사: `RESEARCH-2026-07-dodo-planet-target-architecture.md`. 추가 졸업 작업 착수 전 이 문서로 재탐색을 생략한다. 핵심 설계 공백: trip-less 채팅의 한국 판정이 GPS 신호뿐(문서 §3).
>
> **2026-07-03: 전량 이식 spec 확정** — gildongmu 자산 **전체**의 dodo 이식 판정·Phase·라우팅 설계를 `superpowers/specs/2026-07-03-dodo-full-port-design.md`로 확정(2026-06-13 계약의 확장, Spec B 2026-06-21 흡수). trip-less 한국 판정은 **하이브리드 에스컬레이션**(결정론 신호 OR-래치 + 도구 내부 좌표 최종 판정)으로 사용자 확정. dodo측 대응 문서 `~/Mac-Projects/dodo-planet/docs/plans/2026-07-03-gildongmu-full-port-plan.md`.

1. **v0~v1**: 독립 앱으로 성숙 (이 저장소).
2. **통합 시**: `src/lib/` (providers, deeplink, types)은 그대로 이식 가능하도록 React/Next 비의존으로 유지. UI 컴포넌트는 dodo-planet 디자인 시스템에 맞춰 재스킨.
3. 스택을 dodo-planet과 미리 일치시켜 둠: next-intl 4 / zod 4 / Vitest 4 / App Router / proxy.ts.
4. 통합 형태 후보: dodo-planet의 `[locale]/map` 라우트 대체 또는 "장소 찾기" 신규 탭. (시점에 가서 결정)

## 6. 미해결 항목 (2026-06-13 갱신)

- [x] ~~카카오맵 제품 활성화~~ → 완료, 카카오 로컬 실데이터 동작 확인
- [x] ~~외국인용 장소 검색~~ → TourAPI provider로 설계 확정 (en 로케일 자동 우선). 키 발급 후 검증만 남음
- [x] ~~TourAPI 키 발급~~ → **완료 + 실응답 검증 (2026-06-13)** — 국문·영문 GW 자동 승인(만료 2028-06-13), 키는 `.env.local`·Vercel 3환경. 빈 결과 `items: ""` 확인, `contenttypeid` 라벨 매핑 확정(국문 12~39·영문 75~85 비중첩 단일 맵), en 로케일 E2E 프로덕션 검증. 잔여 관찰: `arrange=A`(제목순)라 랜드마크가 후순위로 밀릴 수 있음 — 정렬 전략은 사용해 보며 결정
- [x] ~~NCP 결제수단 등록 → Maps Application 등록~~ → **완료 (2026-06-13)** — Maps 구독 + Application `gildongmu`(API 6종, Web URL 3개), Geocoding(`englishAddress` 포함)·Directions 5 실호출 검증. 키는 `.env.local` `NCP_MAPS_*`. 다음 실험 후보: 영문 주소 변환(juso.go.kr 대신 NCP `englishAddress` 활용), 카카오 vs NCP Directions A/B
- [x] ~~developers.naver.com 애플리케이션 등록~~ → **완료 (2026-07-18)** — 사용자 수동 발급, `NAVER_LOCAL_*` prod 등록, ko 장소 병합 운영 중
- [x] ~~지역 검색 API 좌표계(×10⁷) 실응답 검증~~ → **완료 (2026-07-18)** — naver-local provider가 ×10⁷ 정수를 내부 변환, ko 병합 prod 실호출 검증
- [x] **Phase 0b (dodo §5b 선행 작업)** — ① NCP en 자동차 경로 **완료(C1, 2026-06-17)** ② `getEnglishAddress()` 체인 헬퍼 ③ tour-api 함수 추가 → ②③은 **2026-07-03 전량 이식 spec(`superpowers/specs/2026-07-03-dodo-full-port-design.md`)으로 이관 종결** — dodo 이식 시점에 그 spec이 정본
- [x] ~~VoiceOver 수동 테스트 시나리오 문서화~~ → **완료 (2026-07-27)** — `docs/appstore/1.0-voiceover-qa-checklist.md` 49항목이 정본
- [x] ~~경로 브리핑의 출발지 대안 입력~~ → **완료 (2026-07-22)** — 길찾기 뷰(`DirectionsView`/iOS `DirectionsTab`) 출발·도착 필드가 장소+주소(`/api/address/search`) 검색을 지원, Geolocation 거부 시에도 완주 가능
