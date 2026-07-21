# RESEARCH 2026-07-21: 길찾기 기능 강화 조사

> 목적: 현행 길찾기(자동차 브리핑 카카오 ko/NCP en, 대중교통 ODsay, 실주행 딥링크 위임)에 덧붙일 축을 도보·실시간 교통·교통약자·자전거/택시/대중교통 보강 4개 관점에서 조사. 병렬 리서치 4축 + 코드/백로그 대조 완료. 다음 단계는 이 문서를 입력으로 한 개발 spec 작성.

## 결론 요약 (우선순위 로드맵)

⚠ 코드 대조 결과(2026-07-21) 조사 시점 후보였던 "택시 요금·통행료 표기"(카카오 `fare.taxi`/`fare.toll`·NCP `taxiFare`, `CarRouteBriefing` 표기)와 "정거장별 하차 안내"(`TransitLeg.stationCount`, legBoard/legTransfer "{count}정거장")는 **이미 구현되어 있어 로드맵에서 제외**. 그 묶음의 실제 공백이던 **배차간격은 2026-07-21 구현 완료**(`intervalMinutes`, 아래 §3).

| 순위 | 항목 | 비용 | 핵심 근거 |
|---|---|---|---|
| 1 | 도보 길찾기 신설 (Tmap 보행자) | 신규 키 1 | 유일한 한국어 완성 문장 턴바이턴. 최대 공백 해소 |
| 2 | 돌발상황 브리핑 (ITS 15040465) | 기보유 키+활용신청 | 사고·공사·통제를 자동차 미리 듣기에 합성 |
| 3 | 지하철 첫차/막차·시간표 | 기보유 키+활용신청 | "막차까지 N분" 텍스트 완결 정합 |
| 4 | 지하철 엘리베이터 위치·음성유도기 seed | 무료(파일+API) | 역 상세 접근성 시설 보강 |

보류(데이터 부재가 원인): 자전거 라우팅, 점자블록/정밀 보행 턴바이턴, 실시간 칸별 혼잡도(유료), 장애인콜택시 연계(실시간 API 없음).

## 1. 도보(보행자) 길찾기: 최대 공백

### Tmap 보행자 경로안내 (SK Open API): 정본 후보

- POST `https://apis.openapi.sk.com/tmap/routes/pedestrian?version=1`, 헤더 `appKey`. openapi.sk.com 자체 발급(신규 env 키 1개, `hasTmapKey()` 게이트 신설).
- 응답은 GeoJSON. **턴바이턴이 `properties.description`에 완성된 한국어 문장**으로 온다: "홍대입구역 9번출구 에서 우회전 후 136m 이동", "호아빈 홍대점 에서 횡단보도 후 보행자도로 을 따라 20m 이동". 첫 Point feature에 `totalDistance`/`totalTime`.
- 좌표 WGS84(변환 불필요). 보행자도로·횡단보도·지하보도 반영, 전국 커버.
- 무료 일 1,000건, 초과 건당 10원.
- ⚠ 함정: `description` 완성 문장이 낭독 정본. `turnType` 코드로 슬롯 조합 재구성 금지(서울버스 `arrmsg1` 교훈과 동형). 상업 서비스 이용 약관·유료 전환 조건은 배포 전 확인 필요(미확정).

### 대안·탈락

- **카카오맵 신규 도보 경로 API**(2026-07-21 적용, 아래 §6): 조건은 Tmap과 동일(일 1,000건 무료, 건당 10원)이나 **턴바이턴 안내문 제공 여부 미공표**. 좌표 폴리라인만이면 본 프로젝트에 무용. 실호출 스키마 확인 전엔 후보 아님. 무료 쿼터 정책 리스크도 병존(§6).
- **NCP Directions**: 공식 문서가 "경로 정보는 자동차에 한해서만 제공" 명시. 도보 없음.
- **OSM 계열(OSRM·OpenRouteService·Valhalla·GraphHopper)**: 한국 보행 태깅 지역 편차 극심(길동 빈약·강남 풍부, 기존 실측). 안내문도 영어. 폴백조차 위험해 제외.
- **V-World**: 지도·공간정보 중심, 보행 라우팅 API 없음.

