# 2026-08-21 실사용 피드백 통합 계획 — 병렬 세션 작업 분할

> 출처: 위원장 실사용 피드백(2026-08-21, 카카오톡) 5건 + `docs/BACKLOG.md` 통합. 판정은 2026-08-22 세션에서 위원장이 내렸고 여기 **결과만** 적는다. 이 문서는 병렬 터미널 세션들의 **착수 브리프**이고, 각 마일스톤의 설계 정본은 그 세션이 쓰는 spec이다(여기 설계를 복제하지 않는다).

> ✅ **2026-08-22 전 웨이브 종료**: 웨이브 1(n2 `972822a`·n4-서버 `e120d21`·n3 `a6f1798`·m4 `380cb0d`) → 웨이브 2(n1 `5e2c845`) → 웨이브 3(n4-iOS `39e2931`, AGENTS 재생성 `91ada3a`). 실기기 정식·실험 두 구성 `91ada3a`. 남은 것은 위원장 실기기 판정뿐 — `docs/BACKLOG.md` N1(6)·N2(2)·N4(5), `docs/FIELD-TEST.md` §5-2·§5-3(N3·A19).

## 0. 전제 (로그 판독 결과)

- **음향신호기 BLE(E20)**: 2차 실측(보강 계측기, 프로브 5회, 무명 기기 7대 직접 연결·서비스 발견)에서도 UART 서비스 0건. 위원장 판정: **이번 재편에서 배제**, "주변 보행 인프라" 메뉴·실험판 진단 UI는 **유지**. 상세는 research `RESEARCH-2026-08-16-audio-signal-ble-control.md` §12.
- **대중교통 "탑승 중" 문구**: 로그상 "탑승" 버튼이 곧 `waiting→riding` 전이다 — 문구가 아니라 **버튼의 뜻**이 문제. 부산물: 탑승 변경 시 포커스 착지 실패 `reboardPromptFocus landed=false` 2건(2026-08-21 09:31·10:11 UTC) → 결함 **A19**.

## 1. 마일스톤과 확정 판정

| ID | 이름 | 피드백 | 확정 판정(위원장 2026-08-22) | 규모 |
|---|---|---|---|---|
| **M4** | iOS "내 주변" 탭 재편 | 1 | ①현재 위치 확인+둘러보기 통합, 최상단 ②보행 인프라 **유지**(제거 철회, E20 배제는 별개) ③"한눈에 보기" 5종은 **공통 반경 하나**(값은 실호출로 정함) ④"주변 확인" **자동 펼침, 커서는 맨 위 위치 문장에 한 번만 착지**, 아래는 헤딩으로 탐색 ⑤각 장소 **상세로 열림, 서버가 좌표 실음**(헤지는 출처 각주로 유지) ⑥**서버 집계**(`assembleWhereAmI` 동형, 결정론 템플릿) ⑦불릿별 독립 3-state(설계 사항) | 큼 |
| **N1** | 안내 중 다른 메뉴 사용(시트 최소화) | 2 | 최소화 개체는 **탭 바 바로 위 띠바**(모든 탭 공통, "…까지 남은 거리 850m, 안내로 돌아가기"). 수치는 **수단별**(도보·자동차=남은 거리, 대중교통=남은 정거장/탑승 대기). 안내 중 새 안내 시작은 **거부**(조회는 허용). 장소 상세 길찾기 섹션에 안내 중일 때만 "여기로 목적지 변경"·"여기를 경유지로 추가" 추가 | 큼 |
| **N2** | 도보 안내 톤 세분화 | 3 | **5종**: 횡단보도(음향신호기식 비프 4연음×2)·왼쪽·오른쪽·뒤로 돌기·그 외(기존 `ahead`). 좌우 구분 방식(패닝/음높이)은 spec 후보 → 실기기 선택. `WalkAction`에 `back` 신설 | 중간 |
| **N3** | 대중교통 탑승 의미·상태 문구 | 4 | "탑승" 버튼 = **차량 고르기**, 탑승 여부는 **앱이 판정**(선택 차량이 내 승차 정류소·역에 도착하면 `riding`). 그 전 문구 "탑승 기다리는 중". 나머지 상태 문구(`transitGuide` 네임스페이스 전수) 재점검. + **A19** 포커스 착지 결함 | 작음~중간 |
| **N4** | 경유지 | 5 | **1개**, **도보·자동차만**(대중교통은 API 없음 → 경유지 있으면 그 수단은 "경유지 미지원" 정직 표시). 버튼 위치: 도착지 검색과 경로 조회 사이, 선택 사항, 도착지 선택 후 포커스는 종전대로 경로 조회 버튼. 안내 중 **도착하면 알리고 계속**(정지 없음). 최근 경로 문장("A부터 B까지 C를 경유하는")·안내 시트 버튼("경유지 추가"↔"C, 경유지 변경", 목적지 팝업과 종료 사이)·장소 상세 버튼(N1과 공유) | 큼 |

