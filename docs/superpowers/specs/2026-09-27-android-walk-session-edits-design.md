# 안드로이드 도보 안내 wave 2 — 안내 중 변경 5종 (M4b)

- 날짜: 2026-09-27 · 세션 `android-m4b` · base `104e1ea3`
- 근거: 위원장 판정 2026-09-27(M4b를 이번 동기화에 넣는다), 병렬 계획 `docs/superpowers/plans/2026-09-27-android-release-sync-parallel-plan.md` §1 판정 2
- iOS 정본: `BeaconModel.swift`(`reacquireRoute`·`changeDestination`·`setWaypoint`·`removeWaypoint`·`requestVariantSwitch`·`performReroute(.switchTo)`·`commitLineSwitch`·`alternativePreviewState`·`open/close/adoptAlternativePreview`·`resetAlternativePreview`), `BeaconTrackingSheet.swift`, `GuideTitleMenu.swift`, `GuideOverviewSheet.swift`(`BeaconOverviewAdapter`·`WalkAlternativePreviewSheet`), `SurroundingsSceneSection.swift`, `GuideSessionCoordinator.swift`(`GuideFormSyncStore`·`waypointAvailable`), `DirectionsTabView.swift`(`consumeGuideFormSync`·`runQuery(silently:)`)
- 상위 spec: `2026-08-12-guide-destination-menu-design.md`(목적지 메뉴·장소 상세·폼 동기화), `2026-08-14`(대안 프리뷰), `2026-09-23-walk-two-lines-kakao-design.md` §4(두 줄 전환), `2026-09-24-waypoint-progress-design.md`(N4), `2026-09-11-transit-station-to-place-and-landing-design.md` §1.2(안내 시트 위 장소 상세는 표준 중첩)
- **설계 리뷰 판정**: 적대적 설계 리뷰 1회(fable, `~/gildongmu-wt/android-m4b-reports/review-design-202609270705.md`) — BLOCKER 0·MAJOR 4·MINOR 8·NIT 3, 갈림길 셋(시트 안 페이지·헤딩+버튼 제목 메뉴·push+최소화 장소 상세) 모두 유지. MAJOR 4건(검색 페이지 앱 통지 소유·왕복 중 종료 표식 잔류·프리뷰 리셋 자리와 페이지 후퇴·주변 확인 조회 수명)과 MINOR #6·#9·#10·#11·#12 반영, #5(위치 없음 문장)·#7(키 계상 — 12키는 이번에 새로 넣는 것이 diff로 확인됨)·#8(`copy`로 컴파일됨)·#13(작업 메뉴 순서 순수 함수는 README 화면 관용구) 기각.

## §1. 범위

| # | 기능 | 모델(판정·전이) | 화면 |
|---|---|---|---|
| ① | 세션 중 목적지 바꾸기 | `WalkGuideModel.changeDestination(dest, label): Boolean` | 제목 메뉴 "목적지 바꾸기" → 끝점 검색 페이지(`EndpointSearchContent` 재사용) |
| ② | 경유지 추가·변경·삭제 | `setWaypoint(dest, label): Boolean` · `removeWaypoint(): Boolean` | 시트 버튼 "경유지 추가" / "{C}, 경유지 변경" + "경유지 삭제" → 같은 검색 페이지 |
| ③ | 두 줄 사이 대안 프리뷰·채택 | `sessionLine`·`alternateLine`, `openAlternativePreview`·`closeAlternativePreview`·`adoptAlternativePreview`, 낡음 폴백 `requestVariantSwitch`, `commitLineSwitch` | 조망 페이지 "대안 경로 보기" → 프리뷰 페이지(헤더·전환·단계·닫기) |
| ④ | 안내 시트에서 장소 상세 | — | 제목 메뉴 "장소 상세" → `PlaceDetailRoute(showsDirectionsEntry = false)` 스택 push, 시트 최소화 → 복귀 시 재개 |
| ⑤ | 주변 확인 | — | 추적 중 시트(진행 상황 다음)·종료 화면(`endKind != stopped`, 닫기 앞)에 목적지 기준 버튼형 `SceneButtonSection` |
| 폼 | 길찾기 폼 동기화 | `GuideFormSync`(iOS `GuideFormSyncStore`) | `DirectionsViewModel.applyGuideFormSync()` + 무통지 조회 |

