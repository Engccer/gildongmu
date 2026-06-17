# B1 — 내 주변 소아 야간·휴일 진료 (달빛어린이병원) 설계

작성: 2026-06-17 | 상태: 설계 확정(실호출 계약 검증 완료) | 로드맵: `2026-06-16-implementation-roadmap-design.md` §B1

## 1. 목적·성과

여행/외출 중 아이가 아픈 밤·휴일에, 시각장애인·외국인·가족 사용자가 **현재 위치에서 가까운 소아 야간·휴일 진료 기관**을 거리·전화·진료시간과 함께 **텍스트로** 듣고 바로 전화/길찾기로 이어간다. 측정 가능 성과: 홈에서 위치 허용 → "내 주변 소아 야간·휴일 진료" 섹션에 거리순 기관 목록(이름·거리·전화·지금 진료여부·진료시간) 노출, 전화는 `tel:` 링크로 바로 연결.

## 2. 데이터 소스 결정 (실호출로 확정, 2026-06-17)

**정본 = NMC 15000736 `getBabyListInfoInqire`** (달빛어린이병원 및 소아전문센터 목록).
- 엔드포인트: `apis.data.go.kr/B552657/HsptlAsembySearchService/getBabyListInfoInqire`, XML, `resultCode 00`.
- 필드: `dutyName`(기관명)·`dutyAddr`(주소)·`dutyTel1`(전화)·`dutyDiv/dutyDivNam`(의원/병원)·`dutyEmcls/dutyEmclsName`(응급의료기관 분류)·`dutyEryn`(응급실 운영)·`dutyMapimg`(찾아오는 길, 예 "5호선 오목교역 2번 출구")·`dutyTime{1..8}s`/`{1..8}c`(요일별 진료 시작/종료, 1=월…7=일, **8=공휴일**, 값 "0900"/"2400" 등)·`wgs84Lat`/`wgs84Lon`·`hpid`.
- 규모: **전국 152개**(서울 19). 한 번 호출(numOfRows=200)로 전량 수신 → 서버 Haversine 정렬(따릉이 패턴). 시도 필터·역지오코딩 불필요.

**왜 15001674(HIRA 소아야간)가 아닌가**: 15001674 `getChildNightMdlrtList1`은 **좌표 필드가 없다**(주소+시도/시군구 코드만, 2026-06-17 실측). 좌표 근접("내 주변")을 못 함. 반면 NMC 달빛 목록은 좌표+진료시간+전화를 다 줘서 단일 소스로 완결. 15001674는 향후 "소아야간 지정 교차표시" 보강 후보로만 남김.

## 3. 아키텍처 (기존 "내 주변" 패턴 재사용)

`따릉이(seoul-bike)` + `버스/지하철 nearby` 동형.

- **provider `src/lib/providers/night-clinic.ts`** (React/Next 비의존):
  - `fetchNightClinics()`: getBabyListInfoInqire 전량 호출 → `parseClinicItems(xml)`로 `NightClinic[]` 투영. 캐시: 목록은 분 단위 변동 없음 → `next: { revalidate: 86400 }`(하루). 단 "지금 진료중"은 캐시 금지(요청 시점 계산).
  - 순수 로직(데이터 주입형, fixture 결정적 테스트):
    - `parseClinicItems(xml)` → 좌표 누락 행 스킵.
    - `rankClinicsByDistance(clinics, lat, lng, {radiusMeters, limit})` → Haversine 거리 부여·정렬·반경 cap·상위 N.
    - `clinicOpenStatus(clinic, nowKstMinutes, dow)` → 해당 요일 dutyTime로 `{state:"open"|"closed"|"unknown", todayStart, todayEnd}`. **"운영시간 정보 없음(unknown)"과 "마감(closed)"을 뭉개지 않음**(arrivalStatus·metro "0대≠정보없음" 교훈). `"2400"`=자정(24:00)로 처리.
  - `findNightClinicsNear(lat, lng)` = fetch + rank (+ 각 항목에 openStatus 부여는 라우트/컴포넌트 시점 now 사용).
  - 키 게이트: `hasDataGoKrKey()`(없으면 빈 배열). **mock 폴백 없음**(의료 정보 — 가짜 실데이터 금지). upstream 장애 throw→502.
  - **`totalCount > numOfRows` 가드**: throw(silent truncation 방지, metro `totalCount>300` 교훈). 현재 152<200이나 증가 대비.
