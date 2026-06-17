# 길동무 미구현 항목 구현 로드맵 (설계안)

작성: 2026-06-16 | 상태: 승인됨(구조·우선순위·즉시 착수 1순위)

## 0. 이 문서의 역할

`docs/SPEC.md` §3 "실험 백로그" 표는 **데이터 카탈로그**(무엇이 조사됐나)다. 이 문서는 그것과 분리된 **실행 로드맵**(무엇을, 어떤 순서로, 어떤 게이트를 통과해 치는가)이다. 백로그가 우선순위 노이즈로 오염되지 않도록 둘을 분리한다.

조사는 끝났지만 코드가 0인 항목을 **실익 = 사용자 가치 × 현 코어 정합 × 즉시 착수 가능성** 기준으로 정렬한다.

## 1. 전 항목 공통 규칙 (머지 게이트)

이 프로젝트의 가장 비싼 교훈을 모든 항목에 적용한다:

1. **실데이터 검증을 머지 게이트로.** fixture/테스트가 모두 green이어도 실계약(수록 범위·필드명·인증·스킴)은 실호출로만 확정된다. 키가 막혀 실호출이 안 되면 그 항목은 **"코드 완료"가 아니라 "대기"**다(서울 시내버스가 정확히 이 상태).
2. **키 없이 코드만 짜는 건 가짜 진전 금지.** 단, 키 발급에 시간이 걸리고 사용자 가치가 최상인 항목은 fixture 선구현 + 키 도착 시 실호출 검증을 허용하되 **머지는 게이트 통과 후**.
3. `src/lib/`는 React/Next 비의존 유지 (dodo-planet 이식성).
4. provider 패턴 준수: 단일 진입점 + mock 폴백 + 키 유무 게이트(`hasXxxKeys()`).
5. a11y: 정보 정본은 텍스트, 상태 변화는 `aria-live` 단일 polite 채널. 과잉 ARIA 금지(First Rule of ARIA).

## 2. 키/게이트 현황 (2026-06-16 실측)

| 게이트 | 상태 | 영향 항목 |
|---|---|---|
| `SEOUL_OPEN_DATA_KEY` (일반 OpenAPI) | 보유·검증(따릉이) | 서울 교통약자 시설(가능성), 서울 일반 데이터 |
| ~~서울 실시간 지하철 인증키 미발급~~ | **발급·운영 완료(2026-06-17)** — 아래 별행 참조 | ~~A2~~ ✅ |
| `DATA_GO_KR_API_KEY` (=`TOUR_API_KEY`) | 보유. **B1·B2 4종 활용신청·실호출 검증 완료(2026-06-17)** — 사용자 활용신청 후 전파 ~5분, 전부 OPEN. 엔드포인트 확정(아래 §B1/B2 게이트 확정) | ~~B1·B2~~ ✅ 게이트 |
| 서울 **실시간 지하철 인증키** | **발급 완료(2026-06-17)** `SEOUL_SUBWAY_REALTIME_KEY` → A2 운영 중 | ~~A2~~ ✅ |
| NCP Maps(`NCP_MAPS_*`) | 보유·검증 | ~~C1 en 자동차 경로~~ ✅ |
| ~~data.go.kr 15013205 활용신청~~ | **불요로 판명 (2026-06-17)** — 15013205는 OpenAPI가 아니라 **연 1회 갱신 XLSX 파일데이터**(제공형태 "기관자체 다운로드", 실제 파일은 KRIC 레일포털). 활용신청·키 게이트 없음 → **정적 seed로 번들 완료** | ~~A3~~ ✅ |
| 서울 시내버스 ws.bus.go.kr 키 동기화 | **여전히 차단(2026-06-17 재확인, 하루 경과)** `headerCd 7` | 대기 레인 |
| KRIC 교통약자 수동 승인 | 승인 대기 | 대기 레인 |

