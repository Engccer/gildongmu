# 백로그 10차 소화: 병렬 세션 계획 (2026-10-05)

코디네이터 `gildongmu-a9 [a3c1fa]`. 절차 정본은 `parallel-sessions` 스킬(Claude Code 분기). 이 문서가 세션 착수 프롬프트보다 상세하고 우선한다. 위원장 판정의 정본은 `docs/BACKLOG.md`의 각 항목이다.

설계 리뷰 판정: 계획 문서라 적대적 설계 리뷰 대상이 아니다(새 불변식은 각 세션 spec이 판정한다).

## 0. 전제 (관측 시점: `cf8c5cf9`, 2026-10-05)

- **push 동결 없음.** 통합은 `origin/main`으로 ff push이고 push는 곧 웹 프로덕션 자동 배포다(Vercel, 스킵 규칙 없음).
- **스토어 최신은 iOS 2.1(빌드 32, 아카이브 `49c47afb`)이다**(2026-10-05 `asc-submit --check`로 `READY_FOR_SALE` 확인). 2.0(`5d57aad0`)·1.19(`5104808d`)도 사용자 기기에 남아 있다. 세 빌드와 안드로이드 설치본은 프로덕션 서버의 응답을 그대로 받는다.
- **디스크 여유 22GB**, 스왑 0, 부팅된 시뮬레이터 0, 다른 claude 세션 0. 세션은 DerivedData·산출물을 자기 폴더에만 쓰고, 여유가 8GB 밑으로 내려가면 빌드를 멈추고 보고한다. 시뮬레이터를 부팅하지 않는다.
- 테스트 기준선은 `~/.claude/parallel-sessions/gildongmu/baseline-<base 12자리>.log`(`npm run test:run`). base는 이 문서를 담은 커밋이고 각 세션 보고 디렉터리의 `base.sha`가 그 값을 든다.
- 웹·Kit(`ios/GildongmuKit`)·안드로이드 `:kit` 세 벌 미러와 공유 fixture는 **고치는 세션이 같은 커밋에서 세 벌을 맞춘다**(한 벌만 고치면 다른 두 게이트가 빨개진다). Kit에 파일을 추가·개명·삭제하면 `android/kit/mirrors/<그룹>.json`을 함께 고친다(`android/README.md` §5).
- iOS 프로젝트는 파일 시스템 동기 그룹이라 새 Swift 파일을 더해도 `project.pbxproj`를 고치지 않는다.

## 1. 마일스톤·판정·모델 배정

| 세션 | 웨이브 | 항목 | 모델·노력 | 한 줄 |
|---|---|---|---|---|
| `e64-order` | 1 | E64 | opus·medium | 길찾기 결과 섹션 순서: 도보와 대중교통 중 빠른 쪽이 맨 위(웹·iOS·안드로이드, 판정 함수 세 벌 미러) |
| `e65-rotor` | 1 | E65 | opus·high | 내 주변 탭 로터 액션(둘러보기·지하철역·버스 정류소). 서버 overview 응답에 좌표 additive가 선행 |
| `ios-reorder` | 1 | E67 · E66 | opus·high | 고정 항목 순서를 로터 액션으로(E67) + 탭 순서 설정(E66, iOS 실험판만). 둘은 같은 조작법이다 |
| `small-13` | 1 | 건너는 길 이름 정식판 졸업 · A60(출처 라벨·자동차 km) · A58 잔여(서버 en `parts`) · E58 ⑦(웹 출처 줄) · PORTS 행 하나 확인 | opus·high | 소형 묶음(서버·웹·iOS·안드로이드). 하위 호환 판정이 딸려 high |
| `doc-audit` | 끝 | 문서 만료 점검 | opus·medium | 전 세션 통합 뒤 새 창(SessionStart `[doc-audit]` 미점검 보고도 여기서 닫는다) |

서브에이전트 모델은 디스패치마다 명시한다: 리뷰어·감사는 `model: opus`, 적대적 설계 리뷰와 데이터 무결성 최종 검토만 `model: fable`(동시 하나, `name` 부여), 할 일이 정해진 구현·이식·탐색은 `model: sonnet`(웹 기준본을 확정한 뒤 Kit·`:kit` 미러 이식을 과제 단위로 맡긴다. 산출은 게이트 종료 코드와 그 뒤의 opus 리뷰로 받는다).

