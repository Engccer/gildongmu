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
- **안내 시트 안의 다단 화면은 같은 시트의 페이지 전환이고, 스택 화면은 시트를 접고 push한 뒤 그 엔트리 id가 빠지면 재개한다**(`GuidePlaceNav.kt`). 화면 안에서 `LocalModalOpen`을 공급할 땐 바깥 값과 OR한다. → PATTERNS
- ⚠ **Compose 1.12의 접근성 초점 이벤트엔 노드 이름이 없다**: 커서 노드는 `findFocus` + 리소스 id로 가린다(`A11yFocusObserver.kt`, 낭독 문장 판정 금지). → PATTERNS
- **안드로이드 안내 음성은 TTS 한 채널이고 잠금과 다른 앱은 같은 백그라운드다**(E53 술어: `voiceOver` = 전경 직접 TTS, `device` = 대기 칸). → PATTERNS
- ⚠ **버튼 착지는 `a11y/Landing.kt`의 `landingTarget`만**(`requestFocus()`는 TalkBack 터치 모드에서 조용히 false). → PATTERNS
- ⚠ **`:kit` 테스트는 모듈 밖 파일을 읽어 Gradle이 변경을 모른다**: `:app`은 모듈 밖 파일만 바꾼 뒤 `--rerun-tasks`. → PATTERNS
- ⚠ **도보 안내 전경 서비스(`location`)·`WAKE_LOCK`·`ACTIVITY_RECOGNITION`은 정식 매니페스트(`src/main`)에 있다**(다른 소스셋으로 옮기지 말 것, `AppSourceGuardTest`·`check-release-manifest.mjs`). → PATTERNS
