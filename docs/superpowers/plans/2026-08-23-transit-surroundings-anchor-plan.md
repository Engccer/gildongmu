# E15-2 대중교통 "주변 확인" 구현 플랜

spec: `docs/superpowers/specs/2026-08-23-transit-surroundings-anchor-design.md`. 구현 방식 **inline**(선행 판정 함수가 시트 배선의 인터페이스를 정하고, 파일 4개·순차 의존).

1. **Kit 판정 함수 + 테스트(TDD)** — `TransitSurroundingsAnchor.swift`, `TransitSurroundingsAnchorTests.swift` 6케이스. `swift test --filter TransitSurroundingsAnchor`.
2. **i18n** — `messages/{ko,en,es,fr,it,ja}.json` `transitGuide.surroundingsAnchorAlight/Current`. `npm run test:run -- i18n-messages`.
3. **시트 배선** — `TransitTrackingSheet.swift` 본 Section 뒤 새 Section(헤더 + `SurroundingsSceneSection`). xcstrings 재생성 뒤 실험판 시뮬 빌드·AX 스냅샷.
4. **리뷰**(spec-compliance + code-quality 서브에이전트, HEAD SHA) → rebase → 생성물 재생성 → 게이트 3종 → ff push.
5. **문서 분배** — CHANGELOG / BACKLOG E15 행 + FIELD-TEST §5-4 행 / PROGRESS 한 줄. CLAUDE.md 함정은 없으면 쓰지 않는다.