### 위원장 판정 (2026-10-05, 코디네이터 세션)

1. **TAGO 출처 이름은 「국토부 TAGO」다**(A60). 버스 답변이든 지하철 첫차·막차 답변이든 같은 한 줄이다. 키를 나누지 않는다.
2. **자동차 안내 문장의 1km 이상 거리는 km로 말한다, 값 그대로**(A60 부수 관찰). 「천호대로를 따라 2197m 이동」 → 「천호대로를 따라 2.197km 이동」. 1km 미만은 종전대로 m. 앱의 다른 거리 표기(`formatDistance`: 원값, 후행 0 없음)와 완전히 같은 규칙이다(같은 날 재판정: 코디네이터가 처음 물을 때 예문을 「2.2km」로 잘못 들었고, `small-13`의 판정 요청 `judgment-202610050452.md`로 다시 물어 값 그대로로 확정).
3. **웹 출처 줄 넷은 앱과 같은 문구다**(E58 ⑦). 「출처: 서울특별시 공공데이터(서울 열린데이터광장) 따릉이.」 꼴. 대상 키는 `bike.source`·`eventsNearby.source`·`subwayArrival.source`·`subwayNearby.source`이고 뒷부분(「따릉이.」, 「문화행사 정보. 오늘 진행 중인 행사만 표시합니다.」, 「지하철 실시간 도착정보.」)은 그대로 둔다.

4. **E67·E66 문장과 조작**(`ios-reorder` 판정 요청 `judgment-202610050431.md`): 이동 뒤 통지는 「2번째로 옮겼습니다」(새 자리만) · 「기본 순서로 되돌리기」 뒤 통지는 「기본 순서로 되돌렸습니다」 · 탭 순서 화면에도 「맨 위로」를 둔다(E67과 같은 조작법).

E64~E67의 판정은 2026-10-05 접수 세션에서 끝났다(BACKLOG 각 본문). 건너는 길 이름 졸업은 2026-10-04 위원장 판정이고 선행 조건(2.1 승인)이 찼다.

### 코디네이터 판정 (제품 판단이 아닌 설계 사항)

1. **`CLAUDE.md`는 코디네이터만 고친다**(현재 72KB/80KB). 세션은 새 함정의 상세를 `docs/PATTERNS.md`·`docs/INTEGRATIONS.md`의 같은 제목 절에 쓰고, `CLAUDE.md`에 들어갈 규칙 한두 줄과 낡게 된 기존 문장은 완료 보고의 "공유 자산 반영 요청"에 문장 그대로 적는다. 이번 회차에 낡는 줄: 실험 플래그 목록(건너는 길 이름·탭 순서), 도보 판본 2의 「길 이름은 iOS 실험판만」, 탭 순서(K1) 줄, 자동차 경로 행, API 키 표와 무관한 출처 문구.
2. **서버 응답 변경의 하위 호환은 세션이 스토어 빌드의 코드로 판정한다.** `git show 49c47afb:<파일>`·`git show 5d57aad0:<파일>`·`git show 5104808d:<파일>`로 2.1·2.0·1.19가 새 응답을 받았을 때 ⓐ 문장 부분 문자열·정규식에 건 판정이 깨지는가 ⓑ 낭독이 종전보다 나빠지는가를 본다. 해당하면 옵트인(쿼리 파라미터)으로 내고 미지정 응답은 종전 그대로 둔다. 새 구조화 필드는 additive로 싣는다. 앱이 새 서버 동작에 의존하면 웹 배포가 앱보다 먼저다. 자동차 km 표기(위원장 판정 2)는 스토어 빌드가 그 문장을 다시 파싱하는 자리가 있는지부터 본다(`rewriteCarGuidance`의 정규식은 이미 `k?m`을 받는다).
3. **건너는 길 이름 졸업의 범위**: iOS는 `AppConfig.experimentalCrossingRoadEnabled` 블록과 `#if`를 삭제한다(항상 참 상수 금지). 웹·안드로이드가 같은 문장을 받게 할지와 서버 옵트인 `crossingRoad=1`을 `wording=2`의 기본값으로 접을지는 `small-13`이 판정 2의 방법으로 정한다(스토어 2.1 정식판은 `wording=2`만 보내고 길 이름 없는 문장을 받는다: 그 빌드가 길 이름 문장을 받아도 되는가가 축이다). 가드 `e62-crossing-road-gate.test.ts`는 새 계약으로 고쳐 남긴다(삭제하지 않는다).
4. **E66과 E67은 한 세션이다.** 둘 다 「위로」·「아래로」 로터 액션이고 이동 뒤 커서 유지·새 자리 통지가 같은 계약이라, 조작 헬퍼와 문자열 키를 한 벌로 만든다. 순서는 E67 먼저(Kit 순수 함수 + 테스트), 그 위에 E66.
5. **안드로이드 범위**: E64는 `:kit` 미러와 앱 호출 자리까지 이번 회차에 한다(위원장 판정이 웹·iOS·안드로이드다). E65·E67의 안드로이드 이식은 iOS 실기기 판정 뒤라 범위 밖이고, E66은 대상 밖이다. 다만 Kit을 고친 세션은 공유 fixture와 미러 등록부 게이트가 요구하는 만큼 `:kit`을 맞춘다.
6. **실기기 배포는 코디네이터가 전 세션 통합 뒤 메인 체크아웃에서 한다**(공식판·실험판 두 구성). 세션은 `deploy-device.sh`를 돌리지 않는다. 세션의 iOS 검증은 Kit `swift test`와 앱 타깃 빌드(Release·Experimental 구성 차이를 만지는 세션은 두 구성 모두)까지다.
7. **App Store 제출·npm 발행·안드로이드 배포는 범위 밖.** 세션은 What's New에 적을 문장만 보고에 남긴다. 다음 iOS 릴리스 여부는 통합 뒤 코디네이터가 위원장에게 묻는다.
8. **범위에서 뺀 것**: E47(ODsay 실호출은 비용) · N4 자동차 경유지(실주행 판정 선행) · E51 후속 ⑤·B13·E58 후속 ①(나들이 실보행 뒤) · E48 후보 ②③(실승차 뒤) · E45 웹 브리핑(보류 유지) · 웹 전용 대기 묶음(E33 웹·B6·B8·B9 안내 중 전환) · E14 ③·E15 ③(설계 선행) · PORTS open 행 중 조건부 셋(어휘 확장·Live API·경량 경로를 건드릴 때. `gemini-2.5` 참조는 `src`에 0건임을 코디네이터가 확인했다).