## 2. 자동차: 실시간 교통은 이미 충족, 강화 여지는 "정보 얹기"

- **카카오모빌리티·NCP 모두 이미 실시간 교통 반영**. 카카오 `priority=RECOMMEND`(기본)가 실시간 교통최적, 응답 road에 `traffic_speed`/`traffic_state`. NCP는 trafast/traoptimal/tracomfort 전부 실시간. 따라서 "Tmap처럼 실시간 반영"이라는 요구는 현행으로 충족되어 있고, provider 교체 실익 없음.
- **돌발상황 브리핑이 실질 신규 가치**: 국토교통부 돌발상황정보(data.go.kr 15040465, 무료·실시간)로 사고·공사·통제·예상 복구시간을 받아 "출발 전 미리 듣기" 산문에 합성. 경로 폴리라인 bounding box(또는 경유 좌표 반경) 질의.
  - ⚠ 커버리지가 고속도로·국도 중심, 도심 이면도로 공백 많음. 3-state 필수: "돌발 없음" ≠ "정보 없음(미커버)" ≠ "조회 실패".
  - ⚠ data.go.kr 활용신청은 API별 독립(신청 전 403). 인증·게이트 모두 `DATA_GO_KR_API_KEY`(split-brain 금지).
  - 서술 필드를 그대로 낭독 정본으로 사용(슬롯 환산 금지).
  - 자매 API: 교통소통정보 15040463(구간 속도), 사고정보 15040464. 서울 도심 보강은 TOPIS 소통/돌발(링크ID 기반이라 좌표 매핑 부담, 2순위).
- 카카오 부가 옵션(참고): `departure_time` 미래 운행 정보 길찾기(별도 엔드포인트), `car_fuel`/`car_hipass` 통행료 정밀화, `alternatives`. Tmap 자동차 경로는 옵션 세분(무료우선·어린이보호구역 회피)이 차별점이나 무료 한도 불투명+신규 키라 ROI 낮음(도입 안 함).

## 3. 택시·대중교통 보강: 기존 응답/키 안에서

- **택시 요금: 이미 구현 확인**(코드 대조 2026-07-21). 카카오 `fare.taxi`/`fare.toll`·NCP `taxiFare`/`tollFare` 모두 `CarRouteBriefing`이 표기 중. 신규 작업 없음.
  - 장애인콜택시(서울시설공단)는 일별 통계 API만 존재(운행대수·평균대기시간 등, 최소 하루 전 데이터). 실시간 호출·대기 연계 불가. 참고 표기 이상은 불가.
- **ODsay 정거장 수 낭독은 이미 구현 확인**(`stationCount`, "{count}정거장"). **배차간격은 2026-07-21 구현 완료**: `subPath.intervalTime`(분, 실호출 확정 — 길동→강남 지하철 10/5/5)을 `TransitLeg.intervalMinutes`로 투영, 탑승 leg 줄에 쉼표로 이어붙여 표기("배차간격 약 N분", 5로케일 `legInterval`). 0·미제공은 생략(3-state). 그 외 ODsay 카탈로그(후속 후보): 지하철역 전체 시간표(첫차/막차), 환승정보, 고속/시외버스·열차·항공, isochrone. 전부 기보유 키·일 1,000회 쿼터 공유.
- **지하철 첫차/막차·역별 시간표**: 서울교통공사 호선별 첫차막차(서울 열린데이터 OA-15492, `SEOUL_OPEN_DATA_KEY`) / TAGO 지하철정보 15098554(역별시간표·출구별 버스노선·주변시설, `DATA_GO_KR_API_KEY`+활용신청).
- **혼잡도**: 무료는 통계값만(서울교통공사 OA-12928, 요일·30분 단위·분기 갱신, 정원 대비 %). "이 시간대 보통 혼잡" 참고 안내로 가치. 실시간 칸별(Tmap Puzzle)은 유료라 보류.
- **장거리**: 고속버스(TAGO 15098522)·시외버스(15098541, 당일 배차만)·열차(15098552/코레일 15125762). ODsay 통합 커버(구현 단순) vs TAGO(필드 상세) 택1. 모두 무료.

