# 최근 경로 + 업데이트 이력 설계

2026-08-10 · 위원장 승인. 한 앱 업데이트로 묶이는 독립 기능 2건: ① 길찾기 탭 "최근 경로" 섹션(웹 미러 포함) ② 설정 "업데이트 이력"(iOS 전용). 공식·실험판은 같은 코드의 빌드 구성이라 iOS 1회 구현으로 양쪽 충족(실험 봉인 `#if EXPERIMENTAL` 미적용 — 두 기능 모두 검증 전 실험 기능이 아니다).

설계 적대적 리뷰 판정: **생략**(글로벌 기준 4축 전부 비해당 — 새 불변식 신설 없음(RecentSearchStore append 코어·삭제/포커스·드리프트 가드 등 검증된 계약의 재조합), 외부 통합 없음, 로컬 저장 신규 키 추가라 비가역 파급 없음, 안전 크리티컬 축 아님). 구현 단계 서브에이전트 리뷰 + 게이트 테스트 + 실기기 VoiceOver 게이트는 그대로 수행한다.

## 0. 전제

자주 가는 경로(집→직장)는 매번 출발지·도착지를 검색하지 않고 한 번의 활성화로 재조회할 수 있어야 한다. 기존 최근 검색(스펙 `2026-07-26-recent-searches-design.md`)은 endpoint 단건 기록이라 두 필드를 각각 채워야 하고, 그 목록은 검색 시트 안에만 있다.

## 1. 최근 경로 (길찾기 탭)

### 1.1 저장 계약

- **단위는 출발지·도착지 쌍**이다. 새 목록 타입 `RecentRoute`:
  - iOS Kit `RecentSearchStore`에 추가: `struct RecentRoute: Codable { let from: RecentEndpoint?; let to: RecentEndpoint? }` — `nil` = "현재 위치".
  - 웹 `src/lib/recent-searches.ts`에 추가: `type RecentRoute = { from: RecentEndpoint | null; to: RecentEndpoint | null }` — `null` = "현재 위치".
- 저장 키: iOS `recentRoutes.v1`, 웹 `gildongmu:recent-routes:v1`. 기존과 동일하게 기기 로컬 전용(UserDefaults / localStorage), 파싱 실패는 빈 목록 복구(기록은 부가 기능).
- **dedupe는 쌍 단위**: from 동일 ∧ to 동일일 때 같은 항목(최신으로 끌어올림). endpoint 동일 판정은 기존 `sameCoord`/`sameEndpoint`(좌표 소수 4자리) 재사용, 양쪽 nil(현재 위치)끼리도 동일. cap 20(기존 `cap`/`RECENT_CAP` 재사용), append 코어(`append`/`appendRecent`) 재사용.
- 두 endpoint 모두 "현재 위치"인 쌍은 기록하지 않는다(자기 자리→자기 자리, 재조회 의미 없음).

### 1.2 기록 시점

- **조회가 settled에 도달한 시점 1곳에서만 기록한다**(성공 수단 0이어도 기록 — 전 수단 실패는 일시 장애일 수 있다).
  - iOS: `DirectionsModel.performQuery`의 `phase = .settled` 커밋 지점.
  - 웹: `DirectionsView.runQuery`의 `setPhase({kind:"settled"})` 커밋 지점.
- 기록하지 않는 경로: `needEndpoints`, 측위 실패(geoDenied·geoReduced·geoError), `outOfCoverage`(선분기·서버 마커 양쪽 — 다시 눌러도 똑같이 실패할 항목을 남기지 않는다), 취소(stale 가드가 이미 return).
- 계단 회피 토글의 도보 단독 재조회는 기록 지점이 아니다(전체 조회 1곳 단일화. 같은 쌍이라 dedupe로 무해하지만 기록 경로를 늘리지 않는다).
- 기록 값은 performQuery/runQuery에 넘어온 endpoint 스냅샷이다. `.current`는 nil로, `.place`는 label+좌표로 투영한다. 측위로 해석된 실좌표를 current 자리에 굳히지 않는다(다음 활성화 때 그 시점 위치를 새로 잡는 것이 계약).

### 1.3 표시