### B1·B2 게이트 확정 (2026-06-17 실호출 검증, 구현 착수 준비 완료)

사용자 활용신청 → ~5분 전파 후 4종 전부 OPEN(resultCode 00). 확정 엔드포인트·계약:

| # | 데이터셋 | 엔드포인트 | 포맷·계약 | 좌표 |
|---|---|---|---|---|
| B1 주력? | 15001674 HIRA 소아야간 | `apis.data.go.kr/B551182/spclMdlrtHospInfoService1/getChildNightMdlrtList1` | XML. `yadmNm`(기관명)·`addr`·`sidoCd/sgguCd(+Nm)`·`telno`·`clCdNm`·`hospUrl`·`ykiho` | **❌ 없음** |
| B1 좌표소스 | 15000736 NMC 병의원 | `apis.data.go.kr/B552657/HsptlAsembySearchService/getHsptlMdcncListInfoInqire` | XML. `Q0`(시도)/`Q1`(시군구)/`QT`(요일)/`QD`(진료과목)/`QZ`(기관구분) 지역필터. `dutyName`·`dutyAddr`·`dutyTel1` | ⭕ `wgs84Lon/Lat`(impl 시 확정) |
| B2 측정소 | 15073877 에어코리아 측정소 | `apis.data.go.kr/B552584/MsrstnInfoInqireSvc/getNearbyMsrstnList` | JSON. **TM좌표**(`tmX/tmY`)→`stationName`·`tm`(거리km, 정렬됨)·`addr` | TM(WGS84→TM 변환 필요) |
| B2 실시간 | 15073861 에어코리아 대기오염 | `apis.data.go.kr/B552584/ArpltnInforInqireSvc/getCtprvnRltmMesureDnsty` | JSON. `sidoName`→`stationName`·`pm10Value`·`pm25Value`·`khaiValue`·`*Grade1h`·`dataTime` | 측정소명 기반 |

**⚠ 데이터 현실(실호출로만 드러남, 코드/문서 리뷰 미검출)**:
- 연구 문서가 B1 좌표 소스로 지목한 **15001674 `getChildNightMdlrtList1`은 좌표 필드가 없다**(addr 텍스트 + 시도/시군구 코드만). "내 주변" 좌표 근접(버스/지하철/따릉이 동형)은 이 API로 직접 불가.
- 따라서 **B1 좌표 근접의 정본은 NMC 15000736**(wgs84 좌표 + Q0/Q1 지역필터 후 클라 Haversine 정렬, 달빛/소아는 QD/QZ 필터). 15001674는 "소아야간 지정 여부" 보강 또는 주소 지오코딩 폴백으로 사용. **B1 설계는 이 발견을 반영해 NMC를 좌표 코어로 잡는다.**
- B2 측정소(15073877)는 **TM중부원점 좌표**를 받으므로 WGS84→TM 변환 단계가 필요(에어코리아 공식 변환 또는 proj 라이브러리). 측정소명 확보 후 15073861로 실시간 대기질 조회하는 2-call 체인.

## 3. 레인별 로드맵

### 레인 A — 교통 접근성 코어 심화 (이번 무게 중심)

현 코어(TAGO 버스 + 코레일 역 편의시설)의 자연 확장. 시각장애인 1급 시민 정합 최강.

