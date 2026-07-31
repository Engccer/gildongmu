# 대중교통 경로 운행 시간 판정 설계 (ODsay 심야 결함 수정)

> 작성 2026-08-01. 승인 위원장. 구현 플랜은 `docs/superpowers/plans/2026-08-01-odsay-service-hours.md`.

## 배경·목표

ODsay `searchPubTransPathT`는 출발 시각 파라미터가 없어 심야에도 주간 노선을 추천한다. 길동무는 이 결과를 그대로 브리핑하므로, 사용자가 정류장에서 오지 않는 버스를 기다리게 된다. 시각장애 사용자는 정류장 전광판을 볼 수 없어 원인조차 알 수 없다.

**측정 가능한 성과**: ① 심야 시각을 주입한 판정 테스트에서 첫차 04:00 노선이 `outside`로 판정된다 ② 같은 경로 응답에서 운행 중 노선이 운행 밖 노선보다 앞에 온다 ③ 브리핑 낭독에 "첫차 04:00, 지금은 운행하지 않습니다"가 포함된다 ④ 운행시간 조회가 실패해도 경로 응답이 살아 있고 순위가 바뀌지 않는다.

## 실측 근거 (2026-08-01 03:58~04:11 실호출, 재조사 금지)

- **결함 확정**: 2구간 6개 대안 전부 운행 시간 밖. 강동역→길동생태공원 342 `04:00~22:30`·370 `04:00~22:50`·30-3 `04:15~23:40`, 광나루→천호역 4318 `04:00~22:30`·340 `04:30~23:10`·3411 `04:30~23:10`. TOPIS 실시간 도착도 342·370을 "출발대기"(차고지 대기)로 일치 확인.
- **앱 내부 모순**: 길찾기 브리핑은 "342, 22분", 같은 앱 도착정보 화면은 같은 노선을 "출발대기"로 낭독한다. 도착 화면은 `arrmsg1` 정본 계약 덕에 정확하므로 **결함은 ODsay 브리핑에 국한**된다.
- **서울 조인**: ODsay `lane[0].busLocalBlID`가 TOPIS `busRouteId`와 **동일 값**(342=`124000038`). 6개 대안 조인 실패 0건. 이름 매칭이 아니라 ID 직결이라 동명 노선 함정([[real-call-gate-weak-predicate]])이 없다.
- **지방 조인은 구조가 다르다**: TAGO `routeid`는 ODsay `busLocalBlID` 앞에 지역 접두사가 붙는다(부산 `5200141000` → `BSB5200141000`). `routeId` 직접 조회는 실패하고, 노선번호 검색 후 대조해야 한다. 도시 코드도 체계가 달라 ODsay `busCityCode=7000`(부산) ↔ TAGO `cityCode=21`이다. 시각 포맷도 TOPIS는 12자리(`202608010400`), TAGO는 4자리(`0430`).
- **지하철도 같은 결함**: 04:07 강동역→강남역 1순위가 지하철 3회 환승인데, 04:11 강동역 실시간 도착은 0건이었다. 다만 판정 수단이 미확정이라 이번 범위 밖.

## 아키텍처

보강은 **provider 진입점 `getTransitRoute` 안에서 끝낸다**. 채팅이 라우트를 거치지 않고 이 함수를 직접 호출하므로(`src/lib/chat/router.ts:253`), 라우트 계층에 두면 채팅만 결함이 남는다. 카카오 도보의 "라우트·채팅 모두 `getWalkRoute`만 호출" 패턴과 동형이며, 소비자 6곳(웹 `TransitRouteBriefing`·`DirectionsView`, 채팅, CLI `formatters`, iOS `DirectionsTabView`)이 자동으로 커버된다.

```
getTransitRoute
  → normalizeOdsayRoute      (ODsay 정규화, 순수·무변경)
  → collectBusRoutes         (중복 노선 dedupe: 같은 노선이 여러 대안에 등장)
  → fetchServiceHours        (TOPIS/TAGO 병렬, 실패는 throw 대신 unknown)
  → annotateServiceStatus    (순수: 시각 + 첫차·막차 → 상태)
  → prioritizeRunning        (안정 정렬)
```

