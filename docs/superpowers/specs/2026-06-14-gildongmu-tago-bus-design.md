# 설계: TAGO 시내버스 도착·정류소 연동 (gildongmu)

- **작성일**: 2026-06-14
- **상태**: 설계 확정 + adversarial-review 반영 (구현 대기)
- **연구 출처**: `docs/research/RESEARCH-2026-06-domestic-api-expansion.md` §A (시내버스)
- **선행 패턴**: `src/lib/providers/korail-facilities.ts`, `src/components/StationFacilities.tsx`

> ## ⚠ 개정 노트 (2026-06-14, codex adversarial-review 반영 — 구현자 필독)
>
> 이 설계는 구현 착수 전 **codex `adversarial-review`**로 공격적 검토를 받았고, 지적 3건을 반영해 개정됐다. 다른 셸/세션에서 이 스펙을 읽고 구현하는 에이전트는 아래를 **반드시** 지킬 것 — 원안의 매끄러운 텍스트만 보고 빠지기 쉬운 함정들이다.
>
> 1. **[도착조회 실패 ≠ 버스 없음] (이 앱의 핵심 불변식)**: A-1 도착조회가 쿼터·인증·네트워크로 실패했을 때 `arrivals: []`로 뭉개면 UI가 "도착 예정 버스 없음"으로 표시 → 시각장애인에게 **"버스 없음" 오판**을 유발한다. `BusStop.arrivalStatus: "ok" | "unavailable"`을 **타입·파서·UI·테스트에 반드시 도입**하고, `unavailable`은 "도착 정보를 가져오지 못함"으로 별도 통지(aria-live)한다. §3·§6·§7·§9·§10 개정 반영됨. (v2.1에서 같은 계열 결함이 실제로 머지 직전 잡힌 전례.)
> 2. **[실 TAGO 검증은 pre-merge 게이트] (선택 아님)**: 활용신청 전이라도 Task 1~9(provider·route·UI·fixture)는 구현하되, **실 응답 캡처→fixture 교정→3종 엔트리틀먼트 헬스체크 통과 전에는 머지/배포 금지**. 키만 있으면(`canShowBus`) 동작하는 것처럼 보이지만 미검증 계약은 프로덕션에서 502·엉뚱한 빈결과를 낸다(fixture 테스트는 다 통과하면서). §11 개정 반영됨.
> 3. **[근접 정류소: 후보 전체를 모은 뒤 정렬]**: A-2를 `numOfRows: 10`만 받아 슬라이스하면 밀집지역(500m 내 10곳 초과)에서 *진짜 최근접*을 Haversine 정렬 전에 누락한다. **`totalCount`를 보고 500m 반경 후보를 충분히 수집(페이징 또는 큰 numOfRows)한 뒤 Haversine 정렬 → 상위 5 cap**. §3·§5·§10 개정 반영됨.

## 1. 목적과 측정 가능한 성과

현재 길동무의 대중교통은 **딥링크 위임만** 가능하다(텍스트 브리핑 없음, `deeplink-kakao.ts`). 실시간 버스 도착은 본질적으로 딥링크로 대체 불가하다 — 네이티브 앱을 열기 전엔 "지금 몇 분 후 오는지" 알 수 없다.

**성과**: 시각장애인 사용자가 지도·외부 앱 없이 **"내 주변 정류소 → 도착 예정 버스 → 저상버스 여부"**를 텍스트(스크린 리더 낭독)만으로 완결한다. 확인 방법:

- 현재 위치 또는 검색한 장소 좌표에서 근접 정류소 5개가 가까운 순으로 나온다.
- 각 정류소의 도착 예정 버스가 노선번호·남은 정류장 수·도착 예정 시간으로 낭독된다.
- 각 도착 버스의 **저상버스 여부**가 정본으로 표시된다(네이버/카카오 대비 차별점).

## 2. 데이터 소스 (TAGO, data.go.kr)

운영주체: 국토교통부 TAGO(국가대중교통정보센터). 인증은 **`DATA_GO_KR_API_KEY` 재사용**(한국철도공사 편의시설과 동일한 data.go.kr 단일 인증키). 새 env 추가 없음.