**A1. 서울 지하철역 교통약자 시설** — 즉시 착수 1순위
- 가치: 코레일 편의시설(15125774)이 전국 철도역 위주라 비어 있는 **서울 도시철도(지하철) 공백을 정확히 메움**. 엘리베이터·휠체어리프트·장애인화장실·에스컬레이터·수어영상전화기.
- 데이터: 서울 열린데이터광장 서울교통공사 데이터셋(OA-22725 엘리베이터, OA-22745 휠체어급속충전기 등 **시설별 개별 데이터셋**, 2025-07 신규 개방분 포함). 시설별 데이터를 역 단위로 조인.
- 게이트: ① 서울 포털 활용신청(통상 즉시 승인) ② **서비스명 실호출 확정**(데이터셋 페이지가 JS 렌더라 서비스명이 정적 HTML에 없음 — 구현 plan 1단계) ③ 따릉이 키로 동작 확인(실시간 아닌 일반 OpenAPI라 가능성 높음).
- 패턴: 코레일 `korail-facilities.ts` + `StationFacilities` 컴포넌트 재사용. 역명 정규화 매칭. 도시철도 매칭 실패 시 graceful degrade.
- **폴백**: 활용신청이 막히거나 따릉이 키로 안 되면 즉시 A3(전국 도시철도역 메타)로 전환.

**A2. 서울 지하철 실시간 도착** — 키 도착 후
- 가치: TAGO 미커버 도시철도의 **유일 정본**. 딥링크로 대체 불가한 "다음 열차 N분/현재 위치".
- 데이터: `swopenapi.seoul.go.kr/api/subway/{KEY}/json/realtimeStationArrival/0/N/{역명}`. `arvlMsg2`(완성 한국어 도착 문장, 낭독 정본)·`barvlDt`(초)·`bstatnNm`(종착).
- 게이트: **실시간 지하철 인증키 사용자 발급**(선결, 차단 중). 발급 후 실호출 검증.
- 패턴: 서울/TAGO 버스 근접→도착 패턴 재사용. 역 식별은 A3 메타 활용 가능.

**A3. 전국 도시철도역 메타(15013205)** — ✅ **완료(2026-06-17)**
- 가치: 1,098역 한/영/한자 역명 + WGS84 좌표 → A1·A2의 역 식별·영문 역명·좌표 근접의 공통 받침대. 외국인(en) 역명 정합 충족.
- **실측 정정**: 15013205는 OpenAPI가 아니라 **연 1회 갱신 XLSX 파일데이터**(전체 1,099행, 데이터기준 2026-02-28, KRIC 레일포털 `data.kric.go.kr/rips/M_01_01/detail.do?id=32`). data.go.kr "바로가기"만 제공, 활용신청 버튼 없음. "등록되지 않은 서비스" 실측은 애초에 OpenAPI가 없어서였음.
- **구현**: OpenAPI 활용신청·provider 패턴이 아니라 **정적 seed 번들**. `scripts/build-subway-stations.py`(XLSX→JSON 변환기, 연간 갱신 도구) → `src/lib/data/subway-stations.json`(1,098역, 307KB, 좌표 누락 1행 스킵) → `src/lib/subway-stations.ts`(순수 조회: `matchStationsByName`·`nearestStations`·`summarizeStation` + seed 바인딩 `findStationsByName`·`findStationsNear`·`findStationMeta`). 서버 전용 import(클라 번들 제외)라 `/api/station/meta` 경유. 장소 상세에 `StationMeta` 컴포넌트로 영문역명·노선·환승·운영기관 노출(en 영문 메인). 16개 단위 테스트 + 실호출 검증(강남 2호선+신분당선, 서울역 1·4·공항철도, 부산역·대전 전국 커버, 고속터미널 3·7·9 환승, 없는역 null, 빈 파라미터 400).
- 키 게이트 없음(정적 데이터). dodo-planet 이식 시 JSON+조회 모듈만 가져가면 됨.

### 레인 B — 가족→dodo-planet 다리 (다음 무게)

SPEC §3 2026-06-16 방향: "여행/외출 중 위치 기반" 가족 항목만 길동무로 올려 dodo 가족 여행 가이드를 선검증. 행정성 지원금·입소대기는 child-care 전용(제외).