**신규 모듈 2개**: `src/lib/service-hours.ts`(순수 판정·정렬), `src/lib/providers/bus-service-hours.ts`(TOPIS/TAGO 조회). `odsay.ts`의 `normalizeOdsayRoute`는 순수 함수로 유지한다(보강은 그 바깥에서).

## 판정 계약

```ts
export type ServiceStatus = "running" | "outside" | "unknown";

/** nowMinutes = KST 기준 0시부터의 분. first/last는 "HHMM" 정규화 후 분. */
export function judgeServiceStatus(
  nowMinutes: number,
  firstMinutes: number | null,
  lastMinutes: number | null,
): ServiceStatus;
```

- 둘 중 하나라도 null이면 `unknown`. **추정 금지**.
- `last < first`면 자정 넘김(심야 노선): `now >= first || now <= last`이면 `running`.
- 그 외: `first <= now && now <= last`이면 `running`.
- 시각을 인자로 받으므로 심야 재현 없이 fixture 테스트가 가능하다.

시각 파싱은 별도 함수로 분리한다. TOPIS 12자리(`202608010400` → 240분)와 TAGO 4자리(`0430` → 270분)를 모두 받아 분으로 정규화하고, 형식이 어긋나면 null을 반환한다(파싱 실패를 0으로 뭉개지 않는다).

## 3-state와 정렬

```ts
const RANK: Record<ServiceStatus, number> = { running: 0, unknown: 1, outside: 2 };
```

`prioritizeOpen`(`src/lib/providers/night-clinic.ts:264`)과 같은 안정 정렬로, 같은 상태 안에서는 **ODsay 추천 순서를 보존**한다.

⚠ **`unknown`이 `outside`보다 위**인 것이 불변식이다. 조회 실패·미지원 지역을 결함으로 단정하면 멀쩡한 경로가 강등된다. "0/없음" ≠ "정보 없음" ≠ "조회 실패"를 뭉개지 않는 3-state 원칙의 적용이다.

경로 단위 상태는 **그 경로의 버스 leg 중 `RANK`가 가장 큰 값**으로 정한다(하나라도 `outside`면 경로가 `outside`, `running`+`unknown`이면 `unknown`). 환승 중 한 구간만 끊겨도 그 경로는 성립하지 않기 때문이다.

⚠ **버스 leg가 없는 경로(지하철 전용·도보 전용)는 판정 대상이 아니므로 정렬 키를 `running`과 같은 0으로 둔다.** `unknown`(1)을 주면 지하철 경로가 운행 중 버스 경로보다 아래로 밀리는데, 지하철 운행시간은 이번 범위 밖이라 근거 없는 강등이 된다. 0을 주면 안정 정렬과 맞물려 **현행 순서가 그대로 보존**되어 회귀가 0이다.

## 낭독·i18n

`TransitLeg`에 옵셔널 필드를 추가한다(도보 leg에는 없음, 기존 옵셔널 관례 준수).

```ts
serviceStatus?: ServiceStatus;
firstServiceTime?: string;  // "04:00"
lastServiceTime?: string;   // "22:30"
```

문장 합성은 기존 `joinText` + `t()` 패턴을 따르고 5개 언어에 키를 추가한다(`i18n-messages.test.ts`가 머지 게이트).

**`outside`만 표기하고 `running`·`unknown`은 침묵한다.** 정상까지 표기하면 매 항목에 노이즈가 붙고, `unknown`은 지방에서 흔해 "정보 없음"을 반복 낭독하게 된다. [[honesty-disclosures-belong-to-api-layer]]의 "조건부 실패 표기만 예외(평소 0, 발생 시만 = 정보)"에 맞춘 결정이다. API 응답에는 세 상태를 모두 담되 UI 표기만 조건부로 둔다.

## 단계 분리

지방은 서울과 조인 구조가 달라(위 실측 근거) 별도 태스크로 나눈다. 두 단계 모두 같은 마일스톤 안에서 처리한다.

