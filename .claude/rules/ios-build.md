---
paths:
  - "ios/**"
  - "src/lib/__tests__/guidance-gate-drift.test.ts"
---

# iOS 빌드 구성 규칙

Claude Code는 위 `paths`에 맞는 파일을 읽을 때 이 파일을 자동으로 싣는다. 설계 단계(파일을 열기 전)이거나 다른 에이전트라면 이 영역 작업 전에 직접 읽는다. 항목 끝의 `→ INTEGRATIONS`·`→ PATTERNS`는 `docs/INTEGRATIONS.md`·`docs/PATTERNS.md`의 같은 제목 절이다. 어디서나 통하는 원칙은 루트 `CLAUDE.md`에 있다.

## iOS 실험 기능은 빌드 구성이 가른다

검증 전 기능을 릴리스에서 빼는 방법은 **플래그 값을 손으로 고치는 것이 아니라 빌드 구성을 고르는 것**이다. 구성은 셋: `Debug`(개발) · `Release`(App Store, 실험 제외) · `Experimental`(실기기 실험판, 실험 포함).

- **`Experimental`이 한꺼번에 정하는 것**: 컴파일 조건·번들 ID `space.dodoplanet.gildongmu.dev`·표시 이름 `…실험`·아이콘. 공식판과 한 기기에 공존하고, 위치 권한 문구는 정식 한 벌이다. → PATTERNS
- **실기기 배포**: 실험판 `CONFIGURATION=Experimental ./ios/deploy-device.sh`, 공식 번들 `CONFIGURATION=Release`(미지정 `Debug`는 기기 확인용이 아니다). → PATTERNS
- **코드 게이트**: 남은 실험 플래그(`AppConfig.experimental*Enabled`)는 `#if EXPERIMENTAL`로 갈리고, 검증되면 `#if`를 **삭제**한다(항상 참 상수 금지). 졸업한 플래그는 되살리지 말 것(가드가 식별자 0건을 센다). → PATTERNS
- ⚠ **봉인의 판정 축은 플래그 참조 목록이 아니라 세션을 시작시키는 호출 전수다**(`guidance-gate-drift.test.ts`). → PATTERNS
- ⚠ **한 버튼이 두 역할을 겸하면 봉인이 그 버튼을 통째로 지우거나 통째로 남기지 못한다** — 섹션 표시 조건은 역할별로 쓴다. 2.0에서 간략 단독 시작 얼굴을 지워 그 버튼은 추적 중 "안내 종료" 하나다(E16 축2 — 간략 단독 진입점 재도입 금지). → PATTERNS
- ⚠ **`INFOPLIST_KEY_*` 빌드 설정만으로는 구성별 분기가 안 된다**: 로컬라이즈 문자열은 `ios/scripts/experimental-infoplist.sh`, 비로컬라이즈 키는 `Support/Info-Experimental.plist`. → PATTERNS
- ⚠ **두 plist 계약의 의도된 예외: Bluetooth 권한 문구와 CoreBluetooth 심볼** — `NSBluetoothAlwaysUsageDescription`은 실험판 plist에만, CoreBluetooth는 앱 타깃 `#if DEBUG || EXPERIMENTAL` 안(Kit에 `import CoreBluetooth` 금지, `check-release-artifact.mjs`가 잡는다). BLE 실측은 Experimental로. → PATTERNS
- ⚠ **졸업 때 옮겨야 하는 것은 코드 게이트만이 아니다** — 백그라운드 모드도 정식 plist로 함께 승격. → PATTERNS
- ⚠ **새 게이트는 그것을 실제로 부르는 경로로 한 번 밟아 본다**(손으로 인자를 준 수동 실행 통과는 증거가 아니다). → PATTERNS
- ⚠ **아이콘 표식만으로는 부족하다** — 스크린 리더 사용자에겐 **표시 이름이 유일한 구분 수단**이라 이름 접미사를 반드시 유지한다.
- ⚠ **번들 ID가 다르면 UserDefaults도 새로 시작한다**(`AppLanguage.current`가 실험판 미선택 폴백만 ko로 고정). → PATTERNS
- ⚠ **pbxproj 객체 ID는 파일 전체에서 유일해야 한다** — `plutil -lint`는 못 잡으니 편집 후 검증은 `xcodebuild -list`로. → PATTERNS