- **B1. 근처 소아 야간·휴일 진료**(달빛어린이병원 15000736 / HIRA 15001674) — `getChildNightMdlrtList`(xPos/yPos/radius) 좌표 근접. `DATA_GO_KR_API_KEY`·버스/역 provider 패턴 그대로 재사용. 여행 중 아이 아플 때 안전망.
- **B2. 이 지역 공기질**(에어코리아 15073877/15073861) — ✅ **완료(2026-06-17)**. `air-quality.ts`(WGS84→TM EPSG:2097 proj4 → 근접측정소 → 측정소명 단건 실시간) + `/api/air-quality/nearby` + `AirQuality`(장소 상세 enrich). KHAI·PM10·PM2.5 등급(낭독 정본). ⚠ 좌표계 EPSG:2097(Bessel, 카카오 5181 아님)·envelope `items` 직접 배열(실호출로 규명). 3-state Flag→unknown. 20개 단위테스트 + 실호출 검증(강동길동·부산·범위밖).
- **B3. 근처 아이 놀 곳**(키즈 장소) — ✅ **완료(2026-06-18)**. `kids-places.ts`(카카오 로컬 키워드 3종 좌표 근접 `Promise.allSettled`→카테고리 화이트리스트→dedupe·거리순·상위8) + `/api/places/kids` + `KidsPlacesNearby`(홈 "내 주변" 5번째). 신규 API·게이트 없음(기존 `KAKAO_REST_API_KEY`). ⚠ **실호출로 규명: 키워드 매칭 ≠ 키즈 장소**(스킨스쿠버·노인복지시설·동우회·방탈출카페가 "놀이터"에 섞임) → `category_name` 계층 화이트리스트가 정본(시각장애인 노이즈 차단). 실내/실외 3-state(놀이터 모호→unknown). 부분 실패 불변식(subway-nearby 동형). 33개 테스트 + code-reviewer 5건(2 수정·2 보강·1 보류). 실호출 검증(강동 8건 노이즈0·부산·범위밖). 설계 `2026-06-18-kids-places-design.md`.

### 레인 C — 외국인 영문 완결성

- **C1. NCP en 자동차 경로(Phase 0b)** — ✅ **완료(2026-06-17)**. `ncp-directions.ts`(`lang=en` 영문 턴바이턴) + `/api/route/car` lang+키 디스패치(en+NCP→영문, 그 외→카카오 ko 폴백). 동일 `CarRouteBriefing` shape라 컴포넌트 불변. ⚠ NCP duration 밀리초→초 변환이 핵심 불변식(테스트+실호출 잠금). 실호출 검증(en 영문 14단계·ko 한국어, durSec 단위 정합).
- **C2. 행안부 영문 도로명주소** — 현 NCP `englishAddress` 2-call 체인을 공식 영문주소 API로 대체/보강. 무료한도 재확인 필요.

### 대기 레인 (외부 차단 — 코드 0, 게이트 풀리면 재개)

- **서울 시내버스** — ws.bus.go.kr 키 동기화 익일 배치 대기. 정본 plan `docs/superpowers/plans/2026-06-15-seoul-bus-api.md`.
- **KRIC 교통약자 이동경로** — 수동 승인 대기. 무장애 환승/역내 동선(최대 차별화 축).

## 4. 우선순위 순서 (실익순)