- 자리: 길찾기 탭, 필드·조회 버튼 섹션 **아래** "최근 경로" 섹션. 웹도 조회(submit) 버튼 아래 동일.
- **노출 조건: 목록 비어 있지 않음 ∧ 결과 없음(`results == nil`) ∧ 조회 진행 중 아님(`!isBusy`)**. 결과가 뜨면 숨긴다(결과 아래에 최대 20행이 붙으면 결과 탐색 방해). 필드 재확정(`clearResults`)으로 결과가 폐기되면 다시 나타난다. 측위·조회 실패 상태에서는 보인다 — 다른 경로를 고르는 우회로가 된다.
- iOS는 전체(최대 20) + "전체 지우기" 행, 웹은 상위 5 + "전체 지우기"(각 플랫폼의 기존 최근 목록 관례 유지).
- 섹션 헤더는 "최근 경로"(heading, iOS `.isHeader`).

### 1.4 활성화

- 항목 라벨: **"{from}부터 {to}까지 경로 조회"**(위원장 제시 형식). "현재 위치"는 기존 `directions.currentLocation` 어휘. 6개 언어 번역(en "Route from {from} to {to}" 계열). 어순이 다른 언어는 위치 인자 순서만 바뀐다(`guidance-template-value-type` 관례).
- 활성화 = **두 필드 원자 확정 + 즉시 조회**. iOS는 `setEndpoint(from)`·`setEndpoint(to)` 후 `runQuery()`, 웹은 두 필드 state 확정 후 `runQuery()`. `setEndpoint` 경유이므로 기존 최근 장소(endpoint) 목록에도 함께 기록된다(dedupe 끌어올림, 의도된 부수 — 기록 단일 경로 유지). `.current`(nil) 쪽은 기존 규칙대로 endpoint 목록엔 기록되지 않는다.
- **활성화 즉시 포커스를 조회 버튼으로 선점 이동한다**(iOS `submitFocused`, 웹 `submitRef.focus()`). 결과가 도착하면 최근 경로 섹션이 통째로 사라지므로, 방치하면 포커스를 쥔 행이 제거되어 커서가 최상단으로 이탈한다(헌장 §5 "포커스를 쥔 요소를 제거하는 상태 전이"). 조회 버튼은 항상 존재하는 안정 요소이고, 완료 시 포커스를 옮기지 않는 기존 계약(위원장 판정 2026-08-02)과도 정합 — 다음 스와이프가 상태→결과로 자연히 이어진다. 완료 통지는 기존 합산 1문장 그대로(추가 통지 없음).
- 측위 의미론은 조회 버튼과 동일하다(같은 `runQuery` 경로, `force:false` 캐시 정책 포함). 활성화가 별도 측위 계층을 만들지 않는다.

### 1.5 삭제·전체 지우기

기존 최근 목록 계약(스펙 2026-07-26 §5) 그대로:

- iOS: 행 `swipeActions` 삭제(VoiceOver 로터 자동 노출). 삭제 후 포커스는 다음 항목 → 없으면 이전 항목 → **목록 소멸 시 조회 버튼**(시트의 마이크 행에 대응하는 이 화면의 안정 착지점). 통지는 기존 `recent.deleted`/`recent.cleared` 재사용, 1건.
- 웹: 항목 버튼 옆 삭제 버튼(인터랙티브 요소는 별도 객체 — 합치지 않는다), `aria-label`은 기존 `recent.deleteItem` 패턴에 항목 전체 라벨. 삭제 후 다음 삭제 버튼으로 포커스(기존 `recentDeleteRefs` 문법).

### 1.6 웹 미러 상세

- `recent-searches.ts`에 routes 4함수(load/record/remove/clear + validator) 추가 — React/Next 비의존 유지(dodo 이식성).
- `DirectionsView`에 섹션 추가: 로드는 마운트 후(SSR 가드, 기존 queueMicrotask 문법), 기록은 runQuery settled 지점에서 state 동기 갱신.

### 1.7 접근성 요지

- 항목 한 줄 = 한 객체(라벨 문장 하나가 곧 버튼 이름, 인라인 분절 없음).
- 섹션은 사용자가 여닫는 패널이 아니라 조건 노출이지만, 필드 바로 아래라 순방향 스와이프가 자연 발견 경로다. heading이 빠른 점프를 담당한다.

