# 2026-09-11 백로그 3차 소화 계획 — 병렬 세션 작업 분할

> 출처: `docs/BACKLOG.md` 전수 판독(2026-09-11 04:40 KST, HEAD `001449c0`). 위원장 지시 "백로그에서 처리할 수 있는 것들 처리하자. 이 세션은 코디네이터, 구현은 병렬 세션, 필요한 판정은 이 세션에서". 판정은 2026-09-10 판정 세션 1·2차(`34b408e5`·`001449c0`)가 이미 내렸고 이 문서는 그것을 실행 단위로 옮긴다. 절차 정본은 `parallel-sessions` 스킬, 직전 선례는 `2026-09-02-backlog-sweep-2-parallel-plan.md`.

## 0. 전제 (코디네이터 판독 결과, 관측 시점 `001449c0`)

- **⛔ push·재배포 동결 2026-09-22 09:00 KST까지**(WebMCP 챌린지 심사, BACKLOG 머리·메모리 `webmcp-challenge-judging-freeze`). `.git/hooks/pre-push`가 origin push를 막는다. 그래서 이번 웨이브는 **통합 = 로컬 `main` fast-forward**(§3)이고 origin은 아무도 만지지 않는다. 로컬 main은 origin/main보다 6커밋 앞서 있다(정본은 로컬 main).
- **착수 범위는 앱 안에서 닫히는 iOS 작업 + 그 웹 미러**. 웹 미러는 로컬 커밋만 되고 배포는 09-22 뒤다. **앱이 새 서버 동작에 의존하게 만드는 변경(새 라우트·새 응답 필드)은 이번에 하지 않는다** — 판정이 클라이언트에서 되는 것만(A32 꼬리 판정은 클라이언트 두 벌에서).
- 실기기 iPhone 13 Pro `available (paired)`(04:47 관측). **실기기 배포는 세션이 하지 않고 웨이브 통합 뒤 코디네이터가 Release·Experimental 두 구성으로 한 번**([[ios-device-deploy-both-configurations]]). ⚠ 실기기 테스트가 프로덕션 쿼터(각 일 1,000회)를 태우면 심사위원이 보는 사이트가 429로 깨진다 — 실호출은 항목당 수십 회 이내.
- **E35·E37 표본 수집은 코디네이터가 돌리고 있다**: `~/gildongmu-private/probes/subway-probe-2026-09-11.mjs`(04:46 KST 시작, ~26시간, 총 ~120회 예산). E35(5호선 `realtimePosition` 결측 재측정 09:00·13:00, 대조군 2·8호선) · E37(매시 3역 `arvlMsg2` 문법 + 23:30~01:30 10분 간격 `barvlDt` 운행 종료 실측). 결과 `subway-probe-2026-09-11.jsonl`. **E35 판정·E37 spec은 이 데이터가 찬 뒤**(웨이브 3).
- **처리하지 않는 것(근거)**: §2 전부·§3 G3(실보행·실승차 판정) / E30(하드 스톱 3종 양자택일 — 앱 내 토글 vs 워치 앱 — + 시청각장애 당사자 판정 경로, 위원장) / E37(수집 게이트 진행 중) / B6·B8·B9 ②·W1-R·PORTS 실브라우저 a11y 게이트(웹 전용 — 동결 뒤) / B7(CLI 실사용 뒤) / E22·E18·M2·E14 ③·E20·A1·D11·E25 최단시간·A22 주간 재관측(조건 미성립·동결·별도 루틴) / PORTS `pickBest` 동률(조건부 — 표시 개수 변경 계획 없음).
- **doc-audit**: SessionStart 결정론 린트는 커밋 수 신호만 냈다(앵커·경로·심볼 0). 전면 점검은 스킬 §5 관례대로 **전 웨이브 뒤 후속 세션**(opus).

## 1. 마일스톤과 확정 판정·모델 배정