**범위 밖**: 장소 상세 화면의 "여기로 목적지 변경"·"여기를 경유지로" 버튼(iOS `PlaceDetailView` N1 §2.5) — 안드로이드 장소 상세에 아직 없고 `place/**`는 이번 소유가 아니다(BACKLOG E43 M4b 항목의 후속으로 남긴다). 자동차·대중교통 안내(M5)의 목적지 변경.

## §2. 모델 상태·전이 (`WalkGuideModel`)

### §2.1 세션 인자

- `WalkStartRequest`에 `alternate: WalkLineKind?`를 더한다(기본값 없음 — A13 규율). 호출부 `walkGuideStartSlot`이 `s.walkLines`에서 `line`이 아닌 첫 알려진 줄을 넘긴다(iOS `model.walkLines.lazy.compactMap(\.lineKind).first { $0 != kind }`).
- 모델에 `sessionLine`·`alternateLine`을 둔다. 시작 값으로 정하고 **전환 커밋(`commitLineSwitch`)에서만** `accessible`·`sessionVariant`와 함께 바뀐다(iOS 동형: `sessionVariant = target.variant; accessible = target.isAccessible; alternateLine = sessionLine; sessionLine = target; syncStartRequestWithSession()`).
- `syncStartRequestWithSession`은 목적지·라벨·경유지뿐 아니라 요청 축 넷(`accessible`·`variant`·`line`·`alternate`)을 세션 현재값으로 맞춘다 — 전환 뒤 `restart()`가 고른 줄로 되돌아가지 않게(A13).
- `fetchDetailData`에 `accessible` 인자를 더한다(전환은 커밋 전까지 세션 축을 건드리지 않고 목표 줄의 축으로 조회). 결과에 `lineKind`(응답 `kind`)를 싣는다.

### §2.2 경로 재획득 `reacquireRoute()` (iOS 동형, `stop()`의 부분집합)

세션(서비스·톤·스트림·워치독·토큰)은 유지하고 경로·목적지 종속 상태만 내려놓은 뒤 `awaitingRoute = true` + `startFixWaitWatch`로 **시작과 같은 기계**를 다시 태운다(다음 수용 fix가 `fetchGuideRoute`를 부른다 — 조회 왕복 동안 옛 경로의 회전·도착 신호가 나갈 창이 구조적으로 없다).

내려놓는 것: 진행 중 조회 잡(`routeFetchJob`·`fixWaitJob`)·`routeOriginBest`, `rerouteToken`·`routeFetchToken` 증가, `isRerouting`·`isSwitchingVariant`·`rerouteInFlight` false, `offRoute` false, `clearProposal()`, `resetAlternativePreview()`, 경로·상태·표시 유닛·하단 2행·잔여 행·띠바 거리·`lastGuidance`·`pendingRecovery`·`pendingStepFreeNotice`·`lastStepFree`, `resetFinalApproach(null)`, `mode = brief`, `statusText = ""`, 목적지 종속 추세(`beaconState`·`gateState`·`toneState`). **승계**: `motionState`(도플러 — 위치 종속), 유도기 버퍼 `carriedCourseDerivation = guideState?.courseDerivation`(재획득 진입마다 덮어쓰고 — 대기 중 다시 바꾸면 앞선 버퍼 유지 — 다음 `fetchGuideRoute` 성공이 1회 소비, `fallbackToBrief`·`stop`이 비운다. iOS는 폴백에서 비우지 않아 다음 재조회로 옛 이력이 샌다 — 옮기지 않는다), 자동 조회 회차 카운터(세션당).

### §2.3 목적지·경유지

