# 2026-08-27 WebMCP 웨이브 — 병렬 세션 계획

> **G3 구현까지 종결·통합 2026-08-27**(`fd7b44c` 구현 → `907cf67` 리뷰 3건 반영 → `881a07c` 분배, `feat/webmcp`·worktree 삭제). 남은 것은 게이트 4(실기기 6항, `docs/FIELD-TEST.md` §8)·게이트 5(G4 제출물) — 정본은 `docs/BACKLOG.md` W1. 아래는 웨이브 시점 기록이다.
> **웨이브 종료 2026-08-27.** G0·G1·G2 전부 종결, 접수 세션 마감. 웨이브 종료 시점 `origin/main` = `e414709`(G3 통합 후 `60f9040`).
> · G1 `tmap-key-swap` DONE (dodo `ab1e15a5`·`ba9f5ff8`, Vercel 프로덕션 교체 07:52 KST + 실호출 확인)
> · G2 `spec-webmcp` DONE (`e0b4258`→판정 반영 `4240abb`, worktree·브랜치 정리 완료)
> · 코디네이터 분배 `e414709` (BACKLOG W1 · PROGRESS · FIELD-TEST §8)
> · ~~남은 것은 G3 구현뿐.~~ G3 종결(위 머리).
> · 후속: 이 웨이브가 문서를 여러 주체에 분배했으므로 **G3 통합 후 `doc-audit`를 돌린다.**

> ⚠ 이 문서의 `G0`~`G4`는 W1 내부 게이트 번호다 — `docs/BACKLOG.md`의 식별자 `G3`(자동차·대중교통 봉인)·`G5`(1.12 제출)와 무관하다.
> 코디네이터: `mac-projects-b3`. 작업 세션: `gildongmu-bc`(spec), `dodo-planet-53`(Tmap 키 교체), Codex(`feat/webmcp` 구현).
> 상위 항목은 `docs/BACKLOG.md` **W1**. 외부 시한 2026-09-04 05:00 KST.

## §1 마일스톤과 확정 판정

| # | 마일스톤 | 담당 | 상태 |
|---|---|---|---|
| G0 | 인앱 브라우저 × VoiceOver × 포커스 추종 실측 | 위원장 | ✅ 2026-08-27 통과(프로브 `4a3ee44`) |
| G1 | Tmap 키 분리 | 코디네이터 → dodo 세션 | ✅ 2026-08-27 07:52 교체·실호출 확인 |
| **G2** | **spec + 설계 리뷰** | **`gildongmu-bc`** | ✅ `e0b4258`·`4240abb` |
| G3 | 구현 | Codex↔Claude 교대(`feat/webmcp`) | ✅ `fd7b44c`·`907cf67`, main 통합 |
| G4 | 영문 설명문 + 3분 영상 + Devpost 제출 | 위원장 | 미착수 |

**확정 판정(코디네이터가 정함, 재논의 불필요)**

1. **설계 리뷰 실시.** CLAUDE.md §마일스톤 게이트 조건 ②(새 외부 통합의 계약 가정 첫 정의)에 해당한다.
2. **노출 도구는 엄선한다.** `src/lib/chat/declarations.ts`의 24개를 전부 옮기지 않는다. 겹치는 도구는 에이전트의 오선택을 부른다.
3. **출력 분할은 `routeKey`를 손잡이로 한다.** 실측: `/api/route/transit` 3,706자 중 `recommended`만 551자, `alternatives` 4건이 3,475자. 권장 상한 1.5K자.
4. **G1은 G3의 선행조건이 아니다.** 심사 트래픽 방어용이라 구현을 막지 않는다.

## §2 파일 소유권 지도

| 주체 | 브랜치 / 작업 위치 | 소유 (여기만 쓴다) |
|---|---|---|
| **Codex ↔ Claude 교대** | `feat/webmcp` @ `.worktrees/webmcp` | `src/app/[locale]/**`(webmcp 관련), `src/lib/webmcp/**`, `messages/*.json`의 `webmcp*` 키, `/{locale}/privacy` 카피 |
| `gildongmu-bc` | `feat/webmcp-spec` @ `.worktrees/spec` | `docs/superpowers/specs/2026-08-27-webmcp-tool-layer-design.md` (**신규 파일 1개**) |
| `dodo-planet-53` | dodo-planet `main` | `.env.local`(로컬), Vercel env, `CLAUDE.md`의 TMAP 행, `CHANGELOG.md` |
| 코디네이터 | gildongmu `main` (메인 체크아웃) | `docs/BACKLOG.md`, 이 계획 문서 |

