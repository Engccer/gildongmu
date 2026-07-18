> 🤖 **이 파일은 자동 생성됩니다. 직접 수정하지 마세요.**
> 정본은 `CLAUDE.md` 입니다. 내용을 바꾸려면 `CLAUDE.md` 를 수정한 뒤
> 프로젝트 루트에서 `python sync_agent_docs.py` 를 실행하세요.
> 이 파일을 직접 고치면 다음 동기화 때 경고와 함께 덮어쓰기 대상이 됩니다.

<!-- SYNC-BODY-START: 이 줄 아래 본문은 CLAUDE.md 와 100% 동일하게 자동 생성됨 -->
# CLAUDE.md — 길동무 (gildongmu)

> Next.js 16 주의: 학습 데이터와 컨벤션이 다를 수 있다. 코드 작성 전 `node_modules/next/dist/docs/`의 관련 가이드를 먼저 읽을 것 (요청 API 전부 비동기: `await params`, `await cookies()`; `middleware.ts` 대신 `proxy.ts`).
>
> **진행상황·실호출 검증 로그·미해결 결정은 `PROGRESS.md`**, 설계 정본은 `docs/superpowers/specs`·`plans`. 이 파일은 **항구 규칙·패턴·함정만** 담는다(매 세션 컨텍스트에 전량 로드되므로 비대화 금지).

## 프로젝트 정체성

**국내 서비스 연동 실험실.** 네이버·카카오를 시작으로 대한민국 로컬 서비스 API(지도·내비·장소·예약·관광)를 계속 발굴·추가하며, 접근성 우선 미니멀 UI로 실험한다. 두 사용자 집단이 1급 시민:

1. **시각장애인** — 스크린 리더만으로 전체 흐름(검색 → 장소 정보 → 길찾기)이 완결되어야 한다.
2. **한국 방문 외국인** — 한국어를 몰라도 쓸 수 있는 미니멀한 영어 UI.

**궁극 목표**: 검증된 기능을 `~/Mac-Projects/dodo-planet/`(가족 여행 가이드 PWA)에 통합한다. 이 저장소는 인큐베이터 — **스택·컨벤션을 dodo-planet과 일치**시키고(next-intl 4, zod 4, Vitest 4, App Router), `src/lib/`는 React/Next 비의존으로 유지해 이식성을 보장한다.

## 절대 원칙: 접근성

기준 정본은 글로벌 접근성 헌장 `~/.claude/ACCESSIBILITY.md`(과잉 ARIA 금지, WCAG 실질 요구는 100%, "한 줄=한 객체", landmark "발견 경로" 규칙). 아래는 그 헌장을 이 repo 코드에 구체화한 것 — 일반 원칙은 헌장이 정본이고 여기엔 repo 고유 디테일(구체 파일 경로·컴포넌트명·계층)만 남긴다:

