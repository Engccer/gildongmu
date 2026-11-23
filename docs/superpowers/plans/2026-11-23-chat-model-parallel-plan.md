# 채팅 모델 재측정(E86)과 실험판 채팅 모델 선택(E89) 병렬 계획

작성 2026-11-23, 코디네이터 세션. 기준 SHA는 이 문서를 담은 커밋이다(각 세션 보고 디렉터리의 `base.sha`).

**종료 상태(2026-11-23 16:30)**: 두 세션 모두 main에 통합하고 창을 닫았다. `e89-chat-model`은 `74c0be26`(운영 배포됨, 처리방침 문구 판정 반영 포함), `e86-remeasure`는 `9dcd5926`(1일차 리포트 `docs/evals/2026-11-23-e86-chat-remeasure-day1.md`). 남은 것: E89 실험판 실기기 설치와 낭독 확인(아이폰 연결 대기), E86 다른 날 재현(2일차, 새 세션, 남은 예산 8.78달러)과 그 뒤 전환 판정. 보고 파일은 `~/gildongmu-wt/<세션 이름>-reports/`에 남아 있다.

## 1. 마일스톤과 확정 판정

| 세션 | 마일스톤 | 모델·노력 | 필요 환경 |
|---|---|---|---|
| `e86-remeasure` | BACKLOG E86 채팅 재측정 1일차: 네 팔을 같은 실행으로 재고 리포트를 낸다 | opus·medium | 어디서든(유료 호출) |
| `e89-chat-model` | BACKLOG E89: 실험판 설정 「채팅 답변 모델」과 채팅 서버의 여러 회사 구조(설계부터 실기기 배포까지) | opus·medium | 로컬(iOS) |

위원장 판정(2026-11-23, 코디네이터 창에서 받음. 원문은 BACKLOG E86·E89):

- E86: 전환 후보는 GPT-6.1 Terra. 재측정을 앞당긴다. 팔은 넷(현행 `gemini-3.6-flash`, Terra 추론 끔, Terra 추론 낮음, Claude Sonnet 5.5 낮음). 운영처럼 띄엄띄엄 보낼 때의 질문당 비용도 잰다.
- E86 비용: 하네스 전 케이스(42개, 11-15의 38개에 11-17 앱 기능 케이스 넷이 더해졌다) × 3회를 오늘 한 번, 다른 날 한 번. 이틀 합계 상한 12달러(하루 6달러). 상한에 닿으면 멈추고 보고한다.
- E89: 설정 줄 이름 「채팅 답변 모델」. 선택지는 Gemini 3.6 Flash(처음 값), GPT-6.1 Terra, GPT-6 Luna, Claude Opus·Sonnet·Haiku(나들이 답변 모델과 같은 구성). 정식판에는 넣지 않는다.

E86의 다른 날 재현(2일차)은 1일차 세션이 닫힌 뒤 다른 날에 새 세션으로 띄운다(세션은 마일스톤 하나로 끝낸다). 1일차 리포트가 2일차의 인계 문서다.

서브에이전트 배정(두 세션 공통): 할 일이 정해진 구현·이식·탐색은 `model: sonnet`·`effort: medium`, 설계가 끼는 일과 일반 리뷰는 `model: opus`, 보안·개인정보 전송 경로의 최종 검토는 `model: fable`·`effort: high` 1회(세션이 opus라 리뷰어는 fable), 적대적 설계 리뷰는 codex `adversarial-review`.

## 2. 파일 소유권 지도

