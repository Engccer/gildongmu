# 백로그 14차 소화: 병렬 세션 계획 (2026-10-27)

코디네이터 `gildongmu-2d [2f7800]`. 절차 정본은 `parallel-sessions` 스킬(Claude Code 분기). 이 문서가 세션 착수 프롬프트보다 상세하고 우선한다. 위원장 판정의 정본은 `docs/BACKLOG.md`의 각 항목이다. 위원장 지시(2026-10-27): "백로그 처리하자. 이 세션은 코디네이터 맡고, 병렬 세션 또는 서브에이전트로 효과적으로 백로그 처리해 줘. 판정은 이 세션에서."

설계 리뷰 판정: 계획 문서라 적대적 설계 리뷰 대상이 아니다. 각 세션의 spec이 리뷰 게이트 판정을 스스로 남긴다(§1 표의 "설계 리뷰" 열).

## 0. 전제 (관측 시점: 이 문서를 담은 커밋, 2026-10-27)

- **push 동결 없음.** iOS 2.2(빌드 33)는 `READY_FOR_SALE`. 통합은 `origin/main`으로 ff push이고 push는 곧 웹 프로덕션 자동 배포다(Vercel).
- 메모리 32GB 중 free 약 1GB·inactive 11GB, 스왑 0, 디스크 여유 604GB. 세션이 띄우는 MCP 서버를 감안해 동시 2개로 시작한다.
- 테스트 기준선은 `~/.claude/parallel-sessions/gildongmu/baseline-<base 12자리>.log`(`npm run test:run`). 각 세션 보고 디렉터리의 `base.sha`가 base 값을 든다.
- 세 벌 미러(웹·Kit·`:kit`)와 공유 fixture는 고치는 세션이 같은 커밋에서 맞춘다. Kit에 파일을 추가·개명·삭제하면 `android/kit/mirrors/<그룹>.json`을 함께 고친다.
- iOS 프로젝트는 파일 시스템 동기 그룹이라 새 Swift 파일을 더해도 `project.pbxproj`를 고치지 않는다.
- **여정(E70)은 실차 판정 전이다**(BACKLOG §2 E70 행). 위원장 판정(2026-10-27): 그 위에 E70-e·E71을 지금 얹는다. 여정 첫 판의 설계 판정(spec `2026-10-17-e70-mode-change-journey-design.md` D1~D14, 판정 1~32)은 재논의하지 않는다.
- 공개 저장소 규율: 위원장 실조회 구간의 실좌표·장소명·자택·지인 주택 근처 상호를 spec·테스트·커밋에 싣지 않는다(`public-repo-privacy-guard.test.ts`, `.githooks/pre-commit`).

## 1. 마일스톤·판정·모델 배정

BACKLOG 머리 `## 착수 순서` 표의 두 묶음 전부(E75 · E70-e+E71). 위원장 판정 2026-10-27: 셋 다 이번 회차.

| 웨이브 | 세션 | 항목 | 모델·노력 | 설계 리뷰 | 한 줄 |
|---|---|---|---|---|---|
| 1 | `e75-sheet` | E75 1~8 | opus·medium | 생략(판정 8건 확정, UI 재배치·플래그 졸업, 새 상태 머신 없음. 단 「지금 여기는 어디?」 창의 위치 조회가 `{force:true}` 계열인지는 spec-compliance 리뷰가 본다) | 도보·자동차 시트에 「경로 새로고침」 아이콘 버튼(제목 오른쪽, 접기 왼쪽) · 목록 안 「경로 다시 조회」 삭제 · 「진행 상황」+「주변 확인」 → 「지금 여기는 어디?」(조망 창 + 현재 위치 주변) · E74 `experimentalGuideTitleActionsEnabled` 졸업(`#if` 삭제, `GuideTitleMenu`·경유지 두 행·옛 키 삭제) |
| 1 | `e70e-bus-stop` | E70-e | opus·medium | 한다(지정 정류장 판정 술어 = 새 판정 계층, 버스 단독 재조회 = ODsay 호출 계약) | ①카카오 장소 검색이 버스 정류장을 잡는지 실호출 실측 → ②서버 지정 역 판정에 정류장 이름 술어 + 버스만 재조회(`SearchPathType=2`) → ③정류장은 출구 선정·출구 도보 생략 → 메뉴 문구 「역/정류장」 |
| 2 | `e71-riding-start` | E71 | opus·high | 한다(대중교통 leg가 boarding 없이 riding 국면으로 시작 = 상태 머신 변경, A16 급행 판정 결합) | 여정 출발지 유형 「지금 탄 열차」(노선 → 지금/다음 역 → 방면) → 대중교통 leg가 riding(비관측 또는 `boardAboard` 잠금)으로 시작, 뒤 구간(자동차 leg)이 이어진다. 급행은 `expressVerdict` 그대로 |