- **정보의 정본은 리스트/텍스트 UI다. 지도는 시각 보조 레이어다.** 지도 SDK는 캔버스라 스크린 리더 접근 불가 — 지도에만 존재하는 정보가 있으면 버그다.
- 상태 변화(검색 결과 수·오류·경로)는 단일 polite `aria-live`로 통지. 키보드 도달 + `:focus-visible` 필수. 터치 타깃 ≥44×44px(`min-h-11`). UI 라벨에 이모지 금지.
- **버튼 비활성화는 `disabled` 대신 `aria-disabled` + 핸들러 가드** — `disabled`는 포커스를 제거해 SR 사용자가 맥락 상실. 비동기 트리거는 **in-flight ref 가드**(`useRef(false)`+`finally`)를 병행(클로저 가드만으론 더블클릭 중복 호출 못 막음).
- **자동 등장 보조 섹션은 region 랜드마크 유지**(`<section aria-labelledby>`+`useId`+`<h3 id>`). 버튼 없이 조용히 fetch되어 나타나는 섹션(`AirQuality`·`StationMeta` 류)은 region이 **유일한 발견 수단**이라 "불필요한 region" 아님. ⚠ 죽은 코드 청소 시 이 `aria-labelledby`·`useId` 제거 금지. **버튼으로 펼치는 패널은 버튼이 발견 경로라 `<div>` 유지**. 판단 규칙: "사용자가 직접 펼쳤나(버튼·div) vs 조용히 나타났나(자동·region)".
- **"내 주변" 결과 각 항목 이름은 `<h4>`**(6종 nearby). 정적 정보 리스트라 발견 경로(버튼)가 없어 heading이 유일한 빠른 점프 수단(자동 등장 섹션과 동형). 계층: nearby 섹션 헤더 `h3` → 항목 `h4`(장소 상세는 장소명 `h2`→nearby `h3`→항목 `h4`). 정류소·역은 이름만 `h4`, 도착편 목록엔 heading 미부여(과잉). **신규 nearby 항목 이름은 `<h4>`로.**
- **한 줄 = 한 접근성 객체 (시각 목적 인라인 분절 금지).** 한 항목의 한 줄(역명+노선+거리, 라벨+값)을 시각 스타일용 인라인 `<span>`(`opacity-70` 흐림, `text-xs` 작게, `font-medium` 라벨, `bg-accent` 배지, `ml-N` 간격)으로 쪼개면 **각 span이 별도 접근성 객체**가 되어 VoiceOver가 조각마다 멈춘다 — 한 항목 읽는 데 스와이프 여러 번(가운뎃점까지 별도 객체). Chrome 접근성 트리로 실측 확정. **수정 정본: `joinText(...)`(`src/lib/format.ts`)로 한 줄을 단일 텍스트로 합친다** — falsy 조각 자동 제거(선택 항목은 `cond && text`), 구분자는 쉼표(가운뎃점은 일부 SR이 단어로 낭독해 금지). 의미 있는 배지(급행·환승·실내/외)는 장식이 아니라 정보이므로 **텍스트로 흡수**(제거가 아니라 합침). **인터랙티브 요소(`tel:` 전화 `<a>`·버튼·입력)는 별도 객체가 정상 — 절대 합치지 말 것.** 글로벌 CLAUDE.md "한 줄 = 한 접근성 객체" 정본.
- **definition list(`<dl>/<dt>/<dd>`)는 단순 라벨-값에 금지.** SR이 항목마다 "용어/정의" 역할과 콜론을 별도 낭독해 "표처럼" 읽힘. **평문 단일 텍스트** `<p>{`${라벨} ${값}`}</p>`로(콜론 제거). ⚠ 과거엔 `<span class="font-medium">라벨</span>`로 라벨만 볼드 처리했으나 **그 라벨 span도 별도 객체로 분절**되므로(위 "한 줄 = 한 객체") 라벨 볼드를 포기하고 라벨+값을 한 텍스트로 합친다. `<html lang={locale}>`가 있어 콘텐츠 언어 == 로케일이면 `lang` 속성 불필요, 다국어는 `prefersEnglish`로 현재 언어 하나만.
- **이미 보이는(SR 노출되는) 콘텐츠를 live region에 복제하지 말 것**(WAI-ARIA 모범). 채팅 답변 산문을 sr-only로 복제했다가 회전자에서 중복 낭독된 회귀가 있었다 — 답변은 보이는 `MessageBubble` 한 곳에만.
- **iOS 채팅(탭·장소 sheet)은 헌장 §6 "대화형 UI"가 정본**(실측 근거·iOS 번역표는 `~/.claude/reference/accessibility.md`). repo 구현 정본: 산문 블록 분할 `parseChatMarkdownBlocks`(GildongmuKit)+블록별 `Text`(헤딩 `.isHeader`), 질문 말풍선 헤딩 trait, 전송 즉시·완료 시 포커스=마지막 질문 헤딩(`questionRevision`/`answerRevision` 신호, `ios/Gildongmu/Chat/ChatConversationView.swift`), 마이크 라벨 "받아쓰기 시작/중지"(내용-라벨 충돌 금지).

## 아키텍처

```
클라이언트 컴포넌트 ──fetch──▶ Route Handler (src/app/api/*) ──▶ 외부 API
                                 (Secret은 서버 전용 env에만 존재)
```

### Provider 추상화 패턴 (신규 국내 서비스 추가 시 따른다)
- `src/lib/providers/`에 도메인별 단일 진입점(예: `searchPlaces()`)이 키 유무로 provider 자동 선택. **provider 파일 추가 → 진입점에 선택 로직 → 게이트(`hasXKey()`).**
- **게이트 패턴**: 키 없으면 도구·섹션·버튼·import **전부 0**(死기능·회귀 0). 채팅 declaration도 게이트(`availableDeclarations()`가 통과분만 Gemini 노출 → LLM이 호출 불가).
- **mock으로 조용히 폴백 금지**(가짜 실데이터 금지). 키 없음→null·섹션 미노출, upstream 장애→throw→502.

