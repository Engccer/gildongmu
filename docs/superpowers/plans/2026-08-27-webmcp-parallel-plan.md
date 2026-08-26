# 2026-08-27 WebMCP 웨이브 — 병렬 세션 계획

> 코디네이터: `mac-projects-b3`. 작업 세션: `gildongmu-bc`(spec), `dodo-planet-53`(Tmap 키 교체), Codex(`feat/webmcp` 구현).
> 상위 항목은 `docs/BACKLOG.md` **W1**. 외부 시한 2026-09-04 05:00 KST.

## §1 마일스톤과 확정 판정

| # | 마일스톤 | 담당 | 상태 |
|---|---|---|---|
| G0 | 인앱 브라우저 × VoiceOver × 포커스 추종 실측 | 위원장 | ✅ 2026-08-27 통과(프로브 `4a3ee44`) |
| G1 | Tmap 키 분리 | 코디네이터 → dodo 세션 | ✅ 앱 `Dodoplanet` 발급 완료, **교체만 남음** |
| **G2** | **spec + 설계 리뷰** | **`gildongmu-bc`** | 착수 |
| G3 | 구현 | Codex(`feat/webmcp`) | G2 대기 |
| G4 | 영문 설명문 + 3분 영상 + Devpost 제출 | 위원장 | 미착수 |

**확정 판정(코디네이터가 정함, 재논의 불필요)**

1. **설계 리뷰 실시.** CLAUDE.md §마일스톤 게이트 조건 ②(새 외부 통합의 계약 가정 첫 정의)에 해당한다.
2. **노출 도구는 엄선한다.** `src/lib/chat/declarations.ts`의 24개를 전부 옮기지 않는다. 겹치는 도구는 에이전트의 오선택을 부른다.
3. **출력 분할은 `routeKey`를 손잡이로 한다.** 실측: `/api/route/transit` 3,706자 중 `recommended`만 551자, `alternatives` 4건이 3,475자. 권장 상한 1.5K자.
4. **G1은 G3의 선행조건이 아니다.** 심사 트래픽 방어용이라 구현을 막지 않는다.

## §2 파일 소유권 지도

| 주체 | 브랜치 / 작업 위치 | 소유 (여기만 쓴다) |
|---|---|---|
| Codex | `feat/webmcp` @ `.worktrees/webmcp` | `src/app/[locale]/webmcp-probe/**`, `src/lib/webmcp/**`(신설), `messages/*.json`의 `webmcp*` 키 |
| `gildongmu-bc` | `feat/webmcp-spec` @ `.worktrees/spec` | `docs/superpowers/specs/2026-08-27-webmcp-tool-layer-design.md` (**신규 파일 1개**) |
| `dodo-planet-53` | dodo-planet `main` | `.env.local`(로컬), Vercel env, `CLAUDE.md`의 TMAP 행, `CHANGELOG.md` |
| 코디네이터 | gildongmu `main` (메인 체크아웃) | `docs/BACKLOG.md`, 이 계획 문서 |

⚠ **겹침 경보 — `docs/BACKLOG.md`·`CHANGELOG.md`**. Codex가 이미 `feat/webmcp`에서 둘 다 건드렸고 iOS 릴리스가 `main`에서 `CHANGELOG.md`를 건드렸다. **병합 충돌이 예측돼 있다**(`merge-tree` 실측: `CHANGELOG.md` 1건 충돌, `PROGRESS.md`는 자동 병합). 따라서:

- **작업 세션은 `docs/BACKLOG.md`·`PROGRESS.md`를 건드리지 않는다.** 완료 보고에 적어 보내면 코디네이터가 한 번에 반영한다.
- `CHANGELOG.md`는 **자기 항목만 추가**하고, rebase 후 `comm -23 <(git show origin/main:CHANGELOG.md | sort) <(sort CHANGELOG.md)`로 남의 줄 소실을 전수 대조한다. 출력된 줄은 전부 자기가 의도적으로 지운 것이어야 한다.

## §3 git 격리 절차

```bash
# gildongmu (repo 관례: .worktrees/, .gitignore 27행)
git -C ~/Mac-Projects/gildongmu worktree add .worktrees/spec -b feat/webmcp-spec origin/main
cd ~/Mac-Projects/gildongmu/.worktrees/spec
git branch --unset-upstream        # 기본값이 origin/main 추적이라 사고 위험
# 문서 전용 작업이면 npm install 불필요. 코드를 실행해야 하면:
#   cp ~/Mac-Projects/gildongmu/.env.local . && npm install
# 통합
git fetch && git rebase origin/main && npm run lint && npx tsc --noEmit
git push origin feat/webmcp-spec:main        # ff만. 거부되면 rebase 재시도, --force 금지
git -C ~/Mac-Projects/gildongmu worktree remove .worktrees/spec
```

- 커밋은 **pathspec**으로: `git commit -- <경로들>`. `git add -A` 금지(다른 세션의 staged 내용을 흡수한다).
- 커밋 직후 `git show HEAD --stat`로 의도 파일만 들었는지 검증.
- ⚠ **메인 체크아웃 `~/Mac-Projects/gildongmu`는 코디네이터 것이다.** 작업 세션이 거기서 커밋하면 index를 공유해 서로의 파일을 흡수한다.
- **리뷰가 도는 동안 rebase하지 않는다.** 리뷰 대상과 통합 대상이 갈리면 "리뷰 통과"가 아무것도 보증하지 못한다.

## §4 웨이브

- **웨이브 1(지금)**: `gildongmu-bc` G2 + `dodo-planet-53` G1 교체. 두 repo가 달라 파일 겹침 0.
- **웨이브 2**: G2 통합(ff push) 후 Codex가 `feat/webmcp`를 `origin/main`에 rebase하고 spec대로 구현.
- **웨이브 3**: 코디네이터가 `feat/webmcp` → `main` 병합(CHANGELOG 충돌 해소) + BACKLOG·PROGRESS 일괄 반영 + doc-audit.

**배포 잠금**: 프로덕션 배포는 한 번에 한 세션. dodo 세션의 Vercel env 변경이 먼저이고, 그 완료 보고 전까지 gildongmu 쪽은 프로덕션에 아무것도 올리지 않는다(어차피 G2·G3은 브랜치 작업이라 자연히 지켜진다).

## §5 착수 프롬프트

세션에 보낸 프롬프트 전문은 코디네이터 세션 기록에 있다. 계약 요지는 §2 소유권 + §3 격리 + "BACKLOG·PROGRESS 금지, 완료 보고로 대신" 세 가지다.
