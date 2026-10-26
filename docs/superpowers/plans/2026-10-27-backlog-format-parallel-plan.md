# BACKLOG 형식 전환(D36) 병렬 세션 계획

기준 SHA: `2f0a331f` (이 문서 커밋 직전 main) · 코디네이터: `gildongmu-9a [5b6924]` · 세션 1개(`backlog-format`)

## §1 마일스톤·확정 판정·모델 배정

**마일스톤**: `docs/BACKLOG.md`를 워크스페이스 BACKLOG 형식으로 옮긴다(BACKLOG D36. 형식 정본은 워크스페이스 `~/Mac-Projects/CLAUDE.md` §프로젝트 맥락 문서 "BACKLOG 머리의 착수 순서 표").

확정 판정(코디네이터가 정함, 제품 판단 아님):

1. 열린 항목(§1~§8)의 머리 줄을 체크박스 `- [ ] **<식별자>. <제목>**`으로 바꾼다. 식별자 글자는 그대로 두고 재사용하지 않는다(다른 문서가 "백로그 A6" 식으로 참조한다). 항목 본문은 바이트 단위로 보존한다.
2. §9 폐기와 `## 종결된 식별자` 표는 열린 항목이 아니므로 체크박스로 만들지 않는다.
3. 파일 머리(`## 이 파일을 읽는 법` 앞)에 `## 착수 순서` 표 `| 묶음 | 항목 | 자리 | 순서 |`를 둔다. 표에는 **구현 착수가 가능한 열린 항목**만 넣고, 판정 대기(§2)·"보이면 고칠" 감시·편승 대기·위원장 직접 액션은 넣지 않는다.
4. 이미 끝났는데 남은 항목은 커밋·CHANGELOG 증거가 있을 때만 닫는다(본문 삭제, `## 종결된 식별자`에 식별자→행선지 한 줄). 증거가 모호하면 닫지 않고 보고에 적는다.
5. D36 자신은 이 작업으로 닫는다.

모델·노력 배정:

| 일 | 주체 | 모델·노력 |
|---|---|---|
| 세션 본체(묶음·순서 판단, 통합) | `backlog-format` | `opus[1m]` · medium (49만 바이트 파일 전체를 판단 재료로 써야 함) |
| 헤딩→체크박스 기계 변환 | 세션이 쓰는 스크립트 | 모델 없음(항목 수·본문 보존 assert) |
| 항목별 자리 1차 분류 | 절별 서브에이전트 | `model: sonnet` · medium (기준표가 정해진 분류) |
| 끝났는데 남은 항목 감사 | 서브에이전트 | `model: opus` · medium (감사) |
| 최종 리뷰 | 서브에이전트 | `model: opus` · medium |

위임 판정: 자리 분류는 절마다 독립이라 위임, 묶음·순서는 전체를 봐야 해서 inline, 변환은 결정론이라 스크립트.

## §2 파일 소유권

- 세션 소유: `docs/BACKLOG.md`, `CHANGELOG.md`(D36 종결 항목 한 개와 이번에 닫은 항목만), BACKLOG 앵커를 가리키는 링크가 있는 문서의 그 링크 줄(`git grep -n "BACKLOG.md#"`로 찾는 자리, 링크 조각만 수정).
- 금지: `CLAUDE.md`·`AGENTS.md`·`PROGRESS.md`·코드 전부. 그 밖에 고칠 것이 보이면 보고에 적는다.
- 경계 인터페이스: `doc-audit` 린트의 열린 항목 정규식 `^\s*[-*] \[ \] (?:\S+ )?\*\*(.+?)\*\*` (`~/.claude/skills/doc-audit/scripts/doc-audit-lint.py` `OPEN_ITEM`). 표 항목 칸의 `**…**` 이름은 이 정규식이 잡는 제목과 글자까지 같아야 한다.

## §3 git 격리

저장소 정책: **main 직접 push**(gildongmu는 리뷰 통과 뒤 자동 commit·push). worktree `~/gildongmu-wt/backlog-format`(브랜치 `feat/backlog-format`, origin/main 기준). 통합은 `parallel-sessions` 스킬 Claude 지침 §3 순서(고정 `base`로 rebase → `comm -23` 소실 대조 → push → 메인 체크아웃 `pull --ff-only`). `--force` 금지. 문서 작업이라 npm 설치·테스트 기준선은 없다.

## §4 웨이브

웨이브 1개, 세션 1개.

## §5 착수 프롬프트·보고

- 착수 프롬프트: `~/.claude/parallel-sessions/gildongmu/backlog-format.prompt.txt`(런처 사본)
- 보고 디렉터리: `~/gildongmu-wt/backlog-format-reports/`