| 코드 | 오퍼레이션 | 엔드포인트(베이스) |
|------|-----------|-------------------|
| A-2 정류소 | `getCrdntPrxmtSttnList` (좌표 근접) | `http://apis.data.go.kr/1613000/BusSttnInfoInqireService` |
| A-1 도착 | `getSttnAcctoArvlPrearngeInfoList` (정류소별 도착예정) | `http://apis.data.go.kr/1613000/ArvlInfoInqireService` |
| A-3 노선 | `getRouteAcctoThrghSttnList` (노선 경유정류소) | `http://apis.data.go.kr/1613000/BusRouteInfoInqireService` |

> **엔드포인트 스킴 주의**: RESEARCH는 `http://` 베이스를 기록했으나, 코레일 편의시설(`https://apis.data.go.kr/...`)처럼 https가 동작할 가능성이 높다. 활용신청 후 첫 실호출에서 **https 우선 시도, 실패 시 http 폴백**으로 확정한다. data.go.kr 표준 envelope(`response.body.items.item`, 빈결과 `""`, `resultCode "0"`)는 코레일과 동일하다고 가정하되 실호출로 검증한다.

### 알려진 응답 필드 (활용신청 후 실호출로 확정 대상)

- **A-2 정류소 item**: `nodeid`(정류소 ID), `nodenm`(정류소명, 한글), `nodeno`(정류소 표지판 번호, 없을 수 있음), `gpslati`/`gpslong`(WGS84 실수), `citycode`(도시코드).
- **A-1 도착 item**: `routeid`(노선 ID), `routeno`(노선번호 예 "272"), `routetp`(노선유형 예 "간선버스"), `arrtime`(도착예정, 초), `arrprevstationcnt`(남은 정류장 수), `vehicletp`(차량유형 — **"저상버스"** / "일반차량").
- **A-3 경유정류소 item**: `nodeid`, `nodenm`, `nodeord`(정류소 순번), `gpslati`/`gpslong`.

## 3. 아키텍처

```
[현재위치 버튼] ─geolocation─┐
                            ├─▶ GET /api/bus/nearby?lat&lng ─▶ tago-bus provider
[장소 상세 좌표] ───props───┘            │
                                         ├ A-2 getCrdntPrxmtSttnList (좌표 → 근접 정류소)
                                         │   └ Haversine 거리 정렬 → 가까운 순 상위 5
                                         └ 정류소 5개 × A-1 (Promise.allSettled, 병렬)

[도착 버스 펼치기] ─▶ GET /api/bus/route?cityCode&routeId ─▶ A-3 getRouteAcctoThrghSttnList (lazy)
```

- **공통 코어 1벌, UI 진입점 2개**: 좌표 출처만 다르고(현재위치/장소좌표) 그 이후 흐름은 동일. `BusArrivals` 컴포넌트가 `mode: "current" | "place"`로 좌표 출처만 분기한다.
- **provider 도메인 단위 1파일**: `tago-bus.ts`에 3 오퍼레이션 + 순수 파서 + Haversine. 코레일 provider와 동일하게 순수 파서 함수를 export해 단위 테스트한다.

### 데이터 흐름 결정