| 세션 | 항목 | 판정·설계 결정(위원장 판정은 BACKLOG 원문이 정본, 여기는 실행 단위) | 모델 | 웨이브 |
|---|---|---|---|---|
| **transit-1** | A33 · A37 ② · A34 ②+① · E34 | 순서 고정(각각 커밋): ⓪**A33** 상태 문장 3키(`transitGuide.stateRidingNotYetVisible`→"하차역에 가까워지면 열차 위치가 표시됩니다."·`stateSignalLost`·`stateNeverSeen` 같은 어투) 6로케일 — ⚠ 같은 키가 **버스 승차**에도 쓰이면 수단별로 가른다(열차/차량). ①**A37 ②** 역 선택(`reboardStationPicker`)에서 **하차역을 고르면 그 leg를 도착으로 끝낸다**(대기 국면으로 돌리지 않는다, `arrived` 진입 → 기존 [다음 구간] 경로). 상시 종료 버튼 없음(기각). ②**A34** [이미 탑승했습니다]를 누르면 **먼저 "지금 어느 역을 지나고 계신가요"**(①의 역 선택 화면 **재사용**, 새 화면 금지) → 그 역의 도착 목록에서 실제 열차 선택 → 정상 잠금. 목록이 비었을 때만 근사 잠금이고 **그때는 열차 위치·남은 정거장을 말하지 않는다**(어림값 표시 폐지 — 3-state 정직성). 급행 확인 프롬프트(A16 ⑦⑧)는 그 흐름 안에서 유지. ③**E34** 마지막 leg의 버튼은 하나 — 라벨이 처음부터 "남은 도보 안내 시작"이고 한 번 누르면 leg 종료+도보 시작(`advance` + `pendingWalkHandoff` 소비를 한 동작으로). 중간 leg는 현행 [다음 구간]. `guidance-gate-drift.test.ts` 호출 수 갱신. **웹 미러**(`useTransitGuide`·`transit-guide.ts`·`TransitGuidePanel`)는 ①②③ 모두. **설계 리뷰 필수**(①②가 상태 전이를 새로 연다): spec 1개(`docs/superpowers/specs/2026-09-11-transit-reboard-and-handoff-design.md`)에 ①②③을 담고 적대적 리뷰 1회(서브에이전트, codex 선택) 뒤 구현. 판정 회수는 실승차(§2 표에 행 추가: A37·A34·E34) | fable | 1 |
| **weight-notice** | E31 | **코디네이터 확정(위원장 인용 근거 "아무 행동도 하지 않고 닫기를 누르는 경우")**: "무시" = 권유가 표시된 도착 화면에서 [체중 입력하기]를 누르지 않고 **[닫기]를 누른 것**. 시트 최소화·30분 만료 소거(A31)·앱 종료는 세지 않는다. 카운터는 `WalkHealth.weightStorageKey` 옆 UserDefaults(Kit 순수 판정 + 테스트). 2회 뒤: 권유 문장·[체중 입력하기] 버튼·"서버에 저장되지 않아요" 고지 모두 사라지고 **기준 체중은 칼로리 문장 안으로**("… **65kg 기준으로** 약 39kcal …" — 줄 수 불변, 두 벌 키). 체중을 입력하면 조건 자체가 사라진다(되살림 UI 없음). iOS 전용(웹 미러 없음). 6로케일 `ios/i18n/ios-extra` + `arg-order.json` 게이트. 설계 리뷰 생략(판정 확정·국소) — 판정 한 줄을 spec 머리에 | opus | 1 |
| **from-here** | E32 · B10 | ①**iOS**: `DirectionsPrefillStore.pending`에 출발지 갈래 추가(`.place` 도착지 전용 → 출발/도착 구분), `PlaceDetailView` 길찾기 섹션 "여기까지 길찾기" **아래**에 "여기부터 길찾기". 프리필 즉시 조회(`runPrefillQueryIfPending`)는 **양끝이 다 있을 때만** — 출발지만 채우면 도착지 입력에 착지하고 조회하지 않는다. ②**웹 B10 먼저**: `openDirections(endpoint)` 프리필 진입과 `?dir=` URL 복원을 가른다(`initialTo` 한 prop에 섞지 말고 프리필 표식) → 프리필 진입에서만 `runQuery(request)` 1회(WebMCP 세대 결박 유지, 새로고침·직진입엔 측위 팝업 0). ③**웹 E32**: `PlaceDetail`에 같은 버튼, 출발지 프리필. 라벨 6로케일 `directions.fromHere`(iOS·웹 공유 키). ⚠ `DirectionsView`는 WebMCP `DirectionsBridge`·`runQuery` 트랜잭션이 있다 — CLAUDE.md §WebMCP 항목을 먼저 읽는다. 설계 리뷰 생략(iOS 선행 계약의 확장) — 판정 한 줄을 CHANGELOG 항목에 | opus | 1 |
| **arrival-tail** | A32 | **클라이언트 두 벌에서 판정**(서버 무변경 — 동결): 같은 응답의 `arvlMsg3`(`currentLocation`) 값이 `arvlMsg2`(`message`) 문자열 안에 **포함**되면 꼬리 `현재 {역}`을 빼고, 아니면 붙인다(못 알아보면 붙이는 쪽 = 현행). 자리: 웹 `src/lib/place-lines/station-arrivals.ts` ↔ iOS `subwayArrivalLine`(`SubwayNearbyView.swift`, `StationSections.swift`가 소비). **en 경로**(`messageEn`·`currentLocationEn`)도 같은 판정. 실호출 확인은 코디네이터 수집기 표본(`~/gildongmu-private/probes/subway-probe-2026-09-11.jsonl`, 읽기 전용)으로 — 직접 호출은 10회 이내. 테스트: 포함/비포함/괄호 역명(`천호(풍납토성) 전역출발`) 3형 fixture 웹·Kit. 설계 리뷰 생략 — 판정 한 줄을 CHANGELOG 항목에 | opus | 1 |
| **transit-2** | A36 ① · E36 · PORTS "오디오 세션 소유권 세 구멍" | ①**A36** `neverSeen` 상한을 벽시계가 아니라 **실제 riding 조회 횟수**로 센다(Kit `TransitGuide.swift` ↔ 웹 `transit-guide.ts` 미러 + 공유 fixture; 상한 횟수는 10분÷폴 주기 등가로 잡되 잠정 상수라 spec에 근거). ②**E36** 백그라운드에서도 riding 폴을 계속하고(`handleScenePhaseChange`의 `pausedInBackground` 폐지 또는 백그라운드 전용 주기), **첫 관측(`trackingStarted`) 한 건만 소리**로 알린다(사다리·도착은 범위 밖). 음성은 억제 유지. **첫 관문은 오디오 세션 생존** — `BeaconTonePlayer` 세션 소유·원복(`didPromote`)을 읽고, PORTS.md gildongmu 행 "오디오 세션 소유권의 세 구멍"(①카테고리/활성화 분리 ②원복 자격 저장 ③`routeChangeNotification` 메아리) **세 가지를 gildongmu 코드에서 각각 재현·확인**한 뒤 필요한 것만 고친다(dodo 관찰이지 gildongmu 재현이 아니다 — 확인 결과를 PORTS 행에 적어 닫는다). 조회 횟수 증가는 일 1,000회 예산과 대조해 백그라운드 주기를 정한다. 배터리는 실측 항목으로 §2에 등록(단정 금지). 실험판 봉인 안. **설계 리뷰 필수**(오디오 세션·백그라운드 실행 = 안전·정확성 축): spec 1개 + 적대적 리뷰 1회 | fable | 2 (transit-1 통합 뒤) |
| **transit-3** | A35 · E33 | ①**A35** 착지 실패(`landed=false` 1/6~4/7): `TransitTrackingSheet.landControlFocus` 재시도 1회·고정 지연·`phaseTransitionLanding` 대상 미렌더 가능성·`scrollTo` 인자 ≠ 포커스 키·`onMiss` 폴백 부재를 정본 시퀀스(가시화→지연→경합 해제→대입→검증→재시도, `SearchView.landFirstRowFocus`)와 대조해 고친다. ⚠ 시뮬레이터로 검출 불가 — 판정은 실승차 로그 `landed=`. 계측(`TransitGuideDiag`)에 시도 횟수·실패 사유를 남겨 다음 로그 회수가 판정하게 한다. ②**E33** 안내 시트의 지하철역(경유역 목록·상태 문장)을 장소 상세로 연다: 표현 계층은 **시트 위 시트 금지**(N1 리뷰 기각). 강한 디폴트 = 안내 시트 자체 NavigationStack **push**(시트가 그것을 수용하면) → 안 되면 최소화 후 검색 탭에서 열고 띠바로 복귀. 식별은 `leg.viaStops[]` 좌표·`stationId`(이름 재검색은 최후). 접근성: 경유역 한 줄을 두 객체로 가르지 말 것(채팅 산문 선례 — 1개면 블록 전체 버튼, 2개 이상이면 로터 액션). 웹 `TransitGuidePanel` + `place-open-request` 브릿지 미러. **설계 리뷰 필수**(E33 표현 계층): spec + 적대적 리뷰 1회 | fable | 3 (transit-2 통합 뒤) |
| **E37-spec** | E37 (+E35 판정 재료) | 수집기 데이터(2026-09-12 07:00 KST 이후)로 문법 표·운행 종료 `barvlDt` 판정 → spec(`완성 문장 정본` 계약을 이 화면에서 바꾸는 근거, 승차 국면·안내 통지는 범위 밖) → 6로케일 + 웹 `station-arrivals.ts` ↔ iOS `subwayArrivalLine` 미러(⚠ arrival-tail 통합 뒤 같은 자리). E35는 코드 아님 — 5호선 결측 재측정 결과를 BACKLOG E35에 기록하고 위원장 판정으로 넘긴다 | fable | 3 |
| **doc-audit** | 문서 전수 정합 | 전 웨이브 뒤 새 창. 종결 식별자 이동, §2 실승차 표에 A37·A34·E34·A36·E36·A35·E33 판정 행 확인, PORTS 행 닫기, E30 판정 위치 기록 | opus | 4 |

