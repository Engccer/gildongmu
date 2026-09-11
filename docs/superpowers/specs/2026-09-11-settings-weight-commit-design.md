# 설정 체중 입력: 범위 밖 값의 3-state 복원 (A39)

**판정**: 코디네이터 확정 2026-09-11(`docs/BACKLOG.md` §1 A39 "착수 시 정할 것" 세 갈래의 답). ⓐ판정 시점은 **필드 편집 종료**이고 타자 중간값(`5`→`50`→`500`)엔 판정하지 않는다 ⓑ범위 밖이면 **직전 유효값을 유지**하고(0으로 덮지 않는다) 통지 1회(`.high`, 허용 범위 포함) + 필드 값을 유효값으로 되돌린다 ⓒ`Section` 푸터에 허용 범위와 "입력한 정보는 서버에 저장되지 않아요"를 상시로 둔다(E31 §5 잔여 흡수).

**설계 리뷰 생략**: 판정 확정·국소(iOS 설정 화면 단독, 웹 미러 없음). 구현 리뷰는 공통 계약대로.

## 1. 증상 (접수 원문 요지)

`SettingsView.commitWeight()`가 `WalkHealth.normalizedWeight(raw) ?? 0`으로 **0을 저장**했다. 입력 필드에는 방금 친 `500`이 그대로 남고 화면·낭독 어디에도 신호가 없어 **스크린 리더 사용자는 저장된 줄 안다**. 실제로는 기본 체중 65kg이 쓰인다 — "저장됨"과 "무시됨"을 뭉갠 헌장 §1 3-state 위반이고, 값이 실제로 쓰이는 자리(도보 종료 화면 칼로리 문장)가 화면 밖이라 되짚을 길도 없다.

## 2. 설계

### 2.1 판정 시점 — 편집 종료

`onChange(of: weightText)`(타자 한 글자마다)에서 **`onChange(of:)` 포커스 이탈**로 옮긴다. `5`→`50`→`500`의 중간값이 전부 범위 밖이므로 글자마다 판정하면 정상 입력이 거절된다.

⚠ **`onSubmit`은 오지 않는다** — 이 필드는 `.keyboardType(.decimalPad)`이고 그 키패드엔 Return이 없다. 그래서 편집 종료의 경로는 둘이다:

1. **키보드 포커스 이탈**(`@FocusState` false) — 다른 컨트롤을 활성화했다.
2. **화면 닫힘** — [닫기] 버튼 핸들러(`dismiss()` **앞**에서 커밋해 통지가 시트가 살아 있는 동안 나간다) + 스와이프·VO escape의 폴백 `onDisappear`.

세 자리 모두 같은 `commitWeight()`를 부르고, 이 함수는 **멱등**이다(거절 뒤 필드가 유효 표기로 되돌아가므로 두 번째 호출은 정상 저장으로 끝나고 통지가 없다).

### 2.2 판정 자체 — Kit 순수 함수

```swift
public enum WeightCommitOutcome: Equatable { case store(Double), clear, reject }
public static func weightCommit(text: String) -> WeightCommitOutcome
```

- 빈 문자열·공백 → `.clear`(미입력으로 되돌리는 정당한 조작이다. 기본 체중 65kg이 쓰이고 도보 종료 화면이 그 사실을 밝힌다).
- 숫자이고 `weightRange`(20...300) 안 → `.store`. 쉼표 소수점(`62,5`)은 여기서 흡수한다(종전 뷰에 있던 치환을 판정과 함께 옮겼다).
- 그 밖(비수치·범위 밖·NaN) → `.reject`.

### 2.3 거절의 처리 — 유지·되돌림·통지

