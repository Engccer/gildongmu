# 백로그 13차 소화: 병렬 세션 계획 (2026-10-19)

코디네이터 `gildongmu-60 [d474b1]`. 절차 정본은 `parallel-sessions` 스킬(Claude Code 분기). 이 문서가 세션 착수 프롬프트보다 상세하고 우선한다. 위원장 판정의 정본은 `docs/BACKLOG.md`의 각 항목이다. 위원장 지시(2026-10-19): "백로그 처리하자. 병렬로 할지 서브에이전트로 할지 변경 규모 판단해서 합리적인 방법으로 진행해 줘."

설계 리뷰 판정: 계획 문서라 적대적 설계 리뷰 대상이 아니다. 각 세션의 spec이 리뷰 게이트 판정을 스스로 남긴다(§1 표의 "설계 리뷰" 열).

## 0. 전제 (관측 시점: 이 문서를 담은 커밋, 2026-10-19)

- **push 동결 없음.** iOS 2.2(빌드 33, 아카이브 `bfa494eb`)는 `WAITING_FOR_REVIEW`이고 심사 대상 바이너리는 이미 굳었다. 통합은 `origin/main`으로 ff push이고 push는 곧 웹 프로덕션 자동 배포다(Vercel).
- 메모리 여유 75%, 스왑 0, 디스크 여유 656GB, 부팅된 시뮬레이터 1(iPhone 17, iOS 27.0).
- 테스트 기준선은 `~/.claude/parallel-sessions/gildongmu/baseline-<base 12자리>.log`(`npm run test:run`). 각 세션 보고 디렉터리의 `base.sha`가 base 값을 든다.
- 세 벌 미러(웹·Kit·`:kit`)와 공유 fixture는 고치는 세션이 같은 커밋에서 맞춘다. Kit에 파일을 추가·개명·삭제하면 `android/kit/mirrors/<그룹>.json`을 함께 고친다.
- iOS 프로젝트는 파일 시스템 동기 그룹이라 새 Swift 파일을 더해도 `project.pbxproj`를 고치지 않는다.
- **공개 저장소 규율**: A70 실보행의 목적지는 지인 댁이다(위원장 확인 2026-10-19). 이 문서를 담은 커밋이 BACKLOG A70에서 이름·출발 좌표를 지웠고, 저장소 밖 가드(`~/gildongmu-private/privacy-guard.json`)에 그 자리의 좌표 중심과 이름을 더했다. 세션은 로그 속 실좌표·장소명을 spec·테스트·커밋에 싣지 않고 합성 좌표를 쓴다.

## 1. 마일스톤·판정·모델 배정

BACKLOG에서 "착수 가능"으로 열린 항목 전부(2026-10-18 등재 4건). E71·E72 웹·안드로이드·E70-e는 앞선 실기기·실차 판정이 선행이라 이번 범위 밖이다.

| 웨이브 | 세션 | 항목 | 모델·노력 | 설계 리뷰 | 한 줄 |
|---|---|---|---|---|---|
| 1 | `a70-reroute` | A70 C 세 층 | `opus[1m]`·high | 한다(새 판정 자격 `far`·도착 창 두 번째 입구 = 상태 머신, 서버 응답 계약 추가) | 서버 출발점 스냅 재시도 + additive 거리 · 앱 채택 검사(웹·iOS·안드로이드) + 시작 고지 · 리듀서 `far` 자격과 이탈 중 도착 창(웹·Kit·`:kit`) |
| 1 | `a69-bus-alight` | A69 둘 다 | opus·medium | 한다(E48 "기기 위치는 표시 전용" 가드의 의도된 예외) | 「다음 정류장 {하차 정류장}에서 내리세요.」 세 플랫폼 문자열 · GPS 하차 정류장 50m 관측 시 한 마디(iOS 먼저, 웹·안드로이드 같은 규칙) |
| 2 | `e74-title-actions` | E74 | opus·medium | 생략(실험판 봉인 뒤 UI 재배치, 판정이 이미 확정) | 안내 시트 제목 행 밀기 동작 + 「현재 경로와 다른 길로 가기」, `experimentalGuideTitleActionsEnabled` |
| 2 | `e73-transfer-walk` | E73 | opus·high | 한다(대중교통 세션 ↔ 도보 세션 인계 = 상태 머신) | 탑승 구간 사이 30m 이상 환승 도보에 A25 승차 전 도보 기제 |