## 4. 교통약자·접근성 특화

- **저상버스 여부: 이미 구현 완료**(신규 아님). TAGO `vehicletp` 포함 판정 + 서울 `busType{slot}`=="1", 両provider `lowFloor` 투영 확인.
- **지하철 엘리베이터 위치**: 서울시 지하철역 엘리베이터 위치정보(data.go.kr 15098158 / OA-21212, 무료 REST). 실시간 가동상태 통합 API는 확인 안 됨: 위치는 표기하되 가동 여부는 "정보 없음"으로(3-state).
- **음성유도기 seed**: 서울교통공사 시각장애인 음성유도기 설치 위치(OA-22526, CSV, 1~8호선 275역 5,802개). 좌표 없음(호선·역명·설치 위치 텍스트) → 역 seed(`subway-stations`)와 역명 조인, 정적 seed 방식(전국도시철도 XLSX 파이프라인 동형).
- **음향신호기 위치**: 전국 통합 없음, 지자체별 파일 분산. 서울(15047259, x/y 좌표 포함: ⚠ 좌표계 중부원점 추정, 에어코리아 TM 변환 함정 재현 가능)·대구(15103064) 등. 지자체별 스키마 상이라 통합 어댑터 필요(bus.ts 병합 패턴 동형). 기존 결론([[overpass-osm-korea-pedestrian-coverage]]: OSM 공백 → data.go.kr 피벗)과 일치. PROGRESS "둘러보기 기능 B" 백로그와 합류.
- **KRIC 교통약자 이동경로 2종**(transferMovement·stationMovement): 2026-06-14 회원가입 후 수동 승인 대기 이력. 승인 상태 재확인이 선행 과제(기존 백로그 항목 유지).
- **점자블록·정밀 보행 턴바이턴(BlindSquare/G-EYE 수준): 공공데이터로 재현 불가에 가까움**. 통합 데이터 부재. 국내 벤치마크 G-EYE+조차 서울 18개 역세권 등 소수 지역을 자체 구축(공공 인프라 공백의 방증). V1 스코프에서 명시 제외.
  - 참고: BlindSquare의 "진행 방향 주변 POI 낭독"은 둘러보기(8방위)로 부분 구현 상태. "미리 걷기"는 Tmap 도보 브리핑이 담당하게 됨.

## 5. 자전거: 보류

- 국내 자전거 라우팅 전용 공개 REST API 사실상 부재. 카카오 신규 자전거 API는 실호출로 실체(라우팅 여부·안내문) 미확인. Tmap은 보행자만. OSM 자체 호스팅은 태깅 편차로 부적합.
- 현실적 최대치는 따릉이 대여소 최근접 쌍(출발지 근처 대여 → 도착지 근처 반납) 안내. 라우팅은 보류.

## 6. 플랫폼 소식 (조사 중 확인된 정책 변경 2건)

### 카카오맵 API 정책 변경 (2026-07-21 적용)

- 신규 4종 공개: 대중교통·도보·자전거 경로 조회 + 정적 지도. 경로 3종은 일 1,000건 무료, 초과 건당 10원.
- **무료 쿼터가 "개발자 계정에서 첫 번째로 카카오맵 API를 활성화한 앱" 하나에만** 제공. gildongmu는 dodo 앱과 카카오 키 공유 → 신규 카카오 경로 API 도입 전 어느 앱이 무료 쿼터를 갖는지 확인 필수. 기존 로컬·자동차 경로에는 즉각 영향 없음.
- 출처: devtalk.kakao.com 공지 150222.

