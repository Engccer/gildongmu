# 백로그 7차 소화: 병렬 세션 계획 (2026-09-30)

코디네이터 `gildongmu-68 [5dfd95]`. 절차 정본은 `parallel-sessions` 스킬(Claude Code 분기). 이 문서가 세션 착수 프롬프트보다 상세하고 우선한다. 위원장 판정의 정본은 `docs/BACKLOG.md`의 각 항목이다.

## 0. 전제 (관측 시점: `c964a916`, 2026-09-30)

- **push 동결은 끝났다**(2026-09-29). 통합은 `origin/main`으로 ff push이고 push는 곧 웹 프로덕션 자동 배포다(Vercel, 스킵 규칙 없음 — `vercel.json`에 `ignoreCommand` 없음을 확인).
- **iOS 1.18이 스토어에 있고(`edc8cbdc`) 1.19가 심사 대기 중이다(`5c3bf9bf`, 빌드 28).** 서버 응답 모양을 바꾸는 push는 이 두 빌드와 안드로이드 배포본을 깨뜨리면 안 된다. 심사자는 1.19를 프로덕션 서버에 붙여 본다.
- **디스크 여유 약 8.7GB**(iOS 18.6 시뮬레이터 런타임을 위원장 승인으로 삭제한 뒤). 웨이브당 빌드 세션은 3개까지. 세션은 DerivedData·산출물을 늘리지 않고, 여유가 3GB 밑으로 내려가면 빌드를 멈추고 보고한다.
- 테스트 기준선은 `~/.claude/parallel-sessions/gildongmu/baseline-<base 12자리>.log`(`npm run test:run`).

## 1. 마일스톤·판정·모델 배정

| 세션 | 웨이브 | 항목 | 모델·노력 | 한 줄 |
|---|---|---|---|---|
| `walk-lines` | 1 | E52 | opus·high | 도보 조회 줄 구성: 최단 · 큰길(다를 때만) · 계단 회피(앞의 두 줄과 다른 길일 때만) |
| `tone-tick` | 1 | E55 | opus·high | 정지 tick을 도보·자동차 안내에서 없애고 그 소리를 나들이 10m 비프 전용으로 |
| `small-7` | 1 | A50 · A51 · E48 잔여 ⑤⑥ · E31 iOS 역이식 · PORTS 거리 반올림 | opus·medium | 소형 결함 묶음(웹·iOS·미러) |
| `doc-diet` | 1 | D28 | opus·medium | `CLAUDE.md` 절 단위 이관으로 예산 여유 확보 |
| `outing-1` | 2 | E54 | opus·medium | 나들이 실사용 피드백 셋 |
| `car-road` | 2 | E56 | opus·high | 자동차 안내 시트 첫 줄 "현재 도로, {도로 이름}" |
| `small-8` | 2 | A52 (+ 웨이브 1이 남긴 소형 인계분) | opus·medium | en 브리핑 마지막 도보 줄의 목적지 이름 |
| `bg-speech` | 3 | E53 | opus·high | 백그라운드 음성 안내 설정(실험판 먼저) |
| `doc-audit` | 끝 | 문서 만료 점검 | opus·medium | 전 웨이브 통합 뒤 새 창 |

서브에이전트 모델은 디스패치마다 명시한다: 리뷰어·감사는 `model: opus`, 적대적 설계 리뷰와 데이터 무결성 최종 검토만 `model: fable`(동시 하나, `name` 부여).

### 코디네이터 판정 (제품 판단이 아닌 설계 사항)