### 횡단 함정 (반복 적용 — 새 통합마다 점검)
- **좌표는 WGS84 십진 통일.** 단 외부 API별 변환 함정: 에어코리아 측정소=**TM중부원점 EPSG:2097**(proj4, ⚠ 카카오/네이버의 EPSG:5181 아님 — false E/N 같아 혼동, Δ300m+) / 기상청=**격자 nx,ny LCC**(`dfs_xy_conv` 직접 이식) / 네이버 `mapx/mapy`(×10⁷ 정수)는 provider 내부만.
- **envelope 비표준 주의**: data.go.kr 표준은 `response.body.items.item[]`·빈결과 `items:""`인데 — 에어코리아는 `body.items`가 **직접 배열** / 서울버스(TOPIS)는 `msgHeader.headerCd`(0정상·4빈결과·그외 throw)+`msgBody.itemList`(ServiceResult 래퍼 없음) / 서울지하철은 정상/에러에서 code 위치가 다름(`errorMessage?.code || code`).
- **단위 함정**: NCP Directions `duration`=**밀리초**(카카오·`durationSeconds`=초, 미변환 시 28분→468시간). ODsay `totalTime`=분·`payment`=원·`totalWalk`=미터.
- **3-state 불변식 (시각장애인 정합)**: "0대/없음"과 "정보 없음(`unknown`)"과 "조회 실패(throw→502)"를 **절대 뭉개지 않는다**. 도착·진료·공기질·날씨·시설 전반에 적용. 해석 불가한 수치는 숨기고 등급 단어를 정본으로.
- **도착 낭독 정본은 완성 문장 필드**: 서울버스 `arrmsg1`·지하철 `arvlMsg2`("곧 도착"·"전역 출발"). ⚠ `traTime1`/`barvlDt`를 슬롯형으로 환산하면 운행종료에도 비0이라 오발화. 한 도착 항목이 1·2번째 버스를 슬롯 페어(`arrmsg1`·`arrmsg2`)로 주므로 둘 다 투영(슬롯2는 메시지가 다를 때만).
- **거리순 정렬은 코드 책임**(Haversine). 좌표 필터 없는 목록 API(따릉이·소아진료)는 전체 받아 서버 정렬→cap. ⚠ `totalCount`/`list_total_count`는 "그 페이지 row 수"일 수 있어 **신뢰 금지** — 종료조건은 받은 row 수. 카카오 키워드 거리순은 `x`/`y`/`sort=distance`+**radius 미지정**(0건 위험 회피).
- **캐시**: 실시간(지하철·버스 도착)=`no-store`+`force-dynamic`, 준정적=`revalidate`(역메타 86400·공기질 600·날씨 1800·주소 3600).

