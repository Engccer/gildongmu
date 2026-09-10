# 체중 입력 권유의 무시 상한 설계 (iOS, E31)

> **설계 리뷰 생략: 판정 확정·국소·가역.** 위원장 판정이 동작을 이미 정했고(2026-09-08 상한, 2026-09-10 문장 흡수), 변경은 도착 화면 한 절과 Kit 순수 판정 하나에 닫힌다. 새 불변식·새 외부 계약·비가역 마이그레이션이 없고, UserDefaults 카운터 하나를 지우면 종전 동작으로 되돌아간다.

> 2026-09-11. 도보 종료 화면(`BeaconTrackingSheet.arrivalSection`)이 체중 미입력자에게 매번 내던 입력 권유 두 줄에 상한을 둔다. 두 번 무시하면 권유가 사라지고, 칼로리 수치의 근거인 기준 체중은 칼로리 문장 안으로 들어간다. iOS 전용이다(웹에는 이 화면이 없다).

## 0. 확정 사항 (백로그 `docs/BACKLOG.md` §5 E31 원문이 정본)

- **요청**(위원장 2026-09-08 17:45 KST): "그 화면이 두 번 출력되었지만 아무 행동도 하지 않고 닫기를 누르는 경우 의도적 무시로 간주하고 그 다음부터는 체중 입력 UI를 띄우지 말아 줘."
- **판정 ①(2026-09-08)**: 무시 2회면 이후 숨긴다.
- **판정 ②(2026-09-10)**: 숨긴 뒤 권유 문장·버튼·"서버에 저장되지 않아요" 고지가 모두 사라지고, 기준 체중은 **줄을 늘리지 않고** 칼로리 문장 안으로 들어간다. 문안:
  > 이번 구간에서 1,240걸음 걸으셨어요. **65kg 기준으로** 약 39kcal를 태우셨어요. 귤 한 개 분량이에요!

  체중을 입력한 사용자는 종전 문장 그대로다(두 벌 키).
- **"무시"의 정의(코디네이터 확정 2026-09-11)**: 권유가 표시된 종료 화면에서 [체중 입력하기]를 누르지 않고 **[닫기]를 누른 것**. 시트 최소화·스와이프·VO escape·30분 만료 소거(A31 축 ②)·앱 종료는 세지 않는다. 근거는 위원장 인용의 "아무 행동도 하지 않고 **닫기를 누르는** 경우"이고, 표시만 되고 사용자가 보지 못한 경로를 세면 두 번이 하루에 차 버린다.

## 1. 결정 요약

| 축 | 결정 | 근거 |
|---|---|---|
| 세는 사건 | [닫기] 누름 **한 종류** | 위원장 인용 그대로. 소거 경로가 여럿이지만(N1: 스와이프·escape는 최소화, 30분 만료) 사용자의 의사가 드러나는 것은 명시적 [닫기]뿐이다. |
| [체중 입력하기]를 누른 뒤의 [닫기] | 세지 않는다 | "아무 행동도 하지 않고"의 문언. 설정에서 입력하지 않고 돌아왔더라도 권유에 응답한 화면이다. |
| 상한 | 2 | 판정 ①. |
| 저장소 | `UserDefaults` `walkWeightPromptDismissals`(`WalkHealth.weightStorageKey` 옆) | 체중 키와 같은 층. 값 하나라 스키마가 필요 없다. |
| 판정 위치 | Kit 순수 함수 2개(`shouldShowWeightPrompt`·`nextWeightPromptDismissals`) + `WalkHealthTests` | 화면은 술어를 호출만 한다. 표시 판정과 증가 판정이 같은 모듈에 있어야 "표시된 화면에서만 센다"가 한 파일에서 읽힌다. |
| 숨긴 뒤 문장 | 새 키 `ios.beacon.healthSummaryWithWeight`(steps·kg·kcal) | 판정 ②. 기존 `healthSummary`를 고치지 않고 두 벌로 둔다 — 체중을 입력한 사용자의 문장이 바뀌면 안 된다. |
| 되살림 UI | 없다 | 판정 ②·백로그. 체중을 입력하면 `usedDefaultWeight`가 false가 되어 조건 자체가 사라지고, 설정의 입력 항목은 그대로 있다. |
| 카운터 리셋 | 하지 않는다 | 체중을 지워 다시 미입력이 되어도 카운터는 남는다. 이미 두 번 거절한 사용자에게 되묻지 않는 것이 판정의 취지다. 설정 화면은 이 작업의 소유 밖이기도 하다. |
| 웹 미러 | 없다 | 도착 건강 요약은 iOS 전용이다. |