서브에이전트 모델은 디스패치마다 명시한다: 리뷰어·감사 `model: opus`, 안전·데이터 무결성 최종 검토만 `model: fable`(동시 하나), 할 일이 정해진 구현·이식·탐색 `model: sonnet`(미러 이식은 웹 기준본 확정 뒤 과제 단위로). 적대적 설계 리뷰는 codex `adversarial-review`, 실패 신호면 `model: fable` 서브에이전트.

### 코디네이터 판정 (제품 판단이 아닌 설계 사항)

1. **웨이브를 둘로 가른 근거는 파일 겹침이다**(호출 기준으로 확인). A70 ②(`BeaconModel.fetchProposal` 채택 검사)와 E74 ①(같은 `fetchProposal`을 사용자 선언으로 부름)이 `ios/Gildongmu/Directions/BeaconModel.swift`를 함께 고치고, E74는 A70의 새 채택 검사를 그대로 지나야 한다. A69 ②(버스 정류장 추적기에서 문장)와 E73(`legAdvanced` 인계)이 `ios/Gildongmu/Directions/TransitGuideModel.swift`를 함께 고친다. 그래서 E74는 A70 통합 뒤, E73은 A69 통합 뒤에 띄운다. 짝이 다른 둘(A70·A69, E74·E73)은 동시에 돈다.
2. **A70 서버 층 문턱은 판정대로 50m 착수 기본값**이고 세션이 실호출 분포를 보고 조정할 수 있다(근거를 spec에). Tmap 재시도는 무료 한도(일 1,000건, 자동차와 공유) 안이고 실호출 검증은 세션 전체 30건 이하, ODsay 호출 0. 넘겨야 하면 멈추고 `judgment-*.md`.
3. **A70 `far` 자격의 자동차 값은 세션이 정한다**(판정이 위임). 근거를 spec에 적고 실주행 판정 대상으로 BACKLOG §2에 행을 남긴다.
4. **A69 ②의 웹·안드로이드**: 같은 추적기가 그 플랫폼에 없으면 만들지 않고 "추적기 없음, 규칙만 대기"를 BACKLOG에 적는다(새 위치 추적 도입은 이번 범위 밖).
5. **`CLAUDE.md`는 코디네이터만 고친다**(77.4KB/80KB, 여유 2.6KB). 세션은 상세를 `docs/PATTERNS.md`·`docs/INTEGRATIONS.md`의 같은 제목 절에 쓰고, `CLAUDE.md`에 들어갈 한두 줄은 완료 보고의 "공유 자산 반영 요청"에 문장 그대로 적는다. 여유가 작으니 새 줄보다 기존 줄 교체를 먼저 제안한다.
6. **실기기 배포는 코디네이터가 전 세션 통합 뒤 메인 체크아웃에서 한다**(공식판·실험판 두 구성). 세션은 `deploy-device.sh`를 돌리지 않는다. 세션의 iOS 검증은 Kit `swift test`와 앱 타깃 빌드(Release·Experimental 두 구성)까지다.
7. **App Store 제출·npm 발행·안드로이드 배포는 범위 밖.** 릴리스 노트 후보 문장은 보고에만.

## 2. 파일 소유권 지도

