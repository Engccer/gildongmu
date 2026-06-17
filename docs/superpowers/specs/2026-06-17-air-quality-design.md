# B2 — 이 지역 공기질(에어코리아) 설계

작성 2026-06-17. 게이트: data.go.kr 15073877·15073861 활용신청 OPEN, **실호출로 계약 잠금 완료**(아래 §2). 로드맵 `2026-06-16-implementation-roadmap-design.md` 레인 B B2.

## 1. 성과(측정 가능)

장소 상세에 "이 지역 공기질 한 줄"을 노출한다. 영유아 외출 판단·시각장애인 이동 판단의 안전망. 성과 확인: 임의 장소 상세 진입 시 가장 가까운 측정소의 통합대기환경지수(KHAI)·미세먼지(PM10)·초미세먼지(PM2.5)의 **등급(낭독 정본)+수치**가 표시되고, 측정 장애 상태는 숫자가 아니라 "정보 없음"으로 낭독된다.

## 2. 잠근 계약 (실호출 검증 2026-06-17)

좌표계 함정과 2-call 체인이 핵심. 문서가 아니라 실응답으로 확정했다.

### 좌표 변환 — WGS84 → TM (deterministic, 테스트 잠금)

- 에어코리아 측정소 API는 **TM중부원점 좌표**를 요구한다(앱 전역 WGS84와 다름).
- **EPSG:2097**(Bessel 타원체 + Tokyo datum, `+towgs84`)이 정본. 카카오/네이버가 쓰는 EPSG:5181(GRS80)이 아니다 — false easting/northing이 같아 혼동하기 쉬우나 결과가 Δ300m+ 어긋난다.
- 검증: 역삼동 `getTMStdrCrdnt` 정본 `(203338.99, 444208.20)` 대비 2097은 Δ88m(손어림 좌표 오차 범위), 5181은 Δ383m. end-to-end(강남·강동길동·부산) 근접측정소가 모두 정상.
- proj4 정의: `+proj=tmerc +lat_0=38 +lon_0=127 +k=1 +x_0=200000 +y_0=500000 +ellps=bessel +units=m +no_defs +towgs84=-145.907,505.034,685.756,-1.162,2.347,1.592,6.342`
- **표준 라이브러리(proj4) 사용** — datum-shift 수학 직접 구현 금지(오류 위험). proj4는 순수 JS라 `src/lib` 이식성 보존.

### Call 1 — 근접 측정소 (`getNearbyMsrstnList`)

- `apis.data.go.kr/B552584/MsrstnInfoInqireSvc/getNearbyMsrstnList?tmX&tmY&returnType=json`
- 응답: `response.body.items[]` = `{stationName, tm(거리 km, **API가 이미 거리순 정렬**), addr}`.
- **첫 항목(최근접)만 사용**. 거리 정렬은 API 책임이라 Haversine 불필요(따릉이·버스와 다른 점).

### Call 2 — 측정소 실시간 (`getMsrstnAcctoRltmMesureDnsty`)

- `apis.data.go.kr/B552584/ArpltnInforInqireSvc/getMsrstnAcctoRltmMesureDnsty?stationName&dataTerm=DAILY&ver=1.3&returnType=json`
- **측정소명 단건**이 정본(시도별 `getCtprvnRltmMesureDnsty`보다 깔끔 — 단일 측정소·전 오염물질·통합지수까지 한 번에).
- 사용 필드: `khaiValue/khaiGrade`(통합대기환경지수), `pm10Value/pm10Grade`(미세먼지), `pm25Value/pm25Grade`(초미세먼지), `dataTime`, `pm10Flag/pm25Flag`(측정 장애).
- 등급 코드: `1`=좋음 `2`=보통 `3`=나쁨 `4`=매우나쁨. 그 외/부재 → unknown.
- envelope: `response.header.resultCode "00"` 정상, 빈결과 `items:""`(data.go.kr 동형).

## 3. 불변식 (리뷰 포커스)

1. **3-state(좋음/…/unknown) — Flag→unknown**: `*Flag`가 non-null이면 측정 장애/점검이라 그때의 value·grade는 신뢰 불가 → **value=null·grade="unknown"**으로 강제. 측정 장애를 숫자로 노출하면 시각장애인 오판(arrivalStatus "0대≠정보없음", B1 open/closed/unknown 교훈의 연장).
2. **등급이 낭독 정본**: 수치(108)가 아니라 등급 단어("나쁨"/"Bad")가 1차 정보. 수치는 보강.
3. **거리는 API 정본**(`tm` km) — 자체 Haversine로 재계산하지 않는다(이중 진실 금지).
4. **upstream 장애 ≠ 정보 없음**: resultCode≠00·HTTP 실패 → throw → 502. 근접 측정소 없음·측정 데이터 없음 → null(graceful 숨김). mock 폴백 없음.
5. **좌표 변환은 결정적 테스트로 잠근다**: 정본 TM값 대비 허용오차 내 일치 + 동일 입력 동일 출력.

## 4. 배치 결정

- **장소 상세 enrich**(홈 "내 주변" 섹션 아님). 로드맵 명시("장소 상세 enrich 한 줄") + 장소 좌표를 그대로 쓰는 자동 fetch 패턴(`StationMeta` 동형) + dodo-planet 가족 여행 가이드 다리("이 여행지 공기질")에 정합. 모든 장소가 좌표를 가지므로 역 여부와 무관하게 노출.
- 게이트 `canShowAir = hasDataGoKrKey()`(B1·버스와 같은 키). page→PlaceSearch→PlaceDetail로 전달.
- a11y: `StationMeta` 동형 — 진입 시 자동 fetch, 보조 정보라 실패/미커버는 조용히 null 렌더(live region 불필요). 등급 단어 lang 기본(로케일 메시지).

## 5. 구조 (기존 패턴 미러)

- `src/lib/providers/air-quality.ts`: `wgs84ToTm`(proj4 순수)·`parseNearestStation`·`parsePollutant`(Flag→unknown)·`parseAirMeasure`·`fetchNearestStation`·`fetchAirMeasure`·`findAirQualityNear`(2-call, 키 게이트).
- 순수 로직은 fixture로 결정적 테스트(좌표 변환 정확값·Flag→unknown·등급 매핑·빈결과). fetch 합성은 mock.
- `/api/air-quality/nearby?lat&lng`: 키 없음→`{air:null}`, 좌표 검증, catch→502.
- `AirQuality.tsx`: place-detail 자동 fetch 컴포넌트.
- 캐시: 측정소 목록 fetch revalidate 86400(거의 불변), 실시간 측정 revalidate 600(시간 단위 갱신).
