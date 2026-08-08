# 네이버 계열 지도·장소·내비게이션 API 생태계 기술 보고서

**기준 시점**: 2026년 6월 12일 | **조사 방법**: NCP 공식 문서(guide/api.ncloud-docs.com), navermaps.github.io, NCP 공식 포럼·공지, 카카오/SK/ODsay 공식 문서 등 1차 출처 기반 (developers.naver.com은 직접 접근이 차단되어 일부 항목은 2차 출처로 보강, 해당 부분 명시)

---

## 1. NCP Maps API 전체 목록과 2026년 현재 신청 방법

### 1.1 2025년 개편의 핵심 — "AI·NAVER API 내 지도" → 독립 "Maps" 서비스

2025년에 NCP 지도 API 체계가 실제로 개편된 것이 공식 공지로 확인된다.

- **2025-03-24 공지**: "AI NAVER API ▶ 지도 API 신규 이용 신청 차단 및 무료 이용량 제공 중단 예정 안내" — 구 체계(AI·NAVER API 안의 지도 API)는 신규 신청이 차단되었다. ([ncloud 공지 1930](https://www.ncloud.com/support/notice/all/1930), [gov-ncloud 공지 499 수정본, 최종 업데이트 2025-06-24](https://gov-ncloud.com/support/notice/all/499))
- **2025-05-28 공지(6-23 수정)**: "AI NAVER API ▶ 지도 API 무료 이용량 제공 종료 안내" — **구 체계의 월 무료 이용량은 2025-06-30까지만 제공, 2025-07-01부터 구 체계는 무료 이용량 없는 전면 유료**로 전환되었다. 신규 무료 이용량은 **신규 'Maps' 상품에서만** 제공된다. ([fin-ncloud 공지 1644](https://www.fin-ncloud.com/support/notice/all/1644), 제3자 확인: [메이크샵 공지](https://www.makeshop.co.kr/newmakeshop/home/notice_view.html?t=note&uid=569))
- **콘솔 통합**: 기존 공공기관용·금융기관용 별도 콘솔은 중단 예정이며 개인/일반 기업용 콘솔로 통합되었고, 이 때문에 **신규 클라이언트 아이디 재발급이 필요**하다. ([JS SDK 공식 가이드 — 클라이언트 아이디 발급](https://navermaps.github.io/maps.js.ncp/docs/tutorial-1-Getting-Client-ID.html))

즉 2026년 현재 신규 프로젝트는 **무조건 신규 "Maps" 서비스**로 신청해야 하며, 구 AI·NAVER API 경로는 신청 자체가 막혀 있다.

### 1.2 API 목록과 엔드포인트 (신규 Maps 체계)

([Maps API 가이드 개요](https://api.ncloud-docs.com/docs/application-maps-overview))

| API | 기능 | REST 엔드포인트 (신규) |
|---|---|---|
| Dynamic Map (Web JS SDK v3 / Android·iOS SDK) | 동적 지도 | JS: `oapi.map.naver.com` (아래 1.5) |
| Static Map | 정적 지도 이미지 | `https://maps.apigw.ntruss.com/map-static/v2` |
| Geocoding | 주소→좌표 | `https://maps.apigw.ntruss.com/map-geocode/v2` |
| Reverse Geocoding | 좌표→주소 | `https://maps.apigw.ntruss.com/map-reversegeocode/v2` |
| Directions 5 | 자동차 경로(경유지 ≤5) | `https://maps.apigw.ntruss.com/map-direction/v1` |
| Directions 15 | 자동차 경로(경유지 ≤15) | `https://maps.apigw.ntruss.com/map-direction-15/v1` |

> 구 체계 엔드포인트는 `naveropenapi.apigw.ntruss.com`이었다(구 문서에 잔존). 신규 통합 후 호스트가 `maps.apigw.ntruss.com`으로 변경되었으므로 마이그레이션 시 호스트 교체가 필요하다.

### 1.3 콘솔 신청 경로와 Application 등록

([Maps 사용 가이드 개요](https://guide.ncloud-docs.com/docs/maps-overview), [클라이언트 아이디 발급 가이드](https://navermaps.github.io/maps.js.ncp/docs/tutorial-1-Getting-Client-ID.html))

1. NCP 콘솔(console.ncloud.com) → **Services > Application Services > Maps > Application** 에서 애플리케이션 등록. "AI·NAVER API" 메뉴가 아니라 **별도의 Maps 서비스 메뉴**다 (직링크: `console.ncloud.com/maps/application`).
2. 등록한 Application을 선택하면 **Client ID / Client Secret** 확인 가능.
   - REST API 호출 시 인증 헤더: `x-ncp-apigw-api-key-id`(Client ID), `x-ncp-apigw-api-key`(Client Secret).
   - JS SDK 로드 시에는 Client ID만 `ncpKeyId` 파라미터로 사용 (Secret은 웹에 노출 금지).
3. Application 등록 시 **사용할 API를 체크**해야 한다. 특히 **Dynamic Map 미체크 시 429 (Quota Exceed)** 오류가 발생하는 것이 공식 문서에 명시된 대표적 함정.
4. Web 서비스 URL 등록: Web Dynamic Map 사용 시 서비스 도메인 URL을 Application에 등록해야 한다(미등록 도메인 호출 시 인증 실패). localhost 개발 도메인도 등록 가능.
5. **리전**: Maps는 한국·미국·싱가포르·일본·독일 리전, VPC/Classic 모두 지원. 일반적인 한국 서비스는 한국 리전 기본. ([Maps 사용 준비](https://guide.ncloud-docs.com/docs/maps-spec))

> **실측 (2026-06-12)**: 결제수단이 등록되지 않은 NCP 계정은 콘솔에서 "This account cannot use the service." 메시지와 함께 Maps 신청이 차단된다. **결제수단 등록(마이페이지 > 결제 수단 관리)이 선행 조건.**

### 1.4 무료 쿼터와 과금 체계

- **과금 모델**: API 호출 수 기준 종량제. Web Dynamic Map은 "지도 로딩 시점"에만 1건 과금(로딩 후 줌/마커 조작은 무과금), Mobile Dynamic Map은 지도 뷰 onCreate 시점당 1건. ([공식 FAQ](https://www.ncloud-forums.com/topic/128/))
- **무료 이용량**: 신규 Maps 상품은 **대표 계정 1개**(개인: 휴대폰 번호 기준)에 한해 **API별 월 3,000건 ~ 최대 1억 건** 범위의 무료 이용량을 자동 제공(별도 신청 불요). 한 계정의 여러 Application 사용량은 합산. 콘솔 "한도 및 알림 설정"으로 무료 한도 내 사용 제한 가능. ([공식 FAQ](https://www.ncloud-forums.com/topic/129/), [Maps 무료 이용량 FAQ](https://www.ncloud.com/support/faq/prod/2828))
- **API별 정확한 현재 단가·무료량**: 공식 요금 페이지가 JS 렌더링이라 표 전체 직접 확인 불가 — **불확실**. 참고로 2023-01 요금 변경 공지의 공식 수치 ([NCP 포럼 공지](https://www.ncloud-forums.com/topic/99/)):
  - Web Dynamic Map: 월 1,000만 건 무료, 초과 0.1원/건
  - Static Map: 월 300만 건 무료, 초과 2원/건
  - Geocoding / Reverse Geocoding: 월 300만 건 무료, 초과 0.5원/건
- 사용 가이드 개요는 무료 이용량 제공 대상으로 **Web Dynamic Map, Static Map, Geocoding, Reverse Geocoding**을 명시. **Directions 5/15의 무료 이용량 포함 여부·단가는 공식 확인 불가(불확실)** — 콘솔 요금 계산기(`ncloud.com/charge/calc`)에서 확인 필요.

### 1.5 JS SDK v3 로드 URL과 인증 파라미터 (최신)

([공식 Hello World 가이드](https://navermaps.github.io/maps.js.ncp/docs/tutorial-2-Getting-Started.html))

```html
<script src="https://oapi.map.naver.com/openapi/v3/maps.js?ncpKeyId=YOUR_CLIENT_ID"></script>
```

- **인증 파라미터는 `ncpKeyId`** — 구 `ncpClientId`(AI·NAVER API용)는 신규 키와 호환되지 않음. 더 오래된 `clientId`(구 오픈API)도 폐기 계보.
- 비동기 로드: `&callback=초기화함수` 파라미터 지원.
- 인증 실패 훅: 전역 `window.navermap_authFailure = function () { ... }`.
- 서브모듈: `&submodules=geocoder` — 단 SDK 경유 geocoder 호출도 Application의 Geocoding 쿼터를 소모. ([geocoder 모듈 문서](https://navermaps.github.io/maps.js.ncp/docs/module-geocoder.html))

---

## 2. 네이버플레이스 / 장소 검색 API

### 2.1 developers.naver.com 지역(Local) 검색 API — NCP와 완전히 별개 체계

- **체계**: 네이버 개발자센터의 "검색 API > 지역". NCP Maps와는 **별개의 가입·키 체계** (애플리케이션 등록 후 `X-Naver-Client-Id` / `X-Naver-Client-Secret` 헤더). 엔드포인트: `https://openapi.naver.com/v1/search/local.json?query=...`
- **쿼터**: 검색 API 공통 **일 25,000회**. (공식 문서 직접 fetch 불가, 2차 출처 — 다년간 안정 유지된 공개 정책)
- **결과 수 제한**: 지역 검색은 **`display` 최대 5건** (다른 검색 API의 최대 100건과 달리 지역만 5건).
- **좌표계**: 과거 KATECH(TM128) → 변경되어 현재 `mapx`/`mapy`는 **WGS84 경위도 × 10⁷ 정수** (10,000,000으로 나누면 십진 도). 공식 문서 원문 직접 확인 불가 — **구현 시 실응답 검증 필요(불확실)**.
- **반환 필드 한계**: 업체명(HTML `<b>` 태그 포함 가능), 카테고리, 주소/도로명, 좌표 정도. **평점·리뷰·영업시간·사진 등 플레이스 상세정보는 없음**.

### 2.2 네이버플레이스 자체 공식 API — 존재하지 않음

- 네이버플레이스(m.place.naver.com)의 상세정보(리뷰, 영업시간, 메뉴, 사진)를 제공하는 **공개 공식 API는 2026년 현재 없다**. 생태계는 Apify/SerpApi류 **비공식 스크레이퍼**가 공백을 채우는 상태(약관 위반 위험).
- 스마트플레이스는 사업주용 관리 도구 — 제3자 조회용 API 아님.
- **현실적 공식 대안**: 지역 검색 API(최대 5건) + WGS84 변환 + NCP Geocoding 조합. 플레이스 상세는 업체명 기반 네이버지도 딥링크로 위임.

### 2.3 카카오 로컬 API와의 비교

([카카오 로컬 REST API 공식 문서](https://developers.kakao.com/docs/latest/ko/local/dev-guide))

| 항목 | 네이버 지역 검색 | 카카오 로컬 |
|---|---|---|
| 결과 수 | 최대 5건 | **페이지당 최대 15건 × 최대 45페이지** |
| 좌표계 | WGS84×10⁷ (변환 필요) | WGS84 그대로 |
| 상세 링크 | 없음 | **`place_url`(카카오맵 상세)** 제공 |
| 부가 필드 | 빈약 | 전화번호, 카테고리 계층, 도로명/지번 |
| 기능 폭 | 키워드 검색만 | 키워드·카테고리 검색, 주소↔좌표, 좌표→행정구역 |

**결론**: 장소 탐색 UX는 카카오 로컬이 명백히 우위. "검색은 카카오 로컬, 표시는 네이버 지도" 혼합 구성이 실무에서 흔함(단, 각 플랫폼 약관의 지도-데이터 결합 조건 확인 필요 — 불확실 영역).

---

## 3. 길찾기 / 내비게이션

### 3.1 Directions 5/15 — 자동차 전용

([Directions 5 driving 공식 문서](https://api.ncloud-docs.com/docs/ai-naver-mapsdirections-driving))

- **자동차 경로 탐색 전용.** 도보·대중교통·자전거는 **NCP에 존재하지 않는다**.
- 탐색 옵션: `trafast` / `tracomfort` / `traoptimal` / `traavoidtoll` / `traavoidcaronly`.
- 경유지 최대 5개(D15는 15개), 통행료·유류비 산출, `lang` 파라미터로 응답 한/영/일/중.

### 3.2 도보·대중교통 현실적 대안

- **TMAP (SK open API)**: 보행자 경로 `apis.openapi.sk.com/tmap/routes/pedestrian`, 대중교통 `apis.openapi.sk.com/transit/routes` (appKey 헤더). 무료 쿼터 수치는 로그인 장벽 — 불확실. ([TMAP transit 가이드](https://transit.tmapmobility.com/docs/routes))
- **ODsay LAB**: 전국 대중교통 경로검색. **Basic(무료): 일 1,000건, 6개월, 개인/학생/5인 이하** 대상. 유료는 최대 100,000건 + 다국어(국/영/일/중/베). ([lab.odsay.com](https://lab.odsay.com/))

### 3.3 네이버 지도 앱 딥링크 (nmap:// URL Scheme) — 공식 문서 존재

([공식 가이드 — 지도 앱 연동 URL Scheme](https://guide.ncloud-docs.com/docs/maps-url-scheme))

- 기본 구조: `nmap://actionPath?parameter=value&appname={호출 앱 식별자}` — **`appname` 필수**.
- actionPath: `/map`, `/search?query=`, `/place`(좌표 핀), `/route/public`, `/route/car`, `/route/walk`, `/route/bike`, `/navigation`(자동차 내비 즉시 실행).
- 길찾기 파라미터: `slat, slng, sname`(출발, 생략 시 현재 위치), `dlat, dlng, dname`(도착).
- 좌표 범위 제약: 위도 31.43–44.35, 경도 122.37–132.00 (한반도 권역).
- 미설치 폴백: Android intent URL / iOS `canOpenURL`+App Store / 모바일 웹 JS 타이머 방식 — 공식 문서가 안내.
- **시사점**: NCP에 없는 도보·대중교통 내비는 이 딥링크로 네이버 지도 앱에 위임하는 것이 가장 마찰 없는 공식 경로.

---

## 4. 접근성 (스크린 리더 / 시각장애인)

### 4.1 네이버 지도 JS SDK의 접근성 수준

- JS SDK v3는 캔버스/타일 렌더링이며 **공식 문서에 스크린 리더 접근성 서술이 사실상 없다**. Google Maps JS API가 마커 키보드 포커스·InfoWindow 접근성 라벨 등을 공식 제공하는 것과 대조적. **지도 캔버스 자체를 스크린 리더로 탐색 가능하게 만들 방법은 없다고 보는 것이 안전.**

### 4.2 권장 패턴 (지도 비의존 이중 트랙)

([Equal Entry](https://equalentry.com/accessible-maps-on-the-web/), [Sparkgeo](https://sparkgeo.com/blog/the-accessibility-of-web-maps/) 등 일반 합의)

1. **데이터의 병행 제공이 1원칙**: 지도가 보여주는 정보를 접근 가능한 리스트/테이블로 별도 제공. 지도는 enhancement.
2. 지도 컨테이너는 `role="application"` 또는 `<figure>`+`aria-label`, 혹은 `aria-hidden` 처리 후 인접 리스트로 안내.
3. **상태 변경은 ARIA live region**: "결과 5건", "도보 12분, 850m" 등을 `aria-live="polite"`로.
4. **거리·방향의 텍스트화**: "북동쪽 300m" 단계별 텍스트를 Directions/TMAP guidance에서 생성.
5. 지도 위 컨트롤은 실제 `<button>`+`aria-label`.

### 4.3 해외 사례

- **Google Maps**: JS API 접근성 개선이 공식 로드맵 — 접근성 요구가 극히 높으면 한국 데이터 한계에도 병행 검토 가치. ([Google 공식 블로그](https://mapsplatform.google.com/resources/blog/latest-accessibility-updates-maps-javascript-api/))
- **Soundscape 계열**: MS Soundscape 종료(2023) 후 오픈소스화 → 후속 **VoiceVista**가 활발 유지보수(2025-06 v2.0.3). 3D 오디오 비콘 기반 보행 안내의 대표 사례. ([VoiceVista](https://drwjf.github.io/vvt/index.html))

---

## 5. 다국어 / 외국인 지원

- **JS SDK 라벨 다국어**: 로드 시 `language` 파라미터 — **`ko` / `en` / `zh` / `ja`**. ([공식 Language 튜토리얼](https://navermaps.github.io/maps.js.ncp/docs/tutorial-Language.html))
- **Static Map**: `lang` 파라미터 en/ja/zh.
- **Geocoding**: `language=kor|eng`, 응답 `englishAddress` 필드 — **영문 주소 출력 공식 지원**. 영문 주소 *입력* 정확도는 불확실.
- **Directions**: `lang` 한/영/일/중.
- **지역 검색 API**: 다국어 미지원 (한국어 질의 전제) — 외국인 대상 검색은 자체 번역 레이어 필요.

---

## 6. Next.js 16 (React 19, TypeScript) 통합 전략

### 6.1 JS SDK 통합

- 지도는 클라이언트 컴포넌트 전용. `next/script` `strategy="afterInteractive"` + `onReady`, 또는 dynamic import `ssr: false`.
- Client ID는 `NEXT_PUBLIC_` 노출 가능(도메인 화이트리스트가 보호). **Secret은 절대 클라이언트 금지.**
- 타입: `@types/navermaps`.

### 6.2 react-naver-maps 래퍼 — 활발히 유지보수 중

([GitHub zeakd/react-naver-maps](https://github.com/zeakd/react-naver-maps))

- 최신 **v0.2.2 (2026-06-03)** — 활성 유지보수 확인. **v0.2는 React 19 전용**, Suspense 기반 로딩, `@types/navermaps` 기반 TS.
- **`ncpKeyId` prop 직접 지원** — 2025 개편 체계 대응됨.
- 비공식 래퍼 유의. 지도 1~2개 화면이면 직접 로드도 충분.

### 6.3 서버 프록시 패턴 — Geocoding/Directions는 서버 호출 필수

- REST API는 Client Secret 헤더 필요 → 브라우저 직접 호출 시 노출. CORS도 일반적으로 비허용.
- 권장: Route Handler(`app/api/*/route.ts`)에서 입력 검증·rate limit·응답 캐싱(주소→좌표 캐시 적중률 높음 — 쿼터 절약).
- 예외: JS SDK `submodules=geocoder` 경유는 클라이언트 가능하나 쿼터 동일 소모.

---

## 7. 종합 권고

1. **신규 진입은 무조건 신규 Maps 상품** (`console.ncloud.com/maps/application`, `ncpKeyId`). 구 체계는 신청 차단 + 무료량 종료.
2. **장소 검색**: 공식 경로는 지역 검색 API(일 25,000회, 최대 5건)뿐. 풍부함 필요 시 카카오 로컬 병행이 현실적.
3. **길찾기**: NCP는 자동차 전용. 도보는 TMAP, 대중교통은 ODsay/TMAP, 최종 내비는 `nmap://` 딥링크 위임.
4. **접근성**: 네이버 지도 캔버스는 스크린 리더 비접근 — 리스트 기반 병행 UI + ARIA live region + 텍스트 경로 안내를 설계 1급으로.
5. **다국어**: JS SDK `language=en|ja|zh`, Geocoding `englishAddress`. 장소 검색 다국어는 공백.
6. **Next.js 16**: 클라이언트 컴포넌트 + Route Handler 프록시로 Secret 격리.

**불확실로 남은 항목**: ① 신규 Maps 상품의 API별 현행 무료량·단가 표(콘솔 요금 계산기 확인 필요), ② Directions 무료 이용량 포함 여부, ③ 지역 검색 좌표계 변경의 공식 문서 원문, ④ TMAP 무료 쿼터 수치, ⑤ 네이버-카카오 데이터 혼용 약관 적합성.