1. **`CLAUDE.md`는 이번 웨이브에서 `doc-diet`와 코디네이터만 고친다.** 여유가 1.7KB라 세션이 규칙을 더하면 예산 테스트(`claude-md-budget.test.ts`)가 깨지고, `sync_agent_docs.py`는 worktree에서 돌지 않는다. 작업 세션은 새 함정의 상세를 `docs/PATTERNS.md`·`docs/INTEGRATIONS.md`의 같은 제목 절에 직접 쓰고, `CLAUDE.md`에 들어갈 규칙 한두 줄과 고쳐야 할 기존 문장은 완료 보고의 "공유 자산 반영 요청"에 **문장 그대로** 적는다. 코디네이터가 `doc-diet` 통합 뒤 모아서 반영하고 `AGENTS.md`를 재생성한다.
2. **실기기 배포는 코디네이터가 웨이브 경계에서 메인 체크아웃으로 한다**(공식판·실험판 두 구성). 세션은 `deploy-device.sh`를 돌리지 않는다. 세션의 iOS 검증은 Kit `swift test`와 앱 타깃 빌드까지다.
3. **App Store 제출·npm 발행·안드로이드 배포는 이번 범위 밖**이다. 세션은 What's New에 적을 문장만 보고에 남긴다(E55는 정식판 사용자가 듣는 소리가 바뀐다).
4. **범위에서 뺀 것**: E47(ODsay 실호출은 비용) · N4 자동차 경유지·E45 웹 브리핑·E51 후속 ③④⑤(위원장 판정 선행) · B13(실보행 뒤) · E43 M4b 후속 둘(한소네 판정이 쌓여 있어 다음 회차) · 웹 전용 대기 묶음 · E14 ③·E15 ③(설계 선행). PORTS의 나머지 open 행(Live 모델·금기 어휘 가드·thinking 수준·llm-model-eval 안전 게이트 문구)은 "어휘·모델을 바꿀 때 함께"가 조건이라 이번에 소비하지 않는다.
5. `small-7`의 PORTS 거리 반올림은 **먼저 재는 일**이다: 웹·Kit·CLI·안드로이드 네 벌이 경계값(1150·1450·1650·1950m)에서 같은 문자열을 내는지 테스트로 확인하고, 어긋날 때만 정수 연산으로 고친다. 이미 같으면 경계값 케이스만 네 벌에 더하고 PORTS 행을 닫는다.

## 2. 파일 소유권 지도

술어는 "이름이 나오는가"가 아니라 "그 세션이 그 파일을 고쳐야 하는가"다. 아래는 코디네이터가 호출부를 열어 확인한 목록이고(관측 `c964a916`), 세션이 틀린 자리를 발견하면 보고한다(코디네이터가 재현해 정정 절을 단다).

### 웨이브 1

| 세션 | 소유 |
|---|---|
| `walk-lines` | `src/lib/walk-route.ts` · `walk-line.ts` · `src/app/api/route/walk/**` · `src/components/DirectionsView.tsx`의 도보 줄 영역과 `DirectionsWalkLines.test.tsx`·`DirectionsOrder.test.tsx` · `src/lib/webmcp/tools/{plan-directions,get-route-steps}.ts` · `src/lib/chat/router.ts`의 도보 경로 도구 자리 · `packages/cli`·`packages/mcp`의 route walk 자리 · `ios/Gildongmu/Directions/DirectionsTabView.swift`의 도보 줄 영역 · Kit `RouteService.swift`·`RouteModels.swift`의 도보 줄 타입 · 안드로이드 `directions/**`·`:kit` `RouteService.kt`·`RouteModels.kt`의 도보 줄 자리 · spec `2026-09-23-walk-two-lines-kakao-design.md` · `docs/INTEGRATIONS.md` §도보 경로 |
| `tone-tick` | `src/lib/guide-tone-layer.ts`·테스트 · `src/hooks/useBeaconSound.ts` · Kit `GuideToneLayer.swift`·`BeaconTones.swift`·해당 테스트 · `ios/Gildongmu/Directions/BeaconTonePlayer.swift` · `ios/Gildongmu/Resources/Sounds/**` · `OutingModel.swift`의 **비프 톤 한 자리만** · 안드로이드 `:kit` `GuideToneLayer.kt`·`BeaconTonesTest.kt`·해당 테스트 · 공유 fixture(톤 계층) · `sounds-drift.test.ts` · spec `2026-08-08-background-tone-coverage-design.md` · `docs/INTEGRATIONS.md` §실시간 길 안내의 톤 절 |
| `small-7` | `src/hooks/useTransitGuide.ts`·그 테스트(A50) · `ios/Gildongmu/SettingsView.swift`(A51) · `ios/Gildongmu/Directions/GuideOverviewSheet.swift`의 "다른 경로" 헤더 자리(E48 ⑤) · `TransitGuideModel.swift`의 `enterIdleIfDue`·`ridingPosition` 자리(E48 ⑥) · Kit `WalkHealth.swift`와 응답 표식을 지우는 자리(E31 역이식) · `src/lib/format.ts`·Kit `Format.swift`·CLI `dist()`·안드로이드 `Format.kt`와 각 테스트(PORTS) · 워크스페이스 `~/Mac-Projects/PORTS.md`의 해당 행(닫기는 보고로 요청, 코디네이터가 반영) |
| `doc-diet` | `CLAUDE.md` · 이관 대상 절이 가는 `docs/PATTERNS.md`·`docs/INTEGRATIONS.md`의 **같은 제목 절** · BACKLOG D28 행 |