## 2. 파일 소유권 지도

술어는 "이름이 나오는가"가 아니라 "그 세션이 그 파일을 고쳐야 하는가"다. 아래는 코디네이터가 함수 자리를 열어 확인한 목록이고(관측 `cf8c5cf9`), 세션이 틀린 자리를 발견하면 보고한다(코디네이터가 재현해 §6에 정정 절을 단다). 큰 파일은 **소유 단위가 파일이 아니라 함수·영역**이다.

| 세션 | 소유 |
|---|---|
| `e64-order` | 웹 `src/lib/directions-order.ts`(`orderDirectionsModes`)와 테스트 · 공유 fixture `src/lib/__tests__/fixtures/directions-order-scenarios.json` · `src/components/DirectionsView.tsx`의 `orderDirectionsModes` 호출 자리 · Kit `Directions.swift`의 `DirectionsOrder.orderModes`와 그것을 부르는 초기화 자리 · `DirectionsTests.swift` · `ios/Gildongmu/Directions/DirectionsTabView.swift`에서 그 Kit 타입에 대중교통 소요 시간을 넘기는 자리만 · `:kit` `Directions.kt`·`DirectionsTest.kt` · 안드로이드 앱 `directions/DirectionsViewModel.kt`의 호출 자리와 `DirectionsViewModelTest.kt` |
| `e65-rotor` | 서버 `src/lib/nearby-overview.ts`·`overview-lines.ts`·`src/app/api/nearby/overview/route.ts`와 테스트(좌표·상세 진입 필드 additive) · Kit `Models/NearbyModels.swift`(`OverviewPlace`·`OverviewStation`)·`LocationNarrative.swift` · `:kit` `models/NearbyModels.kt`·`LocationNarrative.kt`·`NearbyOverviewTest.kt`(디코딩·fixture 정합만큼) · iOS `Nearby/AroundNearbyView.swift`·`SurroundingsSceneSection.swift`·`SubwayNearbyView.swift`·`BusNearbyView.swift` · `SearchView.swift`의 `PlaceRow` 구조체(액션 묶음을 재사용하려 꺼내야 하면 그 구조체만) · `messages`·`ios-extra`의 자기 키 · `packages/cli/src/lib/formatters.ts`는 overview 출력이 바뀔 때만(additive 필드를 찍지 않으면 손대지 않는다) |
| `ios-reorder` | Kit `RecentSearchStore.swift`와 `RecentSearchStoreTests.swift`(이동 순수 함수, 고정 블록 순서 불변식) · `SearchView.swift`의 최근 검색어 행과 `togglePinRecent` 부근 · `DirectionsTabView.swift`의 최근 경로 행과 모델의 `setRoutePinned` 부근 · `DirectionsEndpointSearchView.swift`의 최근 장소 행 · E66: `GildongmuApp.swift`(`AppTab`·탭 구성) · `AppConfig.swift`의 `experimentalTabOrderEnabled` 블록 · `SettingsView.swift` 일반 묶음의 한 줄 + 탭 순서 화면(새 파일) · 가드 `src/lib/__tests__/settings-topic-sections.test.ts` 묶음표 · `messages`·`ios-extra`의 자기 키 · BACKLOG §2 K1 탭 순서 판정 행의 E66 행 교체 |
| `small-13` | `AppConfig.swift`의 `experimentalCrossingRoadEnabled` 블록 · `BeaconModel.swift`·`DirectionsTabView.swift`의 `crossingRoad:` 인자 두 자리 · Kit `RouteService.swift`와 테스트 · 서버 `src/app/api/route/walk/*`·`src/lib/walk-route-url.ts`·`walk-route.ts`·`walk-guidance.ts`의 `crossingRoad` 처리와 비-ko `parts`(A58 잔여) · `src/lib/chat/router.ts`의 `crossingRoad` 자리 · 가드 `e62-crossing-road-gate.test.ts` · 웹·안드로이드 동조를 판정하면 `:kit` `RouteService.kt`와 웹 호출 자리 · A60: `messages/*.json`의 `chat.source.tago`(6로케일)와 그 생성물, `SourceList.test.tsx` 등 기대값 · 자동차 km: `src/lib/car-guidance.ts`(`rewriteCarGuidance`)와 테스트·fixture 기대값 · E58 ⑦: `messages/*.json`의 출처 키 넷(6로케일) · PORTS 확인: `src/__ab__/report.ts`의 safety 판정 문구(고칠 것이 있으면 그 줄) |

