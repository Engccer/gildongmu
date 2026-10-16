# 백로그 11차 소화: 병렬 세션 계획 (2026-10-17)

코디네이터 `gildongmu-f4 [d7e740]`. 절차 정본은 `parallel-sessions` 스킬(Claude Code 분기). 이 문서가 세션 착수 프롬프트보다 상세하고 우선한다. 위원장 판정의 정본은 `docs/BACKLOG.md`의 각 항목이다(2026-10-17 접수 세션에서 판정 완료).

설계 리뷰 판정: 계획 문서라 적대적 설계 리뷰 대상이 아니다(새 불변식은 각 세션 spec이 판정한다).

## 0. 전제 (관측 시점: `d3f073ef`, 2026-10-17)

- **push 동결 없음.** 통합은 `origin/main`으로 ff push이고 push는 곧 웹 프로덕션 자동 배포다(Vercel).
- 디스크 여유 681GB, 스왑 0, 부팅된 시뮬레이터 0. 다른 claude 세션 `gildongmu-stats-53`(통계 회차, 이 계획과 무관)이 돌고 있다: 그 세션이 main에 문서 커밋을 낼 수 있으므로 push 전 rebase는 늘 한다.
- 테스트 기준선은 `~/.claude/parallel-sessions/gildongmu/baseline-<base 12자리>.log`(`npm run test:run`). base는 이 문서를 담은 커밋이고 각 세션 보고 디렉터리의 `base.sha`가 그 값을 든다.
- 웹·Kit(`ios/GildongmuKit`)·안드로이드 `:kit` 세 벌 미러와 공유 fixture는 **고치는 세션이 같은 커밋에서 세 벌을 맞춘다**. Kit에 파일을 추가·개명·삭제하면 `android/kit/mirrors/<그룹>.json`을 함께 고친다(`android/README.md` §5).
- iOS 프로젝트는 파일 시스템 동기 그룹이라 새 Swift 파일을 더해도 `project.pbxproj`를 고치지 않는다.

## 1. 마일스톤·판정·모델 배정

| 세션 | 웨이브 | 항목 | 모델·노력 | 한 줄 |
|---|---|---|---|---|
| `ios-rotor` | 1 | E72 · A64 | opus·high | 로터 동작을 화면 버튼으로(장소 목록 밀기 버튼·딥링크 제외·줄 안 대상 이름만 링크·채팅 통일) + 내 주변 목록 복귀 재조회 생략을 `NearbyLoadCore` 층으로. iOS만 |
| `car-via` | 1 | N4 자동차 경유지 접근 예고 | opus·high | 자동차 안내에서 경유지 약 1분 전 한 번 "경유지 {label}까지 {distance}". 리듀서 웹 ↔ Kit ↔ `:kit` 미러 + 공유 fixture, iOS `BeaconModel` 소비 |
| `e70-design` | 1 | E70 설계 선행 | opus·high | ODsay `maasRP` 조사(실호출 상한 10건) → E70 첫 판 spec(판정 7~11 반영, 열린 판정은 위원장 문답). 코드 구현 없음 |
| `doc-audit` | 끝 | 문서 만료 점검 | opus·medium | 전 세션 통합 뒤 새 창(SessionStart `[doc-audit]` 보고: BACKLOG E72 앵커 깨짐·`maasRP` 심볼) |

서브에이전트 모델은 디스패치마다 명시한다: 리뷰어·감사는 `model: opus`, 데이터 무결성·안전 최종 검토만 `model: fable`(동시 하나, `name` 부여), 할 일이 정해진 구현·이식·탐색은 `model: sonnet`(웹 기준본을 확정한 뒤 Kit·`:kit` 미러 이식을 과제 단위로 맡긴다. 산출은 게이트 종료 코드와 그 뒤의 opus 리뷰로 받는다). 적대적 설계 리뷰는 codex `adversarial-review`(스킬 §1-1 명령), 실패 신호면 `model: fable` 서브에이전트.

### 코디네이터 판정 (제품 판단이 아닌 설계 사항)