서브에이전트 모델은 디스패치마다 명시한다: 리뷰어·감사 `model: opus`, 안전·데이터 무결성 최종 검토만 `model: fable`(동시 하나), 할 일이 정해진 구현·이식·탐색 `model: sonnet`. 적대적 설계 리뷰는 codex `adversarial-review`, 실패 신호면 `model: fable` 서브에이전트.

### 코디네이터 판정 (제품 판단이 아닌 설계 사항)

1. **웨이브를 둘로 가른 근거는 파일 겹침이다**(호출 기준으로 확인, 관측 `40380303`). E75는 `BeaconTrackingSheet.swift`·`TransitTrackingSheet.swift`·`GuideTitleMenu.swift`·`GuideOverviewSheet.swift`·`BeaconModel.swift`·`AppConfig.swift`·`guidance-gate-drift.test.ts`를 고친다. E71은 `TransitTrackingSheet.swift`(riding 시작 국면의 시트)·`TransitGuideModel.swift`·`GuideSessionCoordinator.swift`·`DirectionsTabView.swift`·`AppConfig.swift`·`guidance-gate-drift.test.ts`와 `src/lib/journey/*`·Kit `Journey.swift`를 고친다. E70-e는 `src/lib/journey/*`(`designated.ts`·`assemble.ts`·`egress.ts`)·`DirectionsTabView.swift`(메뉴 문구)·Kit `Journey.swift`를 고친다. E75 ∩ E70-e = ∅ → 동시. E71은 양쪽과 겹친다 → 둘 다 통합된 뒤.
2. **E75 「경로 새로고침」 노출 조건**: 종전 E69 버튼이 서던 자리(`offRoute && rerouteGaveUp`)를 **덮고도 남게**, 상세 안내 중·최종 접근 전이면 언제나 보인다(E74 「다른 길로 가기」의 성립 조건 그대로). 간략·최종 접근 중엔 숨긴다(`canRequestDifferentRoute` 거짓). 조회 중엔 라벨을 「경로 조회 중」으로 바꾸지 않고 접수 문장(「경로를 조회하고 있습니다.」 `.high`)만 — 라벨 교체는 커서가 그 버튼에 있을 때만 들리고 그 외엔 잡음이라서다. 실기기에서 어색하면 E75 §2 행에 적는다.
3. **「지금 여기는 어디?」 창의 주변 조회는 `awaitGeolocation({force:true})` 계열**(iOS는 스토어 `freshTTL`을 지나지 않고 새 fix를 요구)이고, 간략·경로 미보유 세션에서는 진행 문장 한 줄 + 주변(BACKLOG 기본안). 주변 목록은 종전 「주변 확인」이 쓰던 둘러보기 조립(`OVERVIEW_RADIUS_M` 한 상수)을 그대로 부르고 앵커만 현재 위치로 바꾼다. 도착 종료 화면은 손대지 않는다.
4. **E74 졸업은 세 시트 전부**(도보·자동차·대중교통). `GuideTitleMenu`·경유지 두 행·`ios.guide.waypointChange`·`ios.guide.titleWaypointChange` 중 졸업 뒤 남는 키 하나로 정리(남기는 쪽은 정식판 문안 「{경유지}, 경유지 바꾸기」). `OutingSheet`의 제목 행은 E74 게이트 밖이었으면 손대지 않는다. `guidance-gate-drift.test.ts` §9는 졸업 플래그 식별자 0건을 세는 방향으로 갱신. CLAUDE.md의 E74 게이트 서술 교체 문장은 완료 보고의 "공유 자산 반영 요청"에.
5. **E70-e ①실측이 "안 잡힌다"로 나오면 멈추지 않는다**: 입력 경로 후보(카카오 카테고리 `BUS_STOP`류 검색 · 서울 TOPIS/TAGO 정류소 검색 재사용 · 역 검색과 같은 칸에서 `/api/bus/nearby` 이름 매칭)를 비교한 `judgment-*.md`를 쓰고 통보한 뒤, 기본값(기존 버스 정류소 검색 provider 재사용)으로 진행한다. 실호출은 세션 전체 카카오 30건·ODsay 10건 이하, 넘겨야 하면 멈추고 `judgment-*.md`.
6. **E70-e 정류장 이름 술어**는 `normalizeStationName`을 재사용하되 정류장 꼴(「강동역.강동성심병원」의 `.` 뒤 부속명)은 별도 정규화로 — 자체 역명 정규화 금지(CLAUDE.md 역명 매칭 규칙). ODsay 후보의 정류장 식별은 이름 + 좌표 500m(E70 역 판정과 같은 반경, fixture `journey-station-pairs.json`에 정류장 짝을 더한다).
7. **E71 입구는 길찾기 화면의 출발지 칸 메뉴**(E70-d가 합친 메뉴 「경유지/자동차 환승 추가」와 같은 틀로 「지금 탄 열차에서 출발」)이고, 노선 → 지금/다음 역 → 방면 세 단계는 피커가 아니라 검색·목록이다(역 이름 검색은 기존 역 검색 재사용, 노선은 그 역의 노선 목록에서). 안내는 대중교통 leg가 riding으로 시작하므로 승차 전 도보·boarding 폴 없음, 비관측 riding은 폴 주기 0 규칙(CLAUDE.md) 그대로. **첫 판은 지하철만**(버스는 E70-e 뒤 별도). 세션이 spec을 쓰고 설계 갈림길은 `judgment-*.md`로 — 코디네이터가 하나씩 묻는다.
8. **`CLAUDE.md`는 코디네이터만 고친다**(74.1KB/80KB). 세션은 상세를 `docs/PATTERNS.md`·`docs/INTEGRATIONS.md`의 같은 제목 절에 쓰고, `CLAUDE.md`에 들어갈 한두 줄은 완료 보고의 "공유 자산 반영 요청"에 문장 그대로 적는다. 기존 줄 교체를 먼저 제안한다.
9. **실기기 배포는 코디네이터가 전 세션 통합 뒤 메인 체크아웃에서 한다**(공식판·실험판 두 구성). 세션은 `deploy-device.sh`를 돌리지 않는다. 세션의 iOS 검증은 Kit `swift test`와 앱 타깃 빌드(Release·Experimental 두 구성)까지다.
10. **App Store 제출·npm 발행·안드로이드 배포는 범위 밖.** 안드로이드 이식은 E75(제목 행·새로고침)는 PORTS 등록 여부를 세션이 보고에 제안하고, E70-e·E71은 실험판 전용이라 등록하지 않는다.