## 2. 화면 (`BeaconTrackingSheet.arrivalSection`)

권유가 살아 있을 때(무시 0~1회, 체중 미입력) — **현행과 동일**:

1. 헤딩 "도착, {목적지}"
2. 도착 문장
3. `이번 구간에서 1,240걸음 걸으셨어요. 약 39kcal를 태우셨어요. 귤 한 개 분량이에요!`
4. `위 칼로리 수치는 성인 평균인 65kg 기준이에요. 설정에서 체중을 입력하면 더 정확한 정보를 받으실 수 있어요. 입력한 정보는 서버에 저장되지 않아요.`
5. [체중 입력하기]
6. 주변 확인 / [닫기]

권유가 숨겨진 뒤(무시 2회, 체중 미입력) — **3번 문장만 바뀌고 4·5번이 없다**:

3. `이번 구간에서 1,240걸음 걸으셨어요. 65kg 기준으로 약 39kcal를 태우셨어요. 귤 한 개 분량이에요!`

체중을 입력한 사용자는 무시 횟수와 무관하게 현행 그대로다(3번은 `healthSummary`, 4·5번 없음).

### 접근성

- 읽기 순서에서 4·5번 두 객체가 빠지는 것 외의 변화가 없다. 3번은 여전히 **한 `Text` = 한 접근성 객체**이고(걸음·칼로리·비유가 한 문단), 기준 체중은 그 문장 안의 단어로 들어가므로 객체 수가 늘지 않는다.
- "숨겨졌다"는 사실을 알리는 문장·통지를 두지 않는다(부재를 설명하지 않는다 — 아티팩트 메타 정보 규칙과 3-state의 "정보 없음"이 아니라 그냥 없는 줄이다).
- 체중 입력 뒤 요약 문장으로 선점 이동하는 기존 계약(`landHealthSummaryFocus`)은 그대로다.

## 3. Kit 판정 (`WalkHealth`)

```swift
public static let weightPromptDismissalsKey = "walkWeightPromptDismissals"
public static let maxWeightPromptDismissals = 2

/// 종료 화면이 체중 입력 권유를 낼 것인가.
public static func shouldShowWeightPrompt(usedDefaultWeight: Bool, dismissals: Int) -> Bool

/// [닫기]를 눌렀을 때의 다음 무시 횟수.
public static func nextWeightPromptDismissals(current: Int, promptShown: Bool, engagedPrompt: Bool) -> Int
```

- `shouldShowWeightPrompt` = `usedDefaultWeight && dismissals < max`. 체중을 입력했으면 횟수를 보지 않는다(순서가 중요하다 — 입력자에게는 이 축이 존재하지 않는다).
- `nextWeightPromptDismissals`는 `promptShown && !engagedPrompt`일 때만 `current + 1`, 아니면 `current` 그대로. 상한 clamp를 두지 않는 이유: `promptShown`이 참이면 정의상 `current < max`라 결과가 `max`를 넘지 못하고, 넘지 못하는 clamp는 아무것도 바꾸지 않는 방어 코드다([[defensive-code-needs-measured-effect]]).
- **증가 판정을 순수 함수로 뺀 이유**: 화면에 `if 표시중 && !눌렀음 { count += 1 }`을 인라인으로 두면 그 조건을 지키는 테스트가 없다(SwiftUI 뷰는 Kit 테스트 밖). 술어를 Kit으로 올리면 "표시되지 않은 화면에서도 센다"·"버튼을 눌러도 센다" 두 변이가 `WalkHealthTests`에 걸린다. 남는 무검증 면은 **호출 지점이 [닫기] 핸들러 하나뿐인가**이고, 그것은 리뷰와 소스 대조로 지킨다(§6).