1. **A64와 E72는 한 세션이다.** 둘 다 `AroundNearbyView.swift`·`SurroundingsSceneSection.swift`·`SubwayNearbyView.swift`를 고친다(A64는 복귀 재조회 생략을 화면별 `skipReloadOnReturn`에서 `NearbyLoadCore` 층으로 옮기고, E72는 같은 화면의 로터 동작을 밀기 버튼·링크로 바꾼다). 순서는 A64 먼저(Kit 순수 층 + 테스트, 작은 커밋), 그 위에 E72.
2. **E70 설계는 작업 세션이다**(코디네이터 창에서 하지 않는다: 코디네이터는 코드·spec을 쓰지 않고 중계만 한다는 스킬 규칙. 위원장 선택지에는 "이 창에서"로 적혀 있었으나 같은 일을 별도 창에서 한다).
3. **`CLAUDE.md`는 코디네이터만 고친다**(현재 75KB/80KB). 세션은 새 함정의 상세를 `docs/PATTERNS.md`·`docs/INTEGRATIONS.md`의 같은 제목 절에 쓰고, `CLAUDE.md`에 들어갈 규칙 한두 줄과 낡게 된 기존 문장은 완료 보고의 "공유 자산 반영 요청"에 문장 그대로 적는다. 이번 회차에 낡는 줄: 「채팅 산문 블록은 언제나 한 접근성 객체이고, 장소 언급 수로 활성화 방식만 가른다(1개=블록 버튼…)」(E72 규칙 4), 「내 주변 탭 로터 액션은 기존 판별선을 재사용한다(E65…)」, 「경로 브리핑의 역 진입점은 이름 조인이고 줄은 전부 `Text`로 남는다(E45…진입은 로터뿐)」(E72 규칙 3), 「딥링크는 장소 상세의 보조 출구」(E72 규칙 2와 정합 확인), 자동차 안내 줄(N4).
4. **E72의 웹·안드로이드는 범위 밖**(위원장 판정: iOS 실기기 판정 뒤). 다만 Kit을 고친 세션은 공유 fixture와 미러 등록부 게이트가 요구하는 만큼 `:kit`을 맞춘다.
5. **N4의 범위**: 웹 `carGuideStartable`의 경유지 차단은 그대로 둔다(위원장 판정: 웹 실시간 안내 묶음과 함께). 웹 리듀서는 미러로 고치고 fixture로 검증하되 웹 화면 배선은 바꾸지 않는다. 안드로이드는 자동차 안내가 없으므로 `:kit` 리듀서 미러와 fixture 정합까지만.
6. **실기기 배포는 코디네이터가 전 세션 통합 뒤 메인 체크아웃에서 한다**(공식판·실험판 두 구성). 세션은 `deploy-device.sh`를 돌리지 않는다. 세션의 iOS 검증은 Kit `swift test`와 앱 타깃 빌드(Release·Experimental 두 구성)까지다.
7. **App Store 제출·npm 발행·안드로이드 배포는 범위 밖.** 세션은 What's New에 적을 문장만 보고에 남긴다.
8. **E70의 ODsay 실호출은 세션 전체 10건 상한**(Flex 건당 약 27원, 위원장 판정 "실호출은 `--out` 저장 표본 몇 건으로"). 응답은 저장하고 재분석은 저장본으로 한다. 10건을 넘겨야 하면 멈추고 `judgment-*.md`로 묻는다. 카카오·Tmap 실호출은 무료 한도 안에서 필요한 만큼만, 건수를 보고에 적는다.

## 2. 파일 소유권 지도

술어는 "그 세션이 그 파일을 고쳐야 하는가"다(관측 `d3f073ef`, 함수 자리를 코디네이터가 열어 확인). 세션이 틀린 자리를 발견하면 보고한다(코디네이터가 재현해 §6에 정정 절을 단다). 큰 파일은 소유 단위가 함수·영역이다.

| 세션 | 소유 |
|---|---|
| `ios-rotor` | Kit `NearbyLoadCore.swift`·`NearbyLoadCoreTests.swift`(복귀 재조회 생략, 필요하면 `:kit` 미러) · iOS `Nearby/` 화면 전부(`SubwayNearbyView`의 `skipReloadOnReturn` 이관, `BusNearbyView`·`AroundNearbyView`·`SurroundingsSceneSection`의 복귀와 로터 동작) · `SearchView.swift`의 `PlaceRowActions`·`placeRowActions`와 `PlaceRow` · `KidsNearbyView`·`BarrierFreeNearbyView`의 행 동작 · `RouteBriefing.swift`의 역 이름 진입점과 Kit `TransitBriefingStations.swift`(필요할 때) · `DirectionsTabView.swift`의 `stationEntry` 소비 자리만 · `Chat/ChatConversationView.swift`와 산문 블록 렌더의 장소 링크 자리 · `docs/PATTERNS.md`의 로터·채팅 산문 절 · BACKLOG E72·A64 항목 · spec `docs/superpowers/specs/2026-10-17-e72-*`(새 파일) |
| `car-via` | 웹 `src/lib/route-guide.ts`의 자동차 튜닝·경유지 접근 판정 자리와 `route-guide.test.ts` · 공유 fixture `src/lib/__tests__/fixtures/route-guide-scenarios.json`(자동차 경유지 시나리오 추가) · Kit `RouteGuide.swift`·`RouteGuideTests.swift` · `:kit` `RouteGuide.kt`·`RouteGuideTest.kt` · iOS `Directions/BeaconModel.swift`의 경유지 접근 통지 소비 자리(자동차 경로) · `docs/INTEGRATIONS.md` 자동차 경로·경유지 절 · BACKLOG N4 항목 · spec(새 파일, 필요하면) |
| `e70-design` | `docs/superpowers/specs/2026-10-17-e70-*`(새 파일) · `docs/research/RESEARCH-2026-10-17-e70-maasrp-probe.md`(새 파일) · `scripts/probe-odsay-maas.*`(새 파일) · 저장 응답은 저장소 밖 `~/gildongmu-wt/e70-design-reports/` · BACKLOG E70·E47 항목 |