**기존 백로그와의 관계**: M4는 기존 M4(판정 5건 해소). N1은 E15(안내 UI 공통화)의 "진행 상황 조망" 첫 능력과 화면이 겹치나 **N1은 세션 소유권·띠바가 핵심이라 별 항목**이다(E15는 N1 뒤에). N3은 A16 ⑤(포커스)와 B2 ②(상태 문구 어휘)를 흡수. N2·N4는 신규.

## 2. 파일 소유권 (겹침 지도)

병렬의 전제는 **같은 파일을 두 세션이 동시에 고치지 않는 것**이다. 아래 소유권을 어기는 변경이 필요하면 그 세션은 멈추고 소유 세션에 넘긴다.

| 마일스톤 | 소유 파일(주요) |
|---|---|
| M4 | `ios/Gildongmu/NearbyHubView.swift`, `ios/Gildongmu/Nearby/WhereAmIView.swift`·`AroundNearbyView.swift`·`SurroundingsSceneSection.swift`, 서버 `src/app/api/surroundings/**`·`src/lib/surroundings-scene.ts`·신규 `src/app/api/nearby/overview`·`src/lib/nearby-overview.ts`, Kit 투영(`SceneItem` 좌표), CLI 카탈로그 항목 1, `messages/*.json` `nearby`·`whereAmI`·`surroundings` 네임스페이스 |
| N1 | `ios/Gildongmu/GildongmuApp.swift`(모델 승격·띠바), `Directions/GuideSessionCoordinator.swift`, `Directions/DirectionsTabView.swift`(시트 present 블록), `Directions/BeaconTrackingSheet.swift`·`TransitTrackingSheet.swift`(최소화 버튼), `PlaceDetailView.swift`(길찾기 섹션 버튼 2), `messages/*.json` `guide`·`ios.guide` 네임스페이스 |
| N2 | Kit `BeaconTones.swift`·`WalkAction.swift`·`RouteGuide.swift`(톤 선택 층), `Directions/BeaconTonePlayer.swift`, 웹 `src/lib/route-guide*`·`public/sounds/guide-*`, 공유 fixture, 사운드 자산 |
| N3 | Kit `TransitGuide.swift`(상태 머신), `Directions/TransitGuideModel.swift`, `TransitTrackingSheet.swift`(**문구·포커스만** — 최소화 버튼은 N1), 웹 `TransitGuidePanel`, `messages/*.json` `transitGuide` 네임스페이스 |
| N4-서버 | `src/lib/route-schema.ts`, `providers/tmap-pedestrian.ts`·`tmap-car.ts`·`kakao-walk.ts`·`kakao-navi.ts`, `walk-route.ts`·`car-route.ts`, `src/app/api/route/**`, CLI/MCP 카탈로그, 웹 `DirectionsView.tsx`, `src/lib/recent-searches.ts` |
| N4-iOS | `Directions/DirectionsTabView.swift`(폼·최근 경로), `DirectionsEndpointSearchView.swift`, Kit `RouteGuide.swift`(경유지 도착 이벤트), `BeaconTrackingSheet.swift`(경유지 버튼), `PlaceDetailView.swift`(경유지 버튼 본문 — 자리는 N1이 만든다) |

**겹침**: N1∩N4-iOS = `DirectionsTabView`·`BeaconTrackingSheet`·`PlaceDetailView` → **직렬**(N1 먼저). N1∩N3 = `TransitTrackingSheet` → 영역이 다르지만(버튼 vs 문구) 같은 파일이라 **N3 먼저**(작다). N2∩N4-iOS = Kit `RouteGuide.swift` → 영역 분리, rebase로 흡수 가능. M4는 독립.

**공유 생성물·공용 파일 규약**(충돌 하지 않게):
- `messages/*.json`: 자기 네임스페이스 안에서만 키 추가·수정. 6개 로케일 동시.
- `Localizable.xcstrings` 2벌: **손으로 머지하지 않는다.** rebase 뒤 `node ios/scripts/messages-to-xcstrings.mjs`로 재생성 후 `node ios/scripts/check-xcstrings-keys.mjs`.
- `project.pbxproj`: 새 Swift 파일은 충돌 1순위. 가능하면 기존 파일에 넣고, 새 파일이 필요하면 **커밋 직전 rebase → 충돌 시 Xcode에서 다시 추가**. ID 재사용 금지(`xcodebuild -list`로 검증).
- `CHANGELOG.md`·`docs/BACKLOG.md`·`PROGRESS.md`: 자기 항목 줄만. CHANGELOG는 날짜 헤딩 아래 자기 마일스톤 소제목.
- `guidance-gate-drift.test.ts`(`beacon.toggle(`·`restart(` 호출 수 6): N1·N4가 진입점을 옮기면 spec 표와 함께 갱신.

## 3. Git 격리 절차 (세션 공통)