| 세션 | 소유 |
|---|---|
| `a70-reroute` | 서버 `src/lib/walk-route.ts`·`src/lib/car-route.ts`(같은 문턱을 자동차에 둘지 세션 판단)·`src/app/api/route/walk/route.ts`·관련 provider 호출부 · 웹 `src/lib/route-guide.ts`·`src/lib/reroute-proposal-gate.ts`·`src/hooks/useRouteGuide.ts`와 도착 창 판정 lib · Kit `RouteGuide.swift`·도착 창·`routeOriginStep` 자리와 그 테스트·공유 fixture · `:kit` `RouteGuide.kt`와 미러 · iOS `BeaconModel.swift` · 안드로이드 `guide/WalkGuideModel.kt` · 새 문자열 키(`messages`·`ios-extra`·안드로이드 `android-extra`의 자기 키) · `docs/INTEGRATIONS.md` §이탈은 돌아가기 국면의 시작이다 · BACKLOG A70·FIELD-TEST·CHANGELOG·PROGRESS 자기 자리 |
| `a69-bus-alight` | 문자열 `transitGuide.arrivingAtAlightStop`(6로케일 `messages`, iOS·안드로이드 생성물) + 새 GPS 도착 키 · `src/lib/transit-guide.ts`·`src/hooks/useTransitGuide.ts`의 그 문장 자리 · Kit `TransitGuide.swift`·`TransitBusStop.swift`·`GuideSpeechChannel.swift`의 그 자리 · `transit-guide-text-cases.json` · iOS `TransitGuideModel.swift` · `:kit` `TransitGuide.kt` · 안드로이드 대중교통 문장 자리 · `transit-bus-stop-guard.test.ts` 허용 목록 · `docs/INTEGRATIONS.md` 해당 절 · BACKLOG A69·FIELD-TEST·CHANGELOG·PROGRESS 자기 자리 |
| `e74-title-actions` (웨이브 2) | `GuideTitleMenu.swift`·`BeaconTrackingSheet.swift`·`TransitTrackingSheet.swift`·`OutingSheet.swift`의 제목 행 자리 · `BeaconModel.swift`(「다른 길로 가기」 진입점) · `AppConfig.swift` 새 게이트 · `ios-extra` 자기 키(`ios.guide.waypointChange` 문안 포함) · `guidance-gate-drift.test.ts`류 가드 · `docs/PATTERNS.md` 해당 절 · BACKLOG E74·CHANGELOG·PROGRESS 자기 자리 |
| `e73-transfer-walk` (웨이브 2) | `TransitGuideModel.swift`(`legAdvanced` 인계) · `GuideSessionCoordinator.swift` · `BeaconModel.swift`의 `markPrewalk` 자리 · Kit 대중교통 안내 도보 인계 판정 · 자기 문자열 키 · `docs/INTEGRATIONS.md` 승차 전 도보 절 · BACKLOG E73·FIELD-TEST·CHANGELOG·PROGRESS 자기 자리 |

**경계**

- 웨이브 1의 두 세션은 같은 iOS 파일을 고치지 않는다. 공용 생성물만 겹친다: `Localizable.xcstrings`·`ios/i18n/arg-order.json`·`android/i18n/arg-order.json`·안드로이드 `strings.xml`·`android/kit/mirrors/*.json`. 원천(`messages`·`ios-extra`·`android-extra`)은 자기 키만 고치고 생성물은 rebase 뒤 재생성한다(손 병합 금지).
- 웨이브 2의 `e74-title-actions`와 `e73-transfer-walk`는 `BeaconModel.swift`를 서로 다른 자리(E74는 재조회 진입점, E73은 `markPrewalk`)에서 고친다. 뒤에 통합하는 쪽이 rebase 충돌을 풀고 앱 빌드 두 구성을 다시 돌린다.
- `CHANGELOG.md`·`docs/BACKLOG.md`·`PROGRESS.md`·`docs/FIELD-TEST.md`는 자기 항목만, rebase 뒤 `comm` 대조.

**통합 순서**: 웨이브 안에서는 준비된 순서대로. 웨이브 2 세션의 base는 짝 세션(E74 ← A70, E73 ← A69)의 통합 SHA 이후다.

## 3. git 격리 절차 (main 직접 push)

