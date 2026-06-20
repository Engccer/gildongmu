# 이 지역 날씨 — 기상청 현재 날씨 + 공기질 통합 설계

작성 2026-06-20. 기존 공기질(B2, `2026-06-17-air-quality-design.md`)을 "이 지역 날씨" 단일 섹션으로 확장한다. 게이트: data.go.kr 기상청_단기예보조회서비스(15084084) **활용신청 승인 완료(2026-06-20, 만료 2028-06-20)** → **실호출로 계약 잠금 완료(아래 §2)**. 전파 ~3.5분.

## 1. 성과(측정 가능)

홈(idle)·장소 상세에 "이 지역 날씨" 한 섹션을 노출한다. 한국 방문 외국인·시각장애인 여행자의 **외출 판단** 안전망 — 현재 날씨와 공기질을 한 호흡에 듣는다.

성과 확인: 임의 좌표(홈은 현재 위치, 상세는 장소 좌표)에서 한 region "이 지역 날씨"에

- **날씨**: 하늘상태(맑음/구름많음/흐림) 또는 강수(비/눈/소나기) + 현재기온 + 최고/최저기온 + 습도 + 강수확률
- **공기질**(기존 B2 그대로): 측정소 + 통합대기환경지수(KHAI)·미세먼지(PM10)·초미세먼지(PM2.5) 등급+수치

가 **하나의 heading·하나의 region**으로 묶여 표시되고, 스크린 리더 회전자에서 단일 섹션으로 탐색된다. 측정 장애·미커버 상태는 숫자가 아니라 "정보 없음"으로 낭독된다.

## 2. 잠근 계약 (실호출 검증 완료 2026-06-20)

격자 변환 함정과 2-오퍼레이션 체인이 핵심. 공기질 좌표계 함정과 동형으로, **문서가 아니라 실응답으로 확정**했다.

**실호출 검증값(2026-06-20 19시대 KST)**:
- 서울시청(37.5665, 126.978) → **격자 nx=60, ny=127**(알고리즘 레퍼런스와 실호출 일치 — 격자 변환 잠금).
- 길동(37.538, 127.139, nx63 ny126) → `sky=cloudy`·`precipitation=none`·`tempC=21.1`·`humidity=86`·`precipProbability=60`·`baseTime="19:00"`.
- 부산(35.1796, 129.0756, nx98 ny76) → `sky=cloudy`·`tempC=24.8`·`humidity=70`·`precipProbability=30`(전국 격자 커버).
- 범위 밖(10,10) → 400(zod). `tempMax/tempMin=null` — 저녁 시간대엔 오늘 최고(15시 발표)·최저(06시 발표)가 이미 지나 단기예보에서 빠지므로 `todayFcst`가 null → "최고/최저" 줄 graceful 생략(낮에는 표시, I-1 fix 동작 확인).
- **부분 성공 불변식 실전 검증**: 전파 직후 부산 첫 호출에서 **단기예보 오퍼레이션만 0.x초 늦게 전파돼 일시 reject** → 실황(기온·습도) 보존·`sky=unknown`·`pop=null`로 graceful 반환, 재호출 시 완전 데이터(`sky=cloudy`·`pop=30`). allSettled "둘 다 실패만 throw" 설계가 정적 리뷰로 못 잡는 데이터 현실을 흡수.

### 좌표 변환 — WGS84 → 기상청 격자(nx, ny) (deterministic, 테스트 잠금)

- 기상청 단기예보 API는 **격자 좌표(nx, ny)** 를 요구한다(공기질의 TM, 앱 전역 WGS84와 또 다른 좌표계).
- **Lambert 정각원추도법(LCC)** — 기상청 공식 `dfs_xy_conv` 알고리즘. 상수:
  - `RE=6371.00877`(지구 반경 km), `GRID=5.0`(격자 간격 km)
  - `SLAT1=30.0`, `SLAT2=60.0`(표준 위도), `OLON=126.0`, `OLAT=38.0`(기준점 경위도)
  - `XO=43`, `YO=136`(기준점 격자 좌표)