**웨이브 1 경계**
- `BeaconModel.swift`·`useRouteGuide.ts`·`BeaconTrackingSheet.swift`·`OutingSheet.swift`는 웨이브 1에서 **아무도 고치지 않는다**(웨이브 2·3 소유). `tone-tick`이 그 파일의 주석이 낡는 것을 발견하면 고치지 말고 보고에 자리(함수 이름)를 적는다 — 웨이브 2·3 세션이 그 파일을 지날 때 함께 고친다.
- `RouteModels.swift`·`src/lib/types.ts`에서 웨이브 1은 도보 줄 타입만 만진다(자동차 스텝 필드는 웨이브 2 `car-road`).
- `DirectionsTabView.swift`·`DirectionsView.tsx`·`TransitRouteBriefing.tsx`의 대중교통 브리핑 자리는 웨이브 2 `small-8`(A52) 소유다. `walk-lines`는 도보 줄 영역만.

### 웨이브 2 (웨이브 1의 `tone-tick`·`walk-lines` 통합 뒤)

| 세션 | 소유 |
|---|---|
| `outing-1` | `OutingSheet.swift` · `OutingModel.swift`(E54 세 건의 자리) · `OutingOverviewAdapter.swift` · Kit `OutingLandmark.swift`(`OutingNarration`)·`OutingDistanceTone.swift`의 표시 양자화 · 띠바의 나들이 거리 표시 자리 · spec `2026-09-26-outing-mode-design.md` §8 |
| `car-road` | 서버 자동차 경로(`tmap-car.ts`·`car-route.ts`·`src/lib/types.ts`의 자동차 스텝 필드·`/api/route/car`) · `useRouteGuide.ts`의 `currentDisplay` 자리와 웹 자동차 안내 화면 · Kit `RouteModels.swift`의 자동차 스텝 필드 · `BeaconModel.swift`의 `currentGuidanceText` 자리 · `BeaconTrackingSheet.swift`의 상세 분기 세 줄 · `docs/INTEGRATIONS.md` §자동차 경로 |
| `small-8` | `ios/Gildongmu/RouteBriefing.swift` · `DirectionsTabView.swift`·`GuideOverviewSheet.swift`의 브리핑 호출 자리 · `TransitRouteBriefing.tsx`·`DirectionsView.tsx`의 `legWalkToDest` 자리 · WebMCP 브리핑 출력 자리 |

### 웨이브 3 (웨이브 2 전부 통합 뒤)

| 세션 | 소유 |
|---|---|
| `bg-speech` | `BeaconModel.swift`·`TransitGuideModel.swift`·`OutingModel.swift`의 `post`·발화 창구 · `TtsPlayer.swift` · 공유 대기 칸이 올라갈 자리(신설 파일 가능) · `SettingsView.swift`의 토글 행 · `AppConfig` 실험 게이트 · 새 spec · `docs/INTEGRATIONS.md` §실시간 길 안내의 백그라운드 절 |