**경계**

- `DirectionsTabView.swift`는 세 세션이 서로 다른 자리를 고친다: `e64-order`는 조회 결과를 Kit 순서 판정에 넘기는 자리, `ios-reorder`는 최근 경로 행과 고정 토글 부근, `small-13`은 도보 줄 목록 조회의 `crossingRoad:` 인자 한 줄. 자기 자리 밖 줄을 정리·개명하지 않는다.
- `SearchView.swift`는 `e65-rotor`가 `PlaceRow`(파일 뒤쪽 구조체), `ios-reorder`가 최근 검색어 행(파일 앞쪽)을 고친다.
- `AppConfig.swift`는 `ios-reorder`가 탭 순서 블록, `small-13`이 건너는 길 이름 블록을 고친다.
- `messages/*.json`·`ios/i18n/ios-extra/*.json`은 자기 키만. 생성물(xcstrings·`ios/i18n/arg-order.json`·안드로이드 strings와 `android/i18n/arg-order.json`·`android/kit/mirrors/*.json`)은 rebase 뒤 재생성하고 손으로 병합하지 않는다.
- 로터 액션 문자열: 「위로」·「아래로」·「맨 위로」와 이동 통지 키는 `ios-reorder`가 만든다. 「○○ 상세 보기」·「여기까지 길찾기」 등 E65가 쓰는 액션 이름은 **이미 있는 키를 그대로 쓴다**(`PlaceRow`·브리핑 E45가 쓰는 키. 새로 짓지 않는다).
- 안내 판정 계층(리듀서 세 벌, `BeaconModel`의 안내 로직)은 이번 회차 누구의 소유도 아니다. `small-13`의 `BeaconModel.swift` 수정은 `crossingRoad:` 인자 한 자리뿐이다.
- 뒤에 통합하는 세션은 rebase 뒤 게이트(웹·Kit·`:kit`·앱 빌드 중 자기가 만진 층)를 다시 돌린다.

