> 🤖 **이 파일은 자동 생성됩니다. 직접 수정하지 마세요.**
> 정본은 `CLAUDE.md` 입니다. 내용을 바꾸려면 `CLAUDE.md` 를 수정한 뒤
> 프로젝트 루트에서 `python sync_agent_docs.py` 를 실행하세요.
> 이 파일을 직접 고치면 다음 동기화 때 경고와 함께 덮어쓰기 대상이 됩니다.

<!-- SYNC-BODY-START: 이 줄 아래 본문은 CLAUDE.md 와 100% 동일하게 자동 생성됨 -->
# CLAUDE.md — 길동무 (gildongmu)

> Next.js 16 주의: 이 버전은 학습 데이터와 컨벤션이 다를 수 있다. 코드 작성 전 `node_modules/next/dist/docs/`의 관련 가이드를 먼저 읽을 것 (요청 API 전부 비동기: `await params`, `await cookies()`; `middleware.ts` 대신 `proxy.ts`).

## 프로젝트 정체성

**국내 서비스 연동 실험실.** 네이버·카카오를 시작으로 대한민국 로컬 서비스 API(지도, 내비게이션, 장소, 예약, 관광 등)를 계속 발굴·추가하며, 접근성 우선 미니멀 UI로 실험한다. 두 사용자 집단이 1급 시민:

1. **시각장애인** — 스크린 리더만으로 전체 흐름(검색 → 장소 정보 → 길찾기)이 완결되어야 한다.
2. **한국 방문 외국인** — 한국어를 몰라도 쓸 수 있는 미니멀한 영어 UI.

**궁극 목표**: 여기서 검증된 기능을 `~/Mac-Projects/dodo-planet/`(가족 여행 가이드 PWA)에 통합한다. 이 저장소는 인큐베이터 — 따라서 **스택·컨벤션을 dodo-planet과 일치**시키고(next-intl 4, zod 4, Vitest 4, App Router), `src/lib/`는 React/Next 비의존으로 유지해 이식성을 보장한다.

## 절대 원칙: 접근성

- **정보의 정본은 리스트/텍스트 UI다. 지도는 시각 보조 레이어다.** 네이버·카카오 지도 SDK는 캔버스 렌더링이라 스크린 리더 접근 불가 — 지도에만 존재하는 정보가 있으면 그것은 버그다.
- 상태 변화(검색 결과 수, 오류, 경로 안내)는 `aria-live` 영역으로 통지한다.
- 모든 인터랙티브 요소는 키보드 도달 가능 + `:focus-visible` 스타일 필수.
- 터치 타깃 최소 44×44px (`min-h-11` 이상).
- UI 메뉴/버튼 라벨에 이모지 금지 (워크스페이스 공통 원칙).
- 과잉 ARIA 정리 (2026-06-15): 글로벌 "First Rule of ARIA" 기준에 따라 노이즈 요소 제거 — skip link 삭제(단일 화면이라 WCAG 2.4.1 비해당, heading 내비가 진입점), offline 페이지 `<section aria-label>` 중복 레이블 제거, `PlaceCard` 버튼의 시각 텍스트를 덮던 `aria-label` 제거(분류·주소가 다시 낭독됨), `ResultList` 무명 `<section>`→`<div>`. 관련 i18n 키(`nav.skipToContent`·`place.openDetail`) 제거. 기준 정본은 글로벌 `~/.claude/CLAUDE.md`.

## 아키텍처

```
클라이언트 컴포넌트 ──fetch──▶ Route Handler (src/app/api/*) ──▶ 외부 API
                                 (Secret은 서버 전용 env에만 존재)
```