**경계**

- `BeaconModel.swift`는 `car-via` 소유다. `ios-rotor`는 고치지 않는다. 안내 판정 계층(리듀서 세 벌)도 `car-via` 단독이다.
- `DirectionsTabView.swift`는 `ios-rotor`가 `stationEntry`/브리핑 역 진입 자리만 고친다. `car-via`는 경유지 조회·안내 시작 배선을 바꾸지 않는다(필요하면 보고).
- `ios/Gildongmu/Resources/Localizable.xcstrings`·`messages/*.json`·`ios/i18n/ios-extra/*.json`은 자기 키만. 생성물(xcstrings·`ios/i18n/arg-order.json`·안드로이드 strings와 `android/i18n/arg-order.json`·`android/kit/mirrors/*.json`)은 rebase 뒤 재생성하고 손으로 병합하지 않는다. N4의 문장 "경유지 {label}까지 {distance}"는 **도보 N4 진행 표시에 이미 있는 키를 그대로 쓴다**(새 키 금지, 문장이 다르게 필요하면 보고).
- `CHANGELOG.md`·`docs/BACKLOG.md`·`PROGRESS.md`는 자기 항목만, rebase 뒤 `comm` 대조.
- 뒤에 통합하는 세션은 rebase 뒤 게이트(웹·Kit·`:kit`·앱 빌드 중 자기가 만진 층)를 다시 돌린다.

**통합 순서**: 준비된 순서대로. `e70-design`은 문서만이라 어느 때나.

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
- xcodebuild는 `-derivedDataPath ~/gildongmu-wt/<이름>-dd`. 앱 타깃 빌드는 통합 직전에 돌리고 성공을 확인하면 그 폴더를 바로 지운다. 통합 뒤 `ios/GildongmuKit/.build`·`android/*/build`도 지운다. 시뮬레이터 UI 실측이 필요하면 하나만 부팅하고 끝나면 내린다.
- 리뷰 전에 전부 커밋하고 리뷰어는 `git diff origin/main...HEAD`(3점)로 읽는다. 리뷰가 도는 동안 rebase·커밋 금지. 리뷰 보고는 `~/gildongmu-wt/<이름>-reports/review-<주제>-<YYYYmmddHHMM>.md`.
- 실기기 배포·App Store 제출·npm 발행·`vercel` 수동 배포·env 변경·유료 API 대량 호출 금지(E70 ODsay 10건 상한은 §1 판정 8).
- 공개 저장소 규율: 자택·지인 주택 근처 실주소·상호·정류소, 위원장 실조회 구간 이름·거리를 spec·테스트·커밋에 싣지 않는다(`public-repo-privacy-guard.test.ts`, `.githooks/pre-commit`).

## 4. 웨이브

1. **웨이브 1**: `ios-rotor` · `car-via` · `e70-design` 동시(빌드는 게이트 락이 한 번에 하나로 줄 세운다).
2. **통합 뒤** 코디네이터가 `CLAUDE.md` 반영 요청을 모아 반영(`AGENTS.md` 재생성), 메인 체크아웃에서 실기기 두 구성 설치(아이폰이 연결돼 있을 때), PORTS 원장 갱신.
3. **끝**: `doc-audit` 새 창.

## 5. 착수 프롬프트와 보고 경로