**통합 순서**: 준비된 순서대로. `e65-rotor`는 서버 additive가 앱보다 먼저 배포돼야 하지만 한 번의 push로 둘 다 올라가도 된다(앱은 코디네이터 설치 시점에 반영되고, 스토어 빌드는 새 필드를 무시한다).

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
- xcodebuild는 `-derivedDataPath ~/gildongmu-wt/<이름>-dd`. 앱 타깃 빌드는 통합 직전에 돌리고 성공을 확인하면 그 폴더를 바로 지운다. 통합 뒤 `ios/GildongmuKit/.build`·`android/*/build`도 지운다.
- 리뷰 전에 전부 커밋하고 리뷰어는 `git diff origin/main...HEAD`(3점)로 읽는다. 리뷰가 도는 동안 rebase·커밋 금지. 리뷰 보고는 `~/gildongmu-wt/<이름>-reports/review-<주제>-<YYYYmmddHHMM>.md`.
- 실기기 배포·App Store 제출·npm 발행·`vercel` 수동 배포·env 변경·유료 API 대량 호출 금지. ODsay 실호출은 건당 과금이라 하지 않는다. 카카오·Tmap 실호출 게이트는 무료 한도 안에서 필요한 만큼만 돌리고 건수를 보고에 적는다.

## 4. 웨이브

1. **웨이브 1**: `e64-order` · `e65-rotor` · `ios-reorder` · `small-13` 동시(빌드는 게이트 락이 한 번에 하나로 줄 세운다).
2. **통합 뒤** 코디네이터가 `CLAUDE.md` 반영 요청을 모아 반영(`AGENTS.md` 재생성), 메인 체크아웃에서 실기기 두 구성 설치(아이폰이 연결돼 있을 때), PORTS 원장 갱신.
3. **끝**: `doc-audit` 새 창. 다음 iOS 릴리스(건너는 길 이름 졸업 + E64·E65·E67 정식판 도달분)와 CLI/MCP 태그는 위원장 지시가 있을 때 별도 세션.

## 5. 착수 프롬프트와 보고 경로

착수 프롬프트 사본은 `~/.claude/parallel-sessions/gildongmu/<이름>.prompt.txt`, 보고 디렉터리는 `~/gildongmu-wt/<이름>-reports/`(단계별 새 파일 `start`·`integrating`·`done`·`blocked`·`judgment` + `-<YYYYmmddHHMM>.md`, 리뷰 보고 `review-*`, 기준 SHA `base.sha`). 보고는 파일과 `SendMessage` 둘 다, 코디네이터 주소는 `gildongmu-a9 [a3c1fa]`. 위원장 판정이 새로 필요하면 세션이 `judgment-*.md`에 쉬운 한국어로 질문·선택지·각 선택지에서 위원장이 듣게 될 문장을 적어 통보하고, 코디네이터 세션이 위원장에게 묻는다.

## 6. 정정 (코디네이터가 재현해 확인한 것)