1. ~~**A1** 서울 지하철역 교통약자 시설~~ ✅ **완료(2026-06-17)** — data.go.kr 15143843(`B553766/wksn`) 9종, 코레일 동형. plan `2026-06-17-seoul-metro-facilities.md`. 실호출 검증(강동 4종·신도림 18·서울역 23). 서울 포털 view 버그로 data.go.kr 경로 채택.
2. ~~**A3** 전국 도시철도역 메타~~ ✅ **완료(2026-06-17)** — OpenAPI 아닌 연간 XLSX로 판명 → 정적 seed 번들. 장소 상세에 영문역명·노선·환승 노출. 실호출 검증 완료(전국 커버).
3. ~~**A2** 서울 지하철 실시간~~ ✅ **완료(2026-06-17)** — 실시간 인증키 발급(`SEOUL_SUBWAY_REALTIME_KEY`, 일반키와 별도 계열) → 역 상세 실시간 도착 + 홈 "내 주변" 합성(좌표→A3 seed 근접역→역별 실시간 `Promise.allSettled`). plan `2026-06-17-seoul-subway-realtime.md`.
4. ~~**B1** 소아 야간·휴일 진료~~ ✅ **완료(2026-06-17)** — `night-clinic.ts`+`/api/clinic/nearby`+`NightClinicsNearby`(홈 "내 주변" 4번째). NMC `getBabyListInfoInqire`(달빛어린이병원, 좌표+진료시간+전화) 정본(15001674 좌표 없음으로 NMC 채택). 전국 152개 Haversine→20km→상위5, 진료상태 3-state(KST), 공휴일 V1 표시만. mock 없음·502 구분. 22개 테스트. 설계 `2026-06-17-nearby-night-clinic-design.md`. 실호출 검증(강동 5곳). codex 설계검토 hang→code-reviewer 서브에이전트로 대체(불변식 전부 PASS, 보강 3건 반영).
5. ~~**C1** NCP en 자동차 경로~~ ✅ **완료(2026-06-17)** — B1 게이트 차단으로 우선 착수. `ncp-directions.ts` + lang 디스패치, ms→s 변환, 실호출 검증.
6. ~~**B2** 공기질~~ ✅ **완료(2026-06-17)** — `air-quality.ts`+`/api/air-quality/nearby`+`AirQuality`(장소 상세 enrich). WGS84→TM EPSG:2097(proj4) 2-call 체인, KHAI·PM10·PM2.5 등급. ⚠ envelope `items` 직접 배열·EPSG:2097(5181 아님) 실호출로 규명. 3-state Flag→unknown. tago-bus 동형 방어(code-reviewer 3건 반영). 설계 `2026-06-17-air-quality-design.md`. 실호출 검증(강동길동·부산·범위밖).
7. ~~**B3** 키즈 장소(카카오, 게이트 없음)~~ ✅ **완료(2026-06-18)** — `kids-places.ts`+`/api/places/kids`+`KidsPlacesNearby`(홈 "내 주변" 5번째). 카카오 좌표 근접 + **카테고리 화이트리스트**(키워드≠키즈장소, 실호출 규명) + 실내/실외 3-state + 부분실패 불변식. 33개 테스트, code-reviewer 5건 반영. → **다음: C2** 영문 도로명주소(juso 키 미보유)

대기 레인(서울 버스·KRIC)은 외부 게이트가 풀리는 즉시 끼어든다.

## 5. 사용자 액션 아이템 (병행)

- ~~**[사용자, A2 차단 해제]** data.seoul.go.kr 실시간 데이터 인증키~~ ✅ 발급 완료 → A2 운영 중.
- ~~**[사용자, B1·B2 차단 해제]** data.go.kr 15001674·15000736·15073877·15073861 활용신청~~ ✅ **완료(2026-06-17)** — 사용자 수동 신청, ~5분 전파 후 4종 전부 실호출 OPEN 검증. 엔드포인트 §2 확정 표 참조.
- ~~서울 포털 서울교통공사 교통약자 시설 데이터셋 활용신청(A1)~~ ✅ 완료.
- ~~data.go.kr 15013205 활용신청(A3)~~ — 불요(XLSX 정적 데이터, 게이트 없음).

## 6. 진행 현황

A1·A2·A3·C1·B1·B2·**B3 완료**(B3 2026-06-18). **다음 후보: C2 영문 도로명주소**(juso 키 미보유 — 사용자 발급 필요). 서울버스(여전히 차단)·KRIC는 외부 게이트 풀리면 끼어든다. B3는 외부 게이트 없는 마지막 항목이라, 이후 레인은 모두 사용자 키 발급(C2 juso·서울버스·KRIC)에 의존.
