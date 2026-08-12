# 길찾기 결과 섹션 동적 순서 (E11) 설계

- 날짜: 2026-08-12
- 출처: 위원장 요청 2026-08-12(`docs/BACKLOG.md` E11), 문턱 판정 동일자 확정
- 상태: 설계 확정

## 1. 목적

길찾기 결과에서 스크린 리더 순차 탐색 구간을 줄인다. 위원장 요청 둘(①도보가 걸어갈 만한 거리면 도보 섹션 최상단 ②대중교통 경로가 안 나오면 최하단)을 한 규칙으로 합친다. 수단 종류가 아니라 그 조회에서 실제로 쓸 수 있는 내용이 순서를 정한다(검색 "분류는 순위를 결정하지 않는다" 교훈과 같은 축).

## 2. 순서 규칙 (정본)

1. **성공 수단이 앞, 비성공(경로 없음·조회 실패)이 뒤.** 각 군 안에서는 현행 고정 순서(대중교통 → 자동차 → 도보) 유지.
2. **도보가 성공이고 30분 이하면 성공군 맨 앞.** 판정은 기존 도보 상세 접기 경계 재사용: `!shouldCollapseWalk(durationSeconds)`(분 반올림 > 30 이면 접힘). 하나의 경계가 두 동작(상세 펼침·최상단 승격)을 정하므로 "상세가 펼쳐져 있으면 최상단, 접혀 있으면 제자리" 한 문장으로 설명이 끝난다. 새 상수 0개.
3. **순서는 조회 settled 시점에 1회 확정하고 그 뒤 재계산하지 않는다.** 계단 회피 토글(도보 outcome만 교체), 도보 추천↔최단 전환(M3), E10ⓑ 재탐색 어느 것도 순서를 건드리지 않는다. 사용자가 조작 중인 섹션이 발밑에서 이동하는 것을 구조적으로 막는다.
4. **순서 변경을 별도 통지하지 않는다.** 헤딩 이름이 곧 정보다(잉여 통지 금지).

승격 판정의 기준값은 **최초 settled 시점 추천 경로의 `durationSeconds`**다. 계단 회피 재조회로 소요 시간이 30분 경계를 넘나들어도 재판정하지 않는다(규칙 3의 귀결).

## 3. 구현 구조

### 3.1 순수 함수 (웹 ↔ Kit 미러)

- 웹: 신규 `src/lib/directions-order.ts`
  `orderDirectionsModes(modes: ModeKey[], isSuccess: Partial<Record<ModeKey, boolean>>, walkDurationSeconds: number | null): ModeKey[]`
  `modes`는 조회한 수단의 현행 고정 순서 배열. 30분 판정은 `shouldCollapseWalk` 재사용. `walkDurationSeconds`는 도보 성공 시에만 수치, 아니면 null.
- iOS: Kit `Directions.swift`에 동일 규칙. 30분 판정 미러를 Kit에 신설(웹과 같은 반올림: `Int((Double(초)/60).rounded()) > 30` — 양수에서 JS `Math.round`와 동일).
- 동조는 공유 fixture(§5)가 강제한다.

### 3.2 웹 (`DirectionsView.tsx`)

- `activeModes`는 **조회 대상 결정 전용**으로 남긴다(게이트·로케일 파생, fetch 루프·outcomes 키). 조회는 `Promise.allSettled` 병렬이라 fetch 순서는 계약이 아니다.
- `QueryResults`에 `orderedModes: ModeKey[]` 필드를 추가하고 settled 커밋 시 1회 계산해 **스냅샷 저장**.
- 렌더 루프(`activeModes.map` → `results.orderedModes.map`)와 첫 성공 heading 포커스(`successes` 계산)가 `orderedModes`를 기준으로 한다. 성공군이 앞이므로 성공이 하나라도 있으면 첫 성공 = 새 순서의 첫 성공 항목.
- `toggleStepFree`는 현행대로 `outcomes.walk`만 교체한다 — `orderedModes`가 스냅샷이라 순서는 자동 불변.

### 3.3 iOS (Kit `Directions.swift` + 앱 `DirectionsTabView.swift`)

- `DirectionsResults`에 `orderedModes: [DirectionsMode]` **저장 프로퍼티**를 추가한다(init에서 규칙으로 계산, computed 금지 — computed면 부분 재조회가 암묵 재계산을 일으킨다).
- `displayedModes`·`successModes`·`firstSuccess`는 `orderedModes` 파생으로 바꾼다. gated·outOfCoverage는 현행대로 표시 제외(정렬 대상 밖).
- `replacingWalk(outcome:)` 메서드 신설: `orderedModes`를 보존한 채 도보 outcome만 교체. `refetchWalk`의 `DirectionsResults(outcomes:)` 재생성 자리를 이 메서드로 교체한다(현행 코드는 재계산 위험 자리).

### 3.4 3-state 유지

"경로 없음(empty)"과 "조회 실패(error)"는 **위치 축에서만** 같은 취급이다(둘 다 읽을 내용이 없다). 섹션 본문 문구는 현행 구분을 유지한다. 순서가 반영하는 것은 실패 원인이 아니라 내용의 유무다.

## 4. 이득의 웹·iOS 비대칭 (측정 시 유의)

웹은 조회 완료 시 첫 성공 heading으로 자동 포커스하므로 비성공 강등(②)의 탐색 절감이 거의 0이고(실패 섹션을 이미 건너뛴다), iOS는 완료 시 포커스 이동이 없어(의도된 분기, CHANGELOG 2026-08-11) 절감이 크다. 도보 승격(①)은 착지점 자체를 바꾸므로 양쪽 다 이득. 효과 판정은 iOS 실기기에서 한다.

## 5. 테스트

- **공유 fixture** `src/lib/__tests__/fixtures/directions-order-scenarios.json`(course-axis 패턴): 웹 Vitest와 Kit Swift Testing이 같은 파일을 소비. 시나리오 최소 집합:
  - 전 수단 성공 + 도보 29분/30분/31분(경계 3건: 29·30분 승격, 31분 제자리)
  - 대중교통 실패(→ 최하단), 도보 empty(→ 하단), 전 수단 실패(현행 순서 유지)
  - 도보만 성공, 조회 수단이 2개뿐인 경우(게이트로 도보 제외 등)
- **웹 컴포넌트 테스트**: 계단 회피 토글 후 순서 불변(도보 empty→성공 전환 포함), 첫 성공 포커스가 새 순서를 따르는지.
- **Kit 테스트**: `replacingWalk` 순서 보존, fixture 동조.

## 6. 범위 밖

서버·API 변경 0건, i18n 변경 0건, 신규 통지 0건. CLI/MCP 무관(순서는 클라이언트 표시 층의 관심사).

## 7. 배포

웹은 push 자동 배포. iOS는 배포판(기본 구성)과 실험판(`CONFIGURATION=Experimental`) **양쪽** 실기기 빌드·설치(위원장 지시 2026-08-12).

## 8. 설계 리뷰 판정

codex 설계 단계 적대적 리뷰 **생략**: 새 불변식·외부 통합·비가역 파급·안전 크리티컬 축 어디에도 해당하지 않는다 — 검증된 기존 계약(outcomes 3-state·포커스 계약·미러+fixture 동조)의 재조합이고 파급이 국소·가역이며 구현 단계 리뷰·테스트가 잔여 리스크를 덮는다.