- **거리 정렬은 deterministic(코드)**: A-2가 거리순을 보장하지 않으므로 Haversine로 직접 계산·정렬해 가까운 순 상위 5개. (산술은 LLM이 아니라 코드 — 워크스페이스 latent/deterministic 원칙) **단 정렬 전에 500m 반경 후보를 빠짐없이 수집해야 한다** — A-2 응답의 `totalCount`가 받은 item 수보다 크면 페이징해 전체를 모은 뒤 정렬한다(개정 노트 §3). 받은 부분집합만 정렬하면 밀집지역에서 진짜 최근접을 놓친다.
- **N+1은 병렬 흡수 + 실패 구분**: 1회 조회 = A-2 1건 + A-1 5건 = 6건(+A-2 페이징 시 약간 더). 일 10,000건 쿼터 대비 넉넉. `Promise.allSettled`로 한 정류소 도착조회가 실패해도 나머지 정류소는 보존한다. **단 rejected된 정류소는 `arrivals: []`로 뭉개지 말고 `arrivalStatus: "unavailable"`로 표시**한다 — "도착조회 실패"와 "도착 버스 0건(정상)"은 사용자에게 다른 의미다(개정 노트 §1, 접근성 핵심 불변식).
- **cityCode 출처**: A-2 응답의 `citycode`를 그대로 A-1·A-3에 전달(별도 도시코드 조회 불필요).
- **도착 정렬**: 정류소 내 도착 버스는 `arrivalSeconds` 오름차순(곧 올 버스 먼저).
- **numOfRows**: A-2는 **500m 반경 후보를 다 덮을 만큼**(예: `numOfRows: 100`, `totalCount` 초과 시 페이징) 받아 Haversine 정렬 후 상위 5 cap — "10건만 받아 슬라이스" 금지(개정 노트 §3). A-1은 50건(정류소 경유 노선 수 여유), A-3는 200건(노선 전체 정류소).

## 4. 접근성 — 저상버스 노출 (차별점)

A-1의 `vehicletp`가 저상버스 여부를 준다. 휠체어·유아차·교통약자에게 결정적이라 각 도착 버스의 **정본 정보**로 표시한다.

낭독 예: **"272번 간선버스, 3번째 전 정류장, 약 5분 후 도착, 저상버스. 다음 차는 일반버스, 12분 후."**

`lowFloor: boolean`으로 정규화(`vehicletp === "저상버스"`). 표지판/순번 등 부가 필드는 표시하되 낭독 우선순위는 노선번호 → 남은 정류장/시간 → 저상 여부 순.

## 5. 캐싱 — 데이터 성격별 분리

| API | fetch 옵션 | 이유 |
|-----|-----------|------|
| A-1 도착예정 | `cache: "no-store"` | 실시간 — 캐시 금지 |
| A-2 근접정류소 | `cache: "no-store"` | 위치마다 달라 캐시 의미 작음 |
| A-3 경유정류소 | `next: { revalidate: 86400 }` | 노선은 거의 불변 |

## 6. graceful degrade (접근성 정본 원칙)

장애("정보 없음")와 일시 장애를 뭉개지 않는다.

- **키 없음**(`!hasDataGoKrKey()`) → 진입점(버튼) 자체를 미렌더. 키 유무는 **서버 컴포넌트에서 평가**해 UI에 prop으로 전달한다. (버스는 키 없으면 전부 무용이므로 미렌더가 맞다. 코레일 편의시설은 단일 버튼이라 기존 동작 유지 — 일관성보다 의미 우선.)
- **활용신청 누락**(키는 있으나 그 API 권한 없음) → data.go.kr이 `SERVICE_KEY_IS_NOT_REGISTERED_ERROR` 등 에러코드 반환 → **throw → 502 → "조회 실패"**. "정보 없음"과 구분(장애 은폐 금지).
- **근접 정류소 0개** → "주변 정류소 없음"(정상 상태).
- **도착 버스 0개** (`arrivalStatus: "ok"` + `arrivals: []`) → "도착 예정 버스 없음"(막차 종료 등 정상 상태).
- **도착조회 실패** (`arrivalStatus: "unavailable"`, A-1 promise rejected) → **"도착 정보를 가져오지 못했습니다"**(0건과 구분). 정류소 자체(A-2)는 보존하되 그 정류소의 도착 줄만 실패로 표기. 인증/쿼터/서비스 에러는 per-stop 빈값이 아니라 endpoint 실패로 다뤄, 전체 A-1이 같은 사유로 실패하면 그 신호가 사용자에게 드러나야 한다(장애 은폐 금지, 개정 노트 §1).
- **en 로케일** → 정류소명·노선유형은 한글 데이터뿐이라 `lang="ko"`로 감싸 표시, UI 라벨만 영문.

## 7. 타입 (src/lib/types.ts 추가)