| 세션 | 소유 | 읽기만 |
|---|---|---|
| `e86-remeasure` | `src/__ab__/**`, `vitest.ab.config.ts`, `docs/evals/**`(새 파일), BACKLOG의 E86 항목과 착수 순서 표의 E86 행, CHANGELOG 자기 항목 | `src/lib/**`, `src/app/**`, `ios/**` |
| `e89-chat-model` | `src/lib/chat/**`, `src/lib/gemini/**`, `src/app/api/chat/**`, 채팅 훅·컴포넌트 가운데 요청 본문을 만드는 자리, `ios/**`(설정·채팅), `messages/**`·`ios/i18n/**`의 자기 키, 개인정보 안내 문구, `docs/superpowers/specs`·`plans`의 자기 문서, `.claude/rules/chat.md`, BACKLOG의 E89 항목과 착수 순서 표의 E89 행, CHANGELOG·PROGRESS 자기 항목 | `src/__ab__/**`, `src/lib/vergilius/**`(구조 참고. 고쳐야 하면 자진 신고) |

겹침: BACKLOG·CHANGELOG는 둘 다 고치므로 「자기 항목만, rebase 뒤 `comm -23` 대조」를 따른다. 코드 겹침은 없다.

경계 인터페이스(병렬 전에 고정): 평가 하네스(`src/__ab__/model-ab.spec.ts`·`openai-runner.ts`·`claude-runner.ts`)가 실제로 불러 쓰는 채팅 모듈은 여섯이다. `runAgentLoop`(`agent-loop.ts`), `executeFunction`(`router.ts`), `availableDeclarations`(`declarations.ts`), `buildChatSystemInstruction`(`system-instruction.ts`), `dedupeSources`(`sources.ts`), `GEMINI_MODEL`(`gemini/client.ts`). `e89-chat-model`은 이 여섯의 이름과 호출 형태를 바꾸지 않는다(인자를 더할 때는 선택 인자로). 바꿔야만 하면 통합 전에 코디네이터에 보고한다. `e86-remeasure`는 자기 base의 채팅 코드를 그대로 재며 `src/lib/chat`을 고치지 않는다(이 확인은 `import` 줄을 읽어 한 것이다, 관측 SHA `602fdd1b`).

## 3. git 격리와 통합

저장소 정책은 main 직접 push다(push하면 Vercel이 자동 배포한다). worktree는 `~/gildongmu-wt/<세션 이름>`, 브랜치는 `feat/<세션 이름>`, 보고 디렉터리는 `~/gildongmu-wt/<세션 이름>-reports/`다.

```bash
git fetch origin && base=$(git rev-parse origin/main) && git rebase "${base}"
comm -23 <(git show "${base}:CHANGELOG.md" | sort) <(sort CHANGELOG.md)   # 고친 공유 문서마다
# 게이트(gate-lock.py) → push
git push origin feat/<name>:main && git -C ~/Mac-Projects/gildongmu pull --ff-only
```

`--force` 금지, `git add -A` 금지(pathspec 커밋), `git stash` 금지. 무거운 게이트(`test:run`·`build`·xcodebuild)는 `~/.claude/skills/parallel-sessions/scripts/gate-lock.py`로 감싼다.

배포: `e89-chat-model`의 서버 변경은 push 순간 운영에 닿는다. 그래서 정식판 요청이 현행 Gemini 경로를 그대로 타는 봉인을 구조와 테스트로 먼저 세우고, push 직후 운영 `/api/chat` 실호출로 종전 응답을 확인한다. 실기기 배포는 직전에 코디네이터에 알린다.

## 4. 웨이브

웨이브 하나, 두 세션 동시. iOS 빌드는 `e89-chat-model`만 하므로 게이트 겹침은 `test:run`뿐이고 락으로 순번을 잡는다.

## 5. 착수 프롬프트와 보고 파일

착수 프롬프트 사본은 `~/.claude/parallel-sessions/gildongmu/<세션 이름>.prompt.txt`, 보고는 `~/gildongmu-wt/<세션 이름>-reports/<단계>-<YYYYmmddHHMM>.md`다. 판정 요청은 같은 디렉터리의 `judgment-<YYYYmmddHHMM>.md`로 쓰고 코디네이터가 자기 창에서 위원장에게 묻는다.