### UI·상태 패턴
- **현재 위치는 공유 스토어 1곳에서만**(`src/lib/geolocation.ts` 모듈 싱글턴 + `useGeolocation`). 신규 "내 주변"은 `getCurrentPosition` 직접 호출 금지, `awaitGeolocation()` 사용(권한 팝업 세션 1회). **"새로고침"은 `awaitGeolocation({force:true})`**로 정밀 재취득(`PRECISE_OPTS`), ⚠ 실패 시 직전 `done` 데이터 복원(`prevStatus`, 새로고침=재조회이지 데이터 포기 아님).
- **"내 주변" 패널은 닫기·Esc·아코디언으로 접는다**(`nearby-panel-store.ts` 싱글턴 + `useNearbyPanel`). `claim()`/`close(restoreFocus)`. **포커스 비대칭**: 직접 닫기·Esc는 `restoreFocus=true`(trigger 복귀), 다른 패널이 점유 가져가 자동 닫힐 땐 `false`. ⚠ 채팅 오버레이가 열린 동안은 `engaged:false`로 패널 Esc 비활성(스택된 전역 Esc 경합 — [[stacked-global-esc-listener-conflict]]).
- **검색→상세 흐름**: 단일 검색창, 카테고리 칩 필터, 장소 선택 시 **History API 뷰 전환**(카카오는 ID 단건조회 없어 메모리 `Place`로 상세). `?q=` URL 동기화 + request-id ref로 stale 응답 폐기.
- **검색창 3섹션 결정론 병렬**: 장소(`/api/places`)+주소(`/api/address/search` juso 무료)는 **매 검색 병렬**(`Promise.all`), 웹(`/api/search/web` Perplexity)은 **둘 다 0건일 때만 폴백**. ⚠ **Gemini 자연어 라우터 폐기**(LLM을 deterministic 위에 얹은 안티패턴 — "위스키바→바→미용실"로 멀쩡한 쿼리 악화, [[gildongmu-search-router-removed-llm-antipattern]], 부활 금지). 웹 비용방어: IP 레이트리밋(60초 30회)+쿼리 1h 캐시(`unstable_cache`), 실패는 throw로 캐시 회피. 섹션 순서는 건수 내림차순(`orderResultSections`), 통지는 단일 polite 합산(`combinedLiveMessage`), 포커스는 전부 settled 후 1회. **명소(`/api/places/attractions`)는 4번째 병렬 섹션**(ko만) — 거리순과 반대 정렬(정확도순)이라 별도 호출, 결과 있으면 **건수 무관 최상단**(랜드마크 의도 신호가 가장 강함). settled·포커스·통지 판정에 명소도 편입([[gildongmu-landmark-attraction-search]] 스펙 `docs/superpowers/specs/2026-07-01-landmark-attraction-search-design.md`).
- **딥링크로 네이티브 앱 위임**: 실주행 내비는 `nmap://`(`deeplink.ts`)·`kakaomap://`(`deeplink-kakao.ts`). 자체 구현은 "출발 전 미리 듣기" **텍스트 브리핑만**(자동차·대중교통), 실주행은 위임 유지.
- **데이터 언어 분리**(`src/lib/data-locale.ts`): 외부 API는 ko/en만 제공 → 비한국어(en/es/fr/it)는 영문 데이터 공유. **외부 fetch·영문 분기에 `useLocale()` 원시값 직접 금지, `dataLocale`/`prefersEnglish` 경유**(예외: STT Deepgram은 es/fr/it 직접 인식). i18n 키 일관성은 `i18n-messages.test.ts`가 머지 게이트. 언어 선택 UI는 disclosure 메뉴(국기 이모지 금지, 각 언어 자국어 텍스트+`lang` 속성).

### 채팅 (Gemini function-calling)
- `src/lib/chat`·`src/lib/gemini`는 **React 비의존**(dodo 이식성). 진입은 **장소 상세/근처 항목의 "이 장소에 관해 물어보기" 오버레이**(`ChatOverlay` 모달, `canShowChat`=`hasGeminiKey()`). 장소마다 새 대화. ⚠ 과거 메인 페이지 검색⇄채팅 모드 토글은 폐기(`ModeToggle`·`mode-state.ts` 전부 제거, `PlaceSearch`는 순수 검색).
- **에이전트 루프**(`agent-loop.ts` `runAgentLoop`, maxIterations=6): functionCall→`Promise.allSettled` 병렬→관찰 반복, renders·sources 누적. `/api/chat`은 **NDJSON 스트리밍**(`maxDuration=120`). 도구 throw가 루프 안 죽임, 빈 text는 1회 폴백, 카드는 done에서 1회 마운트(중복 낭독 차단).
- **장소 앵커 불변식**: `placeContext` 있으면 주변 도구는 `anchorOf(ctx)`=장소좌표 기준, 단 **길찾기 출발지는 실제 `userLocation`**(장소로 안 덮음). 장소 앵커 시 기기위치 nearby 카드는 render 생략(산문이 정본). `placeContext` 없으면 동작 byte-identical.
- **⚠ 장소 특징 날조 금지**: 도구가 준 필드만 — Gemini가 카페 분위기·평판을 사전지식으로 날조하면 시각장애 사용자가 검증 불가([[agentic-llm-fabricates-unstated-fields]], systemInstruction에 명시). 도구는 provider 직접 import 호출(`ToolResult{data,render?,source?}`), self-fetch 카드+출처(`SourceList`) 노출, `data`는 LLM에만(PII 누수 차단).
- **마크다운 답변**(`react-markdown`+`remark-gfm`): 헤딩은 강조 단락으로 다운그레이드(아웃라인 오염 방지). ⚠ **loose list `remarkTightLists`로 tight 강제** — `<li><p>` 중첩이 iOS VoiceOver 이중 낭독([[markdown-loose-list-voiceover-double-read]]). 완료 통지는 효과음(`playReceive`)+포커스 이동(진행만 live region).
- **15개 도구**: 장소2(검색·주소)·내주변5(소아진료·아이놀곳·둘러보기·지하철·무장애관광지)·좌표3(버스·따릉이·공기질)·역명2·길찾기2·웹검색1(`search_web` Perplexity). 각 게이트. `get_bus_route`는 V1 제외.