## 2. 파일 소유권 (겹침 지도)

| 세션 | 소유 파일(주요) |
|---|---|
| transit-1 | Kit `TransitGuide.swift`·`TransitGuideText.swift`·`TransitDisplayProjection.swift`·`TransitProgressOverview.swift`(참조만), iOS `Directions/TransitGuideModel.swift`·`TransitTrackingSheet.swift`·`GuideSessionCoordinator.swift`(핸드오프 배선만)·`DirectionsTabView.swift`(`startWalkHandoff`만), 웹 `src/hooks/useTransitGuide.ts`·`src/lib/transit-guide.ts`·`transit-guide-text.ts`·`transit-display.ts`·`src/components/TransitGuidePanel.tsx`, 공유 fixture `transit-guide-*`, `src/lib/__tests__/guidance-gate-drift.test.ts`, `messages/*.json` `transitGuide.*`·`ios.transitGuide.*`, spec `2026-09-11-transit-reboard-and-handoff-design.md` |
| weight-notice | Kit `WalkHealth.swift` + `WalkHealthTests.swift`, iOS `Directions/BeaconTrackingSheet.swift`(**건강 요약 절만**), `ios/i18n/ios-extra/*.json` `ios.beacon.health*`만, spec `2026-09-11-weight-notice-dismissal-design.md` |
| from-here | iOS `PlaceDetailView.swift`·`Directions/DirectionsPrefillStore`(정의 파일)·`DirectionsTabView.swift`(**프리필 소비 `runPrefillQueryIfPending` 절만**)·`SearchView.swift`(프리필 호출부만), 웹 `src/components/PlaceDetail.tsx`·`DirectionsView.tsx`(**프리필/URL 복원 분기 + 마운트 조회만**)·`PlaceSearch.tsx`(`openDirections` 호출부만), `messages/*.json` `directions.fromHere`·`directions.toHere` 이웃 |
| arrival-tail | 웹 `src/lib/place-lines/station-arrivals.ts` + 테스트, iOS `Nearby/SubwayNearbyView.swift`(`subwayArrivalLine`)·`StationSections.swift`(소비부만), Kit 판정 함수(신설 시 `SubwayArrivalLine.swift` 류) + 테스트 |