- **route `src/app/api/clinic/nearby/route.ts`**: `force-dynamic`. querySchema `lat`(33~43)·`lng`(124~132) — 버스/지하철 nearby 동일 한반도 바운드. 키 없음→`{clinics:[]}`. try→`{clinics, asOf}`, catch→502.
- **component `src/components/NightClinicsNearby.tsx`**: `BusArrivals`/`SubwayArrivalsNearby` 동형 — 현재위치 getCurrentPosition → fetch(no-store) → aria-live polite 단일 채널, h3 tabIndex=-1 포커스, 수동 새로고침+`asOf`, `aria-disabled`+in-flight ref. 각 기관: `<span lang="ko">이름</span>` · 거리 · `tel:` 링크("OO에 전화 걸기") · **지금 진료 상태**(진료중/마감/정보없음) · 오늘 진료시간 · (있으면)`dutyMapimg` 찾아오는 길.
- **배치**: 홈 idle "내 주변" 4번째 섹션 — 지하철→버스→따릉이→**소아 야간·휴일 진료**. (`PlaceSearch` idle 블록, 기존 3종과 동형 a11y.)

## 4. 불변식 (구현 전 박기 — 이게 리뷰 포커스)

1. **가짜 정보 금지**: mock 폴백 없음. 키 없음=빈 배열(섹션 미노출), upstream 장애=502(빈 목록으로 위장 금지 — "근처에 없음"과 "조회 실패"는 다르다).
2. **진료 상태 3-state**: open/closed/**unknown**. 오늘 요일 dutyTime이 비면 "정보 없음"(마감 아님). 시각장애인에게 "마감"으로 오판 금지.
3. **시간대(KST)·요일**: 서버에서 KST 기준 현재 요일(1=월…7=일)·HHMM 산출(deterministic). **공휴일(dutyTime8) 자동판정은 V1 비포함**(한국 공휴일=음력 포함 비결정적 → 가짜 판정 금지). 대신 공휴일 진료시간을 **별도 라벨로 표시만**("공휴일 진료시간 …")하고, "지금 진료중" 판정은 평일/주말 요일만. 향후 공휴일 API로 보강.
4. **거리 정렬·반경**: Haversine(코드 책임, 산술). 반경 cap(기본 제안 20km) 내 상위 N(제안 5). 반경 내 0건이면 빈 메시지(에러 아님) + (선택) 최근접 1곳 거리 안내.
5. **`2400` 종료시각**: 자정 24:00으로 해석. 교차자정(s>c)은 방어적으로 처리하되 달빛은 2400 캡이라 사실상 없음.
6. **a11y(미니멀)**: live polite 단일, `tel:` 링크 accessible name, 거리/상태 텍스트, min-h-11. 과잉 ARIA 금지.

## 5. 테스트 (게이트, 결정적)

- `parseClinicItems`: 정상 투영·좌표 누락 스킵·빈결과.
- `rankClinicsByDistance`: 거리 계산·정렬·반경 cap·limit·동거리.
- `clinicOpenStatus`: open/closed/unknown 3-state·`2400` 경계·요일 매핑·시작=종료 경계.
- `findNightClinicsNear`(fetch 합성): fixture 정상→거리순, 키없음→[], HTTP 실패→throw, `totalCount>numOfRows`→throw.
- fixture: 2026-06-17 실응답(getBabyListInfoInqire 서울) 축약.

## 6. 비목표(V1)

- 공휴일 자동판정(음력) — 표시만. / 15001674 교차표시 — 후속. / 길찾기 딥링크는 기존 `RouteLinks`/딥링크 재사용 가능하나 V1은 전화+주소+찾아오는길 우선.