### 공용 생성물·공유 문서 규약

- `messages/*.json`(6로케일)은 **자기 키만** 더하고 고친다. `Localizable.xcstrings`·`ios/i18n/arg-order.json`·안드로이드 strings는 생성물이라 rebase 뒤 재생성하고 손으로 병합하지 않는다.
- `project.pbxproj`는 새 파일을 더할 때만, 객체 ID는 파일 전체에서 유일하게(`xcodebuild -list`로 검증). Kit 파일을 추가·개명·삭제하면 `android/kit/mirrors/<그룹>.json`을 함께 고친다.
- `CHANGELOG.md`·`docs/BACKLOG.md`·`PROGRESS.md`·`docs/FIELD-TEST.md`는 자기 항목·자기 줄만. rebase 뒤 `comm -23`(그리고 상대가 절을 지웠으면 `comm -13`) 대조를 고친 문서마다 돌린다.
- `CLAUDE.md`는 §1 판정 1대로 세션이 고치지 않는다.

## 3. git 절차 (저장소 정책: main 직접 push)

```bash
cd ~/gildongmu-wt/<이름>            # worktree·node_modules·.env.local은 이미 있다(npm install 금지)
# 작업: 자기 브랜치 feat/<이름>에만, pathspec 커밋(git add -A 금지), 커밋 이메일 engccer@gmail.com
git fetch origin && base=$(git rev-parse origin/main) && git rebase "${base}" && echo "${base}" > ~/gildongmu-wt/<이름>-reports/base.sha
comm -23 <(git show "${base}:CHANGELOG.md" | sort) <(sort CHANGELOG.md)   # 고친 공유 문서마다, 중괄호 필수
# 생성물 재생성 → 게이트(gate-lock.py) → push
git push origin feat/<이름>:main && git -C ~/Mac-Projects/gildongmu pull --ff-only
```

- push가 거부되면 `--force` 없이 fetch부터 다시. rebase 뒤에는 게이트를 다시 돌린다.
- 무거운 게이트(`test:run`·`tsc`·`build`·`swift test`·`xcodebuild`·gradle·playwright)는 `VITEST_MAX_WORKERS=2 python3 ~/.claude/skills/parallel-sessions/scripts/gate-lock.py <이름> -- <명령>`으로 감싼다(머신 전체에서 한 번에 하나).
- 리뷰 전에 전부 커밋하고 리뷰어는 `git diff origin/main...HEAD`(3점)로 읽는다. 리뷰가 도는 동안 rebase·커밋 금지. 리뷰 보고는 worktree 밖 `~/gildongmu-wt/<이름>-reports/`에 파일로 받는다.
- 통합을 마치면 worktree의 빌드 산출물(DerivedData·`.build`·gradle `build/`)을 지운다. worktree 제거와 창 닫기는 코디네이터가 한다.

## 4. 웨이브

1. **웨이브 1**: `walk-lines` · `tone-tick` · `small-7` · `doc-diet`.
2. **웨이브 2**: `outing-1` · `car-road` · `small-8`. 조건: `tone-tick`·`walk-lines` 통합(`small-8`은 `walk-lines`만, `outing-1`은 `tone-tick`만 기다린다).
3. **웨이브 3**: `bg-speech`. 조건: 웨이브 2 전부 통합과 `small-7` 통합.
4. **끝**: 코디네이터의 `CLAUDE.md` 반영·실기기 배포 → `doc-audit` 새 창.

## 5. 착수 프롬프트·보고 경로

- 프롬프트 사본: `~/.claude/parallel-sessions/gildongmu/<이름>.prompt.txt`(공통 계약 `_common-w7.txt` + 세션별 과제).
- 보고 디렉터리: `~/gildongmu-wt/<이름>-reports/`(`<단계>-<YYYYmmddHHMM>.md`, 단계 = start·integrating·done·blocked·judgment, 매번 새 파일).
- 코디네이터 주소: `gildongmu-68 [5dfd95]`.
