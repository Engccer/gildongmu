# 카카오 계열 API 생태계 기술 보고서

**기준일**: 2026년 6월 12일 | **조사 방법**: developers.kakao.com, apis.map.kakao.com, developers.kakaomobility.com 등 공식 문서 및 카카오 데브톡 공지 직접 확인
**전제 맥락**: 시각장애인 접근성·외국인 여행자를 1급 요구사항으로 두는 장소 검색·내비게이션 연결 웹앱(Next.js 16). 네이버 측 조사 완료(지역 검색 5건 제한, NCP Directions 자동차 전용, 네이버플레이스 공식 API 부재). 카카오 개발자 계정 및 앱(dodo-planet 카카오 로그인용)이 이미 존재.

---

## 1. 카카오 로컬(Local) REST API

출처: https://developers.kakao.com/docs/latest/ko/local/dev-guide

### 1.1 엔드포인트 일람

베이스: `https://dapi.kakao.com`, 인증: `Authorization: KakaoAK ${REST_API_KEY}` 헤더(서버 측 호출). 응답은 JSON/XML.

| 기능 | 엔드포인트 | 비고 |
|---|---|---|
| 키워드로 장소 검색 | `GET /v2/local/search/keyword.json` | 핵심 API |
| 카테고리로 장소 검색 | `GET /v2/local/search/category.json` | 카테고리 그룹 코드 필수 |
| 주소 → 좌표 | `GET /v2/local/search/address.json` | 지번/도로명 모두 |
| 좌표 → 주소 | `GET /v2/local/geo/coord2address.json` | 역지오코딩 |
| 좌표 → 행정구역 | `GET /v2/local/geo/coord2regioncode.json` | 행정동·법정동 코드 |
| 좌표계 변환 | `GET /v2/local/geo/transcoord.json` | WGS84↔TM 등 |

### 1.2 키워드 검색 상세

- **요청 파라미터**: `query`(필수), `category_group_code`(FD6 음식점, CE7 카페, AT4 관광명소, AD5 숙박 등), `x`/`y`+`radius`(반경 0~20,000m), `rect`(사각 영역), `page`(1~45), `size`(1~15), `sort`(`accuracy`|`distance`)
- **응답 필드**: `id`(장소 ID), `place_name`, `category_name`(전체 카테고리 경로), `category_group_code/name`, `phone`, `address_name`(지번), `road_address_name`(도로명), `x`(경도), `y`(위도), `place_url`, `distance`(기준 좌표 제공 시 미터 단위)
- **건수 제한**: page 최대 45 × size 최대 15이지만 실제 노출 가능 결과(`pageable_count`)는 **최대 45건**으로 캡핑. 그래도 **네이버 지역 검색의 5건 제한 대비 압도적으로 유리** — 반경·영역·정렬·페이징을 모두 지원하는 사실상 국내 유일의 무료 장소 검색 REST API.

### 1.3 쿼터·과금 (2023년 이후 정책 변화 포함)

출처: https://developers.kakao.com/docs/latest/ko/getting-started/quota , https://developers.kakao.com/docs/latest/ko/app-setting/paid-api , 공지 https://devtalk.kakao.com/t/api/141107

- **일일 무료 쿼터**: 키워드 장소 검색 **100,000건/일**, 주소-좌표 변환·좌표 변환 각 100,000건/일 수준. 전체 API 통합 월간 쿼터 3,000,000건 언급(항목별 수치는 대시보드에서 앱별 확인 권장).
- **정책 변화(중요)**: **2024-12-01부터 "카카오맵 API 활성화 설정" 필수화**. [내 애플리케이션] > [제품 설정] > [카카오맵] ON 해야 지도 SDK·로컬 API 호출 가능. 동시에 추가 쿼터(유료) 도입 — 무료 쿼터 초과 시 기본은 차단, **비즈 앱 + 비즈월렛 자동결제카드 등록** 시에만 초과분 유료(로컬 API 건당 0.5~2원 수준). **무료 쿼터 내에서는 결제수단 불필요.**
- 신규 앱에서 활성화 시 권한 신청·승인 절차 가능성 있음(테스트 앱은 신청 불요).