- `changeDestination(dest, label)`: 추적 중이 아니면 false(호출부는 폼도 건드리지 않는다). 같은 좌표면 라벨만 갱신 + `android.guide.destChanged` 즉시 통지(재조회 없음). 아니면 `dest`·`destinationLabel` 교체, `waypointPassedInSession = false`(n4 인계 1), `syncStartRequestWithSession`, `reacquireRoute`, 통지 `destChanged + " " + destChangedFetching`.
- `setWaypoint(dest, label)`: 추적 중이 아니면 false. 같은 좌표면 라벨만 + `waypointKept`. 아니면 교체·동기화·`reacquireRoute`·`waypointSet`.
- `removeWaypoint()`: 추적 중 ∧ 경유지 있음이 아니면 false. 비우고 동기화·`reacquireRoute`·`waypointRemoved`.
- 세 통지 모두 `announceNow(…, highPriority = true, bypassSuppression = true)` — 활성화의 직접 응답이라 억제(검색 페이지)·착지 낭독에 잠식되면 "버튼이 동작하지 않는다"가 된다(iOS `.high`).
- 경유지 추가 진입점은 ko에서만 보인다(iOS `waypointAvailable = beacon.isTracking ∧ dataLocale == ko`). 삭제·변경은 경유지가 있을 때만.
- 경유지 도착(`GuideEvent.WaypointReached`) 분기의 n4 주석 자리에 `resetAlternativePreview()`를 채운다.
- 폼의 경유지는 경유지 **도착**으로 지우지 않는다(폼은 사용자 질의, iOS spec §4.3). 삭제도 폼에 보내지 않는다(iOS `removeWaypoint` 주석 — 폼 via를 지우는 것은 사용자 몫).

### §2.4 대안 프리뷰·채택

상태 `AltPreviewState`(iOS `AlternativePreviewState`): `Idle` · `Fetching(token)` · `Ready(proposal, fetched)` · `NoRoute` · `Failed` — "대안 없음"과 "조회 실패"를 가른다(3-state). 토큰 `altPreviewToken` latest-wins.

