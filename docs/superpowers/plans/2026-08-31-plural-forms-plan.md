# 수량 문구 복수형(A29) 구현 플랜

spec: `docs/superpowers/specs/2026-08-31-plural-forms-design.md`. 세션 plurals, worktree `~/gildongmu-wt/plurals`(`feat/plurals`), 통합은 ff push만.

**구현 방식 판정: inline.** 태스크가 순차 의존이다(변환 규칙 → 카탈로그 재생성 → Swift 해석기 → 호출부 → 게이트) — 앞 단계의 출력 형식(`{N, plural, …}`)이 뒤 단계의 파서 입력이라 인터페이스가 확정되기 전엔 위임할 수 없고, 수정 파일도 한 도메인(i18n 파이프라인)에 몰려 있다. 리뷰는 별도 컨텍스트(diff만) + a11y-auditor.

## 태스크

1. **설계 리뷰** — codex adversarial-review(raw `codex exec`, spec 주입, worktree라 companion 금지). 결과를 spec §10에 기록, 수정 사항 반영.
2. **웹 문자열** — `messages/{en,es,fr,it}.json`의 §2.1 ○ 칸을 ICU plural로(python 스크립트로 키→로케일→문자열 표를 적용, ko·ja 바이트 불변 확인 `git diff --stat`). `i18n-messages.test.ts` `tokens()` ICU 인자 파서로 교체. `i18n-plurals.test.ts` + fixture `plural-category-cases.json` 신설. `npm run test:run -- i18n` green.
3. **변환 스크립트** — `messages-to-xcstrings.mjs`: plural 블록 파서·인덱스화·`#` 치환, export + CLI 가드. `xcstrings-plural.test.ts`. `ios-extra/*.json` §2.2 반영 + `ios.nearby.announce*` 5키 신설·`announceCount`/`unit*` 삭제. `node ios/scripts/messages-to-xcstrings.mjs all` 재생성 → diff에서 삭제 키가 정본 부재 키뿐인지 대조(수기 편집분 소실 검사, 메모리 함정 5).
4. **Swift 해석기** — Kit `Localization.swift`: `pluralCategory`·`resolvePluralBlocks`·`formatLocalized`(public), `kitLocalized` 경유. 앱 `AppLocalization.swift` 두 오버로드 경유. `LocalizationTests.swift`(fixture·단위·실카탈로그). `swift test` green.
5. **호출부** — §5.4 전수(Int 통일, `RouteBriefing` 2단계 제거, `nearbyLoadedMessage(count:kind:)` + 8곳). `node ios/scripts/check-xcstrings-keys.mjs` green.
6. **게이트** — `npm run test:run`·`npx tsc --noEmit`·`npm run lint`·Kit `swift test`·키 린터·시뮬 빌드+AX 스냅샷 1회.
7. **리뷰** — 별도 컨텍스트 spec-compliance/code-quality(diff만) + a11y-auditor(수량 낭독). 지적 처리 후 재게이트.
8. **분배** — CHANGELOG(A29), BACKLOG A29 종결, CLAUDE.md i18n 절(함정: 네이티브 variations 금지 사유·`{N, plural}` 카탈로그 형식·Int 인자), 메모리 `gildongmu-ios-i18n-architecture` 함정 8 추가.
9. **통합** — 코디네이터 통보 → rebase main → xcstrings 재생성 → 게이트 재실행 → `git push origin feat/plurals:main`(ff) → 통보 → worktree remove.