- 검증 레퍼런스: 서울시청(37.5665, 126.9780) → **nx=60, ny=127**. 강동 길동·부산·대전 등 end-to-end로 격자→실응답 정상 확인(활용신청 후).
- **공기질의 proj4(EPSG:2097)와 달리 표준 라이브러리가 없다** — 기상청 LCC는 일반 EPSG가 아닌 자체 파라미터라 공식 알고리즘을 직접 이식한다(수십 줄 결정적 수학, fixture로 잠금). 순수 함수라 `src/lib` 이식성 보존.

### 2-오퍼레이션 체인 (실황엔 하늘상태가 없다 — 함정)

호스트 `apis.data.go.kr/1360000/VilageFcstInfoService_2.0`, 공통 파라미터 `serviceKey, dataType=JSON, base_date, base_time, nx, ny, numOfRows, pageNo`. envelope는 다른 data.go.kr 동형 `response.body.items.item[]`, `response.header.resultCode "00"`.

- **Call 1 — 초단기실황 `getUltraSrtNcst`**: 현재 **실측값**. base_time = 매시 정시 발표(제공은 매시 **40분 이후**). 사용 카테고리:
  - `T1H` 현재기온(°C), `REH` 습도(%), `PTY` 강수형태(0 없음/1 비/2 비눈/3 눈/4 소나기). item은 `obsrValue`.
  - ⚠ **실황에는 `SKY`(하늘상태)가 없다** → Call 2 필요.
- **Call 2 — 단기예보 `getVilageFcst`**: **예보값**. base_time = `0200,0500,0800,1100,1400,1700,2000,2300` 중 현재시각 이전 최근(발표 후 ~10분 여유). 사용 카테고리:
  - `SKY` 하늘상태(1 맑음/3 구름많음/4 흐림), `TMX` 일 최고기온, `TMN` 일 최저기온, `POP` 강수확률(%). item은 `fcstValue` + `fcstDate/fcstTime`별 다수.
  - `SKY`/`POP`은 **현재 시각에 가장 가까운 `fcstTime`** 항목, `TMX`/`TMN`은 **오늘(`fcstDate`)** 항목을 고른다.

### base_date/base_time 계산 (deterministic)

- **서버 KST(+9) 기준**. 실황은 현재시각에서 40분 미경과면 직전 정시(보수적으로 −1시간 정시 사용 가능), 단기예보는 발표시각 목록에서 (현재−10분) 이하 최댓값(00:00~02:09는 전날 23시). 자정 경계 → 전날 날짜. 순수 함수로 KST 경계 fixture 테스트.

## 3. 불변식 (리뷰 포커스)

1. **상태 코드→자국어 매핑은 우리 책임**: 기상청은 OpenWeather와 달리 `lang` 파라미터가 없다 → `SKY`/`PTY` 코드를 ko/en/es/fr/it 메시지로 직접 매핑. **미매핑 코드 → "정보 없음"(unknown)**(공기질 grade·B1 unknown 교훈).
2. **상태 단어가 낭독 정본**: 수치(12°C)가 아니라 상태 단어("맑음"/"Clear")가 1차 정보. 강수형태가 "없음"이면 강수형태는 낭독하지 않고 하늘상태만 노출(condition = `PTY≠없음 ? 강수형태 : 하늘상태`).
3. **upstream 장애 ≠ 정보 없음**: resultCode≠00·HTTP 실패 → throw → 502. 무데이터(`items` 빈 응답)·미커버 → null(graceful 숨김). **mock 폴백 없음** — dodo의 정적 더미 데이터(키 없을 때 −2°C 서울)는 이식하지 않는다(가짜 실데이터 금지).
4. **부분 성공 보존**: provider 내부에서 실황·단기예보를 `Promise.allSettled` 독립 처리 — 실황만 성공해도 현재기온·습도 표시, 단기예보만 실패면 하늘상태/최고최저/강수확률은 undefined(해당 줄 생략). **둘 다 rejected여야 throw**, 둘 다 빈 데이터면 null.
5. **격자 변환은 결정적 테스트로 잠근다**: 서울 nx60 ny127 등 레퍼런스 격자 정확값 + 동일 입력 동일 출력 + base_time KST 경계.
6. **3-state 온도/등급**: 핵심값(현재기온)이 없고 하늘상태도 없으면 Weather는 null(빈 카드 금지). 개별 수치 부재는 해당 줄만 생략.