## 2. 파일 소유권 지도

| 세션 | 소유 |
|---|---|
| `e75-sheet` | iOS `BeaconTrackingSheet.swift`·`TransitTrackingSheet.swift`·`GuideTitleMenu.swift`(삭제)·`GuideOverviewSheet.swift`·`OutingOverviewAdapter.swift`(조망 어댑터가 주변을 들면)·`BeaconModel.swift`(새로고침 진입점·현재 위치 주변 조회)·`AppConfig.swift`(E74 플래그 삭제) · `ios/i18n/ios-extra` 자기 키(`ios.guide.differentRoute` 값 교체·새 키 「지금 여기는 어디?」·옛 키 삭제) · `guidance-gate-drift.test.ts`·`guide-sheet-landing-guard.test.ts`·`reroute-button-visibility-guard.test.ts` · `docs/PATTERNS.md` 제목 행·착지 절 · BACKLOG E75·E74·§2 E74 행·FIELD-TEST §4-3b·CHANGELOG·PROGRESS 자기 자리 · 웹 E69 버튼은 손대지 않는다(웹 실시간 안내는 B6·B15 축) |
| `e70e-bus-stop` | 서버 `src/lib/journey/*`·`src/app/api/route/journey/*`·`src/lib/providers/odsay*.ts`의 버스 단독 재조회 자리·`src/lib/station-match.ts`(정류장 정규화를 여기 둘 때) · 공유 fixture `journey-station-pairs.json` · Kit `Journey.swift` 디코딩 · iOS `DirectionsTabView.swift`의 메뉴 문구·칸 검색 provider · `ios-extra`·`messages` 자기 키(「역/정류장」) · 실호출 게이트 스크립트(`scripts/verify-*journey*.mjs`류, `--from-corpus` 우선) · `docs/INTEGRATIONS.md` §여정 조립과 출구 수집 · BACKLOG E70-e·FIELD-TEST §6-3·CHANGELOG·PROGRESS 자기 자리 |
| `e71-riding-start` (웨이브 2) | iOS `DirectionsTabView.swift`(출발지 메뉴)·`TransitGuideModel.swift`·`GuideSessionCoordinator.swift`(`startJourney` riding 진입)·`TransitTrackingSheet.swift`(riding 시작 국면 착지) · Kit `TransitGuide.swift`·`Journey.swift`와 테스트·공유 fixture `transit-guide-scenarios.json` · 웹 `src/lib/transit-guide.ts` 미러(판정 함수만)·`:kit` `TransitGuide.kt` 미러 · 서버 `src/lib/journey/*`(출발 leg 유형) · 자기 키 · `guidance-gate-drift.test.ts`·`transit-landing-guard.test.ts` · `docs/INTEGRATIONS.md` 해당 절 · BACKLOG E71·FIELD-TEST·CHANGELOG·PROGRESS 자기 자리 |