### 통합 카탈로그 (provider · route · 핵심 함정)
세부 구현·검증은 각 spec(`docs/superpowers/specs`) 참조. 새 통합 추가 시 위 횡단 함정·게이트 패턴을 적용.

| 도메인 | provider / route | 핵심 함정·정본 |
|---|---|---|
| 장소 검색 | kakao-local(+naver-local ko 병합) / `/api/places` | 좌표 거리순(`buildKakaoSearchUrl`). ko는 両키 보유 시 `searchPlacesMergedKo` 병합(카카오 15 primary + 네이버 5 보강, 좌표 4자리 dedupe, 좌표 시 Haversine 재정렬 — 네이버는 거리 정렬·좌표 필터 없음). 카카오 미등록 가게 보강(여의도 "백년찌개집 1971" 실측 2026-07-18). 폴백 kakao>naver>mock |
| 관광지·명소 | 디스패처 `attractions.ts` → ko: kakao-attractions / en: tour-api / `/api/places/attractions` | **로케일 분기**(`searchPlaces` 동형): ko=카카오 정확도순→`category_name.startsWith("여행 > 관광,명소")` 필터(⚠ **AT4 group code 아님** — 부속 명소는 group code 빈 문자열, 실호출 확정), en=TourAPI EngService2 `searchKeyword2`+**서버측 `contentTypeId=76`**(Tourist Attraction, 영문명·매장 배제, ⚠ 78 Cultural Facility 제외로 ko parity). cap 5, 좌표 시 Haversine 거리. **정렬 비대칭**: ko는 정확도순 유지, en은 좌표 있으면 **거리순**(TourAPI엔 정확도 arrange 없어 먼 동명 청도·경주 남산이 상단에 옴 — 실호출 확정, 근접성이 유일 관련도 신호). "경복궁"류 랜드마크가 거리순에 밀려 안 나오던 문제 해결(경복궁 1건이라 en 정렬 무영향). **결과 있으면 최상단 병치**(`orderResultSections` 4번째 인자, 건수 무관 unshift). 게이트 `hasKakaoKey`\|\|`hasTourApiKey` |
| en 장소 | `searchPlacesMergedEn` | 카카오+TourAPI 병렬 병합, 중복=좌표 4자리. 영문주소 juso→NCP 폴백 |
| 주소·우편번호 | juso `searchJusoAddresses` / `/api/address/search` | 좌표는 카카오 `/api/geocode` 재사용. `engAddr`는 국가명 미포함 |
| 코레일 역시설 | korail-facilities / `/api/station/facilities` | 406역 전체 받아 `normalizeStationName` 클라 매칭, `stn_cd` 조인 |
| 서울 지하철역 시설 | seoul-metro-facilities (9 op) | 도시철도 보완, `stnNm` 포함필터→정확매칭 제외, `totalCount>300` throw |
| 도시철도역 메타 | subway-stations (정적 seed) / `/api/station/meta` | XLSX→JSON 연1회 갱신(`scripts/build-subway-stations.py`), 서버 전용 import |
| 서울 지하철 실시간 | seoul-subway-arrival / `…/subway-arrival[/nearby]` | `arvlMsg2` 정본, 역명 기반(seed `findStationsNear`로 근접역), 부분실패 보존 |
| 시내버스 | tago-bus + seoul-bus → `src/lib/bus.ts` 병합 | 지방=TAGO·서울=TOPIS, `mergeBusStops` allSettled, envelope 다름(위 참조) |
| 따릉이 | seoul-bike / `/api/bike/nearby` | 전체 페이지루프+서버 Haversine, row 수<1000이 종료조건 |
| 소아 야간진료 | night-clinic NMC / `/api/clinic/nearby` | 좌표 보유는 `getBabyListInfoInqire`(15001674은 좌표 없음), 진료 3-state(KST) |
| 공기질·날씨 | air-quality + weather → `LocalConditions` | 단일 region, 두 fetch 독립(allSettled), 좌표계 TM/격자(위 참조) |
| 아이 놀 곳 | kids-places / `/api/places/kids` | 카카오 키워드→`category_name` 화이트리스트(키워드 매칭≠키즈), 실내/외 3-state |
| 둘러보기 | surroundings / `/api/places/around` | 카카오 카테고리(10종)+8방위(`bearing.ts`), ⚠ heading 없어 정면-상대 방향 금지 |
| 현재 위치 정위 | where-am-i / `/api/where-am-i` | 4조각 allSettled 조립, 산문은 결정론 템플릿(LLM 아님), `stripRegionPrefix` 중복제거 |
| 무장애 여행 정보 | tour-barrier-free / `/api/places/barrier-free[/detail/match]` | 한국관광공사 KorWithService2(B551011). 편의시설 화이트리스트 라벨링(⚠ 필드 철자는 실호출 확정), 장소상세 매칭 좌표50m∩이름(코드 거리 가드 병행). **게이트·인증 모두 `DATA_GO_KR_API_KEY`로 일치**(split-brain 금지). ⚠ 활용신청 별도(API별 독립 승인) |
| 자동차 경로 | 카카오모빌리티(ko) / ncp-directions(en) / `/api/route/car` | en=NCP 영문 턴바이턴, NCP duration=ms(위 단위 함정) |
| 대중교통 | odsay / `/api/route/transit` | 환승도보 `{distance:0}` leg 제외, error -98→null. **URI(도메인) 식별**: 서버 fetch가 `Referer: https://gildongmu.vercel.app/` 명시(IP 무관 — Vercel 가변 IP 해소). ⚠ ODsay 키는 발급 시점 플랫폼에 묶임 — Server 키에 URI 추가해도 referer 식별 불가, URI 전용 앱 키여야 함(PROGRESS 2026-07-04) |
| STT | Deepgram nova-3 / `/api/speech-to-text` | ⚠ `detect_language` 금지(ko→vi 오인식), `language` 명시. 효과음으로 시작/정지 통지 |
| 채팅 웹검색 | perplexity-search / `search_web` 도구 | `ToolResult{data,render,source}`, 결과 카드+출처 노출 |