- **Provider 추상화** (`src/lib/providers/`): 도메인별 단일 진입점(예: `searchPlaces()`)이 키 유무로 provider를 자동 선택. **새 국내 서비스 추가 시 이 패턴을 따른다** — provider 파일 추가 → 진입점에 선택 로직 → mock 폴백 유지.
  - 장소 검색 우선순위: **kakao-local(15건) > naver-local(5건) > mock**. `PLACES_PROVIDER` env로 강제 지정(A/B 실험).
  - **en 로케일은 카카오 + TourAPI 병합**(`searchPlacesMergedEn`): TourAPI는 관광 콘텐츠만 커버해 일상 장소(학교·카페 등)를 못 찾으므로, 카카오를 기본으로 두고 TourAPI 영문 관광 정보를 보강한다. 두 소스를 병렬 호출해 한쪽 실패해도 다른 쪽 실데이터는 보존하고, 둘 다 실패하면 에러를 던진다. 중복은 좌표 4자리(약 11m)로만 판정해 카카오를 우선 남긴다(이름은 한/영으로 갈려 비교 불가). en+TourAPI만 있으면 TourAPI 단독, 카카오만 있으면 카카오 단독.
  - **en 병합 결과의 카카오 카드는 영문 주소 보강**(`enrichEnglishAddresses` → `ncp-geocode.ts`): 카카오는 한글 주소만 주므로 NCP Maps Geocoding으로 `englishAddress`를 채운다. TourAPI 카드는 이미 영문 주소라 건드리지 않고, `hasNcpMapsKeys()` 가드로 NCP 키 없으면 단계 자체를 건너뛴다. 영문 주소는 best-effort 보강 — `geocodeEnglishAddress`는 HTTP·네트워크 실패를 모두 null로 흡수하고 throw하지 않아, 변환 실패 카드는 한글 주소로 graceful degrade한다. UI는 영문을 메인·한글을 보조(`lang="ko"`)로 표시.
  - 실데이터 호출 실패 시 mock으로 조용히 폴백하지 않는다(가짜 실데이터 금지).