**경계**

- 웨이브 1의 두 세션은 같은 iOS·서버 파일을 고치지 않는다. 공용 생성물만 겹친다: `Localizable.xcstrings`·`ios/i18n/arg-order.json`·`android/i18n/arg-order.json`·안드로이드 `strings.xml`·`android/kit/mirrors/*.json`. 원천(`messages`·`ios-extra`·`android-extra`)은 자기 키만 고치고 생성물은 rebase 뒤 재생성한다(손 병합 금지).
- **인계 계약(E70-e → E71)**: E70-e가 `src/lib/journey/designated.ts`에 정류장 판정을 더하면 지정 지점 타입의 이름(역·정류장 판별 필드)을 `done` 보고에 적는다. E71은 그 타입에 출발 유형을 더한다.
- **인계 계약(E75 → E71)**: E74 졸업 뒤 대중교통 시트 제목 행의 착지 바인딩 이름(`SheetControl`)과 밀기 동작 자리를 `done` 보고에 적는다. E71은 riding 시작 국면의 착지를 그 행 아래 상태 문장 행으로 둔다(E38 기본 착지 그대로).
- `CHANGELOG.md`·`docs/BACKLOG.md`·`PROGRESS.md`·`docs/FIELD-TEST.md`는 자기 항목만, rebase 뒤 `comm` 대조.

**통합 순서**: 웨이브 1은 준비된 순서대로. 웨이브 2의 base는 두 세션의 통합 SHA 이후다.

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
- 실기기 배포·App Store 제출·npm 발행·`vercel` 수동 배포·env 변경·유료 API 대량 호출 금지(E70-e 실호출 상한은 §1 판정 5).
- 공개 저장소 규율: 자택·지인 주택 근처 실주소·상호·정류소, 위원장 실조회 구간의 실좌표·장소명을 spec·테스트·커밋에 싣지 않는다.
- 워크스페이스 상위 `.claude/agents/a11y-auditor.md`는 worktree 세션에 실리지 않는다: 그 파일을 Read해 지시를 준 `model: opus` 범용 에이전트로 대신한다.

## 4. 웨이브

1. **웨이브 1**: `e75-sheet` · `e70e-bus-stop` 동시.
2. **웨이브 2**: 둘 다 통합 → `e71-riding-start`(base는 그 통합 SHA).
3. **통합 뒤** 코디네이터가 `CLAUDE.md` 반영, 메인 체크아웃에서 실기기 두 구성 설치.
4. **끝**: `doc-audit` 새 창.

## 5. 착수 프롬프트와 보고 경로

사본 `~/.claude/parallel-sessions/gildongmu/<이름>.prompt.txt`, 보고 `~/gildongmu-wt/<이름>-reports/`(단계별 새 파일 `start`·`integrating`·`done`·`blocked`·`judgment` + `-<YYYYmmddHHMM>.md`, 리뷰 `review-*`, `base.sha`). 보고는 파일과 `SendMessage` 둘 다. **위원장에게 직접 묻지 않는다**: 판정이 필요하면 `judgment-*.md`에 쉬운 한국어로 질문·선택지·각 선택지에서 위원장이 듣게 될 문장을 적어 통보하고, 기본값으로 진행할 수 있으면 진행한다. 코디네이터가 위원장에게 묻고 답을 전한다.

## 6. 정정 (코디네이터가 재현해 확인한 것)

(웨이브가 돌면서 채운다.)