## API 키 현황

전부 **서버 전용 env**(클라 노출 금지). 게이트 함수가 키 유무를 판정해 死기능을 막는다.

| 키 | 게이트 | 용도·비고 |
|---|---|---|
| `KAKAO_REST_API_KEY` | `hasKakaoKey` | 로컬검색+지오코딩+카카오모빌리티 자동차경로 (dodo 앱 공유, 1개로 전부) |
| `TOUR_API_KEY` = `DATA_GO_KR_API_KEY` | `hasDataGoKrKey` | **동일값** — data.go.kr 계정당 단일키. 코레일·TAGO·서울지하철역시설·소아진료·공기질·날씨·무장애여행정보 공유. 신규 추가는 활용신청만. ⚠ 신규 provider 인증은 게이트와 같은 `DATA_GO_KR_API_KEY`로(`TOUR_API_KEY`로 인증하면 게이트와 split-brain — 거짓 "없음" 음성 위험) |
| `NCP_MAPS_CLIENT_ID/SECRET` | `hasNcpMapsKeys` | en 영문주소 보강 폴백 + en 자동차경로. 헤더 `x-ncp-apigw-api-key-id`/`-key` |
| `JUSO_CONFM_KEY` | `hasJusoKey` | 행안부 도로명주소 검색(영문주소+우편번호), 무료·무제한 |
| `SEOUL_OPEN_DATA_KEY` | `hasSeoulOpenDataKey` | 서울 열린데이터(따릉이). ⚠ 실시간 지하철은 별도 키 |
| `SEOUL_SUBWAY_REALTIME_KEY` | `hasSeoulSubwayRealtimeKey` | "실시간 데이터 인증키"(일반키로 호출 시 `ERROR-338`), 일 1,000회 |
| `ODSAY_API_KEY` | `hasOdsayKey` | ODsay 대중교통 — URI 전용 앱 `gildongmuweb` 키(~2027-01-04, 일 1,000회). ⚠ `+`/`/` 포함이라 **URL 인코딩 형태로 저장**(provider가 raw로 URL에 붙임), 만료 갱신·dodo 이식 시 해당 도메인 URI 앱 등록 |
| `DEEPGRAM_API_KEY` | — | STT nova-3 (dodo 공유). ⚠ prod 502면 키 유효성 먼저([[deepgram-prod-key-401]]) |
| `GEMINI_API_KEY` | `hasGeminiKey` | 채팅 FC 엔진(`GEMINI_MODEL=gemini-3.5-flash`). dodo `GOOGLE_GENERATIVE_AI_API_KEY` 공유 |
| `PERPLEXITY_API_KEY` | `hasPerplexityKey` | 검색창 웹섹션 + 채팅 `search_web`. 유료($5/1,000req). dodo 공유 |
| `NAVER_LOCAL_CLIENT_ID/SECRET` | `hasNaverLocalKeys` | 네이버 지역검색(ko 장소 병합 보강). 2026-07-18 발급(수동 — Claude in Chrome이 naver 도메인 차단). 일 25,000회, 결과 최대 5건 |