- **좌표는 WGS84 십진 도로 통일**. 네이버 지역 검색의 `mapx/mapy`(×10⁷ 정수)는 provider 안에서만 존재. 카카오는 WGS84 그대로.
- **내비게이션은 딥링크로 네이티브 앱 위임**: `src/lib/deeplink.ts`(nmap://), `src/lib/deeplink-kakao.ts`(kakaomap://). NCP/카카오내비 Directions는 자동차 전용이라 도보·대중교통 자체 구현 대상이 아니다.
- **자동차 경로 텍스트 브리핑** (`/api/route/car` + `CarRouteBriefing` 컴포넌트): 카카오모빌리티 directions의 `guides[].guidance`(완성된 한국어 안내문)를 낭독 정본으로 사용. 실주행 내비가 아니라 "출발 전 경로 미리 듣기" — 실주행은 딥링크 위임 원칙 유지.
- **버튼 비활성화는 `disabled` 대신 `aria-disabled` + 핸들러 가드** — `disabled`는 포커스를 제거해 스크린 리더 사용자가 맥락을 잃는다 (a11y 감사 반영, 2026-06-13). 단 `aria-disabled`만으로는 빠른 더블클릭/Enter 반복 시 같은 렌더의 클로저 가드가 중복 호출을 못 막으므로, 비동기 트리거에는 **in-flight ref 가드**(`useRef(false)` + `finally` 해제)를 병행한다(codex 리뷰 반영, 2026-06-14).
- **검색 → 결과 → 장소 상세 흐름 (v2, 2026-06-14)**: 입력은 검색창 하나. 결과는 카테고리 버킷 칩으로 필터(`ChipFilter`), 장소를 고르면 **같은 페이지 내 뷰 전환 + History API**로 상세(`PlaceDetail`)를 연다 — 카카오 로컬은 ID 단건 조회가 없어 메모리의 `Place`로 상세를 그린다. `openDetail`이 `pushState`로 백버튼 포착용 trap 엔트리를 쌓고, `popstate`가 단일 수렴점으로 목록 복귀 + 결과 헤딩 포커스 이동을 담당(딥링크 상세 복원은 비목표). 검색은 `?q=` URL 동기화 + request-id ref로 stale 응답을 버린다. 상세에 길찾기 딥링크·자동차 브리핑·(역이면)역 편의시설을 집약.
- **역 교통약자 편의시설** (`korail-facilities` provider + `/api/station/facilities` + `StationFacilities`): 철도공사 API(15125774)가 역명 필터를 무시해 406역 전체를 받아 `normalizeStationName`으로 클라이언트 매칭(일 1회 revalidate). 교통약자(`/weekPersonFacilities`)와 엘리베이터(`/stationFacilities`)를 **`stn_cd` 조인**(역명 조인은 동명이역 혼입 위험). **정본 정확성**: "0대"와 "정보 없음"을 뭉개지 않음(`num→number|undefined`), 주 데이터 upstream 장애는 throw→502(미커버 `null`과 구분). 도시철도(지하철)는 미포함이라 매칭 실패=graceful degrade.
- **서울 지하철역 교통약자 시설** (`seoul-metro-facilities.ts` provider + `/api/station/metro-facilities` + `SeoulMetroFacilities`): 코레일 편의시설의 **도시철도(서울 1~8호선) 공백 보완**. data.go.kr 서울교통공사_교통약자이용정보(15143843, `apis.data.go.kr/B553766/wksn`, `DATA_GO_KR_API_KEY` 공유), **9 오퍼레이션**(엘리베이터·에스컬레이터·휠체어리프트·무빙워크·휠체어급속충전기·안전발판·수어영상전화기·도우미·장애인화장실). 코레일과 동형(`parseStationItems` 재사용, 주 fetch 장애 throw→502, 키없음/전종류빈결과 null). **시설마다 필드가 달라** 공통 코어(name)+시설별 정규화(위치 `dtlPstn`/`bgngFlrDtlPstn`·층 `bgngFlr~endFlr`·가동현황 `oprtngSitu`·화장실 `rstrmInfo` 등)로 투영 — 카운트가 아니라 **위치·층·가동현황 인스턴스 목록**(시각장애인 정합). **`stnNm`은 "포함" 필터**라(강동→강동구청 혼입) `normalizeStationName` 정확매칭으로 제외. **`oprtngSitu` M=정상·그 외(S)=점검·중지** 보수 매핑(과소경고 회피). 9 오퍼레이션 `Promise.all` 병렬, **`totalCount>numOfRows(300)`면 throw**(포함필터 환승역 silent truncation 방지). 2026-06-17 실호출 검증(강동 4종·신도림 18시설·서울역 23시설·없는역 null). 도시철도 외 역=graceful degrade.
- **전국 도시철도역 메타** (A3, `subway-stations.ts` + `/api/station/meta` + `StationMeta` 컴포넌트): 1,098개 도시철도역의 **한/영/한자 역명 + WGS84 좌표 + 노선·환승·운영기관·도로명주소**. 출처는 전국도시철도역사정보 표준데이터(공공데이터포털 15013205)인데 **OpenAPI가 아니라 국가철도공단 레일포털(`data.kric.go.kr`)이 연 1회 갱신하는 XLSX 파일데이터**(차기 2026-12). 활용신청·키 게이트 없음 → **정적 seed 번들**이 정답. `scripts/build-subway-stations.py`(XLSX→JSON 변환기, 헤더 정합 가드·좌표 필수)로 `src/lib/data/subway-stations.json`(307KB) 생성, 갱신 시 최신 XLSX로 재실행. `subway-stations.ts`는 **순수 로직(데이터 주입형)**(`matchStationsByName` 정규화 정확매칭·`nearestStations` Haversine 근접·`summarizeStation` 노선 집계)과 **seed 바인딩 공개 API**(`findStationsByName`·`findStationsNear`·`findStationMeta`)를 분리 — 순수 로직은 fixture로 결정적 테스트(연간 seed 갱신과 독립). seed는 **서버 전용 import**(클라 번들 제외)라 `/api/station/meta` 경유. 장소 상세가 역이면(`isStation`) `StationMeta`가 진입 시 자동 fetch해 **영문역명·노선·환승을 표시**(en 로케일은 영문역명 메인·한글 보조, A1/A2 받침대 + 외국인 정합 실현). 매칭 실패=조용히 숨김(보조 정보, live region 불필요). 환승역은 같은 역명 다중 노선 행을 `lines`로 집계. 2026-06-17 실호출 검증(강남 2호선+신분당선·서울역 1·4·공항철도·부산역·대전 전국 커버·고속터미널 3·7·9 환승·없는역 null). **A2(서울 지하철 실시간)는 실시간 인증키 차단으로 보류** — 역 식별은 이 seed가 받침대.
- **TAGO 시내버스** (`tago-bus.ts` provider + `/api/bus/*` + `BusArrivals`/`BusRouteStops`): 국토부 TAGO 3종(근접정류소 15098534 → 정류소별 도착예정 15098530 → 노선 경유정류소 15098529, `DATA_GO_KR_API_KEY` 공유). 좌표 근접 정류소를 받아 Haversine로 거리 정렬(A-2가 거리순 미보장 — 산술은 코드 책임), 도착예정의 `vehicletp`로 **저상버스 정본**(`includes("저상")`) 판정. data.go.kr 표준 envelope·빈결과 `items:""`는 코레일 편의시설과 동일 가정(2026-06-14 실호출로 구조·필드명 일치 검증). **⚠ 서울 시내버스 미수록**(서울은 TOPIS 별도 운영) — 경기·지방·부산만 커버, 서울에선 정류소 0건이라 안내 메시지(`bus.empty`)로 graceful degrade. 서울 버스는 다음 마일스톤(키 전파 대기 — 아래 표 `SEOUL_OPEN_DATA_KEY` 참조).
- **따릉이 서울 공공자전거** (`seoul-bike.ts` provider + `/api/bike/nearby` + `BikeStations`): 서울 열린데이터광장 `bikeList`(OA-15493, `SEOUL_OPEN_DATA_KEY`). `openapi.seoul.go.kr:8088/{KEY}/json/bikeList/{start}/{end}/`. **bikeList엔 좌표 필터가 없어 전체(~2,720) 페이지 루프로 받아 서버 Haversine 정렬→1km cap→상위 5**. ⚠ 실측: `list_total_count`는 "전체 수"가 아니라 "그 페이지 row 수"라 **종료 조건은 "받은 row 수 < 1000"**(필드 신뢰 금지 — 버스 `totalCount` 교훈과 동형). envelope `rentBikeStatus.RESULT.CODE`(`INFO-000`만 정상, 빈결과도 `INFO-000`+`row:[]`라 그 외·RESULT부재는 throw→502)·`row[]`(`stationName` 번호접두 포함·`parkingBikeTotCnt`=대여가능·`rackTotCnt`=거치대). **캐시 60초 revalidate**(버스 no-store와 달리 전체목록 호출이 비싸고 분 단위 변동이라 허용). `canShowBike`(`hasSeoulOpenDataKey()`) 게이트로 장소상세·홈 두 곳 노출(BusArrivals와 동형 a11y). 2026-06-16 실호출 검증(길동 마루빌딩 236m 등 5건, 대여가능 실시간 반영).
- i18n: next-intl, `/ko` `/en` 경로 프리픽스, 메시지는 `messages/*.json`. **로케일별 단일 언어**(혼용 제거) + 언어 전환기(`LanguageSwitcher`)가 경로·`?q=`(`replaceState` 후 커스텀 이벤트로 동기화)·`NEXT_LOCALE` 쿠키를 보존. SSG hydration 안전(`useSyncExternalStore`, 서버 스냅샷 `""`).
- **음성 받아쓰기 (v2.1, dodo-planet 수입)**: 검색창 마이크 버튼(`VoiceRecordButton`, 탭-토글)이 `useVoiceRecorder`(MediaRecorder)로 녹음 → `/api/speech-to-text`(Deepgram Nova-2, 언어 자동감지) → 전사 텍스트로 자동 검색. 파서는 `src/lib/deepgram.ts`(순수). 마이크 권한은 별도 사전요청 없이 `startRecording`의 `getUserMedia` **단일 경로**로 처리 — 네이티브 프롬프트가 뜨고, 거부/실패를 `NotAllowedError` 기준으로 `mic_denied`/`mic_failed`로 분류한다(getUserMedia 중복 호출·오분류 제거, codex 잔여리뷰 반영 2026-06-15). 자원 안전: `getUserMedia` 직후 언마운트 가드(마이크 스트림 누수 차단)·recorder 셋업 실패 시 트랙 정리·in-flight ref·`AbortController`·`mountedRef`. **접근성**: 전사·검색 통지는 polite 단일 채널로 순차화(assertive 미사용으로 발화 경합 제거), 훅 오류는 **코드→로케일 번역**(en 사용자도 영어 오류, 한국어 하드코딩 금지), Esc 취소·미지원/거부 graceful. dodo 의존(sonner·useSound·cn·모달)은 제거하고 aria-live·토큰으로 적응.
- **PWA (v2.1)**: `app/manifest.ts`(standalone·theme_color accent·아이콘) + **수제 서비스워커**(`public/sw.js` — Serwist `@serwist/next`가 Next 16 Turbopack 미지원이라 폴백). document는 network-first(stale 페이지 금지), **API/검색은 비캐시**(`/api/` early-return — 가짜 캐시 금지), 로케일별 오프라인 폴백(`/ko/offline`·`/en/offline` 둘 다 precache), 캐시 버전드+`skipWaiting`/`clients.claim`. `SWRegister`는 프로덕션 한정 등록.

## API 키 현황 (2026-06-13)

| 키 | 상태 | 비고 |
|----|------|------|
| `KAKAO_REST_API_KEY` | **동작 확인 (2026-06-12)** | dodo-planet 카카오 앱(ID 1383407) 키 재사용(.env.local). 카카오맵 제품 활성화 완료. 이 키 하나로 **로컬 검색 + 주소 지오코딩 + 카카오모빌리티 자동차 경로**까지 모두 동작 (모빌리티는 별도 활성화 불필요, 2026-06-13 검증) |
| `TOUR_API_KEY` | **동작 확인 (2026-06-13)** | data.go.kr 국문·영문 GW 활용신청 승인(만료 2028-06-13), 실응답 검증 완료(빈 결과 `items:""`, contenttypeid 라벨 매핑 확정). 신형 GW는 **hex 64자 단일 키**(Encoding/Decoding 구분 없음, 승인 후 전파 ~10분간 401). **개발계정은 기능당 일 1,000건**(상향은 운영계정 신청). en 로케일 장소 검색은 카카오와 병합(`searchPlacesMergedEn`)되어 일상 장소+관광 영문 정보를 함께 노출 — 로컬 실호출 검증됨(2026-06-13) |
| `DATA_GO_KR_API_KEY` | **동작 확인 (2026-06-14)** | **`TOUR_API_KEY`와 동일 값** — data.go.kr은 계정당 단일 인증키라 모든 승인 API가 공유. "TOUR" 이름에 묶이지 않는 정식 별칭으로 추가(향후 TAGO 버스·열차·무장애여행 등 data.go.kr 서비스 공용). 현재 **한국철도공사 편의시설(15125774)** 승인·실호출 검증 완료: `apis.data.go.kr/B551457/convenience`의 `/stationFacilities`·`/weekPersonFacilities`(교통약자: 장애인화장실유무 `pwdbs_tolt_estnc`·휠체어리프트수 `whlch_liftt_cnt`)·`/parkingLots`·`/codes`, 각 일 10,000건, 전국 406역. **TAGO 시내버스 3종(15098534 정류소근접·15098530 도착예정·15098529 노선)도 같은 키로 활용신청·자동승인·실호출 검증 완료(2026-06-14)** — envelope(`response.body.items.item`, 빈결과 `items:""`, `resultCode "00"`)·필드명(`citycode/gpslati/gpslong/nodeid/nodenm`, `arrtime/arrprevstationcnt/routeno/routetp/vehicletp`)·저상버스 판정(`vehicletp` 실값 `"저상버스"`/`"일반차량"`) 모두 실응답 일치. **⚠ 서울 시내버스 미수록(서울시청·강동구청 totalCount 0)** — 서울은 TOPIS로 별도 운영하기 때문. **경기·지방·부산은 정상 커버**(성남 13건·하남 25건·부산역 20건 실응답). 서울 버스는 다음 마일스톤(서울 TOPIS API). **프로덕션 실호출 검증 완료(2026-06-14): `gildongmu.vercel.app/api/bus/nearby` 성남 정상(341번·9800 도착, 저상 판정)·서울 빈결과(`{"stops":[]}`), `/api/bus/route` 노선 경유정류소 정상.** **서울교통공사_교통약자이용정보(15143843, `B553766/wksn`, 9 오퍼레이션)도 같은 키로 활용신청·자동승인·실호출 검증 완료(2026-06-17)** — 서울 1~8호선 지하철역 교통약자 시설(엘리베이터·에스컬레이터·화장실 등), 코레일 도시철도 공백 보완. envelope·`oprtngSitu`(M/S)·`stnNm` 포함필터 모두 실응답 일치. 신규 API 추가는 같은 키로 data.go.kr 활용신청만 하면 즉시 자동승인 |
| `NAVER_LOCAL_CLIENT_ID/SECRET` | 미발급 | developers.naver.com 수동 등록 필요 (Claude in Chrome이 해당 도메인 차단) — 결제수단 불필요, 일 25,000회 |
| `NCP_MAPS_CLIENT_ID/SECRET` | **동작 확인 (2026-06-13)** | 결제수단 등록 후 Maps 구독 + Application `gildongmu` 등록(API 6종 전체 체크, Web URL: vercel.app·localhost:3000·3001). Geocoding(`englishAddress` 포함)·Directions 5 실호출 검증. 호스트 `maps.apigw.ntruss.com`, 헤더 `x-ncp-apigw-api-key-id`/`x-ncp-apigw-api-key`. **en 검색 카카오 카드의 영문 주소 보강에 사용 중**(`ncp-geocode.ts`, 2026-06-13 연결) — Directions는 카카오모빌리티와 중복이라 미연결 |
| `DEEPGRAM_API_KEY` | **동작 확인 (2026-06-14)** | dodo-planet `.env.local`에서 수입(공유 키). 음성 받아쓰기 STT — `/api/speech-to-text`가 Deepgram Nova-2(`nova-2-conversationalai`, smart_format·detect_language)로 전사. 서버 전용(클라 노출 금지). 프로덕션 env 등록 완료. 검색창 마이크 버튼이 이 라우트로 녹음 오디오를 전송 |
| `SEOUL_OPEN_DATA_KEY` | **동작 확인 (2026-06-16)** | 서울 열린데이터광장(data.seoul.go.kr) **일반 인증키**(30자 hex). data.go.kr과 별개 포털 — 서울 네이티브 서버(`openapi.seoul.go.kr:8088` 등) 즉시 동작. **따릉이(`bikeList` OA-15493) 실호출 검증 완료**(`INFO-000`, 길동 근처 5건). 서버 전용. **⚠ 서울 시내버스(ws.bus.go.kr/TOPIS)는 이 키로도 미동작** — data.go.kr 서울버스 3종(15000303·15000314·15000193) 활용신청 [승인]·기간 정상이나 **ws.bus.go.kr 키 동기화 배치(익일 추정) 전까지 headerCd 7**(포털 자체 미리보기도 동일 실패 → 코드 아닌 전파 문제 확정, 2026-06-16). 서울 버스는 전파 후 재개(정본 plan `docs/superpowers/plans/2026-06-15-seoul-bus-api.md`). 지하철 실시간(swopenapi)은 또 별도 "실시간 지하철 인증키" 필요. 프로덕션 env 미등록(따릉이 배포 시 등록+재배포 필요) |

상세 조사: `docs/RESEARCH-2026-06-naver-api-ecosystem.md`, `docs/RESEARCH-2026-06-kakao-api-ecosystem.md`, **`docs/RESEARCH-2026-06-domestic-api-expansion.md`**(우편번호·버스·지하철·맛집·예약·접근성 6개 도메인 + KRIC 교통약자 §I). 설계 결정: `docs/SPEC.md`.

## 배포

- **Vercel 프로덕션**: https://gildongmu.vercel.app (2026-06-13 최초 배포, 팀 `hunyong-kims-projects`)
- 프로덕션 환경변수 현황(2026-06-14): `KAKAO_REST_API_KEY`(Production), `TOUR_API_KEY`(Production/Preview/Development), `NCP_MAPS_CLIENT_ID`·`NCP_MAPS_CLIENT_SECRET`(Production — en 영문 주소 보강용), `DATA_GO_KR_API_KEY`(Production — 역 교통약자 편의시설), `DEEPGRAM_API_KEY`(Production — 음성 받아쓰기 STT, dodo-planet과 공유 키, 2026-06-14 추가). `vercel env ls production`으로 확인.
- **환경변수는 배포 시점에 함수로 주입된다** — 키를 추가/변경한 뒤에는 반드시 재배포(`vercel deploy --prod --yes` 또는 push)해야 이미 떠 있는 배포에 반영된다. 키만 추가하고 재배포 안 하면 기존 함수는 옛 env를 본다(2026-06-13 NCP 키 등록 시 실측).
- 비대화형 등록: `printf '%s' "$VALUE" | vercel env add <KEY> production`. 주의: CLI `vercel env add <key> preview`는 비대화형에서 `git_branch_required`로 멈추는 결함(54.12.2에서도 재현) — Preview 등록은 REST API(`POST /v10/projects/{id}/env`) 또는 대시보드 사용
- GitHub 저장소(`Engccer/gildongmu`)가 Vercel에 연결됨 — **push하면 자동 배포**된다. push는 사용자 요청 시에만 하는 워크스페이스 규칙이 곧 배포 게이트.
- 수동 배포: `vercel deploy --prod --yes`

## 명령어

```bash
npm run dev        # 개발 서버 (localhost:3000)
npm run build      # 프로덕션 빌드
npm run lint       # ESLint
npm run test:run   # Vitest (게이트 테스트 — 매 커밋 통과 필수)
```

## 개발 규칙

- 기능·버그픽스는 같은 커밋에 테스트 동반 (워크스페이스 공통).
- 커밋 이메일 `engccer@gmail.com` (dodo-planet과 동일).
- 코드 주석·커밋 메시지·문서: 한국어. 변수/함수명: 영어.
- a11y 변경 후에는 `a11y-auditor` 서브에이전트로 점검.
- 새 서비스 실험을 추가할 때는 `docs/SPEC.md`의 "실험 백로그" 표를 갱신할 것.