**겹침과 처리**:
- transit-1 ∩ from-here = ~~`DirectionsTabView.swift`~~ **정정(2026-09-11 05:10, transit-1 보고 → 코디네이터 재현)**: `startWalkHandoff`는 N1(2026-08-22)에 `GuideSession.acceptWalkHandoff`(`GuideSessionCoordinator.swift`, transit-1 소유)로 옮겨져 `DirectionsTabView.swift`에는 주석 한 줄뿐이다. transit-1은 그 파일을 만지지 않는다 → 겹침 없음. 대신 웹 E34가 `src/components/DistanceBeacon.tsx`(소유자 없음 → transit-1에 허가)와 `DirectionsView.tsx`의 `<DistanceBeacon …/>` 렌더 두 자리(prop 전달만)를 만진다. from-here는 같은 파일의 프리필/URL 복원 분기만 — 절이 다르므로 rebase 자동 병합, 양쪽 자진 신고.
- transit-1 ∩ weight-notice = 없음(`BeaconTrackingSheet`는 weight-notice만).
- arrival-tail ∩ 나머지 = 없음.
- **웨이브 2·3(transit-2·transit-3)은 transit-1과 같은 파일군**(`TransitGuide.swift`·`TransitGuideModel.swift`·`TransitTrackingSheet.swift`)이라 **직렬**이다. transit-2는 transit-1 통합 SHA 위에서, transit-3는 transit-2 통합 SHA 위에서 worktree를 만든다.
- 소유권은 grep이 아니라 호출 관계로 쟀다(스킬 §1 경고). 세션이 "내 소유 목록이 틀렸다"고 보고하면 코디네이터가 재현해 이 표를 고친다.