## 4. 컴포넌트 아키텍처 — 단일 region 통합 (접근법 A)

사용자 요구: "시각적으로나 스크린 리더 탐색상으로나 **한 섹션처럼**". → region·heading **하나**, "둘 다 데이터 없으면 빈 heading도 없음".

- **신규 `LocalConditions.tsx`** — `{lat, lng}` props. **날씨 fetch(`/api/weather/nearby`) + 공기질 fetch(`/api/air-quality/nearby`) 두 fetch를 직접 소유**. 단일 region `<section aria-labelledby><h3>이 지역 날씨</h3>` 안에 **날씨 블록 먼저 → 공기질 블록**. **둘 다 null이면 렌더 0**(부모가 양쪽 상태를 알아 빈 heading 방지). 두 fetch는 독립 — 한쪽 502가 다른 쪽을 죽이지 않는다.
- **`AirQuality.tsx` 리팩터**: 표시부를 headless `<AirQualityBody air={air}/>`(측정소 줄 + KHAI/PM10/PM2.5 평문, **자기 region·h3 없음**)로 추출. `LocalConditions`가 이 Body를 공기질 블록으로 렌더. 기존 self-fetch `AirQuality`(chat `get_air_quality`·MessageBubble용)는 이 Body를 감싸는 얇은 래퍼로 유지(자기 region·h3 보존 — chat에서는 단독 카드라 region 필요).
- **신규 `WeatherBody`**(LocalConditions 내부 또는 `Weather.tsx`) — 날씨 평문 렌더.
- **마운트 교체**:
  - `PlaceSearch.tsx`(홈 idle, 둘러보기 버튼 아래 — 위치 그대로): `<AirQuality lat lng>` → `<LocalConditions lat lng>`.
  - `PlaceDetail.tsx`: `<AirQuality lat lng>` → `<LocalConditions lat lng>`.
  - 게이트 `canShowAir`(= `hasDataGoKrKey()`)를 그대로 재사용(날씨·공기질 동일 키). 별도 `canShowWeather` 불필요 — 같은 게이트.

## 5. 접근성 (자동 등장 섹션 = region 유지)

- 단일 region "이 지역 날씨"(`<section aria-labelledby>` + `<h3>`) — 날씨·공기질 **모두 버튼 없이 자동 fetch**라 region이 유일한 발견 경로(CLAUDE.md "자동 등장 섹션 region 유지" 정책 부합, 불필요한 region 금지에 **비해당**).
- **날씨 평문 `<p>`**(definition list 금지 — 콜론 낭독 노이즈 교훈, 볼드 인라인 라벨만):
  - "{condition}, {tempC}°C" (예: "맑음, 12°C")
  - "최고 {max}° 최저 {min}°"
  - "습도 {humidity}%, 강수확률 {pop}%"
- **공기질 블록**: 기존 측정소·KHAI/PM10/PM2.5 평문 유지하되 **자기 h3 제거**(단일 heading 원칙). 통합 느낌 보존을 위해 **볼드 인라인 "공기질" 라벨 단락 1개**(heading 아님). graceful로 날씨만 빠졌을 때 "공기질" 라벨이 "날씨" heading 혼동을 완화.
- **graceful 조합**: 날씨만 실패→공기질만 / 공기질만 실패→날씨만 / 둘 다 실패→region 0.
- `lang="ko"`(측정소명 등 한글 고유명) 유지. 조회시각·출처는 블록별 또는 하단 1줄.

## 6. i18n (5개 언어)

