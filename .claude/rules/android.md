---
paths:
  - "android/**"
  - "ios/GildongmuKit/Sources/**"
  - "src/lib/__tests__/mirror-registry.test.ts"
---

# 안드로이드 앱 규칙

Claude Code는 위 `paths`에 맞는 파일을 읽을 때 이 파일을 자동으로 싣는다. 설계 단계(파일을 열기 전)이거나 다른 에이전트라면 이 영역 작업 전에 직접 읽는다. 항목 끝의 `→ INTEGRATIONS`·`→ PATTERNS`는 `docs/INTEGRATIONS.md`·`docs/PATTERNS.md`의 같은 제목 절이다. 어디서나 통하는 원칙은 루트 `CLAUDE.md`에 있다.

## 안드로이드 앱 (`android/`, 정본 `android/README.md`)

- **Kit(`ios/GildongmuKit/Sources`)에 파일을 추가·개명·삭제하면 `android/kit/mirrors/<그룹>.json`을 함께 고친다**(새 파일은 `pending`, 가드 `mirror-registry.test.ts`). → PATTERNS
- **구조·이식 관용구·게이트는 `android/README.md`가 정본이다**(`:app` Compose + `:kit` 순수 JVM 미러, 화면 패키지 소유권, fixture 로더, 등록부, 게이트 락). 설계 판정은 `docs/superpowers/specs/2026-09-15-android-app-decisions.md`(D1~D13, 재논의 금지), 마일스톤별 spec은 같은 폴더 `2026-09-16-android-*`.
- ⚠ **`:kit`에서 정규식 약칭 클래스(`\d`·`\s`·`\w`)와 Kotlin 기본 `trim`·`isBlank`·`isWhitespace`를 쓰지 않는다**(명시 클래스 + `SwiftSemantics`만). → PATTERNS
- **안내 시트 안의 다단 화면은 같은 시트의 페이지 전환이고, 스택 화면은 시트를 접고 push한 뒤 그 엔트리 id가 빠지면 재개한다**(`GuidePlaceNav.kt`). 화면 안에서 `LocalModalOpen`을 공급할 땐 바깥 값과 OR한다. ⚠ 스택 화면 push는 시트 컴포지션을 없애 `remember`가 초기화된다(iOS 중첩 시트와 다르다): 돌아와 앉을 줄을 세우는 상태(경유역 펼침 등)는 세션 쪽 메모에 둔다. ⚠ 재개 판정은 목적지 변경 통지 안에서 `currentBackStack`을 읽지 않는다(navigation 2.10은 통지 뒤에 목록을 갱신한다). → PATTERNS
- ⚠ **Compose 1.12의 접근성 초점 이벤트엔 노드 이름이 없다**: 커서 노드는 `findFocus` + 리소스 id로 가린다(`A11yFocusObserver.kt`, 낭독 문장 판정 금지). → PATTERNS
- **안드로이드 안내 음성은 TTS 한 채널이고 잠금과 다른 앱은 같은 백그라운드다**(E53 술어: `voiceOver` = 전경 직접 TTS, `device` = 대기 칸). → PATTERNS
- ⚠ **버튼 착지는 `a11y/Landing.kt`의 `landingTarget`만**(`requestFocus()`는 TalkBack 터치 모드에서 조용히 false). → PATTERNS
- ⚠ **`:kit` 테스트는 모듈 밖 파일을 읽어 Gradle이 변경을 모른다**: `:app`은 모듈 밖 파일만 바꾼 뒤 `--rerun-tasks`. → PATTERNS
- ⚠ **도보 안내 전경 서비스(`location`)·`WAKE_LOCK`·`ACTIVITY_RECOGNITION`은 정식 매니페스트(`src/main`)에 있다**(다른 소스셋으로 옮기지 말 것, `AppSourceGuardTest`·`check-release-manifest.mjs`). → PATTERNS
- ⚠ **사용자 정의 `Layout`이 자식에게 0보다 큰 최소 높이를 주면 `mergedRow`의 48dp 하한이 꺼진다**(`defaultMinSize`는 최소 제약 0일 때만 채운다): 몫을 최소 높이로 넘기는 배치는 `maxOf(몫, 48dp)`. → PATTERNS
- ⚠ **버튼 수식어의 여백은 `tapTarget()` 앞에 둔다**: 뒤에 건 `padding`은 48dp 안에서 빠져 누르는 객체가 40dp가 된다(체인 안 `clickable` 뒤 여백은 예외)(가드 `AppSourceGuardTest`). → PATTERNS
- **안내 시작은 수단마다 공개 함수 하나가 거부 판정 `refuseIfActive()` 뒤 본문 `beginBeacon`을 부르고, 자동차는 같은 모델의 `sessionKind = car` 세션이다**(M5): 새 시작 함수는 `GuideSourceGuardTest` ①-2 표를 넓히고, 자동차 세션은 걸음 센서 값(`steps.liveSample`)을 읽지 않는다. → PATTERNS
- ⚠ **Compose는 사용자 지정 액션을 라벨로 골라 실행한다**: 한 줄에 같은 라벨이 둘이면 둘째는 닿지 않는다(`distinctBy { it.label }`). → PATTERNS
- ⚠ **`clearAndSetSemantics`는 같은 노드에서 자기 뒤에 붙은 시맨틱(작업 메뉴·헤딩)도 지운다**: 지울 거면 남길 시맨틱을 같은 블록이나 그 앞에 둔다(`mergedRow` 뒤 `.semantics {}`가 조용히 사라진다, A77). → PATTERNS
- ⚠ **화면 밖 행으로 옮기는 착지는 `bringIntoView()`를 기다린 뒤 포커스를 준다**: 화면 밖 행의 포커스 이동은 한소네 커서가 따르지 않는다(요청은 `true`). → PATTERNS
- ⚠ **자기 키를 바꾸는 `LaunchedEffect`는 일을 하기 전에 취소된다**: 1회 신호는 일을 마친 뒤 끈다. → PATTERNS
- **탭 전체 리셋은 시작 탭의 저장 스택부터 복원해 지운다**(`resetAllTabs`, `clearBackStack(시작 탭)` 금지). → PATTERNS
- ⚠ **전역 1회 신호(바로가기 액션)는 받은 액티비티만 꺼낸다**: 지워지는 옛 `AppRoot`가 먼저 가져간다(`AppSession.take(owner)`). → PATTERNS
- ⚠ **바로가기·안내 알림은 태스크의 기준 인텐트를 바꾼다**: `MainActivity`는 `singleTop`이고(아니면 런처 아이콘 복귀가 화면을 쌓는다), 최근 앱 재실행은 그 인텐트에 `FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY`를 붙여 오므로 액션으로 받지 않는다. → PATTERNS
- ⚠ **동적 바로가기에는 시스템이 `NEW_TASK|CLEAR_TASK`를 붙이지 않고, 매니페스트에서 뺀 정적 바로가기 id는 다시 쓸 수 없다**(고정된 사본이 등록을 막는다): 플래그는 직접 붙이고 id는 가른다. → PATTERNS
- ⚠ **이미 입력 포커스를 쥔 노드에 다시 `requestFocus()`해도 커서는 따라오지 않는다**: 비우고 접근성 이벤트 묶음 간격을 기다린 뒤 준다(`MovedRowLanding`). → PATTERNS
- ⚠ **안내 문자열 표는 없는 키에 실행 중 던진다**: 안내 시트가 다른 패키지 컴포저블(`DisclosureRow`)에 `guideStrings`를 넘기면 그 함수의 키를 표와 가드 ⑧ 공용 줄 목록에 더한다. → PATTERNS
- ⚠ **누른 버튼이 사라지거나 대화상자가 닫힌 뒤의 착지는 비우고 간격을 둔 뒤 준다**: 누르는 순간 준 포커스는 한소네 커서를 옮기지 못하고(계측은 초록), 대화상자는 창이 돌아오고 1초 뒤에 앉힌다. → PATTERNS
- ⚠ **`MutableStateFlow`는 `equals`가 같은 값을 버린다**: 동일성으로 가르는 표식은 data class 아닌 감싸개로 싣는다. → PATTERNS
- ⚠ **누른 버튼이 사라지는 전이에서는 TalkBack이 커서를 옮기고 그 이동이 접근성 초점 이벤트 두 번으로 오기도 한다**: 착지 대기는 그 묶음을 사용자 이동으로 세지 않는다(`TransitSheetLanding` `expectsSystemPlacement`). → PATTERNS