**공유 생성물·공용 파일 규약**: `messages/*.json`·`ios/i18n/ios-extra/*.json`은 자기 네임스페이스만(6로케일 동시) / `Localizable.xcstrings` 2벌·`ios/i18n/arg-order.json`은 손 머지 금지, rebase 뒤 `node ios/scripts/messages-to-xcstrings.mjs` + `node ios/scripts/check-xcstrings-keys.mjs`(기존 키 어순 변경은 `--update-arg-order`로만) / `project.pbxproj` 새 파일은 ID 재사용 금지(`xcodebuild -project ios/Gildongmu.xcodeproj -list`로 검증) / `CHANGELOG.md`·`docs/BACKLOG.md`·`docs/FIELD-TEST.md`·`PROGRESS.md`·`CLAUDE.md`·`docs/PATTERNS.md`·`docs/INTEGRATIONS.md`는 **자기 항목·자기 줄만**, rebase 뒤 `comm` 순·역방향 소실·되살림 전수 대조(§3) / `PORTS.md`는 transit-2(오디오 세션 행 닫기)와 doc-audit만 / 릴리스 노트는 이번 묶음에서 쓰지 않는다(1.16 판정은 동결 뒤).

## 3. git 격리 절차 (각 세션 공통 — **origin 금지, 로컬 main ff 통합**)

worktree와 `node_modules`·`.env.local`은 **코디네이터가 착수 전에 만들어 두었다**(`~/gildongmu-wt/<name>`, base = 로컬 `main`). `npm install` 금지.