상세 키 발급 경로·실호출 검증 이력은 `PROGRESS.md`, API 생태계 조사는 `docs/RESEARCH-2026-06-*.md`.

⚠ **prod 채팅/STT가 502면 코드보다 키 등록 유효성을 먼저 의심**([[vercel-env-add-noninteractive-bug]]·[[deepgram-prod-key-401]]). 검증은 `env pull` 길이가 아니라 실호출로([[vercel-prod-env-pull-redacts-encrypted]]).

## 배포

- **Vercel 프로덕션**: https://gildongmu.vercel.app (팀 `hunyong-kims-projects`). GitHub `Engccer/gildongmu` 연결 — **push하면 자동 배포**.
- **env 변경 후 반드시 재배포**(키는 배포 시점 함수 주입). 수동 배포 `vercel deploy --prod --yes`.
- 비대화형 등록 `printf '%s' "$VALUE" | vercel env add <KEY> production`(`vercel@latest` 사용 — 구버전 빈값 버그 [[vercel-env-add-noninteractive-bug]]). Preview는 `git_branch_required` 결함이라 REST API/대시보드.
- ⚠ **배포 직후 React #418(hydration) transient**는 스테일 SW 캐시 탓, 코드 결함 아님([[pwa-stale-sw-deploy-hydration-418]]) — dev 클린·캐시제거 먼저 확인. PWA는 수제 서비스워커(`public/sw.js`, Serwist가 Next 16 Turbopack 미지원이라 폴백), document network-first·`/api/` 비캐시.

### CLI/MCP 릴리스 (`packages/cli`=npm `gildongmu`, `packages/mcp`=npm `gildongmu-mcp`)

- 발행은 `cli-v*` 태그 push → `.github/workflows/cli-publish.yml`이 두 패키지를 npm Trusted Publishing(OIDC)으로 자동 발행. 토큰·환경변수 불필요.
- 릴리스 절차: 두 packages/*/package.json 버전 동조 갱신 → 커밋 → `git tag cli-v<버전> && git push origin main --tags`.
- ⚠ `--provenance` 금지(private repo, 404로 위장된 422, dodo Round 119 실측). 카탈로그(`endpoint-catalog-shared.ts`) 수정 시 cli·mcp 両미러 동일 유지(drift 테스트가 강제).

## 명령어

```bash
npm run dev        # 개발 서버 (localhost:3000)
npm run build      # 프로덕션 빌드
npm run lint       # ESLint
npm run test:run   # Vitest (게이트 테스트 — 매 커밋 통과 필수)
```

## 개발 규칙

- 기능·버그픽스는 같은 커밋에 테스트 동반(node-env Vitest엔 컴포넌트 와이어링 레인 없음 → 순수 로직은 fixture 단위테스트, 컴포넌트는 lint+build+**실호출이 머지 게이트**).
- **외부 API 통합은 실호출(실데이터)을 머지 게이트로 박는다** — fixture green ≠ 실계약 검증(데이터 커버리지 현실은 정적 리뷰가 못 잡음).
- 커밋 이메일 `engccer@gmail.com`. 주석·커밋·문서 한국어, 변수/함수명 영어.
- a11y 변경 후 `a11y-auditor` 서브에이전트 점검. 새 서비스 추가 시 `docs/SPEC.md` "실험 백로그" 갱신.
- gildongmu는 리뷰 게이트 통과 후 묻지 말고 commit+push(자동배포 포함, [[gildongmu-auto-commit-push]]). `git add -A` 금지, 의도 파일만([[commit-stage-explicit-files]]).
