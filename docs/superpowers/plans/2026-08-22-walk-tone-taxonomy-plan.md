# N2 도보 안내 톤 5종 — 구현 플랜

> spec: `docs/superpowers/specs/2026-08-22-walk-tone-taxonomy-design.md`. 브랜치 `feat/n2-tones`(worktree `~/gildongmu-wt/n2-tones`).
>
> **구현 방식 판정**: inline. 태스크가 한 축(행동 → 톤 → 재생)을 순서대로 타고 같은 fixture를 공유하므로 선행 결정(톤 이름·파일 이름)이 후속 전부의 인터페이스다. 리뷰는 별도 컨텍스트(spec-compliance + code-quality 서브에이전트).

| # | 태스크 | 파일 | 검증 |
|---|---|---|---|
| 1 | 소리 생성 스크립트 + 7개 mp3(웹·iOS 양쪽) | `scripts/build-guide-tones.py`, `public/sounds/guide/*.mp3`, `ios/Gildongmu/Resources/Sounds/guide-*.mp3` | `sounds-drift.test.ts` 16종 |
| 2 | `WalkAction.back` + 마커 + `imminentTone` (웹↔Kit) | `src/lib/walk-action.ts`, `WalkAction.swift`, `walk-action-cases.json`, 테스트 | walk-action 테스트 両플랫폼 |
| 3 | route-guide `GuideTone` 확장·6a 방출 교체·fixture 갱신 | `route-guide.ts`, `RouteGuide.swift`, `route-guide-scenarios.json`, 러너 `toneName` | route-guide fixture 両플랫폼 + 변이(상수 ahead로 되돌리면 실패) |
| 4 | 톤 계층 `isActionTone` | `guide-tone-layer.ts`, `GuideToneLayer.swift` | tone-layer fixture |
| 5 | 재생기: 파일·게인·햅틱·scheme | `useBeaconSound.ts`, `BeaconTonePlayer.swift`, `BeaconTones.swift`(resourceName(scheme)), `BeaconModel` 변환 | 빌드 + drift 테스트 |
| 6 | i18n `guide.imminent.back`·`guide.liveAction.back` 6로케일 + `GuideText` switch | `messages/*.json`, `GuideText.swift`, xcstrings 재생성 | `i18n-messages.test.ts`, `check-xcstrings-keys` |
| 7 | 실험 피커(설정) | `SettingsView.swift`, `ios.settings.*` 키 | 빌드 |
| 8 | 문서 분배·리뷰·통합 | CHANGELOG·BACKLOG N2·CLAUDE.md 함정 1줄·spec 머리 | §3 절차 |
