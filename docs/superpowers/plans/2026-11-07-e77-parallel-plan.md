# E77 병렬 세션 계획 (2026-11-07)

코디네이터 `gildongmu-75 [1ac7af]`(위원장 창, 같은 시간 다른 백로그 판정 진행) + 작업 세션 1: `e77-input`.

## §1 마일스톤·확정 판정·모델 배정

| 세션 | 과제 | 확정 판정 | 모델·노력 |
|---|---|---|---|
| `e77-input` | E77 경유지/자동차 환승 입력을 검색칸 하나 + 확인 질문으로(웹 + iOS 실험판) | `docs/BACKLOG.md` §5 E77 절 전체(판정 1~6, 확정 문안 표, 기각 대안). 문안은 위원장 TextEdit 왕복 확정본이라 바꾸지 않는다 | opus · medium. 서브에이전트: 구현·이식 `model: sonnet`, 리뷰어·접근성 감사 `model: opus` |

설계 리뷰 판정(코디네이터): 새 불변식·외부 통합 계약·비가역 저장 포맷·안전 크리티컬 4종 어디에도 해당하지 않는 입력 UI 변경이라 **codex 적대적 설계 리뷰는 생략**한다. 세션이 작업 중 저장 포맷(최근 경로·`DirectionsEndpoint`)이나 서버 계약을 바꿔야 한다고 판단하면 그때 codex `adversarial-review`를 1회 돌린다.

## §2 파일 소유권

단일 세션이라 겹침은 코디네이터와만 있다.

- `e77-input` 소유: 웹 `src/components/DirectionsView.tsx`와 여정 입력 관련 컴포넌트·테스트(`src/components/__tests__/DirectionsJourney.test.tsx` 등), `src/lib/__tests__/e70-journey-wording-guard.test.ts`, `messages/*.json`의 `journey.*` 키, iOS `ios/Gildongmu/Directions/**`, `ios/i18n/ios-extra/*.json`의 journey 키, 생성물 `ios/Gildongmu/Resources/Localizable.xcstrings`·`ios/i18n/arg-order.json`, 필요 시 `android/i18n/android-extra`(지운 키를 안드로이드가 쓸 때만)·안드로이드 생성 strings, Kit 순수 판정 함수 추가분(`ios/GildongmuKit/Sources/**` 새 파일이면 `android/kit/mirrors/<그룹>.json` 등록 동반), E77 spec(새 파일), `docs/BACKLOG.md`의 **E77 절과 착수 순서 표의 E77 행만**, `CHANGELOG.md` 새 항목, `PROGRESS.md`의 여정 상태 줄.
- 코디네이터 소유: `docs/BACKLOG.md`의 E77 밖 전부(판정 진행), 이 계획 문서.
- 경계 인터페이스: 서버 `/api/route/journey`·`/api/route/journey/stops` 계약은 바꾸지 않는다(입력 UI만). 정류장 이름 검색은 기존 라우트를 그대로 부른다.

## §3 git 격리

저장소 정책: **main 직접 push**(gildongmu는 리뷰 통과 뒤 자동 commit+push, push = 웹 자동 배포). 스킬 `parallel-sessions` Claude 지침 §3 그대로: 고정 `base`로 rebase → 공유 문서 `comm -23` 대조(BACKLOG·CHANGELOG·PROGRESS) → 게이트(`gate-lock.py`) → `git push origin feat/e77-input:main && git -C ~/Mac-Projects/gildongmu pull --ff-only`. `--force` 금지, `git add -A` 금지.

## §4 웨이브

웨이브 1: `e77-input` 하나.

## §5 착수 프롬프트·보고

- 착수 프롬프트 사본: `~/.claude/parallel-sessions/gildongmu/e77-input.prompt.txt`
- 보고 디렉터리: `~/gildongmu-wt/e77-input-reports/`