```bash
cd ~/gildongmu-wt/<name>                     # 브랜치 feat/<name>, 자기 파일만, pathspec 커밋(git add -A 금지)
# 리뷰(서브에이전트 spec-compliance + code-quality, iOS a11y 변경은 a11y 감사 — general-purpose에 역할 파일 Read 지시) 통과 뒤:
base=$(git rev-parse main); git rebase main   # fetch 없음 — origin은 동결, 정본은 로컬 main
node ios/scripts/messages-to-xcstrings.mjs && node ios/scripts/check-xcstrings-keys.mjs    # i18n을 건드렸을 때
comm -23 <(git show $base:CHANGELOG.md | sort) <(sort CHANGELOG.md); comm -13 <(git show $base:CHANGELOG.md | sort) <(sort CHANGELOG.md)   # BACKLOG·FIELD-TEST도 같게 — 출력은 전부 내가 의도한 줄이어야 한다
# 게이트(부하 게이트: `uptime` 1분 load가 10 미만일 때만, 넘으면 60초 뒤 재확인):
npm run test:run -- --maxWorkers=2 && npx tsc --noEmit && npm run lint
(cd ios/GildongmuKit && swift test)                                                        # Kit
xcodebuild -project ios/Gildongmu.xcodeproj -scheme Gildongmu -configuration Experimental -destination 'generic/platform=iOS Simulator' build -quiet   # 앱
git -C ~/Mac-Projects/gildongmu merge --ff-only feat/<name>   # 통합. 거부(비-ff)면 rebase부터 다시. --force·origin push 금지
git worktree remove ~/gildongmu-wt/<name>   # 코디네이터 "통합 확인" 뒤
```

- `git push`는 어디로도 하지 않는다(pre-push 훅이 origin을 막지만 규율로도 금지). 통합 뒤 `git -C ~/Mac-Projects/gildongmu log --oneline -1`로 자기 커밋이 main HEAD인지 확인해 보고에 SHA를 적는다.
- 리뷰가 도는 동안 rebase·추가 커밋 금지. 리뷰는 **전부 커밋한 뒤** `git diff main...HEAD`(3점)로 읽게 하고, 리뷰 보고는 파일로 받는다(`~/gildongmu-wt/reports/<name>-review-*.md`, 머리에 HEAD SHA).
- **실기기 배포·App Store 제출·npm 발행·origin push는 세션이 하지 않는다.** 배포는 웨이브 통합 뒤 코디네이터.
- 보고는 **파일 + SendMessage 둘 다**: `~/gildongmu-wt/reports/<name>.md`(착수 SHA·통합 SHA·변경 파일·검증 결과·소유권 밖 파일 자진 신고·남은 판정 위치·공유 자산 반영 요청). 코디네이터 주소는 `gildongmu-83 [9e7857]`. SendMessage는 통보 채널이지 질의 채널이 아니다 — 답을 기다리는 구조를 만들지 말 것.
- 위원장 판정이 새로 필요하면 그 세션이 `AskUserQuestion`으로 직접 묻는다(코디네이터 경유 금지). 배정 모델이 판정에 부족하다고 느끼면 밀고 나가지 말고 코디네이터에 보고한다.
- 작업 세션은 TTS 요약을 쓰지 않는다(런처가 `TTS_SUMMARY=off`). 사용자에게 닿아야 하는 것은 코디네이터로.

## 4. 웨이브

- **웨이브 1(동시 4)**: transit-1 · weight-notice · from-here · arrival-tail
- **웨이브 2**: transit-2 (transit-1 통합 뒤) — 통합 뒤 코디네이터 실기기 배포 1회(두 구성)
- **웨이브 3**: transit-3 · E37-spec (수집기 종료 2026-09-12 07:00 KST 이후)
- **웨이브 4**: doc-audit → 실기기 배포 최종 → §2 실승차 판정은 위원장

최종 순서는 위원장 결정으로 남긴다(기본값은 위).

## 5. 세션별 착수 프롬프트

착수 프롬프트 원문은 코디네이터가 `launch-session.sh`로 넘긴다(파일은 `~/.claude/parallel-sessions/gildongmu/<name>.prompt.txt`, 본 문서에 복제하지 않음). 머리말 고정: `[병렬 세션 배정: 이 세션의 역할 이름은 **<이름>** 다. 첫 응답 첫 줄에 "세션 <이름>" 라고 밝혀라.]`, 본문은 §0 전제 + §1 자기 행 + §2 자기 행 + §3.
