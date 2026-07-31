# 지하철 구간 운행 시간 판정 구현 플랜 (2026-08-01)

정본 스펙: `docs/superpowers/specs/2026-08-01-subway-service-hours-design.md`

## 구현 방식 판정: inline

태스크가 **순차 의존**이다. 순수 매처가 확정돼야 조회 모듈의 인터페이스가 정해지고, 조회 모듈이 있어야 `annotateServiceStatus` 배선이 가능하다. 수정 파일도 겹친다(`odsay.ts`를 T3·T4가 함께 건드린다). 도메인은 하나(대중교통 경로)다. 위임 신호(독립 도메인 3개 이상·동형 반복·10개 이상 파일 탐색)는 어느 것도 성립하지 않는다.

**리뷰는 이 판정과 무관하게 분리한다** — 구현 완료 후 별도 컨텍스트 리뷰어에게 요구사항(이 플랜)과 산출물(diff)만 넘긴다.

## 태스크

### T1. 노선명 코어에서 구분자 제거 (`station-match.ts`)

`lineHintMatches`의 `core()`가 `.`·`·`·공백을 제거하도록 확장한다. ODsay `수인.분당선` ↔ TAGO `수인분당` 매칭의 전제.

- 기존 케이스 회귀 없음을 테스트로 못 박는다: 양평 5호선 vs 경의중앙(동명이역 분리 유지), `1호선` vs `11호선`(숫자 완전 일치 유지), `공항철도` ↔ `공항`.
- 신규: `수인.분당선` ↔ `수인분당`, `신분당선` ↔ `신분당`.

게이트: `npm run test:run` green.

### T2. 순수 매처 `pickTimetableStation` + `subwayHoursKey` (신설 모듈)

`src/lib/providers/subway-service-hours.ts`에 순수 부분만 먼저 만든다.

- 역명 정확 매칭은 `normalizeStationName` 재사용(자체 정규화 금지 — CLAUDE.md 횡단 규칙).
- 노선 매칭은 **순서 있는 2단계**: 지역 유지 변형 우선, 0건일 때만 지역 제거 변형.
  - 지역 유지 변형 = ODsay 이름에서 공백 제거(`인천 1호선`→`인천1호선`)
  - 지역 제거 변형 = 첫 공백 앞 토큰 제거(`수도권 1호선`→`1호선`)
- 후보 2건 이상이면 `null`(모호 → 판정 안 함).

테스트(스펙 §4-1 전량): 부평 인천1호선/수도권1호선 분기, 부산 2호선, 수인분당, 이름 불일치, 시청 충돌.

게이트: 위 6케이스 green.

### T3. 조회 `fetchSubwayServiceHoursMap` (같은 모듈)

- `tago-subway.ts`의 `fetchTago`를 export해 재사용(envelope·resultCode·totalCount 검증 중복 제거).
- 요청당 공휴일 1회 판정 → `dailyTypeCode`, `computeServiceDailyType` 재사용.
- ref 중복 제거 후 `Promise.allSettled` 병렬. **절대 throw하지 않는다**(실패는 Map에서 누락 → 호출부가 unknown).
- `deriveFirstLast`의 `"HH:MM"`에서 콜론을 떼어 `parseServiceTime`에 넘긴다(공유 파서 계약 불변).
- 방향: `wayCode === 1 ? "U" : "D"`.

게이트: 모듈 단위 테스트(fixture로 키워드 응답·시간표 응답 주입) green.

### T4. 배선 — `TransitLeg.serviceWayCode` + `annotateServiceStatus` 지하철 분기

- `types.ts`에 `serviceWayCode?: number`.
- `toLeg`가 지하철 구간에 `wayCode` 투영(`OdsaySubPath`에 `wayCode?: number` 추가).
- `annotateServiceStatus(result, busHours, subwayHours, nowMinutes)` — 지하철 leg는 `subwayHoursKey`로 조회.
- `getTransitRoute`가 버스·지하철 map을 `Promise.all`로 병렬 조회.
- rank 주석을 스펙 §3-4대로 갱신(지하철이 판정 대상이 된 사실 반영).

게이트: 스펙 §4-3 계약 테스트 5건 green + 기존 대중교통 테스트 무회귀.

### T5. 채팅 안내 문구 수단 일반화

`declarations.ts`의 "구간에 serviceStatus가 outside인 **버스**가 있으면"을 수단 무관 표현으로. 프롬프트 최소 수정 원칙(유인 문구 삭제·긍정 트리거) 준수 — 금지문 덧대기 금지.

게이트: i18n 키 테스트 green(문구 변경이 키를 건드리지 않는지).

### T6. 실호출 머지 게이트

fixture green ≠ 실계약 검증. 스크립트는 scratchpad 일회성(repo 미포함).

1. 길동→강남 실호출 — 지하철 구간에 첫차·막차가 실제로 채워지는가(전량 unknown이면 조인 사망)
2. 부평 경유 구간 — 인천1호선 / 수도권 1호선이 각각 옳게 갈리는가
3. 심야 시각 주입(순수 함수라 실시각 대기 불요) — 지하철 경로가 실제로 강등되는가
4. 비수도권(부산 서면→해운대) — 판정되거나 정직하게 unknown인가

## 리뷰·완료 게이트

1. `npm run test:run` green + `npm run lint` + `npm run build`
2. 별도 컨텍스트 code-reviewer(요구사항=이 플랜, 산출물=diff만. 세션 히스토리·의도 미전달)
3. 리뷰 반영 후 commit + push(자동 배포)
4. PROGRESS.md 운영 표·BACKLOG.md A1 갱신
