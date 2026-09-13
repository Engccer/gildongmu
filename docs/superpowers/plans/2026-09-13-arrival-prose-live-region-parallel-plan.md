# 병렬 계획 — 도착 줄 문장형(E37+A38) · 웹 live region 단일화(A40) (2026-09-13)

> 코디네이터 세션이 백로그 전수 판정 뒤 작성. 작업 세션은 자기 절만 읽어도 착수할 수 있게 자족적으로 쓴다.
> ⛔ **push 동결 중**(2026-09-22 09:00 KST까지, OpenAI WebMCP Challenge 심사). **통합은 로컬 `main` fast-forward**이고 `origin` push는 `.git/hooks/pre-push`가 막는다. 훅을 지우지 않는다.

## §1. 마일스톤과 확정 판정

기준 SHA: `7fc1e832`(로컬 `main`, 작업 트리 clean).

### M1. `arrival-prose` — E37 지하철 도착 줄 전면 문장형 + A38 영문 현재역

**왜 한 세션인가**: 둘이 같은 파일(`station-arrivals.ts`·`SubwayArrivalLine.swift`)의 같은 조립 자리를 고친다. 갈라 놓으면 서로 덮어쓴다.

**위원장 판정(2026-09-13, 이 세션에서 확정)**

| 항목 | 판정 |
|---|---|
| E37 범위 | **시간형·정거장형 둘 다 우리 문장으로 바꾼다.** 정거장 수는 글자에서 파싱하되 **못 알아보면 그 줄만 서울시 원문 그대로**(실패 방향 = 현행 동작, 정보 손실 0) |
| A38 방식 | **영문 줄은 자기 값(`currentLocationEn`)으로 판정한다.** 한국어 칸이 비었다는 이유로 영문 현재역을 버리지 않는다. 한 줄 안에서 언어를 섞지 않는다는 E27 계약은 그대로 |

**판정 문장 초안**(spec에서 확정, 위원장 문안 왕복 대상):

| 원문 | 목표 |
|---|---|
| `4분 후 (삼각지)` | `4분 후 도착. 현재 삼각지.` |
| `4분 30초 후` | `4분 30초 후 도착. 현재 방배.` |
| `[4]번째 전역 (하남검단산)` | `4정거장 전 하남검단산에 있습니다.` |
| `전전역 출발` | `2정거장 전 미사에서 출발.` |
| `서울 도착` / `서울 출발` | `서울 도착.` / `서울 출발.` |

### M2. `live-region` — A40 웹 길찾기 안내 중 polite live region 둘

**출처**: `~/gildongmu-wt/reports/small-batch-review-a11y.md` L7(2026-09-11, 구조 관찰이고 실측 아님). `TransitGuidePanel`과 `DirectionsView`가 각각 polite live region을 문서에 둔다 — 접근성 헌장 §1 "단일 polite live region" 위반.

**설계 판정은 세션이 한다**(제품 판단 아님): 어느 쪽으로 합칠지, `nearbyLiveMessage`류 단일 창구를 새로 세울지 기존 것을 쓸지. 단 **웹 단독**이고 iOS는 건드리지 않는다.

### §1-1. 모델 배정

| 세션 | 모델 | 근거 |
|---|---|---|
| `arrival-prose` | `fable` | **판단이 정본** — spec을 새로 쓰고("완성 문장이 낭독 정본"이라는 계약을 이 화면에서 여는 근거), 심야 코퍼스에서 `barvlDt` 오발화 게이트를 해석하고, 파싱 폴백 불변식을 설계한다 |
| `live-region` | `opus` | **절차가 정본** — 계약(헌장 §1 단일 polite live region)이 이미 확정이고 `nearbyLiveMessage` 선례가 있다. 자리를 찾아 합치는 일 |

## §2. 파일 소유권 지도

겹침 **0**. 술어는 "그 파일을 고치는가"이지 "이름이 나오는가"가 아니다.