```ts
/** 버스 정류소 하나 — A-2 응답 + A-1 도착 결과 + 계산 거리 */
export interface BusStop {
  nodeId: string;       // nodeid — A-1/A-3 조회 키
  cityCode: string;     // citycode — A-1/A-3 조회 키
  name: string;         // nodenm — 정류소명(한글)
  stopNo?: string;      // nodeno — 표지판 번호(없을 수 있음)
  lat: number;          // gpslati
  lng: number;          // gpslong
  distanceMeters: number; // Haversine 계산값(정렬·표시용)
  /** 도착조회 상태(개정 노트 §1) — "ok": A-1 성공(arrivals가 정본, 0건이면 정상적 "버스 없음").
   *  "unavailable": A-1 실패(쿼터·인증·네트워크) → "버스 없음"과 구분, 장애 은폐 금지. */
  arrivalStatus: "ok" | "unavailable";
  arrivals: BusArrival[]; // arrivalStatus==="ok"일 때만 의미. unavailable이면 [].
}

/** 정류소에 도착 예정인 버스 하나 — A-1 응답 정규화 */
export interface BusArrival {
  routeId: string;          // routeid — A-3(경유정류소) 조회 키
  routeNo: string;          // routeno — 노선번호
  routeType: string;        // routetp — 노선유형(한글)
  arrivalSeconds: number;   // arrtime — 도착예정(초)
  prevStationCount: number; // arrprevstationcnt — 남은 정류장 수
  lowFloor: boolean;        // vehicletp === "저상버스"
}

/** 노선 경유정류소 하나 — A-3 응답 정규화 */
export interface BusRouteStop {
  nodeId: string; // nodeid
  name: string;   // nodenm
  order: number;  // nodeord — 정류소 순번
  lat: number;    // gpslati
  lng: number;    // gpslong
}
```

## 8. 신규/변경 파일

```
src/lib/providers/tago-bus.ts      신규 — A-1/A-2/A-3 호출 + 순수 파서 + Haversine
src/app/api/bus/nearby/route.ts    신규 — A-2 + A-1 묶음 (lat/lng → BusStop[])
src/app/api/bus/route/route.ts     신규 — A-3 lazy (cityCode/routeId → BusRouteStop[])
src/lib/types.ts                   BusStop/BusArrival/BusRouteStop 추가
messages/ko.json, messages/en.json bus.* 라벨 추가
src/components/BusArrivals.tsx      신규 — 정류소+도착, mode: "current"|"place", 수동 새로고침
src/components/BusRouteStops.tsx    신규 — 경유정류소 펼치기(lazy fetch)
src/components/PlaceDetail.tsx      BusArrivals(mode="place") 온디맨드 삽입
src/components/PlaceSearch.tsx      "내 주변 버스"(mode="current") 진입 배치 + 키유무 prop 게이트
src/app/[locale]/page.tsx          hasDataGoKrKey()를 서버에서 평가해 PlaceSearch에 전달
```

## 9. UI 동작 (StationFacilities 패턴 재사용)

- 상태머신: `idle | locating | loading | empty | error | done`(현재위치 모드는 `locating` 추가 — geolocation 권한/획득 단계).
- **수동 새로고침**: "새로고침" 버튼 + 조회 시각 표시("HH:MM 기준"). 자동 폴링 없음.
- in-flight ref 가드(`useRef(false)` + `finally` 해제)로 더블클릭 중복 호출 차단.
- `aria-disabled`(`disabled` 금지) + `aria-busy`, 통지는 `aria-live="polite"` 단일 채널.
- 결과 도착 시 결과 헤딩으로 포커스 이동(`requestAnimationFrame`).
- geolocation 거부/미지원 → "위치 권한이 필요합니다" graceful 안내(장소 상세 모드는 좌표가 props라 영향 없음). geolocation API는 secure context(HTTPS/localhost)에서만 동작 — 프로덕션은 HTTPS라 무방, dev는 localhost라 무방.
- **거리 표시 포맷**: `distanceMeters` < 1000이면 "약 320m", 이상이면 "약 1.2km"(소수 1자리). 정렬은 항상 미터 원값 기준.

## 10. 테스트 (Vitest 게이트 — 같은 커밋)

순수 파서 중심(결정적·로컬·무료·빠름):

