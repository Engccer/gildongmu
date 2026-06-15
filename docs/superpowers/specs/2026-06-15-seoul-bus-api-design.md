# 설계: 서울 시내버스 API 연동 (gildongmu)

작성일: 2026-06-15
선행: `2026-06-14-gildongmu-tago-bus-design.md` (TAGO 시내버스 — 경기·지방·부산)

## 배경 / 동기

TAGO(국가대중교통정보센터, data.go.kr 15098xxx)는 경기·지방·부산 시내버스는 커버하지만
**서울 시내버스는 미수록**이다(실측: 서울시청·강동구청 좌표 `totalCount` 0). 서울은
TOPIS(서울시 교통정보시스템)로 별도 운영되기 때문이다. 사용자 거주지가 **강동구 길동(서울)**
이라 현재 앱은 사용자 본인 동네에서 버스 정보를 전혀 못 준다 — 접근성 우선 길찾기 앱의 핵심 공백.

**측정 가능한 성과**: 강동구 길동 좌표로 `/api/bus/nearby` 실호출 시 서울 정류소·실시간
도착예정·저상버스 판정이 텍스트로 반환된다(현재는 빈 결과). 로컬 + 프로덕션 둘 다에서 확인.

## 데이터 소스 / 인증

서울 버스 정보는 data.go.kr에 **서울특별시 명의로 별도 등재**돼 있다(TAGO와 다른 서비스).
실 호출 호스트는 `ws.bus.go.kr/api/rest/...`(서울 TOPIS 버스운행정보 공유서비스)이며,
serviceKey는 **기존 `DATA_GO_KR_API_KEY`로 활용신청**한다(CLAUDE.md: data.go.kr 활용신청은
즉시 자동승인). **새 API 키·새 env 없음.**

| data.go.kr | 오퍼레이션(ws.bus.go.kr) | 용도 |
|---|---|---|
| 15000303 정류소정보조회 | `stationinfo/getStaionsByPosList` (tmX=lng, tmY=lat, radius) | 좌표 근접 정류소 |
| 15000314 버스도착정보조회 | `stationinfo/getStationByUidItem` (arsId) | 정류소별 도착예정 + 저상(`busType`) |
| 15000193 노선정보조회 | `busRouteInfo/getStaionByRoute` (busRouteId) | 노선 경유정류소 |

> ⚠ 엔드포인트 경로·파라미터명·envelope·필드명·저상 판정값은 **실호출로 최종 확정**한다.
> 위 표는 공식 문서 기준 가정이며, fixture green ≠ 실계약(프로젝트 원칙). 실호출 게이트 §검증 참조.

## 아키텍처

기존 TAGO 구조(`tago-bus.ts` provider + `/api/bus/*` + `BusArrivals`/`BusRouteStops`)를
그대로 따르되, **서울 provider를 추가하고 두 provider를 병렬 병합**한다.

```
좌표 ──▶ fetchNearbyBusStops (병합 진입점)
            ├─ TAGO   provider (경기·지방·부산)  ─┐
            └─ Seoul  provider (서울 TOPIS)      ─┤ Promise.allSettled
                                                  ▼
                              좌표 4자리 dedup → 거리순 정렬 → 상위 5 cap → BusStop[]
```

이는 en 장소검색 병합(`searchPlacesMergedEn`)과 동일한 병렬-병합 패턴이다. 강동구처럼
서울/경기 경계 지역에서 양쪽 정류소를 모두 노출하고, 한쪽이 실패해도 다른 쪽 실데이터를 보존한다.

### 1. 서울 provider — `src/lib/providers/seoul-bus.ts` (신규)

TAGO와 **동일한 반환 타입**(`BusStop[]`/`BusArrival[]`/`BusRouteStop[]`)으로 정규화. 서울 API의
차이(envelope·필드명)를 이 파일 안에 가둔다.

- **envelope**: 서울 TOPIS는 `ServiceResult.msgHeader.headerCd` + `msgBody.itemList` 형식(가정)
  — TAGO의 `parseTagoItems`(`response.body.items.item`)와 다르므로 **별도 파서**(`parseSeoulItems`).
  정상 에러코드/빈결과/장애 구분은 TAGO `fetchTago`의 graceful 규약을 그대로 차용:
  HTTP 실패·비정상 응답·서비스 장애는 throw(라우트가 502), 정상 빈결과는 빈 배열.
- **근접 정류소**(`getStaionsByPosList`): `tmX=lng, tmY=lat, radius`. 응답은 거리순 보장 안 한다고
  가정 → **Haversine 직접 정렬**(`geo.ts`의 `haversineMeters` 재사용). 좌표는 WGS84(`tmX`/`tmY`).
- **도착정보**(`getStationByUidItem`): `arsId` 기반. 저상 판정은 `busType`(`"1"`=저상) — TAGO의
  `vehicletp.includes("저상")`에 대응하는 서울 정본. 도착시간은 초 또는 메시지형일 수 있어
  실호출로 정규화 규칙 확정(arrivalSeconds).
- **노선 경유정류소**(`getStaionByRoute`): `busRouteId` 기반, 거의 불변 → 하루 캐시
  (`next: { revalidate: 86_400 }`).
