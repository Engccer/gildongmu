# 대중교통 실시간 안내 "주변 확인" 능력 (E15-2) 설계

> 백로그 `docs/BACKLOG.md` §5 E15 다음 능력 ①. 병렬 브리프 `docs/superpowers/plans/2026-08-23-backlog-sweep-parallel-plan.md` §1 E15-2 행. 설계 리뷰(codex adversarial) **생략** — 검증된 컴포넌트(`SurroundingsSceneSection`)의 재배선이고 파급이 국소·가역이며 새 불변식·외부 계약·비가역 변경이 없다(글로벌 CLAUDE.md §마일스톤·설계 리뷰 게이트 4조건 전부 불성립).

## 1. 목표

도보 안내 시트에 있는 "주변 확인"(M1 부근 상황 재구성, `SurroundingsSceneSection`)을 대중교통 안내 시트 `TransitTrackingSheet`에도 둔다. 도보는 앵커가 목적지 좌표였고, 대중교통은 **역 좌표**다 — 내릴 곳이 어떤 모습인지 미리 듣거나, 승차 중이면 지금 지나는 역 주변을 듣는다.

## 2. 앵커 판정 (Kit 순수 함수)

`transitSurroundingsAnchor(state:leg:) -> TransitSurroundingsAnchor?` (`ios/GildongmuKit/Sources/GildongmuKit/TransitSurroundingsAnchor.swift`).

| 조건 | 결과 |
|---|---|
| `transitOverviewHere(state:leg:)`가 `.station(idx)` (= riding ∧ 지하철 ∧ `signal == tracking` ∧ 정규화 역명 유일 매칭) | `.currentStation(leg.viaStops[idx])` |
| 그 밖의 모든 경우, `leg.alightStop != nil` | `.alightStop(leg.alightStop!)` |
| `leg.alightStop == nil` (정차역 목록 미보유) | `nil` → 섹션 자체를 내지 않는다 |

- "현재역"은 E15-1 조망의 `here` 판정을 **그대로 재사용**한다 — 같은 화면에서 조망은 "현재 위치 모름"이라 하는데 주변 확인은 "현재역 주변"이라 말하는 모순을 구조적으로 막는다. 판정 로직을 복제하지 않는다.
- 대기·승차 전·버스·도착 후·신호 소실 중은 전부 하차역이다. 이는 3-state 뭉갬이 아니다 — 앵커는 "어디 주변을 묻는가"이고, 위치 불명일 때 하차역은 사용자가 가장 알고 싶은 정직한 기본값이다.
- 웹 미러는 두지 않는다: 웹 `TransitGuidePanel`에는 주변 확인 UI가 없다(E15 다음 능력 ③ 웹 조망 UI 뒤의 일). 순수 함수가 Kit에만 있는 첫 사례이므로 그 사실을 파일 주석에 남긴다.

## 3. 프로토콜 판정

`GuideOverviewCapability`는 넓히지 않는다(E15-1 설계 리뷰 판정 — 조망 전용 봉인). 이 능력에는 **프로토콜이 필요 없다**: 셸(`SurroundingsSceneSection`)이 앵커 좌표 하나만 받고, 수단별로 다른 것은 앵커 판정뿐이라 시트가 Kit 함수를 호출해 좌표를 넘기는 배선으로 끝난다. 도보 시트도 같은 방식(목적지 좌표 직접 주입)이라 둘이 이미 동형이다. 다음 능력(추세 톤)이 셸·배선을 요구하면 그때 자기 프로토콜을 둔다.

## 4. 시트 배선 (`TransitTrackingSheet`)

- 위치: 본 Section(진행 상황 버튼·상태·경유역·국면 컨트롤) **뒤, 목적지 변경 섹션 앞**에 별도 `Section`. 도보 시트는 진행 상황 버튼 바로 뒤에 두지만, 대중교통 본 Section은 국면 컨트롤(대기 후보 목록·탑승 변경)이 자주 쓰이는 행이라 그 앞에 끼우면 SR 읽기 순서 비용이 커진다([[sr-reading-order-position-is-cost]]).
- 헤더: `transitGuide.surroundingsAnchorAlight` "내릴 곳 {name} 주변" / `transitGuide.surroundingsAnchorCurrent` "현재역 {name} 주변" (heading trait, 섹션 헤더). 도보와 달리 앵커가 둘 중 하나로 바뀌므로 **어느 역 주변인지가 곧 정보**다 — 버튼 라벨 "주변 확인"만으로는 SR 사용자가 기준을 알 수 없다. 중복 안내가 아니라 유일한 기준 표시.
- 내용: `SurroundingsSceneSection(anchor:proxy:)` — **시그니처 불변**. 앵커가 바뀌면 섹션의 기존 `onChange(of: anchorKey)`가 장면을 버린다(역이 바뀌면 지난 역 장면은 틀린 정보).
- 세션 종료 화면(핸드오프 제안)에는 두지 않는다 — 핸드오프 뒤 도보 세션이 자기 주변 확인을 가진다.

## 5. i18n

`messages/*.json` 6로케일 `transitGuide.surroundingsAnchorAlight`·`surroundingsAnchorCurrent`. 통합 뒤 `node ios/scripts/messages-to-xcstrings.mjs` + `check-xcstrings-keys.mjs`.

## 6. 테스트

- Kit `TransitSurroundingsAnchorTests`: ①riding·subway·tracking·유일 매칭 → currentStation(좌표가 viaStops 해당 인덱스) ②riding·tracking·동명 2건 → alightStop ③waiting → alightStop ④버스 riding → alightStop ⑤signalLost → alightStop ⑥alightStop nil → nil.
- 시뮬(실험판 `CONFIGURATION=Experimental`): 대중교통 안내 시트 AX 스냅샷에서 헤더 "내릴 곳 … 주변" → "주변 확인" 버튼 순서.
- 실기기(실승차, `docs/FIELD-TEST.md` §5-4 행 추가): 승차 중 현재역으로 앵커가 바뀔 때 펼쳐 둔 장면이 사라지는 체감(다음 역 진입마다 재설정) — 불편하면 "현재역은 사용자가 누를 때 고정" 변형을 판정.

## 7. 범위 밖

추세 톤(E15 ②)·웹 조망 UI(③)·`SurroundingsSceneSection` 내부 변경·자동차 시트(이미 도보와 같은 모델·시트).