### 네이버 Search API의 NAVER API Hub 이관 (개발자센터 공지 2026-07-15·07-21 수신)

- 네이버 개발자센터의 Search API·Search Trend·Shopping Insight 3종이 NCP 신설 "NAVER API Hub"로 이관, 개발자센터 쪽은 단계 종료. **gildongmu 네이버 지역검색(`NAVER_LOCAL_CLIENT_ID/SECRET`)이 Search API 소속으로 직접 영향권.**
- 일정(약관 부칙 정본): 2026-07-30 24:00 개발자센터 신규 신청 중단 / 2026-07-31 24:00 Search API 중 쇼핑·책·학술정보만 즉시 종료(지역검색 비해당) / **2027-06-30 24:00 개발자센터 제공 전면 종료, 기존 키 차단**.
- gildongmu 판정: 키 2026-07-18 발급으로 기존 이용자 유예 대상 → **2027-06-30까지 현행 무변경**. 그 전에 `naver-local.ts` 인증을 NCP API Key 방식으로 이관(NCP 계정 기보유, Search API 무료 정책은 이관 후에도 동일 명시 → 비용 영향 없음). 메일 간 표현 차이(발급일로부터 1년 vs 2027-06-30)는 약관을 정본으로 보수적 적용.

## 미확정 (spec 작성 시 실호출/확인 게이트)

1. Tmap 상업 이용 약관·유료 전환 정확 조건 (자동차 경로 무료 한도 포함, openapi.sk.com 요금 페이지 로그인 필요).
2. 카카오 신규 도보·자전거 API의 턴바이턴 안내문 존재 여부 (실호출 스키마 확인).
3. 카카오 무료 쿼터 "첫 활성화 앱" 판정이 dodo 공유 키에 미치는 영향.
4. 카카오 자동차 응답 fare 객체가 현행 요청 파라미터로 수신되는지 (실호출 확인, NCP는 문서상 기본 포함).
5. KRIC 교통약자 2종 승인 상태.

## 출처

- Tmap 보행자: https://openapi.sk.com/products/detail?svcSeq=4 · https://skopenapi.readme.io/reference/보행자-경로안내 · 약관 https://tmapapi.tmapmobility.com/terms.html
- 카카오 신규 API·쿼터 공지: https://devtalk.kakao.com/t/api-notice-on-new-kakao-map-api-features-and-free-quota-policy/150222 · 자동차 https://developers.kakaomobility.com/docs/navi-api/directions/ · 미래 운행 https://developers.kakaomobility.com/docs/navi-api/future/
- NCP Directions: https://api.ncloud-docs.com/docs/ai-naver-mapsdirections-driving (자동차 전용 명시)
- ITS·국토부: 돌발 https://www.data.go.kr/data/15040465/openapi.do · 소통 15040463 · 사고 15040464 · https://www.its.go.kr/opendata/opendataList
- TOPIS: https://topis.seoul.go.kr/refRoom/openRefRoom_4.do · https://www.data.go.kr/data/15058364/openapi.do
- ODsay: https://lab.odsay.com/guide/guide
- 지하철 시간표·혼잡도: OA-15492 · 15098554 · OA-12928
- 장거리: 15098522(고속) · 15098541(시외) · 15098552(열차) · 15125762(코레일)
- 접근성: 엘리베이터 15098158/OA-21212 · 음성유도기 OA-22526 · 음향신호기 15047259(서울)/15103064(대구) · KRIC https://data.kric.go.kr/
- 장애인콜택시: https://www.data.go.kr/data/15057705/openapi.do
- G-EYE+: https://apps.apple.com/kr/app/g-eye-plus/id1495742951
- OSM 라우팅: https://openrouteservice.org/restrictions/ (한국 보행 커버리지는 자체 실측 [[overpass-osm-korea-pedestrian-coverage]])
- 네이버 이관: developers.naver.com 공지 32530 · NAVER API Hub https://www.ncloud.com/product/applicationService/naverApiHub (수신 메일 2026-07-15·07-21 정리)
