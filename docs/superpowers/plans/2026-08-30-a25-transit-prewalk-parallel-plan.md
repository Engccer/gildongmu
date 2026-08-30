# A25 승차 전 도보 안내 — 병렬 세션 계획 (2026-08-30)

> **종료 2026-08-30**: `a25-prewalk` main `f2db848`(+`cf3ce33`) ff 통합, 실험판 실기기 배포 완료, worktree 제거. 남은 사용자 판정: 실승차(`docs/FIELD-TEST.md` §5-4, BACKLOG A25).

코디네이터: 접수 세션(A25 등재 커밋 `5ba4913`). 작업 세션 1개(`a25-prewalk`). 단일 마일스톤이지만 위원장 지시로 새 창 세션에서 착수한다.

## §1 마일스톤·확정 판정

- **A25** (`docs/BACKLOG.md` §1): 대중교통 안내 시작 시 승차역까지의 도보 leg를 **도보 실시간 안내(GPS)로 먼저 돌리고, 도착하면 대기 국면(열차 후보)으로 이어간다**. 하차 후 핸드오프(spec 2026-08-04 §14.2)와 대칭. 위원장 판정 2026-08-30(대안 "역 도착 버튼 국면"·"현행 유지" 기각).
- 설계 리뷰: **필요**(새 상태 전이·세션 연결 = 글로벌 규칙 ①). spec 작성 → codex adversarial-review → plan → 구현.
- 근거 로그: `~/gildongmu-private/field-logs/transit-guide-diag-2026-08-29.log`, `urlcache-2026-08-29/` entry 775.

## §2 파일 소유권 지도

`a25-prewalk` 소유(전부): `ios/Gildongmu/Directions/{TransitGuideModel,GuideSessionCoordinator,GuideSession*,TransitTrackingSheet,BeaconModel}.swift`, `ios/GildongmuKit/Sources/GildongmuKit/TransitGuide.swift`(+Tests), `src/lib/transit-guide.ts`, `src/hooks/useTransitGuide.ts`, `src/components/TransitGuidePanel.tsx`, `src/lib/__tests__/guidance-gate-drift.test.ts`, 공유 fixture `transit-guide-scenarios*`, i18n `transitGuide.*` 네임스페이스(6로케일 + xcstrings 재생성), 신규 spec/plan, `docs/BACKLOG.md` A25 항목·`CHANGELOG.md` 자기 항목·`docs/FIELD-TEST.md` 자기 행.
겹침 없음(동시 활성 세션 없음). 공용 생성물은 rebase 뒤 재생성.

## §3 git 격리

```bash
git worktree add ~/gildongmu-wt/a25-prewalk -b feat/a25-prewalk main
cp .env.local ~/gildongmu-wt/a25-prewalk/ && (cd ~/gildongmu-wt/a25-prewalk && npm ci)
# 통합: git fetch && git rebase origin/main → 생성물 재생성 → npm run test:run → git push origin feat/a25-prewalk:main (ff만)
```
`--force` 금지, `git add -A` 금지, rebase 후 `comm -23` 소실 대조.

## §4 웨이브

W1: `a25-prewalk` 단독. 실기기 배포(실험판 `CONFIGURATION=Experimental ./ios/deploy-device.sh`)는 이 세션이 단독 수행.

## §5 착수 프롬프트

`~/.claude/parallel-sessions/gildongmu/a25-prewalk.prompt.txt`.