- **1단계 서울(TOPIS)**: `busCityCode === 1000`. `busRouteInfo/getRouteInfo`에 `busRouteId = busLocalBlID`를 그대로 넘긴다. 조인 실증 완료.
- **2단계 지방(TAGO)**: ODsay `busCityCode` → TAGO `cityCode` 매핑 테이블(광역시·도 단위)을 두고, `getRouteNoList`로 노선번호 검색 후 **`routeid.endsWith(busLocalBlID)`로 대조**한다. 접두사 규칙을 추측해 조립하지 않는다(부산 `BSB`만 관측했고 다른 지역 접두사는 미관측).
- 2단계 착수 전 **최소 3개 지역(부산·대구·인천 등)으로 매칭 규칙을 실호출 확인**한다. `endsWith` 대조가 깨지는 지역이 나오면 그 지역은 `unknown`으로 폴백하고 매핑 테이블에서 뺀다.
- 1단계만 배포된 상태에서 지방은 전부 `unknown`이므로 강등도 표기도 없고 **현행과 동일하게 동작**한다(회귀 0).

## 캐시·비용·실패

- 노선 운행시간은 준정적이므로 `next: { revalidate: 86400 }`. GET이라 캐시가 실효한다([[nextjs-fetch-cache-route-handler-contract]]).
- 경로 3건에서 dedupe 후 보통 2~5개 노선. 기존 `DATA_GO_KR_API_KEY` 재사용이라 **추가 비용 0원**.
- **조회 실패는 throw하지 않는다.** `Promise.allSettled`로 받아 실패한 노선만 `unknown`으로 두고 경로 응답은 살린다. 운행시간 보강 실패가 길찾기 자체를 죽이면 결함을 고치려다 더 큰 회귀를 만든다.
- ODsay 호출 자체의 계약(`-98` graceful null, 그 외 throw)은 무변경.

## 경계·불변식

- `normalizeOdsayRoute`는 순수 함수로 유지한다. 보강 로직을 이 안에 넣지 않는다(fixture 테스트 계약 유지).
- 라우트·채팅 모두 `getTransitRoute`만 호출한다. provider 직접 호출 금지 규칙에 `bus-service-hours`를 추가한다.
- 판정 기준 시각은 **KST**다. 서버 타임존에 의존하지 않고 명시적으로 변환한다.
- 지하철 leg는 이번 범위 밖이며 `serviceStatus`를 부여하지 않는다(`undefined`). 부여하면 "판정했는데 running"으로 오독된다.

## 테스트·검증 계획

- **순수 판정 fixture(게이트)**: 주간·심야·자정 넘김·경계값(첫차 정각·막차 정각)·결측(null)·파싱 실패. 시각 주입이라 결정적.
- **정렬**: `running`/`unknown`/`outside` 혼재 시 순서와 **같은 상태 안 원순서 보존**(안정성).
- **경로 단위 상태**: 환승 경로에서 한 구간만 `outside`일 때 경로가 `outside`가 되는지.
- **실패 격리**: 조회가 전부 실패해도 경로 3건이 그대로 반환되고 순위가 원본과 같은지.
- **실호출 게이트**: TOPIS·TAGO 응답을 fixture로 캡처해 필드명·포맷을 고정한다(추측 금지). 2단계는 3개 지역 매칭 확인이 머지 게이트.
- ⚠ 심야 대조는 시각 의존이라 재현 불가하다. 그래서 판정 함수가 시각을 인자로 받는 설계이며, 실호출 게이트는 "필드가 오는가"만 보고 "지금 운행하는가"는 주입 시각으로 검증한다.

## 범위 밖 (후속)

- **지하철 운행시간 판정**: 결함은 실측 확인됐으나 판정 수단이 미확정이다. 기존 `/api/station/timetable`은 강동역에서 빈 `lines`를 반환해 신뢰할 수 없고, 실시간 도착으로 대체하면 일 1,000회 쿼터를 추가로 쓴다. 수단 확정 후 별도 spec.
- ODsay `-98`(700m 이내) 근거리 경로 미제공은 별개 이슈.
- dodo-planet 이식은 이 마일스톤 종료 후.