- 키 미존재 시 빈 배열(방어적, 진입점은 키 게이트로 미렌더).

### 2. 타입 변경 — `src/lib/types.ts`

`BusStop`과 `BusArrival`에 **소스 판별자** 추가:

```ts
export type BusSource = "tago" | "seoul";
// BusStop, BusArrival 각각에:  source: BusSource;
```

- 이유: 병합 후 `BusStop`은 두 provider가 섞인다. `/api/bus/route`(경유정류소 조회)가 정류소/노선이
  어느 provider 소속인지 알아야 올바른 엔드포인트로 디스패치한다(서울은 cityCode 대신 busRouteId).
- 서울 provider는 기존 필드를 서울 의미로 채운다: `nodeId`=arsId(또는 stId), `cityCode`="seoul"(센티넬
  대신 `source`가 정본), `arrivals[].routeId`=busRouteId.
- 기존 TAGO 코드/테스트는 `source: "tago"`만 추가하면 됨(필드 시맨틱 불변).

### 3. 병합 진입점 — `tago-bus.ts`의 `fetchNearbyBusStops` 승격

현재 TAGO 단독 호출인 `fetchNearbyBusStops(lat, lng)`를 병합 진입점으로 바꾼다.
(위치: `tago-bus.ts`에 두되 `seoul-bus.ts`를 import, 또는 중립 `bus.ts` 신설 — 구현 시 결정.
`src/lib/` React/Next 비의존 원칙 유지.)

- TAGO `fetchNearbyBusStops`(기존 로직) → `fetchTagoNearby`로 改名, 서울 `fetchSeoulNearby` 신설.
- 병합: `Promise.allSettled([tago, seoul])` → 좌표 4자리 반올림 키로 dedup(중복 시 거리 가까운 쪽
  유지) → 거리순 정렬 → **상위 5 cap**. 둘 다 rejected면 throw, 하나라도 성공이면 그 결과 보존.

### 4. API 라우트

- `/api/bus/nearby`: 병합 진입점 호출(시그니처 동일). zod 좌표 가드·키 가드 그대로.
- `/api/bus/route`: **`source` 쿼리 파라미터 추가**(`"tago"|"seoul"` zod enum). source로 provider
  디스패치 — tago는 `cityCode+routeId`, seoul은 `routeId(busRouteId)`. 잘못된 조합은 400.

### 5. UI 컴포넌트 — 거의 그대로

- `BusArrivals`: 정류소 key를 `source-cityCode-nodeId`로(병합 시 충돌 방지). 도착 표시 로직 불변.
- `BusRouteStops`: props에 `source` 추가 → `/api/bus/route?source=..` 호출. 표시 불변.
- `bus.empty` 문구: 이제 "서울 미수록 안내"가 아니라 **진짜 정류소 없음**일 때만 — i18n 키 의미 갱신
  필요 시 메시지 조정(ko/en).

## 검증 (머지 전 필수 — 프로젝트 원칙)

**게이트 테스트**(결정적·로컬·무료, 매 커밋):
- `seoul-bus.test.ts`: 서울 응답 fixture로 파서 단위 테스트(정류소·도착·저상·경유정류소,
  빈결과, 장애 throw). 도착시간 정규화 규칙 검증.
- 병합 dedup 테스트: 서울/경기 경계 중복 정류소 시나리오 → 좌표 4자리 dedup·거리순·상위 5 cap.
- 기존 TAGO 테스트는 `source` 필드 추가만 반영.

**실호출 게이트**(머지 게이트 — fixture green ≠ 실계약):
- 활용신청(15000303·15000314·15000193) 후 **강동구 길동 좌표**로 `/api/bus/nearby` 실호출
  → 서울 정류소·실시간 도착·저상 판정 확인. **이 단계에서 실제 envelope·필드명·저상값·도착시간
  형식을 확정**하고 provider 파서를 실값에 맞춘다.
- 경계 검증: 강동구 좌표에서 서울+경기(하남) 정류소가 병합되는지.
- 프로덕션(`gildongmu.vercel.app/api/bus/nearby`)에서도 동일 확인(env 주입은 재배포 시점).

## 비목표 (YAGNI)

- 따릉이·지하철 등 다른 서울 교통수단(별도 마일스톤).
- 버스 위치 실시간 추적(15000332) — 도착예정으로 충분, 추가 호출 비용만 늘어남.
- 노선번호 텍스트 검색(getStationByNameList) — 현재 흐름은 좌표 근접만.
- 서울 영문 정류소명 — TOPIS 미제공, TAGO와 동일하게 한글 + `lang="ko"`.

## 리스크 / 미확정

- **엔드포인트 실계약 미확정**: 경로·파라미터·envelope·필드명·저상값·도착시간 형식은 실호출로만
  확정. 설계의 가정과 다르면 provider 파서를 실값에 맞춰 조정(이게 실호출 게이트의 목적).
- 활용신청 자동승인 후 전파 지연(~10분간 인증오류 가능, TOUR_API_KEY 때와 동일).
- 일 1,000건(개발계정) 한도 — 병렬 병합으로 호출 2배지만 개인 실험 규모엔 충분.
