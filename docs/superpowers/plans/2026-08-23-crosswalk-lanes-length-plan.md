# E8 횡단보도 차로 수·도로 폭 주석 — 구현 계획

spec `docs/superpowers/specs/2026-08-23-crosswalk-lanes-length-design.md`. 구현 방식 판정: **inline** — 태스크가 seed → 판정 → 파이프라인 → 게이트 순으로 순차 의존하고(앞 단계 산출물이 다음 단계 입력), 수정 파일이 전부 E8 소유(`walk-route.ts`·신규 provider·스크립트)라 위임 이득이 없다. 리뷰는 서브에이전트 2종(spec-compliance·code-quality)으로 분리.

1. `scripts/build-crosswalk-seed.mjs` + `scripts/build-crosswalk-seed.test.ts` — 봉투 파서·trim·가드·중복 제거(TDD). 실행해 `src/lib/data/crosswalks.json` 생성.
2. `src/lib/providers/crosswalks.ts` + `src/lib/providers/__tests__/crosswalks.test.ts` — `matchCrosswalk` 3중 게이트(TDD, 변이 각 축).
3. `src/lib/walk-route.ts` — `annotateCrosswalkInfo` + 파이프라인 결선, `walk-route.test.ts` 추가 케이스.
4. `scripts/verify-crosswalk-annotation.mjs` — 실호출 게이트, dev 서버 띄워 PASS 확인.
5. 문서: `NOTICE.md` 표, `docs/INTEGRATIONS.md` §도보 경로 소절, `CLAUDE.md` 카탈로그 행, `CHANGELOG.md`, `docs/BACKLOG.md` E8, `PROGRESS.md` 한 줄.
6. 리뷰 → rebase → `npm run test:run && npx tsc --noEmit && npm run lint` → ff push → 코디네이터 보고.