- **2026-10-05 04:30, 관측 `45ebec39`, 출처 `e65-rotor` 착수 보고(코디네이터 재현 확인)**: 지하철역 목록의 역 제목 액션(상세 보기·여기까지 길찾기)에는 역 좌표가 필요한데 근접 역 응답 `NearbySubwayStation`(`src/lib/types.ts`)에 좌표 필드가 없다. §2 `e65-rotor` 소유에 **`src/lib/providers/subway-nearby.ts`·`src/lib/types.ts`의 `NearbySubwayStation` 필드(`lat`·`lng`, 옵트인 `coords=1`일 때만. 채팅 도구가 역 객체를 Gemini 입력으로 펼치므로 미지정 응답은 불변으로 둔다: 세션 보고, 코디네이터 미재현)와 그 테스트**를 더한다. 다른 세 세션의 변경 파일에 이 둘이 없음을 확인했다. overview 쪽은 세션 설계로 옵트인 `places=1`(미지정 응답 불변: 채팅 도구 입력과 CLI/MCP 출력이 불지 않게)이다.
- **2026-10-05 04:40, 관측 `24e9cc4a`: `e64-order` 종료.** 통합 `24e9cc4a`(E64 종결: 세 벌 미러 + fixture 18건, 앱 호출부 무변경, 서버 응답 무변경, `CLAUDE.md` 반영 요청 없음). 코디네이터가 보고 전문과 `45ebec39..24e9cc4a` 변경 파일이 소유 목록 안임을 확인하고 창을 닫고 worktree를 지웠다. What's New 문장과 §2 E64 실사용 행은 세션 보고 `done-202610050431.md`.
- **2026-10-05 05:00, 관측 `6757624c`: `ios-reorder` 종료.** 통합 `6757624c`(E67·E66 코드 종결, 리뷰 4종 반영, 서버 응답 무변경). 새 파일: Kit `Reorder.swift`·앱 `ReorderActions.swift`·`TabOrderView.swift`·`:kit` `Reorder.kt`, spec `2026-10-05-reorder-rotor-actions-design.md`. 소유 밖 자진 신고(코디네이터가 변경 파일 목록으로 확인): `DirectionsTabView.swift` body를 `ScrollViewReader`로 감싸는 2줄과 재착지 Task 취소 한 줄씩, `android/README.md` K1 구절, 안드로이드 strings·`android/i18n/arg-order.json` 재생성(`ios-extra` 키를 안드로이드 생성기도 싣는다: §2 경계의 "생성물 재생성"에 안드로이드 strings가 `ios-extra`만 고친 세션에도 해당한다), BACKLOG 새 A61(언어 전환 때 길찾기 프리필 재조회). `CLAUDE.md` 반영 요청 두 줄은 보고 `done-202610050454.md`. **열린 판정 하나**: 안드로이드 실험판은 K1 고정 순서(검색 맨 앞)를 유지해 iOS 실험판(채팅 맨 앞 + 설정)과 기본 순서가 갈린다. PORTS 등록 후보: E67 안드로이드 이식(iOS 실기기 판정 뒤).
- **2026-10-05 05:05, 관측 `0bba3ab1`: `e65-rotor` 종료.** 통합 `0bba3ab1`(E65 코드 종결, 리뷰 4회 BLOCKER 0, 프로덕션 실호출 6건). 새 서버 계약(둘 다 옵트인, 미지정 응답 byte-identical): `/api/nearby/overview?places=1`(`nearest[].place`·`event`, `station.lat`·`lng`) · `/api/station/subway-arrival/nearby?coords=1`(`stations[].lat`·`lng`). 소유 밖 자진 신고(코디네이터가 변경 파일 목록으로 확인): `PlaceDetailView.swift`·`NearbyHubView.swift` 각 두 줄(길찾기 허용 인자 명시), `RouteBriefing.swift`·`StationPhoneStore.swift`(전화 라벨 공용화, 브리핑 동작 불변), 근접 역 라우트와 테스트. 위원장 판정(2026-10-05): 역 제목 로터의 「전화 걸기」는 E45처럼 늘 둔다. `CLAUDE.md` 반영 요청 두 줄(+선택 한 줄)은 보고 `done-202610050501.md`. PORTS 등록 후보: E65 안드로이드 앱 층 이식(iOS 실기기 판정 뒤).
- **2026-10-05 05:15, 관측 `624ad2b8`: `small-13` 종료, 웨이브 1 종료.** 통합 `624ad2b8`(건너는 길 이름 졸업 · A60 출처 이름과 자동차 km · A58 잔여 en `parts` · E58 ⑦ · PORTS gildongmu 행 소비). **건너는 길 이름은 옵트인을 판본 2의 기본값으로 접었다**: 이 배포부터 스토어 2.1 정식판·웹·안드로이드가 길 이름 문장을 받는다(위원장 판정 "다음 릴리스에서 졸업"보다 앞당겨졌다. 하위 호환 판정 근거는 spec `2026-10-03-crosswalk-guidance-design.md` §3.5, 코디네이터는 그 절을 읽었고 2.1 코드를 직접 대조하지는 않았다. 위원장에게 고지함). 통합 SHA: `e64-order` `24e9cc4a` · `ios-reorder` `6757624c` · `e65-rotor` `0bba3ab1` · `small-13` `624ad2b8`. 창 넷 모두 닫고 worktree·`feat/*` 브랜치 0. 코디네이터 처리: `CLAUDE.md` 반영 요청 8건 반영(73.6KB/80KB)과 `AGENTS.md` 재생성, 세션 관찰을 BACKLOG에 등재(A62 en 도보 Tmap 제어 문자 502 · A63 채팅 출처 줄 분절 · A64 내 주변 복귀 재조회 통지 반복 · D32 `Format.swift` 주석), PORTS 원장 gildongmu "모델 전환 안전 게이트" 행 `[done]`.