착수 프롬프트 사본은 `~/.claude/parallel-sessions/gildongmu/<이름>.prompt.txt`, 보고 디렉터리는 `~/gildongmu-wt/<이름>-reports/`(단계별 새 파일 `start`·`integrating`·`done`·`blocked`·`judgment` + `-<YYYYmmddHHMM>.md`, 리뷰 보고 `review-*`, 기준 SHA `base.sha`). 보고는 파일과 `SendMessage` 둘 다, 코디네이터 주소는 `gildongmu-f4 [d7e740]`. 위원장 판정이 새로 필요하면 세션이 `judgment-*.md`에 쉬운 한국어로 질문·선택지·각 선택지에서 위원장이 듣게 될 문장을 적어 통보하고, 코디네이터 세션이 위원장에게 묻는다. `e70-design`은 판정 문답이 많으므로 **자기 창에서 위원장에게 직접 `AskUserQuestion`으로 하나씩 묻는다**(결과는 보고 파일에도 적는다).

## 6. 정정 (코디네이터가 재현해 확인한 것)


- **2026-10-17 05:40, 관측 `f1d2e56e`, 출처 `ios-rotor` 판정 요청**: 위원장 판정 E72 Q1 = 번호 없는 역 전화 밀기 버튼은 VoiceOver가 꺼져 있을 때만 알림창, Q2 = 실기기 판정 대기, Q3 = **안내 시트(문장 속 역 이름·경유역 목록 전화)도 이번에 이름 링크로**. §2 `ios-rotor` 소유에 `Directions/TransitTrackingSheet.swift`의 해당 자리(필요하면 `OutingSheet.swift`의 같은 자리)를 더한다. `BeaconModel.swift`·판정 계층은 계속 `car-via` 소유.
- **2026-10-17 05:25, `f1d2e56e`**: 루트 `package-lock.json`의 cli·mcp 버전이 0.11.0으로 남아 있어(0.12.0 릴리스 `92866c52` 때 누락) worktree 설치가 미커밋 2줄을 만들었다. 코디네이터가 main에 반영했고 세션들은 rebase 직전 로컬 사본을 버린다.
- **2026-10-17 06:05, 관측 `92db0144`: `car-via` 종료.** 통합 `92db0144`(N4 자동차 경유지 접근 예고: 임계 `max(150m, v×60초)`·표본 부족 600m·정숙 10초, 상수 잠정, 리뷰 codex 설계 2회·opus 코드·fable 안전 BLOCKER 0). 코디네이터가 보고 전문과 `ce2923ca..92db0144` 변경 파일이 소유 목록 안임을 확인하고 창을 닫고 worktree를 지웠다. 위원장 판정(같은 시각): 운전자 모드도 이 예고를 말한다(현행 유지, spec §4). 미결: ①`CLAUDE.md` 반영 한 줄(보고 `done-202610170602.md`, 웨이브 끝에 일괄 반영) ②소유 밖 후속: 안드로이드 `:app` `WalkGuideWaypointProgressTest.kt:138`의 `assertFalse(model.contains("waypointApproachM = null"))`가 필드 non-null화로 늘 참이 됐다(삭제 또는 "도보 튜닝 사본 금지"로 재작성) — 다음 소형 세션 몫.
- **2026-10-17 06:40, 관측 `8b9c3958`: `ios-rotor` 종료.** 통합 `8b9c3958`(A64 `NearbyLoadCore.appear()`/`notePushed()` · E72 밀기 버튼·이름 링크·채팅 통일·안내 시트 Q3, 리뷰 설계·코드·a11y BLOCKER 0, 시뮬레이터 런타임이 없어 시뮬레이터 레인은 건너뜀). 소유 밖 자진 신고 `StationPhoneStore.swift`(`onNotice`)·`NearbyLoadState.swift`는 코디네이터가 변경 파일 목록으로 확인했고 판정과 정합한다. 창·worktree 정리. **실기기 설치**: 메인 체크아웃 `8b9c3958`로 실험판(Experimental)·공식판(Release) 두 구성 iPhone 13 Pro 설치·실행 확인. **세션 권고(채택)**: BACKLOG §2 E72 ①(밀기 버튼이 VoiceOver 동작 목록에 오르는가)·②(링크 품은 줄이 한 객체인가) 판정 전엔 정식판 아카이브에 싣지 않는다. 판정 후보·후속 후보(복귀 재조회가 남은 목록 넷, 웹·안드로이드 E72)는 보고 `done-*.md` §미결.
- **`CLAUDE.md` 반영(코디네이터, 같은 시각)**: `ios-rotor` 요청 5건(채팅·안내 시트·내 주변·브리핑 줄 교체 + 「로터 동작은 화면에도 보인다」 신설)과 `car-via` 요청 1건(자동차 경유지 접근 예고 줄). 76.5KB/80KB, 예산 테스트 통과, `AGENTS.md` 재생성.