repo는 main-direct다. 병렬은 **worktree + 브랜치**로 격리하고 main 통합은 fast-forward만 한다.

```bash
# 착수 (세션마다 1회, 이름은 아래 표)
git -C ~/Mac-Projects/gildongmu worktree add ~/gildongmu-wt/<name> -b feat/<name> main
cd ~/gildongmu-wt/<name>

# 작업 중: 자기 브랜치에만 커밋, pathspec으로 (git add -A 금지)
git commit -- <파일들>

# 통합 (리뷰 통과 후)
git fetch origin && git rebase origin/main        # 충돌은 여기서만 푼다
node ios/scripts/messages-to-xcstrings.mjs && npm run test:run   # 생성물 재생성 + 게이트
git push origin feat/<name>:main                   # fast-forward만. 거부되면 다시 rebase
git -C ~/Mac-Projects/gildongmu worktree remove ~/gildongmu-wt/<name>
```

- `--force` 금지(하드 스톱). push가 거부되면 rebase를 다시 한다.
- **실기기 배포는 한 번에 한 세션만**: 같은 실험판 번들을 덮어쓴다. 배포 직전 다른 세션에 알린다([[parallel-sessions-device-deploy-coordination]]). 정식·실험 두 구성 모두 설치가 기본.
- TTS 요약 파일은 머신 전역이라 병렬 세션이 서로 소비한다([[tts-summary-file-shared-across-sessions]]) — 알려진 잡음, 조사하지 말 것.
- 메인 worktree(`~/Mac-Projects/gildongmu`)는 **통합 뒤 `git pull --ff-only`만** 하고 작업하지 않는다.

## 4. 웨이브 (착수 순서 제안 — 최종 순서는 위원장 결정)

| 웨이브 | 동시 세션 | 근거 |
|---|---|---|
| **1** | **M4** · **N2** · **N3** · **N4-서버** (4개) | 서로 파일이 안 겹친다. N3이 작아 먼저 끝나면 N1의 길이 열린다. N4-서버는 iOS 없이도 웹·CLI로 실호출 검증이 끝난다 |
| **2** | **N1** (N3 통합 뒤) | `TransitTrackingSheet`·`DirectionsTabView`·`PlaceDetailView` 독점 |
| **3** | **N4-iOS** (N1 통합 뒤) | N1이 만든 장소 상세 버튼 자리·앱 수준 세션에 경유지를 얹는다 |

대안: N4 전체를 웨이브 1에서 한 세션이 잡고 N1을 그 뒤로 — 경유지가 더 급하면 이쪽. 단 N1 뒤로 가면 N1이 끝날 때까지 "여기를 경유지로 추가" 버튼 자리가 없다.

## 5. 세션 착수 프롬프트 (복사용)

각 터미널에서 `cd ~/gildongmu-wt/<name>` 후 아래를 첫 메시지로. 공통 머리말: *"`docs/superpowers/plans/2026-08-22-feedback-260821-parallel-plan.md`를 읽고 **§2 소유 파일 밖은 건드리지 말 것**. brainstorming → spec → plan → 구현·리뷰 → §3 절차로 통합."*

- **m4-nearby**: "M4 iOS 내 주변 탭 재편. 판정 7건은 plan §1 M4 행이 정본, 코드 분석은 `docs/research/RESEARCH-2026-08-12-nearby-tab-restructure.md`. 공통 반경 값은 실호출로 정하고 근거를 spec에 남길 것. 보행 인프라 화면과 BLE 진단 섹션은 유지."
- **n2-tones**: "N2 도보 안내 톤 5종. `BeaconTone`·`WalkAction`(`back` 신설)·`GuideTone` 선택 층·웹 미러·fixture. 좌우 구분은 패닝/음높이 두 후보를 만들어 실기기 선택을 위원장에게 요청. 백그라운드·잠금에서도 구분되는지가 성과 기준."
- **n3-transit-boarding**: "N3 대중교통 탑승 의미 재정의(선택→앱이 탑승 판정)+상태 문구 전수+A19 포커스 착지. 로그 `~/gildongmu-private/field-logs/transit-guide-diag-2026-08-21.log` 참조. `TransitTrackingSheet`는 문구·포커스만."
- **n4-waypoint-server**: "N4 서버·웹·CLI 경유지 1개(도보·자동차, `via` 파라미터). Tmap passList·카카오 내비 waypoints 실호출 게이트. 대중교통은 `unsupported` 정직 표시. 웹 `DirectionsView` 버튼·최근 경로 문장."
- **n1-guide-minimize**(웨이브 2): "N1 안내 세션을 앱 수준으로 승격 + 탭 바 위 띠바 + 중복 시작 거부 + 장소 상세 버튼 2. 설계 리뷰 대상(상태 소유권 이동)."
- **n4-waypoint-ios**(웨이브 3): "N4 iOS 경유지: 폼 버튼·최근 경로·안내 시트 버튼·장소 상세 버튼·경유지 도착 통지."