```bash
# worktree·node_modules·.env.local은 코디네이터가 미리 만든다(npm install 금지)
cd ~/gildongmu-wt/<이름>            # 브랜치 feat/<이름>, origin/main base
# 작업: 자기 브랜치에만, pathspec 커밋(git add -A 금지)
# 통합(리뷰와 게이트를 통과한 뒤):
git fetch origin && base=$(git rev-parse origin/main) && git rebase "${base}" && echo "${base}" > ~/gildongmu-wt/<이름>-reports/base.sha
comm -23 <(git show "${base}:CHANGELOG.md" | sort) <(sort CHANGELOG.md)   # 고친 공유 문서마다, 중괄호 필수
comm -13 <(git show "${base}:CHANGELOG.md" | sort) <(sort CHANGELOG.md)   # 되살림 대조
# 생성물 재생성 → 게이트(gate-lock.py) → push
git push origin feat/<이름>:main && git -C ~/Mac-Projects/gildongmu pull --ff-only
```

- `base`는 셸 변수라 같은 명령 안에서만 산다. 호출을 나누면 `base.sha` 파일에서 읽는다.
- `--force` 금지. push가 거부되면 fetch·rebase·대조·게이트부터 다시.
- 무거운 게이트(`test:run`·`tsc`·`build`·`swift test`·`xcodebuild`·gradle·playwright)는 `VITEST_MAX_WORKERS=2 python3 ~/.claude/skills/parallel-sessions/scripts/gate-lock.py <이름> -- <명령>`으로 감싼다(머신 전체 한 번에 하나).
- xcodebuild는 `-derivedDataPath ~/gildongmu-wt/<이름>-dd`. 앱 타깃 빌드는 통합 직전에 돌리고 성공을 확인하면 그 폴더를 바로 지운다. 통합 뒤 `ios/GildongmuKit/.build`·`android/*/build`도 지운다. 시뮬레이터 UI 실측이 필요하면 이미 부팅된 하나를 쓰고 새로 부팅하지 않는다.
- 리뷰 전에 전부 커밋하고 리뷰어는 `git diff origin/main...HEAD`(3점)로 읽는다. 리뷰가 도는 동안 rebase·커밋 금지. 리뷰 보고는 `~/gildongmu-wt/<이름>-reports/review-<주제>-<YYYYmmddHHMM>.md`.
- 실기기 배포·App Store 제출·npm 발행·`vercel` 수동 배포·env 변경·유료 API 대량 호출 금지(A70 실호출 상한은 §1 판정 2).
- 공개 저장소 규율: 자택·지인 주택 근처 실주소·상호·정류소, 위원장 실조회 구간의 실좌표·장소명을 spec·테스트·커밋에 싣지 않는다(`public-repo-privacy-guard.test.ts`, `.githooks/pre-commit`).
- 워크스페이스 상위 `.claude/agents/a11y-auditor.md`는 worktree 세션에 실리지 않는다: 그 파일을 Read해 지시를 준 `model: opus` 범용 에이전트로 대신한다.

## 4. 웨이브

1. **웨이브 1**: `a70-reroute` · `a69-bus-alight` 동시.
2. **웨이브 2**: `a70-reroute` 통합 → `e74-title-actions`, `a69-bus-alight` 통합 → `e73-transfer-walk`(각각 짝이 통합되는 즉시, 서로 기다리지 않는다).
3. **통합 뒤** 코디네이터가 `CLAUDE.md` 반영, 메인 체크아웃에서 실기기 두 구성 설치.
4. **끝**: `doc-audit` 새 창(SessionStart 신호의 미구현 심볼 3개 `experimentalGuideTitleActionsEnabled`·`rerouteFarM`·`rerouteFarS`는 이 웨이브가 코드에 넣으면 해소된다).

## 5. 착수 프롬프트와 보고 경로

사본 `~/.claude/parallel-sessions/gildongmu/<이름>.prompt.txt`, 보고 `~/gildongmu-wt/<이름>-reports/`(단계별 새 파일 `start`·`integrating`·`done`·`blocked`·`judgment` + `-<YYYYmmddHHMM>.md`, 리뷰 `review-*`, `base.sha`). 보고는 파일과 `SendMessage` 둘 다. **위원장에게 직접 묻지 않는다**: 판정이 필요하면 `judgment-*.md`에 쉬운 한국어로 질문·선택지·각 선택지에서 위원장이 듣게 될 문장을 적어 통보하고, 기본값으로 진행할 수 있으면 진행한다. 코디네이터가 위원장에게 묻고 답을 전한다.