- **저장하지 않는다**: `weightKg`는 직전 값 그대로다(0으로 덮지 않는다 — 유효값이 있던 사용자가 오타 한 번으로 그것을 잃던 것이 이 항목의 절반이다).
- **필드를 되돌린다**: 직전 값이 있으면 그 표기로, 없으면 빈 문자열로. 화면과 저장값이 어긋난 채 남지 않는다.
- **통지 1회 `.high`**: 화면 변화가 없는 동작(값이 저장되지 않았다는 것)의 **유일한 증거**이고, 활성화 직접 응답은 기본 우선순위로 잠식된다(헌장 §5, `copyAddressToPasteboard` 선례).
- **포커스는 옮기지 않는다**: 커밋을 부른 것이 사용자의 포커스 이탈 자체라 그 자리가 사용자의 의도다. 되돌릴 필요가 있는 자리가 아니므로 재포커스는 하지 않는다(헌장 §5의 "유지"는 *우리가 뺏지 않는다*이지 *되돌려 놓는다*가 아니다).

문장은 둘로 가른다 — 직전 값이 있을 때와 없을 때는 사용자가 다음에 할 일이 다르다.

### 2.4 문구 (`ios/i18n/ios-extra`, 6로케일, ko 원문)

| 키 | ko | 자리 |
|---|---|---|
| `ios.settings.weightFooter` | 체중은 {min}~{max}kg 사이로 입력해 주세요. 입력한 정보는 서버에 저장되지 않아요. | 체중 `Section` 푸터(상시) |
| `ios.settings.weightRejected` | 체중은 {min}~{max}kg 사이여야 합니다. 이전 값 {kg}kg을 유지합니다. | 거절 통지(직전 값 있음) |
| `ios.settings.weightRejectedNone` | 체중은 {min}~{max}kg 사이여야 합니다. 저장하지 않았습니다. | 거절 통지(직전 값 없음) |

범위는 **인자**로 넘긴다 — `WalkHealth.weightRange`가 정본이고 문장에 숫자를 박으면 상수가 바뀔 때 문장만 낡는다([[spoken-strings-source-of-truth-is-i18n]]의 역방향 함정). 푸터의 뒷문장은 E31 §5 잔여를 흡수한다(권유 상한 도달 뒤 앱 어디에도 없던 문장이 여기 상시로 산다).

## 3. 불변식 점검

- **3-state**: "저장됨"(통지 없음, 필드에 그 값) / "미입력으로 되돌림"(빈 필드) / "거절됨"(통지 + 직전 값 복원)이 갈린다.
- **한 줄 = 한 접근성 객체**: 푸터는 단일 `Text`(두 문장이지만 한 객체다). 필드 라벨은 종전 그대로.
- **웹 미러 없음**: 체중은 iOS 도보 종료 화면 전용 값이다.
- **E31과의 경계**: 도보 종료 화면의 권유·무시 카운터는 손대지 않는다. 이 항목은 설정 화면 단독이다.

## 4. 테스트

- Kit `WalkHealthTests`: `weightCommit` 표 — `""`·`"  "` → clear / `"65"`·`"65.5"`·`"62,5"`·`"20"`·`"300"` → store / `"500"`·`"5"`·`"0"`·`"-10"`·`"abc"`·`"nan"` → reject.
- 소스 가드(`settings-weight-commit.test.ts`, Swift 소스를 읽는 웹 테스트 — 뷰 계층엔 테스트 레인이 없다): `onChange(of: weightText)` 커밋이 없다 / 편집 종료 세 자리가 `commitWeight()`를 부른다 / 거절이 `weightKg`를 쓰지 않는다 / 통지가 `.high`다 / 푸터가 범위 인자를 넘긴다.
- 변이 주입 1회: `.reject`에서 `weightKg = 0`을 쓰도록 되돌리면 소스 가드가 빨간불인지 실측.

## 5. 파일

Kit `WalkHealth.swift`(+`WalkHealthTests.swift`) / iOS `SettingsView.swift` / `ios/i18n/ios-extra/*.json` `ios.settings.*` / 소스 가드 `src/lib/__tests__/settings-weight-commit.test.ts` / 생성물 `Localizable.xcstrings`·`arg-order.json`.