| 세션 | 소유(쓰기) |
|---|---|
| `arrival-prose` | `src/lib/place-lines/station-arrivals.ts` · `src/lib/place-lines/pick-line.ts` · `src/lib/place-lines/__tests__/**` · `src/lib/__tests__/fixtures/subway-arrival-tail-cases.json`(+ E37용 새 fixture) · `src/components/SeoulSubwayArrival.tsx` · `ios/GildongmuKit/Sources/GildongmuKit/SubwayArrivalLine.swift` · `ios/GildongmuKit/Tests/**`(도착 줄 테스트) · 새 spec 파일 |
| `live-region` | `src/components/TransitGuidePanel.tsx` · `src/components/DirectionsView.tsx` · 그 둘의 `__tests__` |

**공용 생성물 규약**

- **i18n 메시지(`messages/*.json` 6로케일)**: `arrival-prose`가 도착 문장 키를 새로 추가한다. `live-region`은 새 키를 만들지 않는 것이 기본이고, 불가피하면 착수 보고에 키 이름을 적는다. 둘 다 **자기 키만** 건드리고 남의 줄을 지나가며 정렬하지 않는다.
- **iOS xcstrings**: `arrival-prose`만 생성한다(`node ios/scripts/messages-to-xcstrings.mjs`). rebase 뒤 재생성.
- **`docs/BACKLOG.md`·`CHANGELOG.md`**: 각자 자기 항목 줄만. rebase 후 `comm -23 <(git show $base:docs/BACKLOG.md | sort) <(sort docs/BACKLOG.md)`로 소실 대조하고, 출력된 줄이 전부 자기가 의도적으로 지운 것인지 확인한다.
- **`CLAUDE.md`**: 새 함정이 생기면 규칙 한두 줄만, 상세는 `docs/PATTERNS.md`·`docs/INTEGRATIONS.md`의 같은 제목 절로. ⚠ 80KB 예산 테스트(`claude-md-budget.test.ts`)가 있다.
- ⚠ **`sync_agent_docs.py`는 worktree에서 돌지 않는다**(ROOT가 `~/Mac-Projects` 고정). `CLAUDE.md`를 고쳤으면 통합 보고에 적고, 코디네이터가 메인 체크아웃에서 돌린다.

## §3. git 격리 (동결판 — 그대로 따른다)

```bash
# worktree는 코디네이터가 이미 만들어 두었다. npm install 금지(node_modules 설치 완료).
cd ~/gildongmu-wt/<name>

# 작업: 자기 브랜치에만, pathspec 커밋
git commit -- <의도한 경로들>        # ⛔ git add -A / git add . 금지(병렬 세션이 index를 공유한다)
git show HEAD --stat                 # 내 파일만 들었는지 확인

# 통합(push 아님 — 로컬 main ff)
git rebase main
# → 생성물 재생성 → 게이트 테스트 → 소실 대조
git -C ~/Mac-Projects/gildongmu merge --ff-only feat/<name>
# ff 거부면 다른 세션이 먼저 올린 것: git rebase main부터 다시

git worktree remove ~/gildongmu-wt/<name>   # 코디네이터 허가 뒤
```

- ⛔ `git push origin ...` 금지(훅이 막는다). `--force` 금지.
- **게이트 순번은 락으로 잡는다**: 무거운 게이트(`npm run test:run`·`npx tsc --noEmit`·iOS 빌드) 전에
  `until mkdir ~/gildongmu-wt/gate.lock 2>/dev/null; do sleep 30; done` → 끝나면(실패해도) `rmdir ~/gildongmu-wt/gate.lock`.
- **게이트**(전부 0/green이 기준선):
  ```bash
  npm run test:run      # 웹
  npx tsc --noEmit      # 타입
  npm run lint          # ESLint
  swift test --package-path ios/GildongmuKit   # M1만
  ```
- **실기기 배포는 한 번에 한 세션**이고 코디네이터 허가 뒤에만. 이번 웨이브는 **M1만** 해당(M2는 웹 단독).

## §4. 웨이브

웨이브 하나. 두 세션 동시 착수(겹침 0, 동시 게이트 2개는 상한 3 안).

## §5. 착수 프롬프트

`~/.claude/parallel-sessions/gildongmu/<name>.prompt.txt`에 저장돼 있고 런처가 실행 인자로 넘긴다.

## §6. 종료 상태

(웨이브 종료 시 코디네이터가 기록)
