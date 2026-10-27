# E75 도보·자동차 안내 시트: 「경로 새로고침」 버튼 + 「지금 여기는 어디?」 + E74 졸업 설계 (2026-10-27)

설계 리뷰 판정: 생략. 위원장 판정 8건(BACKLOG E75)과 코디네이터 설계 판정(계획 `2026-10-27-backlog-sweep-14-parallel-plan.md` §1 판정 2·3·4)이 확정돼 있고, 내용은 UI 재배치와 플래그 졸업이다. 새 상태 머신·외부 계약·저장 포맷이 없다. 재조회는 E74 `requestDifferentRoute()` 그대로이고(§3의 예산 판정 하나만 바뀐다), 「지금 여기는 어디?」의 주변 조회는 기존 둘러보기 장면(`/api/surroundings/scene`)을 기준 좌표만 바꿔 부른다. 위치 조회가 `{force:true}` 계열인지는 spec-compliance 리뷰가 본다.

정본 판정: `docs/BACKLOG.md` E75 1~8. 범위: iOS 정식판·실험판 둘 다(봉인 없음). 웹 E69 버튼·안드로이드는 손대지 않는다.

## 1. E74 졸업(판정 8)

- `AppConfig.experimentalGuideTitleActionsEnabled`와 그 `#if EXPERIMENTAL` 블록을 삭제한다. 항상 참인 상수를 남기지 않는다. 식별자는 iOS 어디에도 0건이다(`guidance-gate-drift.test.ts` §9가 센다).
- 세 시트(도보·자동차 `BeaconTrackingSheet`, 대중교통 `TransitTrackingSheet`)의 제목은 섹션 첫 행 `GuideTitleActionsRow` 하나다. 섹션 헤더는 비운다.
- 종전 정식판 갈래를 함께 지운다: 팝업 메뉴 `GuideTitleMenu`, 도보·자동차 시트의 경유지 두 행(「{경유지}, 경유지 변경」·「경유지 삭제」 버튼 행), 키 `ios.guide.waypointChange`.
- 경유지 동작 라벨은 `ios.guide.titleWaypointChange`(「{경유지}, 경유지 바꾸기」) 하나로 남는다.
- 파일 `GuideTitleMenu.swift`는 남는 공용 뷰(`GuideTitleActionsRow`·`GuideTitleRow`·`GuideMinimizeButton`·새 `GuideRefreshButton`·`GuideStopButton`)를 담아 `GuideTitleActionsRow.swift`로 개명한다. 나들이 시트(`OutingSheet`)는 `GuideTitleRow`만 쓰고 E74 게이트 밖이었으므로 바꾸지 않는다.
- 안드로이드는 iOS `waypointChange`를 `android.guide.waypointChange`로 개명해 들여 쓴다(`GuideSheet.kt`). 원천 키를 지우면 안드로이드 문자열도 빠지므로 6로케일 값을 `android/i18n/android-extra`로 옮긴다(CLAUDE.md 안드로이드 문자열 규칙).

## 2. 「경로 새로고침」(판정 1·2·3)

### 2.1 자리와 모양

- 제목 행 오른쪽, 접기 아이콘 왼쪽. 읽기 순서는 제목 → 경로 새로고침 → 안내 시트 접기.
- `GuideRefreshButton`: 접기(`GuideMinimizeButton`)와 같은 틀. `Image(systemName: "arrow.clockwise")`, `.font(.body)`, 터치 영역 `minWidth/minHeight 44`, `.buttonStyle(.borderless)`, 이름은 `accessibilityLabel(appLocalized("ios.guide.differentRoute"))`.
- 제목은 나머지 폭을 쓴다. 긴 목적지는 버튼 앞에서 줄바꿈한다(`GuideTitleRow`의 `HStack` + `Spacer(minLength: 8)` 그대로).
- 키 `ios.guide.differentRoute` 값 교체: ko 「경로 새로고침」, en "Refresh route", es "Actualizar ruta", fr "Actualiser l'itinéraire", it "Aggiorna percorso", ja 「経路を更新」(앱 안 「새로고침」·Refresh·Actualizar·Actualiser·Aggiorna·更新과 같은 낱말).
- 밀기 동작 묶음에서 「다른 길로 가기」가 빠진다. 오른쪽 밀기는 경유지 추가·바꾸기와 경유지 삭제만 남는다. 들리는 동작 순서는 경유지 → (경유지 삭제) → 목적지 바꾸기 → 장소 상세 보기.

### 2.2 노출 조건(코디네이터 판정 2)