⚠ **겹침 경보 — `docs/BACKLOG.md`·`CHANGELOG.md`**. Codex가 이미 `feat/webmcp`에서 둘 다 건드렸고 iOS 릴리스가 `main`에서 `CHANGELOG.md`를 건드렸다. **병합 충돌이 예측돼 있다**(`merge-tree` 실측: `CHANGELOG.md` 1건 충돌, `PROGRESS.md`는 자동 병합). 따라서:

- **작업 세션은 `docs/BACKLOG.md`·`PROGRESS.md`를 건드리지 않는다.** 완료 보고에 적어 보내면 코디네이터가 한 번에 반영한다.
- `CHANGELOG.md`는 **자기 항목만 추가**하고, rebase 후 `comm -23 <(git show origin/main:CHANGELOG.md | sort) <(sort CHANGELOG.md)`로 남의 줄 소실을 전수 대조한다. 출력된 줄은 전부 자기가 의도적으로 지운 것이어야 한다.

### §2-1 교대 규약 (2026-08-27 개정 — Codex 전담 철회) — 종결(브랜치 삭제 2026-08-27)

사용 한도 때문에 **Codex와 Claude가 `feat/webmcp` 하나를 교대로** 쓴다. 워크트리도 브랜치도 하나다.

⚠ **동시에 쓰지 않는다.** 같은 디렉터리는 git index를 공유하므로 한쪽이 stage한 파일이 다른 쪽 커밋에 흡수된다(자율성 헌장 §병렬 세션 git 안전의 실사고). 교대는 시간 분할이지 병렬이 아니다.

**넘기는 쪽**: ①pathspec 커밋(`git commit -- <경로들>`, `git add -A` 금지) ②`git show HEAD --stat`로 의도 파일만 들었는지 검증 ③`git push origin feat/webmcp`. **미커밋 상태로 넘기지 않는다** — 받는 쪽이 그 변경을 자기 것으로 오인한다.

**받는 쪽**: ①`git pull --ff-only` ②`git log --oneline -5`로 상대가 어디까지 했는지 확인 ③작업 시작. 상대의 미완 변경이 워킹트리에 남아 있으면 **자기 것으로 커밋하지 말고 상황을 보고**한다.

⚠ **`feat/webmcp`의 base가 낡았다**: `7d65693`은 `cd13576` 기반이고 그 뒤 main이 `e414709`까지 갔다(spec·계획·CLAUDE.md·FIELD-TEST). **다음 세션이 첫 순서로 `git fetch && git rebase origin/main && npm install`을 한다.**

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

## §4 웨이브 — 전부 종결(2026-08-27)

- **웨이브 1(지금)**: `gildongmu-bc` G2 + `dodo-planet-53` G1 교체. 두 repo가 달라 파일 겹침 0.
- **웨이브 2**: G2 통합(ff push) 후 Codex가 `feat/webmcp`를 `origin/main`에 rebase하고 spec대로 구현.
- **웨이브 3**: 코디네이터가 `feat/webmcp` → `main` 병합(CHANGELOG 충돌 해소) + BACKLOG·PROGRESS 일괄 반영 + doc-audit.

**배포 잠금**: 프로덕션 배포는 한 번에 한 세션. dodo 세션의 Vercel env 변경이 먼저이고, 그 완료 보고 전까지 gildongmu 쪽은 프로덕션에 아무것도 올리지 않는다(어차피 G2·G3은 브랜치 작업이라 자연히 지켜진다).

## §5 착수 프롬프트

세션에 보낸 프롬프트 전문은 코디네이터 세션 기록에 있다. 계약 요지는 §2 소유권 + §3 격리 + "BACKLOG·PROGRESS 금지, 완료 보고로 대신" 세 가지다.