> **실측 (2026-06-12)**: Dodo Planet 앱의 REST 키로 키워드 검색 호출 시 `NotAuthorizedError: App(Dodo Planet) disabled OPEN_MAP_AND_LOCAL service.` — 카카오맵 제품 활성화 전 상태 확인됨.

### 1.4 place_url로 얻을 수 있는 것

- `place_url`은 `https://place.map.kakao.com/{장소ID}` 형태의 **카카오맵 장소 상세 웹페이지 링크**. API 응답으로는 URL 문자열만 제공.
- 상세 페이지의 영업시간·메뉴·사진·리뷰·별점은 **공식 API 미제공**. 스크래핑은 약관 위반 소지 + 구조 변경 취약 → **"카카오맵에서 자세히 보기" 외부 링크로만 사용**이 맞다.

### 1.5 다국어 지원

- **공식 다국어 질의·응답 미지원**. 응답 필드 전부 한국어, 영문 주소 변환 미제공 (데브톡 https://devtalk.kakao.com/t/api/78215 , https://devtalk.kakao.com/t/topic/143035 ).
- 카카오맵 자체의 영문 지도 버전도 없음 (https://devtalk.kakao.com/t/topic/72207 ).
- **외국인 여행자 요구사항은 카카오 단독으로 충족 불가** → 7절 TourAPI(다국어) + 행안부 영문 주소 API 병행 필요.

---

## 2. 카카오맵 SDK / 지도 표시

출처: https://apis.map.kakao.com/web/guide/ , https://apis.map.kakao.com/web/documentation/

### 2.1 JavaScript SDK

- **키 체계**: **JavaScript 키** (`//dapi.kakao.com/v2/maps/sdk.js?appkey=JS키&libraries=services,clusterer,drawing&autoload=false`).
- **도메인 등록 필수**: [플랫폼] Web에 도메인 등록(localhost 포함), 등록 도메인에서만 동작.
- **무료 쿼터**: 지도 SDK(JavaScript) **300,000건/일**. 2024-12-01부터 카카오맵 활성화 ON 필요.
- **라이브러리**: `services`(브라우저에서 키워드/카테고리 검색·주소↔좌표 — 로컬 REST의 클라이언트 버전), `clusterer`, `drawing`.
- **Next.js 16 통합**: 전역 `kakao` 객체 주입 방식 → `next/script`(`afterInteractive`) + `autoload=false` + `kakao.maps.load()` 콜백. 클라이언트 컴포넌트 전용.
- **react-kakao-maps-sdk** (https://github.com/JaeSeoKim/react-kakao-maps-sdk , npm v1.2.1): React 19 대응 발행이 2026년 초에도 이어짐 — **유지보수 활성**. 사실상 React 표준 래퍼.

### 2.2 정적 지도 (StaticMap)

- JS SDK에 `kakao.maps.StaticMap` 클래스 존재(브라우저 렌더링, 최대 2048×2048).
- **URL 호출만으로 PNG를 받는 REST 정적 지도 API는 없음** (네이버 Static Map 같은 것 부재). 서버사이드 OG 이미지 생성 등에 부적합.

### 2.3 접근성

- 공식 문서에 **스크린 리더·ARIA 언급 전무**. 지도 타일은 이미지/DOM 오버레이로 의미 정보가 보조기술에 전달되지 않음 (국내 지도 SDK 공통 한계).
- **권고**: 지도 캔버스는 장식적 보조 수단(`aria-hidden` 또는 대체 텍스트), **검색 결과 리스트·거리·방면 정보를 텍스트/시맨틱 HTML로 1차 제공** 필수. (본 프로젝트의 기존 설계 원칙과 일치)

---

## 3. 카카오모빌리티 API

출처: https://developers.kakaomobility.com/guide/navi-api/start , …/directions , …/waypoints

### 3.1 자동차 길찾기 REST API

- **엔드포인트**: `GET https://apis-navi.kakaomobility.com/v1/directions`
- **인증**: `Authorization: KakaoAK ${REST_API_KEY}` — **developers.kakao.com의 동일한 통합 REST API 키 사용** (별도 키 아님). dodo-planet 기존 앱 키로 호출 가능 구조.
- **파라미터**: `origin`/`destination`(좌표+명칭), `waypoints`(GET 최대 5개), `priority`(RECOMMEND/TIME/DISTANCE), `avoid`(ferries, toll, motorway, schoolzone, uturn), `alternatives`, `car_fuel`, `car_hipass`, `summary`, `road_details`
- **응답**: `routes[].summary`(거리 m, 소요시간 초, 택시·통행 요금), `sections[].roads`(도로별 교통상태), `sections[].guides`(**턴바이턴 안내 문구**) — 텍스트 기반 경로 브리핑(접근성 가치 큼)에 활용 가능.
- **다중 경유지**: `POST /v1/waypoints/directions` — 경유지 최대 30개, 총 1,500km 미만.
- **미래 운행 정보**: `/v1/future/directions` (출발 시각 지정).
- **쿼터**: 데브톡 답변 기준 자동차 길찾기 **일 10,000건 무료**, 상향은 제휴 협의 (https://devtalk.kakao.com/t/rest-api/123783 — 공식 고정 수치인지 **불확실**, 콘솔 확인 필요). 2025-04 카카오모빌리티가 길찾기 API 일반 개방 확대 보도 (https://zdnet.co.kr/view/?no=20250423183106 ).

### 3.2 도보·대중교통 — 미제공

- **도보**: 일반 공개 REST API 없음 (B2B 별도 신청 사례만 — https://devtalk.kakao.com/t/directions-api-navigation-api/147260 ).
- **대중교통 경로 API**: **없음** (앱에는 있으나 API 미개방). Navigation SDK도 자동차 전용.
- → 도보·대중교통은 **카카오맵 앱 딥링크(4절)로 위임**이 유일한 현실 경로. (네이버 NCP도 동일 공백. raw 데이터 필요 시 ODsay·국토부 TAGO가 별도 선택지)

### 3.3 카카오 T (택시)

- **일반 공개 택시 호출 API 없음**. ① 카카오 T 비즈니스 API(기업 계약 — https://kakaot-biz-developers.oopy.io/ ), ② 카카오 T 퀵/배송 API(물류)만 존재. 일반 앱에서는 카카오 T 앱으로 링크 이동 수준이 한계 (공식 딥링크 문서 미확인 — **불확실**).

---

## 4. 앱 딥링크 (URL Scheme)

### 4.1 kakaomap:// 공식 스킴

출처(공식): https://apis.map.kakao.com/ios_v2/docs/getting-started/urlscheme/ , https://apis.map.kakao.com/android_v2/docs/api-guide/urlscheme/

| 기능 | URL 형식 |
|---|---|
| 좌표로 지도 이동+마커 | `kakaomap://look?p=위도,경도` |
| **장소 상세 보기** | `kakaomap://place?id=장소ID` — 로컬 API의 `id`와 연결 |
| 검색 | `kakaomap://search?q=검색어&p=위도,경도` |
| **길찾기** | `kakaomap://route?sp=위도,경도&ep=위도,경도&by=이동수단` |
| 로드뷰 | `kakaomap://roadView?p=위도,경도` |

- **`by` 값: `car`, `publictransit`, `foot`, `bicycle`** (소문자) — **도보·대중교통·자전거 길찾기를 앱으로 넘길 수 있다** (API 공백을 딥링크가 메움). 경유지 `vp`, `vp2`~`vp5` 최대 5개(대중교통은 경유지 불가). `sp` 생략 시 현재 위치 출발.
- 로컬 API 검색 결과의 `id` → `kakaomap://place?id=...`로 **장소 상세를 앱에서 바로 여는 체인이 공식 성립** — 카카오 생태계의 가장 큰 통합 이점.

### 4.2 웹 URL (미설치 폴백 겸용)

출처: https://apis.map.kakao.com/web/guide/ (URL로 카카오맵 연결)

- 지도: `https://map.kakao.com/link/map/이름,위도,경도` 또는 `/link/map/장소ID`
- 길찾기: `/link/to/이름,위도,경도`, `/link/from/출발/to/도착`, `/link/by/{car|traffic|walk|bicycle}/...`
- 검색: `/link/search/검색어`, 로드뷰: `/link/roadview/위도,경도`
- **폴백 패턴 권고**: 웹앱에서는 `kakaomap://` 직접 호출(실패 감지 까다로움)보다 **`map.kakao.com/link/*` URL을 새 탭으로 여는 방식이 안전** — 모바일 앱 설치 시 앱으로 연결, 미설치/데스크톱은 웹 지도가 그대로 열림. 앱 우선 UX가 꼭 필요할 때만 스킴 시도 → 타임아웃 → `/link/` 폴백 2단 구조.

### 4.3 카카오내비 앱 호출

출처: https://developers.kakao.com/docs/latest/ko/kakaonavi/common

- JS SDK `Kakao.Navi.start({name, x, y, coordType})`, `Kakao.Navi.share()`. JavaScript 키 기반, 미설치 시 설치 페이지 자동 이동(폴백 내장).
- 자동차 운전자용 — 본 프로젝트 우선순위 낮음.

---

## 5. 카카오 로그인과의 시너지 (dodo-planet 관점)

### 5.1 동일 앱에서 사용 가능 — 가능

- 로컬 API, 지도 SDK, 카카오내비(앱 호출), 메시지 API는 **모두 동일 앱에서 제품별 활성화만 하면 사용 가능**. 별도 가입 불필요.
- **카카오모빌리티 길찾기도 동일 앱의 REST API 키 그대로 사용** (공식 시작 가이드 확인).

### 5.2 키 용도 구분

| 키 | 용도 | 보호 수단 |
|---|---|---|
| **JavaScript 키** | 지도 SDK, JS용 메시지/내비 SDK (브라우저) | 도메인 등록 제한 |
| **REST API 키** | 로컬 API, 모빌리티 길찾기, 메시지 REST (서버) | 허용 IP 등록 + 클라이언트 시크릿 |
| **Admin 키** | 관리성 API (서버 전용, 최고 민감) | 절대 클라이언트 노출 금지 |
| 네이티브 앱 키 | iOS/Android SDK | 패키지명/번들ID |

- Next.js 16 권고: 로컬·길찾기 API는 **Route Handler 서버 프록시**(REST 키 비노출 + 쿼터 모니터링 일원화), 지도 표시만 JS 키로 클라이언트 직접. (본 프로젝트 기존 구조와 일치)

### 5.3 기존 카카오 로그인 앱에 추가하는 절차

1. [내 애플리케이션] > [제품 설정] > **[카카오맵] 활성화 ON** (2024-12 이후 필수, 신규 활성화는 권한 신청·승인 절차 가능성)
2. JS SDK 쓸 경우 [플랫폼] > Web 도메인 등록 (로그인용 등록분 재사용 가능)
3. 메시지 API 쓸 경우 동의항목 `talk_message` 추가 (나에게 보내기는 권한 신청 불필요, 친구에게 보내기는 별도 권한 신청)
4. 모빌리티 길찾기는 같은 REST 키 — 단 모빌리티 디벨로퍼스 측 별도 활성화 단계 유무는 **불확실**(콘솔에서 확인)

---

## 6. 예약·생활 서비스 API

- **카카오톡 예약하기**: 카카오톡 채널 기반 입점형 비즈니스 도구 — **제3자 개발자용 공개 API 없음** (https://kakaobusiness.gitbook.io/main/tool/booking ).
- **카카오톡 메시지 API — 장소 공유에 직접 유용** (https://developers.kakao.com/docs/latest/ko/kakaotalk-message/rest-api ):
  - **위치(location) 템플릿**: `address`(필수), `address_title`, `content`(제목·설명·이미지·링크), `buttons`. 수신자가 **카카오톡 인앱 지도 뷰로 위치 확인 가능** — 장소를 가족·동행자에게 공유하는 데 최적.
  - 나에게 보내기 `POST /v2/api/talk/memo/default/send` (`talk_message` 동의만으로 가능), 친구에게 보내기는 별도 권한 신청 + 1회 최대 5명.
  - 쿼터: 메시지 전송 일 30,000건(앱), 발신자/수신자당 일 100건 수준.
  - 캘린더 템플릿(일정 공유), 피드/리스트 템플릿(장소 카드 목록)도 기본 제공.
- **톡캘린더 API**: 존재하나 상세 미확인 — **불확실**.

---

## 7. 그 외 국내 장소·여행 API 생태계 (간단 스캔)

- **한국관광공사 TourAPI 4.0** (https://api.visitkorea.or.kr/ , 공공데이터포털): 관광지·숙박·행사·여행코스를 **국문 + 영문(약 8만 건) 등 다국어 서비스로 분리 제공** (영문: https://www.data.go.kr/data/15101753/openapi.do ). 무료. **외국인 여행자 요구를 메우는 사실상 유일한 공식 다국어 관광 데이터 소스.** 좌표 기반(locationBasedList)·키워드 검색 지원 — 카카오 좌표 체계와 결합 가능. 언어별 서비스 구성은 포털에서 개별 확인 권장(**부분 불확실**).
- **행정안전부 도로명주소 API** (juso.go.kr): **영문 주소 변환 공식 지원** — 카카오·네이버의 다국어 공백 보완.
- **소상공인시장진흥공단 상가(상권)정보 API**: 업종별 점포 데이터, 대량·무료이나 실시간성 낮음.
- **예약 도메인**: 캐치테이블(공개 API 없음, B2B 입점만), 네이버예약(사업자용만), 망고플레이트(공개 API 없음, 존속 유동적 — **불확실**). **국내 식당 예약을 제3자 앱에서 API로 거는 길은 2026-06 현재 사실상 전무** — 예약은 플랫폼 링크 아웃이 현실적 설계.

---

## 8. 네이버 vs 카카오 역할 분담 권고

| 기능 | 권고 | 근거 |
|---|---|---|
| **장소 키워드/카테고리 검색** | **카카오 로컬 API (주력)** | 최대 45건+반경·정렬·페이징 vs 네이버 5건. 일 10만 건 무료. 장소 `id`→딥링크 체인 |
| 지오코딩/역지오코딩 | **카카오** (로컬 API로 일원화) | 같은 키·같은 쿼터로 운영 단순화. 영문 주소만 juso.go.kr 보완 |
| 지도 표시 | **카카오맵 JS SDK + react-kakao-maps-sdk** | 검색 결과와 좌표계·장소 ID 일치. 단 지도는 2차 채널 |
| 자동차 경로(데이터) | **카카오모빌리티 directions 우선** | 기능 동급이나 로그인 앱 키 재사용 + `guides` 안내 문구가 텍스트 브리핑에 유리 |
| **도보·대중교통 길찾기** | **카카오맵 앱 딥링크** (`by=foot/publictransit`, 폴백 `map.kakao.com/link/by/walk/...`) | 양사 모두 API 미제공. 카카오만 도보·대중교통 딥링크가 공식 문서화 |
| 장소 상세(리뷰·영업시간) | API 자체 구현 포기 → `place_url`/`kakaomap://place?id=` 링크 | 양사 모두 상세 데이터 API 부재 |
| **외국인용 다국어 장소 정보** | **TourAPI 4.0 (영문 등)** + juso.go.kr 영문 주소 | 카카오·네이버 모두 다국어 미지원 |
| 장소 공유 | **카카오톡 메시지 위치 템플릿** | 네이버에 대응물 없음. `talk_message` 동의항목 추가만 필요 |
| 예약 | 미구현 (플랫폼 링크 아웃) | 공개 API 전무 |
| 택시 연결 | 카카오 T 앱 링크 수준 | 공개 호출 API 없음 |

**종합**: 카카오는 네이버의 3대 공백(검색 5건 제한, 도보·대중교통 부재, 장소 상세 연결 부재) 중 **검색은 API로, 도보·대중교통과 장소 상세는 공식 딥링크로** 메운다. 남는 공백은 다국어(→ TourAPI + juso.go.kr)와 예약(→ 해법 없음, 링크 아웃). dodo-planet에 이미 있는 카카오 앱 하나로 로그인·로컬·지도·길찾기·메시지를 모두 운용 가능(카카오맵 활성화 + 도메인 등록 + `talk_message` 동의항목 추가만 필요) — 운영 비용 면에서도 카카오 중심 설계가 합리적. 접근성 관점에서도 카카오 로컬의 풍부한 텍스트 필드(카테고리 경로, 거리, 주소)와 directions의 `guides` 문구가 "텍스트가 1차" 원칙을 받쳐 준다.

**불확실로 남은 항목**: ① 모빌리티 무료 쿼터 정확 수치(일 10,000건은 데브톡 기준), ② 모빌리티 콘솔 측 활성화 단계 유무, ③ TourAPI 언어별 서비스 구성, ④ 톡캘린더 API 상세, ⑤ 카카오 T 딥링크 공식 문서.