- 노출 술어 `alternativePreviewAvailable = mode == detail ∧ alternateLine != null`(조망 행동 슬롯이 이 값으로 버튼을 낸다 — 죽은 버튼 금지).
- `openAlternativePreview()`: 노출 술어 ∧ `dest`가 있어야. 토큰 증가 → `Fetching` → 조회. **origin은 모델 최신 수용 fix(15초 이내, `rerouteOrigin()`)** — iOS는 `LocationService.currentCoordinate()`로 새로 재지만 안드로이드 모델은 스트림 fix만 보고 재조회(`performReroute`)도 같은 origin을 쓴다. 신선도 기준 시각 `acquiredAt = lastFixCoordAt`(좌표와 한 쌍). 없으면 `Failed` — iOS도 위치 오류를 같은 catch로 `altPreviewFailed`에 싣는다(설계 리뷰 #5 기각 근거). 커밋 가드: 토큰·추적 중·상세·목적지·경유지 불변. 응답 null → `NoRoute` + polite 통지 `altPreviewNone`, 성공 → `Ready` + polite 통지(헤더 문장), 예외 → `Failed` + `altPreviewFailed`.
- `closeAlternativePreview()` = `resetAlternativePreview()`(토큰 증가 + `Idle`). 초기화 자리: 닫힘·`commitReroutedRoute`·`reacquireRoute`·경유지 도착·**최종 접근 진입(`beginFinalApproach`)**·`stop()` — 여섯(iOS 동형; 문 앞 전환은 최종 접근을 푼다). 채택 가드에 `!inFinalApproach`(방어 2선).
- `adoptAlternativePreview()`: `Ready` ∧ `!rerouteInFlight` ∧ `alternateLine`. 신선(최근 fix 15초 ∧ `RerouteProposalGate.isFresh`)하면 `commitLineSwitch(target)` → `commitReroutedRoute(fetched)` → 열화 통지 결합 → 문장 `variantSwitch(route, first, fetched.lineKind ?: target)` + success 진동 + high 통지 → `variantAdoptedSeq += 1`. 낡았으면 `requestVariantSwitch()`(같은 목표 줄로 현위치 재조회, 프리뷰는 열린 채).
- `requestVariantSwitch()`는 안드로이드에 버튼이 없다(iOS도 수동 전환 버튼 폐기) — 낡음 폴백 전용. `clearProposal`·`rerouteInFlight`·`isSwitchingVariant = true`·토큰 증가 → `performReroute(token, SwitchTo(target))`. 성공 커밋은 `commitLineSwitch` → `commitReroutedRoute`와 같은 원자 블록이고 `variantAdoptedSeq += 1`. 실패는 재조회 실패와 같은 문장·진동.
- 헤더 문장(iOS `alternativePreviewHeaderText`): 조회 중 `altPreviewLoading`, 없음 `altPreviewNone`, 실패 `altPreviewFailed`, 준비 = `joinText(altPreviewSummary(줄 이름, 총거리), altPreviewTime(분 — 소요>0일 때), altPreviewRemaining(지금 경로 잔여 — 이탈 중엔 거짓이라 생략), 서버가 줄 이름을 주지 못했으면 stepFreeNotice)`. 줄 이름은 받은 경로의 성질 우선(`fetched.lineKind ?: alternateLine`).
- 화면 투영: `ui.altPreviewOpen`·`altPreviewReady`·`altPreviewSteps` + `ui.alternativePreviewAvailable` + `ui.isSwitchingVariant` + `ui.variantAdoptedSeq`, 헤더 문장은 페이지가 `altPreviewHeaderText()`를 `ui` 변화마다 다시 읽는다(잔여가 fix마다 바뀐다). 프리뷰 단계에는 "지금 이 구간" 표식이 없다(대안 경로 위에 현재 위치가 없다).

### §2.5 자동 재조회와의 관계

iOS 그대로: 전환·재조회·자동 채택은 하나의 토큰 계열(`rerouteToken`)과 `rerouteInFlight`를 공유하고, `commitReroutedRoute`가 프리뷰를 무효화한다. 전환 시작은 진행 중 자동 조회를 폐기한다(`clearProposal`). 프리뷰 조회는 자기 토큰만 쓰고 `rerouteInFlight`를 잡지 않는다(보기일 뿐).

## §3. 폼 동기화

- `guide/GuideFormSync.kt`(새 파일, iOS `GuideFormSyncStore`): `pending: StateFlow<DirectionsEndpoint.Place?>`·`pendingWaypoint`, `post`·`postWaypoint`·`take`·`takeWaypoint`(읽고 비우는 한 연산). 목적지·경유지 채널을 가른다(한 값이면 "도착지 없이 경유지만 바뀜"을 표현할 수 없다).
- 게시 자리: 시트의 검색 확정 콜백 — 모델 함수가 true를 돌려줄 때만(세션에 반영되지 않은 선택은 폼에 보내지 않는다).
- 소비 자리: `DirectionsViewModel`의 진입점 하나 `applyGuideFormSync()` — `init`에서 두 흐름을 collect(프리필 관용구). 목적지가 폼 도착지와 다르면 출발지를 현재 위치로(안내 세션이 실제로 그렇다) + 도착지 확정(`setEndpoint` — 최근 기록 경로 그대로), 경유지가 다르면 `setVia`. 바뀐 것이 있으면 `runQuery(silently = true)`.
- **무통지 조회**: 안드로이드 `notice`는 화면 상태 줄이자 라이브 리전이다. 무통지 조회 동안에는 국면·완료 문장으로 `notice`를 올리지 않는다(진동 포함 — 안내 발화와 경합할 이유가 없다, iOS §5.3). 필드 변경의 `clearResults`가 이미 `notice`를 빈 문장으로 비웠으므로 낡은 문장이 남지 않는다 — 대신 iOS와 달리 보이는 결과 요약 문장도 비어 있다(결과 행 자체는 그려지므로 기능 손실은 아니다, 의도). 표식은 다음 `runQuery` 진입이 매번 다시 정한다.

## §4. 시트 구조

`ModalBottomSheet` 하나 안의 **페이지 전환**이 정본이다(기존 `overviewOpen` 관용구의 일반화). 안드로이드 시트는 자기 윈도라 그 위에 또 시트를 올리는 것보다 같은 윈도 안의 페이지가 TalkBack 스코프를 한 곳에 가둔다. 페이지: `Tracking` · `Overview` · `AltPreview` · `Search(to|via)`. 뒤로(시스템 백)는 한 단계 위로(AltPreview → Overview → Tracking, Search → Tracking). 페이지 상태는 `TrackingContent`의 `remember` — 도착으로 종료 화면이 되면 통째로 사라진다(iOS가 도착 시 조망을 명시적으로 닫는 것과 같은 결과). **프리뷰가 사용자 조작 밖에서 비워지면**(자동 채택·경유지 도착·최종 접근 — 원인 쪽이 이미 통지했다) 프리뷰 페이지는 조망으로 물러나 [대안 경로 보기]에, 조망도 사라졌으면 제목에 착지한다(iOS는 헤더가 "조회 중"에 갇히는 잠재 결함 — 옮기지 않는다). 채택 성공과 리셋은 모델의 한 동기 블록에서 바뀌므로 화면은 두 신호를 한 효과에서 본다.

### §4.1 추적 중 페이지 읽기 순서 (iOS `BeaconTrackingSheet`)

제목 행(제목 메뉴 버튼 + 접기) → [ko] 경유지: 없으면 "경유지 추가", 있으면 "{C}, 경유지 변경" + "경유지 삭제" → 진행 상황 → 주변 확인(버튼형 섹션) → 재조회(이탈 시) → 간략 주석 → 잔여 → 하단 2행 → 상태 → 소리 행들 · 최하단 고정 "안내 종료".

### §4.2 제목 메뉴 (iOS `GuideTitleMenu`)

제목 행은 **헤딩 + 버튼** 한 객체(라벨 = 종전 제목 `joinText(도보 안내, 목적지)`, 헤딩 로터 항행 보존)이고 누르면 `DropdownMenu`에 두 항목 "장소 상세"(`android.guide.destMenuDetail`)·"목적지 바꾸기"(`destMenuChange`) — 메뉴 순서는 순수 함수 `guideTitleMenuItems()`로 잠근다(README 화면 관용구). 열리면 첫 항목에 착지(팝업 윈도로 커서를 옮기는 것은 TalkBack 관례이지 보장이 아니다). iOS 헤딩+팝업 버튼 조합 동형. **실기기 판정 조건**: 헤딩+버튼 조합 낭독이 어색하면 iOS와 같은 폴백(제목은 텍스트 헤딩 유지 + 섹션 첫 행 메뉴 버튼). 대안(제목 헤딩에 `customActions`만): TalkBack 밖 사용자에게 진입점이 없어 기각. 종료 화면 헤딩에는 메뉴가 없다(끝난 세션에 "목적지 바꾸기"가 성립하지 않는다).

### §4.3 끝점 검색 페이지

`EndpointSearchContent(picker, state, onBack)`를 시트 안에서 그대로 쓰고 수정하지 않는다. `EndpointPicker`는 시트가 만든다(`closesOnSelect = true`, `onSelect` = 대상별 `changeDestination`/`setWaypoint` → true면 `GuideFormSync` 게시 → Tracking 복귀). 서비스·최근 저장소는 `AppConfig`에서, 근접 가중 좌표는 null(세션 fix는 모델 밖으로 내지 않는다 — 가중치일 뿐 결과 정확성과 무관). 최근 기록은 폼 동기화의 `setEndpoint`가 한다(iOS 동형 — 세션에 반영되지 않은 선택은 기록도 없다). 검색 페이지의 상태 줄(`StatusLine`)은 검색 화면 통지 전용이다 — `LocalModalOpen = true`로 감싸 앱 통지(`AppNotices`)를 집지 않는다(시트 윈도와 밑 탭이 둘 다 RESUMED라 소유자가 둘이 되고, 집으면 "위치 해제"가 후보 수와 한 문장으로 붙는다). 시트는 IME를 밀어 올리지 않으므로 페이지 루트에 `imePadding`. 검색 페이지가 열린 동안 `GuideSession.setOutputSuppressed(true, owner)`(iOS 검색 시트 억제 동형 — 안드로이드엔 마이크가 없지만 TalkBack 입력 반향과 안내 TTS가 겹친다. 보류된 실행 안내 최신 1개는 해제 때 복구 발화). 해제는 `DisposableEffect` onDispose(도착으로 페이지가 사라져도 풀린다). 현재 위치 선택 버튼은 도착지·경유지 대상에서 원래 없다.

### §4.4 장소 상세 중첩

`NavController.openGuidePlace(place, returnTo)`(guide/ui, `openWeightSettings` 선례): 시트 최소화(`isMinimized = true`, `suppressNextBandLanding = true`) → `PlaceDetailRoute.of(place)`에 `showsDirectionsEntry = false`(목적지 상세; 주변 확인 행의 상세는 iOS처럼 기본값 true) push → push된 **그 엔트리 id**가 백스택에서 빠지면 시트를 다시 연다(`getBackStackEntry<PlaceDetailRoute>()` 타입 조회는 다른 탭에 원래 있던 상세를 잡아 오판한다). 재개 시 착지는 `GuideSession.pendingSheetReturn`(제목 또는 그 장면 행 키) 1회 소비 — 다음에 컴포즈되는 시트 콘텐츠(추적·종료 화면)가 무조건 소비하고, 그 행이 없으면(앵커가 바뀌어 장면이 새로 시작) 제목·종료 문장으로 물러난다. `hasScreen`이 아니면 재개하지 않고 **두 표식(`pendingSheetReturn`·`suppressNextBandLanding`)을 함께 지운다**(왕복 중 알림 "안내 종료"·안전망 종료가 다음 세션 착지를 깨지 않게). 탭 전환도 복귀로 본다(선례 `openWeightSettings` 동형 — 되돌아오면 상세는 시트 뒤에 남는다). 상세를 읽는 동안 화면 유지(`KeepScreenOn`)가 풀리는 것은 설정 선례와 같은 의도된 동형(안내는 서비스 wake lock으로 산다). 안내 신호는 억제하지 않는다(iOS — 임박 큐는 안전 계층).
- 이 화면은 `GuideBottomBar`가 NavController를 받아야 한다 → `nav/AppRoot.kt` 호출 한 줄 교체(`GuideBottomBar(GuideNav(onOpenSettings, onOpenPlace))`, 코디네이터 허가, 자진 신고). 목적지 상세의 `Place`는 `:kit guideDestinationPlace`, 라우트는 `PlaceDetailRoute.of(place).copy(showsDirectionsEntry = …)`(`place/**` 무수정).

### §4.5 주변 확인 (버튼형)

`nearby/SceneSection.kt`에 `SceneButtonSection(lookup, requesterFor, onOpenPlace)`를 새로 두고, 자동 펼침과 묶음·항목·더 보기·출처 렌더를 `SceneGroups`로 공유한다(위치 문장은 버튼형만 — 자동 펼침은 부모 위치 문장이 같은 내용을 말한다). 상태는 `SceneLookup`(같은 파일, `:kit NearbyLoadCore` + `Fixed(anchor)` + `NearbyService.surroundingsScene`): `busy`·`refreshFailed`·`closed`·phase·묶음 창. **인스턴스는 `GuideSession`이 화면 자리(추적·종료) × 앵커 단위로 든다** — 장소 상세 왕복에 시트 컴포지션이 사라져도 펼친 목록과 커서 자리(행 키)가 남아야 하고(iOS는 중첩 시트라 시트가 산다), 종료 화면은 백지로 시작한다(iOS `arrivalSection`의 새 섹션 동형). 앵커가 바뀌면 새로 만들고 새 세션 시작이 버린다. **조회는 세션 스코프**라 시트를 접어도 끝까지 가고, 섹션이 컴포지션을 떠나 있는 동안 끝난 조회는 착지를 소비된 것으로 둔다(돌아온 시트의 진입 착지와 두 번 갈리지 않게 — 결과는 펼쳐진 채 남는다). 끝점 검색 피커는 반대로 시트의 `rememberCoroutineScope` — 닫힘·최소화가 곧 검색 취소다. 통지 채널 없음(iOS 동형 — 조회 중 = 트리거 `stateDescription`, 성공 = 결과 헤딩 착지, 빈·실패 = 메시지 행 착지, 닫기 = 트리거 착지). 라이브 리전 없음.

## §5. 착지

| 전이 | 착지 |
|---|---|
| 검색 페이지 진입 | 검색 입력(`EndpointSearchContent` 자체) |
| 검색 확정·뒤로 | 제목 |
| 경유지 삭제(버튼 소멸) | 제목(선점) |
| 제목 메뉴 열림 | 첫 항목 |
| 제목 메뉴를 고르지 않고 닫음 | 제목 |
| 장소 상세에서 복귀 | 제목(메뉴) / 그 장면 행(주변 확인) |
| 조망 → 대안 보기 | 프리뷰 헤더 |
| 프리뷰 닫기 | 조망의 "대안 경로 보기" 버튼 |
| 채택 성공(`variantAdoptedSeq` 증가 — 전이에만) | Tracking 제목(조망·프리뷰 통째 소멸) |
| 프리뷰가 조작 밖에서 비워짐 | 조망의 "대안 경로 보기"(조망도 없으면 제목) |
| 주변 확인 로드 | 결과 헤딩 / 메시지 행; 닫기 → 트리거 |
| 띠바 복귀·도착 전이·재조회 소멸 | 종전 그대로 |

전부 `land()`(한 프레임 + 400ms, 실패 시 600ms 재시도) + `landingTarget`.

## §6. 통지

모델 발화 창구 하나(TTS, `announce`/`announceNow`) — 시트엔 라이브 리전이 없다(M4 §5-3). 활성화 응답(목적지·경유지)은 `announceNow` high·억제 우회, 전환·채택 성공은 high + success 진동, 프리뷰 결과는 polite. 길찾기 탭 폼 동기화는 무통지. 새 문자열 12키(`android.guide.viewAlternative`·`adoptAlternative`·`altPreviewLoading/None/Failed/Summary/Time/Remaining`·`switchedToShortest/Accessible/Broad/Recommended` — ios-extra의 비접두 `guide.*`라 자동 도입되지 않는다, `autoReroute` 선례)는 android-extra 6로케일에 ios-extra 문안 그대로. 목적지·경유지 문장과 메뉴 라벨(`destChanged*`·`waypoint*`·`destMenu*`)은 ios-extra `ios.guide.*`가 이미 `android.guide.*`로 도입돼 있다.

## §7. 소유 파일

`A/guide/**`(WalkGuideModel·WalkGuideUiState·WalkStartRequest·GuideText·GuideStrings·GuideSession·ui/GuideSheet·ui/GuideBottomBar·ui/WalkGuideStartButton·ui/WeightSettingsNav·**새** GuideFormSync·ui/GuidePlaceNav), `A/directions/DirectionsViewModel.kt`(폼 동기화·무통지 조회), `A/nearby/SceneSection.kt`(버튼형·공유 렌더), `A/nav/AppRoot.kt` 한 줄(허가), `android/i18n/android-extra/*.json`(12키) + 생성물, 테스트. `place/**`·`EndpointPicker`·`EndpointSearchContent`·`:kit` 무수정.

## §8. 테스트

JVM: 목적지 변경(같은 좌표·다른 좌표·재조회 URL·`waypointPassedInSession` 초기화·세션 없음 false), 경유지 추가·같은 좌표·삭제, 재획득이 옛 경로 응답을 버림, 프리뷰(없음·실패·준비 헤더·닫힘 뒤 늦은 응답 폐기·경유지 도착 초기화·채택 신선/낡음·채택 뒤 재시작 요청이 새 줄), 폼 동기화(목적지·경유지·같은 값 무동작·무통지), 소스 가드(제목 메뉴 순서 순수 함수, 검색 억제 해제 onDispose, `openGuidePlace`가 엔트리 id로 판정), 문자열 매핑. androidTest: 추적 페이지 읽기 순서 한 줄(컴파일만).