## 4. 화면 배선

- `@AppStorage(WalkHealth.weightPromptDismissalsKey) private var weightPromptDismissals = 0`
- `@State private var weightPromptEngaged = false` — 이번 종료 화면에서 [체중 입력하기]를 눌렀는가. 도착 전이(`onChange(of: model.arrivalDest)`)에서 false로 되돌린다.
- 계산 프로퍼티 `showsWeightPrompt`가 **렌더와 [닫기] 양쪽이 읽는 단일 술어**다. 두 자리가 각자 조건을 조립하면 "표시되지 않았는데 셌다"가 조용히 생긴다.
- [닫기] 핸들러: `weightPromptDismissals = WalkHealth.nextWeightPromptDismissals(...)` 뒤에 기존 `model.clearArrival()`.
- 설정 시트에서 체중을 입력하고 돌아오면 `recomputeArrivalHealth()`가 `usedDefaultWeight`를 false로 만들어 `showsWeightPrompt`가 저절로 false가 된다 — 그 뒤의 [닫기]는 세지 않는다(입력한 사용자를 무시로 계상하지 않는다).

## 5. 문자열 (`ios/i18n/ios-extra/*.json`, 6로케일 동시)

신규 키 `ios.beacon.healthSummaryWithWeight`. 인자 순서는 ko 문장이 ABI를 정한다: `steps`, `kg`, `kcal`(`ios/i18n/arg-order.json`에 신규 등록). 복수 블록은 기존 `healthSummary`와 같은 자리·같은 형태를 쓴다(en·es·it은 `{steps, plural, …}`, ko·ja·fr은 무변화형). 걸음 수는 화면이 천 단위 구분 문자열로 넘기므로 복수 분기는 `other`로 해석된다(`pluralCount`의 명시 계약).

기존 `ios.beacon.healthSummary`·`healthWeightNotice`·`healthEnterWeight`는 **손대지 않는다**. 백로그가 후보로 적었던 "고지 문자열 쪼개기"는 하지 않는다 — 판정 ②가 숨긴 뒤의 문장을 별도 키로 정했으므로, 남는 화면(권유가 살아 있는 화면)의 문자열을 쪼갤 이유가 사라졌다.

## 6. 검증

- `WalkHealthTests`: 표시 판정 4형(미입력·0회 / 미입력·1회 / 미입력·2회 / 입력자·2회), 증가 판정 3형(표시+미응답 → +1 / 표시+응답 → 불변 / 미표시 → 불변), 상한 도달 뒤 재증가 없음.
- **변이 주입 1회**(커밋 뒤, [[mutation-injection-commit-first]]): `nextWeightPromptDismissals`에서 `promptShown` 가드를 제거해 "닫기면 무조건 센다"로 바꾸고 `swift test`가 빨개지는지 확인한 뒤 `git checkout`으로 되돌린다.
- 게이트: `npm run test:run` · `npx tsc --noEmit` · `npm run lint` · `swift test` · `xcodebuild -configuration Experimental build` · `messages-to-xcstrings` + `check-xcstrings-keys`.
- **실기기 판정은 남는다**(`docs/BACKLOG.md` §2): 두 번 닫은 뒤 세 번째 종료 화면에서 권유가 사라지고 칼로리 문장이 기준 체중을 담는가, VoiceOver 읽기 순서에서 그 문장이 한 객체로 들리는가.