- `model.canRequestDifferentRoute`(추적 중 ∧ 상세 ∧ 최종 접근 전)일 때 선다. 간략·최종 접근 중엔 없다.
- 종전 「경로 다시 조회」(E69, `offRoute && rerouteGaveUp`)를 덮는다: 그 래치는 상세 모드에서만 서고(`requestReroute`가 `mode == .detail`을 요구), 최종 접근 진입은 이탈 표시와 래치를 함께 내린다(`BeaconModel` 최종 접근 진입의 `entry == .offRoute` 갈래). 그래서 E69 버튼이 눌러서 동작하던 국면은 전부 `canRequestDifferentRoute`가 참인 국면이다. 간략 강등(`fallbackToBrief`)은 이탈 표시를 내리지 않아 E69 버튼이 간략 세션에 남을 수 있었지만, 그 버튼은 `requestReroute`의 상세 가드에 막혀 아무 일도 하지 않았다. 새로고침은 그 자리에 서지 않는다.
- 대중교통 시트에는 없다(판정 7).

### 2.3 상태 신호

- 조회 중에 라벨을 바꾸지 않는다. 누르는 순간 접수 문장 「경로를 조회하고 있습니다.」(`.high`)가 응답이다(E74 그대로). 라벨 교체는 커서가 그 버튼에 있을 때만 들리고 그 밖엔 잡음이다.
- 조회 중에 다시 누르면 접수 문장만 다시 말한다(E74 그대로).
- 채택이면 새 경로 요약(`.high`) 뒤 첫 정보 행으로 착지한다(E74 `differentRouteAdoptedSeq` 그대로). 실패면 「새 경로를 찾지 못했습니다.」(`.high`, 상태 행에도)이고 커서는 버튼에 남는다.

### 2.4 목록 안 「경로 다시 조회」 삭제(판정 3)

- 시트의 E69 버튼 행, `BeaconModel.showsRerouteButton`·`requestReroute()`·`isRerouting`을 지운다(소비자가 그 버튼뿐이다). 착지 대상 `.reroute`와 "누른 결과로 버튼이 사라질 때"의 착지(`reroutePressed`·`offRoute` 해제 착지)·그 근거 값 `offRouteEndedByReroute`도 함께 지운다. 새로고침 버튼은 이탈 해제로 사라지지 않으므로 그 착지가 필요 없다.
- E69 래치 `rerouteGaveUp`과 자동 갈래 문장 「새 경로를 자동으로 찾지 못했습니다.」는 남긴다. 래치는 회차의 첫 진단 로그(`rerouteButton cause=`) 한 번만 가르고, 문장의 회차당 한 번은 `rerouteGaveUpSpoken`이 가른다. 문장 뒤 사용자의 다음 행동이 버튼 대신 경로 새로고침이다. 운전자 채널 이탈 문장의 꼬리도 iOS 전용 키 `ios.guide.carOffRoute`로 「경로 새로고침」을 가리킨다(웹·안드로이드는 공유 `guide.carOffRoute` 그대로).

## 3. 예산 판정(이 spec의 유일한 동작 변경)

- E74는 선언 조회가 자동 재조회의 세션 예산 5회(`proposalFetchCount`)를 함께 썼다. 소진이면 실패 결말을 냈고, 그때 이탈 중이면 E69 버튼이 예비 출구였다(`requestReroute`는 예산을 보지 않는다).
- E69 버튼이 사라지면 예산 소진 뒤 이탈한 사용자는 수동 출구가 없다. 그래서 **선언 조회는 예산을 보지 않고 세지도 않는다**(종전 E69 수동 재조회와 같은 위치). 예산은 앱이 묻지 않고 거는 자동 조회의 상한이다. 사용자가 누르는 조회는 누르는 횟수가 상한이다.
- 로그 `differentRoute request n=`의 n은 그 시점 자동 예산 사용 수 그대로다. `rerouteAdopt source=declare result=budget`은 더 나오지 않는다.

## 4. 「지금 여기는 어디?」(판정 4·5·6)

### 4.1 버튼

- 「진행 상황」 버튼과 「주변 확인」(`SurroundingsSceneSection`, 목적지 앵커) 섹션을 지우고 그 자리에 버튼 하나 「지금 여기는 어디?」(새 키 `ios.guide.whereNow`)를 둔다. 누르면 늘 조망 창을 연다.
- 간략·경로 미보유 세션도 창을 연다(종전엔 낭독뿐). 창 머리(헤더)가 진행 문장 한 줄이고 본문은 주변이다(코디네이터 판정 3 기본안). `announceProgress()`는 소비자가 없어지면 지운다.
- 6로케일: ko 「지금 여기는 어디?」, en "Where am I now?", es "¿Dónde estoy ahora?", fr "Où suis-je maintenant ?", it "Dove sono adesso?", ja 「今ここはどこ？」.

### 4.2 창