- 신규 `weather` 네임스페이스(messages/*.json 5종): `heading`("이 지역 날씨"), 라벨(현재기온/최고/최저/습도/강수확률/"공기질" 서브라벨/조회시각/출처), **상태 코드 매핑**:
  - `sky`: { clear "맑음", partlyCloudy "구름많음", cloudy "흐림" }
  - `precipitation`: { none, rain "비", rainSnow "비/눈", snow "눈", shower "소나기" }
  - `unknown` "정보 없음"
- `airQuality.heading`("이 지역 공기질")은 chat air-only 단독 `AirQuality`용으로 잔존. 공기질 등급/라벨 키는 그대로 재사용.
- 데이터 언어 분리: 기상청은 ko/en 구분 없는 **수치+코드**라 `dataLocale` 불필요(상태 단어는 우리가 로케일 메시지로 매핑). 숫자는 로케일 무관.
- `i18n-messages.test.ts`가 ko 기준 키 집합·ICU 플레이스홀더 정합 머지 게이트.

## 7. 구조 (공기질 패턴 미러)

- `src/lib/providers/weather.ts`:
  - 순수: `latLngToGrid(lat,lng)→{nx,ny}`(LCC)·`ultraSrtNcstBaseTime(now)`·`vilageFcstBaseTime(now)`(KST)·`parseNcstItems`(T1H/REH/PTY)·`parseFcstItems`(SKY/TMX/TMN/POP, 시각 선택)·`skyLabel`/`ptyLabel`(코드→라벨, 미매핑 unknown)·`mergeWeather`(부분 성공 합성).
  - I/O: `fetchUltraSrtNcst`·`fetchVilageFcst`·`findWeatherNear(lat,lng)`(allSettled 2-call, 키 게이트, 둘 다 실패 throw).
  - 순수 로직은 fixture 결정적 테스트(격자 정확값·base_time KST 경계·item 파싱·코드 매핑·부분 성공). fetch 합성은 mock.
- `src/app/api/weather/nearby?lat&lng`: 키 없음→`{weather:null}`, zod 좌표 검증(33~43·124~132), catch→502. 공기질 라우트 미러.
- `src/lib/types.ts`: `WeatherCondition`(code+label)·`Weather`(sky·precipitation·tempC·tempMax·tempMin·humidity·precipProbability·baseTime·grid) 추가.
- `LocalConditions.tsx`(신규)·`AirQuality.tsx`(headless Body 추출 리팩터)·`Weather`/`WeatherBody` 렌더.
- 캐시: 두 오퍼레이션 모두 `revalidate:1800`(30분 — 단기예보 갱신 주기, dodo와 동일 호흡). force-dynamic 아님(준실시간 허용).

## 8. 테스트 / 머지 게이트

- 순수 로직 fixture(공기질 19테스트 패턴): 격자 변환 정확값·base_time KST 경계(자정·40분 경계)·`parseNcstItems`/`parseFcstItems`·코드→라벨·`mergeWeather` 부분 성공·빈 데이터 null.
- node-env Vitest엔 컴포넌트 와이어링 레인 없음 → **기상청 실호출이 머지 게이트**(길동 좌표 → 현재 날씨 2-call 정합, 공기질 2026-06-17 검증 동형). 활용신청 승인 후 수행.
- `i18n-messages.test.ts` 키 정합.

## 9. 선행조건 / 스코프

- **선행조건(사용자 계정 1회)**: data.go.kr에서 기존 `DATA_GO_KR_API_KEY` 계정에 **기상청_단기예보조회서비스(15084084) 활용신청**(자동승인 ~5분, 공기질·버스 때와 동일). 실호출 검증·머지 게이트 전에 필요. 코드/설계는 선행 가능.
- **프로덕션**: `DATA_GO_KR_API_KEY`는 이미 Production 등록됨 → 활용신청 승인 후 **재배포 없이도 동작**(env 불변, 신규 라우트는 push 자동배포). 활용신청은 키가 아니라 계정 권한이라 env 변경 없음.
- **스코프 제외(백로그)**: chat `get_weather` 도구(현재 `get_air_quality`만), 풍속·체감온도, 시간별/주간 예보. dodo 정적 더미 폴백.

## 10. dodo-planet 이식 메모

- dodo `/api/weather/route.ts`는 **OpenWeather** 기반이라 데이터 소스는 이식하지 않는다(길동무는 기상청). 이식하는 것은 **개념**(현재 날씨 카드 + 로케일 상태어)뿐. dodo `WeatherInfo.tsx`는 여행/도시/패킹 컨텍스트 강결합이라 재사용 불가 → 길동무용 신규.
- 역수입 가능성: 기상청 provider는 국내 좌표 전용이라 dodo(해외 여행지)엔 부적합 — 단방향(길동무 고유). 단 "현재 날씨 + 공기질 단일 region" UX 패턴은 dodo에 역수입 후보.