## 6. 정정 (코디네이터가 재현해 확인한 것)

- **위원장 지시(2026-10-19 06:10)**: A70 지인 댁 문장이 남은 옛 커밋(`d1ee1098`)의 히스토리 재작성과 강제 push를 필요한 시점에 묻지 않고 진행한다. **시점은 전 세션·doc-audit 종료 뒤**(도는 worktree가 있으면 그 세션들의 base가 사라진다). 절차는 `~/gildongmu-private/sanitize-2026-10/`(2026-10-04 선례): `git filter-repo --replace-text`로 그 두 문장만 치환 → 트리 대조(HEAD 트리 동일) → `--force-with-lease` → 문서 속 커밋 번호를 옛→새 대응표로 갱신(`fix_sha_citations.py`) → Windows 클론 재동기화 안내.
- **06:35, 관측 `4a400d37`: `a69-bus-alight` 종료.** 판정 둘 반영(웹·iOS 문장 + GPS 한 마디 `busAlightNoticeStep`, 안드로이드는 문장만이고 추적기 없음 → BACKLOG "규칙만 대기"). 게이트 전부 통과, 실호출 0. 소유 밖 신고 `transit-text-args.ts`·`TransitGuideTextRenderer.swift`(새 키 배선, 필수)·주석 3곳·`mirrors/guide.json` 메모: 수용. CLAUDE.md A41 줄을 요청 문장으로 교체. 창·worktree·브랜치 정리.
- **위원장 판정 A70 Q1~Q4(06:25)**: 전부 기본값(서버 재시도 오늘부터 정식판 · 시작 문장 방향+거리 · 버튼 재조회는 받고 알림 · 「목적지 근처입니다」→15m 도착).
- **06:40: `e73-transfer-walk` 착수**(opus·high, base `4a400d37`).
- **07:22, 관측 `6e31d805`: `a70-reroute` 종료(DONE_WITH_CONCERNS).** 세 층 반영, 서버 문턱은 실측(정상 경로 95% 40.7m 이하)으로 30m(앱 채택 문턱과 같게), 자동차 `far` 400m·60초, 실호출 29건(카카오 17·Tmap 12, ODsay 0), 프로덕션 사고 경로 첫 점 236.6m → 6.0m. CLAUDE.md 이탈 줄 교체·도보 경로 카탈로그 행 보강 반영.
- **07:34, 관측 `d36ee4df`: `e73-transfer-walk` 종료.** 환승 도보 30m 이상이면 A25 기제로 도보 → 같은 경로 대기 국면 복귀. 웹은 B14 플랫폼 갭으로 등재.
- **10:06, 관측 `49c1abc0`: `e74-title-actions` 종료.** 실험판 제목 행 밀기 동작·「다른 길로 가기」. 소유 밖 신고 가드 두 개 정규식 갱신(의도 불변) 수용. CLAUDE.md 플래그 목록·제목 행 한 줄 반영(78.5KB/80KB). 졸업 문턱: 제목 행 안 접근성 객체 둘(제목·접기 버튼)에 VoiceOver 동작이 어디 붙는지 실기기 미관측.
- **위원장 판정(10:20)**: E73 [안내 종료] 둘 다 끝냄(현행) · 시작 문장 기존 문장(현행) · **E73 걷는 중 위치 권한 상실 → 걷기만 끝내고 승차 대기로(변경)** · A70 도보 도착 정확도 상한 50m(현행) · E74 접수 문장 「경로를 조회하고 있습니다」(현행) · E74 대중교통 동작 둘(ODsay 경유역 불가, 현행) · **E74 직접 누른 실패 문장 「새 경로를 찾지 못했습니다.」(변경, 자동 재조회 실패 문장은 그대로)**. 변경 둘은 후속 세션 `small-19`.