- **A-2 파싱**: envelope → `BusStop[]`, Haversine 거리 계산·정렬 검증, `nodeno` 부재 처리.
- **A-2 후보 수집(개정 노트 §3)**: `totalCount`가 받은 item 수보다 큰 fixture에서 **페이징으로 전체 후보를 모은 뒤** 정렬해야 진짜 최근접 5개가 나오는지 검증(10건만 받으면 누락되는 케이스를 실패로 고정).
- **A-1 파싱**: envelope → `BusArrival[]`, `lowFloor` 판정("저상버스"/"일반차량"), `arrivalSeconds` 정렬, 빈결과(`""`)·단일 item(객체 vs 배열) 양형.
- **도착 실패 구분(개정 노트 §1)**: A-1 promise rejected → 해당 `BusStop.arrivalStatus === "unavailable"`(+`arrivals: []`)이고, 빈결과(`""`) → `arrivalStatus === "ok"` + `arrivals: []`임을 **각각 구분해 검증**(둘이 뭉개지지 않음을 고정).
- **A-3 파싱**: envelope → `BusRouteStop[]`, `nodeord` 순서.
- **graceful**: 키 없음 → 빈/null, 에러코드 응답 → throw, 좌표 0건 → 빈 배열.
- Haversine는 알려진 두 좌표쌍의 거리로 검증(예: 서울시청↔강동구청 ≈ 알려진 km).

## 11. 전제조건 (사용자 액션 필요)

data.go.kr에서 **TAGO 3개 API 활용신청** — 자동승인, 같은 `DATA_GO_KR_API_KEY`:

- 15098534 BusSttnInfoInqireService (정류소, A-2)
- 15098530 ArvlInfoInqireService (도착, A-1)
- 15098529 BusRouteInfoInqireService (노선, A-3)

활용신청 후 첫 실호출로 확정할 항목(미해결 리스트):

1. **3종 ServiceKey 공유 여부** — 같은 키로 셋 다 동작하는지(provider 키 관리 영향).
2. **https/http 스킴** — https 동작 여부.
3. **envelope 정합** — `response.body.items.item` / 빈결과 `""` / `resultCode "0"` 코레일과 동일한지.
4. **필드명** — §2의 알려진 필드명이 실응답과 일치하는지.
5. **A-3 일한도** — RESEARCH §H에서 미확정(10,000건 추정).

> 활용신청 전에는 provider·route·컴포넌트·테스트를 모두 구현하되 실호출 검증은 보류한다. 파서 단위 테스트는 **고정 fixture(예상 envelope JSON)** 기반이라 키 없이 통과한다.
>
> **⚠ 실 검증은 pre-merge 게이트다(개정 노트 §2 — 선택 아님)**: fixture 테스트가 다 green이어도 **머지/배포 금지**. 다음을 먼저 통과해야 한다:
> 1. 3종 API 활용신청 승인 후 **실 응답을 캡처**해 위 미해결 항목 1~5(키 공유·스킴·envelope·필드명·한도)를 확정한다.
> 2. **캡처한 실응답으로 fixture를 교정**하고 파서 테스트를 재고정한다(예상 envelope이 실제와 다를 수 있음).
> 3. **3종 엔트리틀먼트 헬스체크**(각 API가 키로 실제 200 + 정상 envelope 반환)를 통과한다.
> 키 존재만으로 진입점을 노출(`canShowBus`)하지만, 키 존재 ≠ 엔트리틀먼트 동작이다. 미등록 API는 런타임에 `SERVICE_KEY_IS_NOT_REGISTERED_ERROR` → throw → 502로 드러나야 하며(§6), 이 에러 경로가 fixture 테스트로도 고정돼 있어야 한다. 미검증 계약을 단 fixture만으로 머지하면 프로덕션에서 502·엉뚱한 빈결과가 난다.

## 12. 비목표 (YAGNI)

- ODsay 환승 경로계산(A-4) — 별도 카테고리, 다음 패스.
- en 로케일 영문 정류소명 — TAGO 미제공. 유료 ODsay 또는 보류.
- 자동 폴링·실시간 푸시 — 수동 새로고침으로 충분.
- 정류소 즐겨찾기·알림 — 후속.