## 2. 업데이트 이력 (설정, iOS 전용)

### 2.1 데이터 파이프라인

- **정본은 `docs/appstore/release-notes.md`** (버전별 `### ko`·`### en` 코드블록). 변환 스크립트 `scripts/build-release-notes.mjs`가 md를 파싱해 `ios/Gildongmu/Resources/release-notes.json`으로 생성·커밋한다(정적 seed 관례 동형). 형식: `[{ "version": "1.4", "ko": "…", "en": "…" }]`, md 등장 순서(최신순) 보존.
- 파서 규칙: `## <버전> (빌드 N)` 섹션 안의 `### ko`·`### en` 각각의 첫 fenced 코드블록을 본문으로 취한다. **둘 다 없는 버전은 제외**(1.0 — 첫 출시라 What's New가 없는 것이 정본), **하나만 있으면 스크립트 실패**(불완전 데이터로 조용히 출시되는 것을 막는다).
- **드리프트 가드**: vitest 테스트가 md를 같은 파서로 읽어 커밋된 JSON과 대조, 어긋나면 "scripts/build-release-notes.mjs 실행" 안내와 함께 실패(version-drift 관례 동형). 파서는 스크립트에서 export해 테스트가 재사용한다(파서 2벌 금지).
- 릴리스 절차(CLAUDE.md §CLI/MCP 릴리스의 iOS 판)에 한 줄 추가: 노트 작성 후 스크립트 실행. 잊으면 가드 테스트가 잡는다.

### 2.2 UI

- `SettingsView` List 말미에 무헤더 Section + `NavigationLink` "업데이트 이력" → `ReleaseNotesView`(시트 안 NavigationStack push).
- `ReleaseNotesView`: 번들 JSON 디코드, 버전별 Section. 헤더는 "버전 {v}"(`.isHeader` — 로터 헤딩 점프가 버전 간 이동 수단). 본문은 노트 텍스트를 줄 단위로 갈라 **비어 있지 않은 줄마다 Text 행 하나**(한 줄 = 한 접근성 객체). "새로운 기능"/"개선" 소제목 줄도 본문 줄로 취급(heading 미부여 — 과잉). 하이픈 불릿은 원문 그대로(VoiceOver가 정상 낭독, 풀어쓰기 금지 관례).
- 디코드 실패·리소스 부재는 이 화면에서만 "이력을 불러올 수 없습니다" 1행(3-state 정직 — 빈 목록으로 위장하지 않는다). 부가 기능이라 설정 나머지는 무영향.

### 2.3 언어

- `AppLanguage.dataLocale == "ko"`면 ko 본문, 그 외(en·es·fr·it·ja)는 en 본문(정본이 2벌인 현실을 그대로 — 4개 언어 추가 번역을 만들지 않는다).
- 행 라벨·화면 제목·버전 접두("업데이트 이력"·"버전 {v}"·오류 문구)는 6개 언어 i18n(기존 messages→xcstrings 파이프라인).
- 실험판도 같은 JSON을 번들한다(공식 릴리스 이력이 곧 앱의 이력).

## 3. 테스트·검증

- **Kit 단위**: `RecentSearchStoreTests` 확장 — routes append·쌍 dedupe(current 포함)·cap·remove·clear·양측 current 기록 거부·디코드 실패 복구.
- **웹 단위**: recent-searches routes 함수 동형 케이스. `DirectionsView` jsdom 컴포넌트 테스트 — settled 시 기록, 실패 경로 미기록, 노출 조건, 활성화 시 두 필드+조회 호출+submit 포커스, 삭제 포커스.
- **릴리스 노트**: 파서 단위 테스트(정상 2블록·1.0형 무블록 제외·한쪽 누락 실패) + md↔JSON 드리프트 가드.
- **실기기 VoiceOver 게이트**(시뮬레이터 판정 불가 축): 활성화 직후 조회 버튼 포커스 유지, 마지막 항목 삭제 후 조회 버튼 착지, 릴리스 노트 헤딩 로터 버전 점프. `a11y-auditor` 점검 포함.
- 커밋 후 실기기 배포(`ios/deploy-device.sh`)까지가 한 사이클.