- 종전 조망 창 `GuideOverviewSheet` + `BeaconOverviewAdapter` 그대로. 머리 = 진행 문장, 행 = 구간 목록(경로 보유 시), 행동 = 대안 보기(도보). 그 뒤에 「주변 상황」 헤딩(`surroundings.ready`) + 주변 목록, 맨 끝 닫기.
- 주변은 능력 프로토콜을 넓히지 않는다(프로토콜 머리 주석의 봉인 — 조망 전용). 셸에 선택 인자 `showsHereSurroundings: Bool`(기본 거짓)을 두고 도보·자동차 시트만 참으로 넘긴다. 대중교통 조망은 그대로다(판정 7).
- 상단 닫기는 행이 있거나 주변이 있을 때 선다(간략 세션에서도 주변이 길 수 있다).
- 착지는 종전처럼 창 첫머리(헤더 = 진행 문장)이다. 주변 섹션은 포커스를 옮기지 않는다. 조용히 나타나는 섹션이라 「주변 상황」 헤딩이 발견 경로다(헌장 §3).
- 장소 행은 장소 상세로 여는 링크다(`SurroundingsSceneGroupsView` 공유). 그래서 도보·자동차 시트는 창을 `NavigationStack`으로 감싸고 루트의 내비게이션 바를 숨긴다(빈 바가 머리보다 먼저 착지 후보가 되지 않게).
- 위치 문장(장면의 `place`, 지금 위치의 주소)은 그대로 보인다. "지금 여기는 어디?"의 답이 그 문장이다.

### 4.3 주변 기준과 위치 조회(판정 6, 코디네이터 판정 3)

- 기준은 지금 내 위치다. 조회는 창이 열릴 때 한 번 한다.
- 좌표는 `LocationService.shared.currentCoordinate(force: true)`. 추적 중엔 스트림의 최신 fix를 재사용 게이트(신선도·정확도)로 거른 값이고, 게이트를 못 넘으면 실패다(옛 좌표를 "지금"으로 말하지 않는다). 추적 밖이면 캐시를 버리고 새로 잰다. 수동 위치(`ManualLocationJudge`)는 거치지 않는다(실시간 안내는 실좌표, CLAUDE.md 현위치 수동 지정 규칙).
- 상태 표시(3-state): 조회 중 「주변 조회 중…」, 위치 실패 `manualLocation.gpsFailed`, 권한 거부 `ios.common.geoDeniedTitle`, 정확한 위치 꺼짐 `ios.common.geoReducedTitle`, 한국 밖 `ios.common.outOfCoverage`, 0건 `surroundings.empty`, 서버 실패 `surroundings.error`. 장면 조회는 `SurroundingsSceneModel`에 좌표 소스 인자를 더해 재사용한다(골격 복붙 금지).
- 조회 중 문장 행에 커서가 있는 채로 결과가 오면(그 행이 사라진다) 커서를 「주변 상황」 헤딩으로 옮긴다(헌장 §5 포커스 이탈 방지).
- 도착 종료 화면의 주변 확인(목적지 앵커 `SurroundingsSceneSection`)은 바꾸지 않는다.

## 5. 착지 계약 변화

- `SheetFocus.reroute` → `.refresh`(새로고침 버튼). 착지 대상이 아니라 "커서가 사라지는 버튼 위에 있었는가"를 읽는 자리다. 행 존재 사본은 `canRequestDifferentRoute`, 소실 복구 집합(`presentInfoRows`)에 든다: 최종 접근 진입·간략 강등으로 버튼이 사라질 때 커서가 그 위였으면 그 통지 뒤 첫 정보 행으로 간다. 첫 정보 행 후보는 여전히 남은 거리 → 윗줄 → 상태 문장.
- 「지금 여기는 어디?」 창을 닫으면 종전처럼 `landAfterSubSheet`(트리거 복원 또는 대기 착지).

## 6. 가드

- `guidance-gate-drift.test.ts` §9: 졸업 플래그 식별자 0건, `GuideTitleMenu`·`ios.guide.waypointChange` 0건, `GuideTitleActionsRow(` 생성 두 곳(도보·대중교통)이 조건 없이 선다, `requestDifferentRoute` 호출은 새로고침 버튼 한 곳.
- `guide-sheet-landing-guard.test.ts`: 재조회 성공 착지 검사를 새로고침 소실 복구 검사로 바꾼다.
- `reroute-button-visibility-guard.test.ts`: iOS ① 렌더 검사를 "E69 버튼 0건 + 새로고침 노출 = `canRequestDifferentRoute`"로 바꾸고, 선언 조회가 예산을 보지 않는 것을 잠근다. ②③ 래치 검사는 유지한다. 안드로이드·웹은 그대로.

## 7. 안드로이드 이식

이번 범위 밖. PORTS 등록 제안: 안드로이드 `GuideSheet.kt`는 아직 E69 버튼·진행 상황·경유지 행 구조다. 이식 여부는 위원장 판정(완료 보고에 제안).
