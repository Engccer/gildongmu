# E74 안내 시트 제목 행 밀기 동작 + 「현재 경로와 다른 길로 가기」 설계 (2026-10-19)

설계 리뷰 판정: 생략. 실험판 봉인 뒤의 UI 재배치이고 판정(BACKLOG E74 1~6)이 확정돼 있다. 새 판정 계층·외부 계약·저장 포맷이 없고, 재조회 채택은 기존 `fetchProposal` 경로에 사용자 선언 갈래 하나를 더하는 것이라 A70(설계 리뷰 거침)의 채택 검사를 그대로 지난다(계획 문서 §1 표).

정본 판정: `docs/BACKLOG.md` E74. 범위: **iOS 실험판만**. 정식판은 지금 팝업 메뉴·경유지 두 행 그대로다.

## 1. 봉인

- 새 게이트 `AppConfig.experimentalGuideTitleActionsEnabled`(`#if EXPERIMENTAL`). 실험판은 참, 그 밖은 거짓.
- 소비자는 두 시트의 제목 자리(도보·자동차 `BeaconTrackingSheet`, 대중교통 `TransitTrackingSheet`)뿐이다. 실험판 갈래는 `GuideTitleActionsRow`를 섹션 첫 행으로 두고 헤더를 비우며, 정식판 갈래는 종전 헤더(`GuideTitleRow` + `GuideTitleMenu`)와 경유지 두 행을 그대로 둔다. 정식판 갈래의 조건은 `!AppConfig.experimentalGuideTitleActionsEnabled`로 써서 상수 거짓일 때 종전 코드와 같은 뷰가 된다.
- 「다른 길로 가기」의 모델 진입점 `BeaconModel.requestDifferentRoute()`는 실험판 갈래의 밀기 버튼에서만 부른다.
- 가드 `guidance-gate-drift.test.ts` §9가 새 플래그를 센다: 행 생성 자리 두 곳과 `requestDifferentRoute()` 호출 한 곳이 플래그 조건 안에 있고, 종전 메뉴·경유지 행은 `!플래그` 조건 안에 있다.
- 나들이 시트(`OutingSheet`)는 제목에 동작이 없다(목적지가 없는 세션). 바꾸지 않는다.

## 2. 제목 행(판정 2·3·4)

`GuideTitleActionsRow`(`GuideTitleMenu.swift`): 섹션 첫 `List` 행. 내용은 종전 헤더와 같은 `GuideTitleRow`(왼쪽 제목, 오른쪽 접기 아이콘)이고, 제목은 `Text(joinText(수단, 목적지))` + `.isHeader`(헤딩 로터 보존). 그 행 뿌리에 밀기 버튼 두 묶음.

| 밀기 | 버튼(선언 순 = 가장자리부터) | 조건 |
|---|---|---|
| 오른쪽(`leading`) | 현재 경로와 다른 길로 가기 | 도보·자동차, 상세 안내 중이고 최종 접근 전(`canRequestDifferentRoute`) |
| | 경유지 추가 / {경유지}, 경유지 바꾸기 | 도보·자동차, `waypointAvailable` |
| | 경유지 삭제 | 미도착 경유지가 있을 때 |
| 왼쪽(`trailing`) | 목적지 바꾸기 | 여정(E70) 단계가 아닐 때 |
| | 장소 상세 보기 | 늘 |

- 거는 순서와 들리는 순서는 E72 `PlaceRowActions`와 같은 관측 조건을 따른다(왼쪽 묶음을 안쪽에 먼저, 오른쪽 묶음을 바깥에). VoiceOver 동작 목록에서 오른쪽 묶음이 먼저, 묶음 안은 선언 순이라 판정 3의 순서(다른 길 → 경유지 → 목적지 바꾸기 → 상세)가 된다.
- 끝까지 밀기 실행은 두 묶음 다 끈다(`allowsFullSwipe: false`, 판정 2 — 넷 다 되돌릴 수 없다).
- 대중교통 시트는 오른쪽 묶음이 없다. 판정 원문은 "나머지 셋"이지만 대중교통 안내에는 경유지가 없다(ODsay가 경유역을 받지 않는다, N4). 그래서 목적지 바꾸기·장소 상세 둘이다.
- 「다른 길로 가기」가 서지 않는 국면(간략 안내·최종 접근)에는 버튼 자체가 없다. 직선 안내로 바꾸는 갈래는 두지 않는다(E16 축2). 누를 수 없는 이유가 있는 자리에 죽은 버튼을 두지 않는다.
- 접기 아이콘은 같은 행의 오른쪽 끝에 남는다. 읽기 순서는 종전과 같이 제목 → 접기.

### 2.1 착지 바인딩

종전 `GuideTitleRow`가 메뉴와 행을 나눈 이유(착지 바인딩을 메뉴에 직접 달기)는 E57·E38에서 제목 착지가 폐기돼 이미 쓰이지 않는다. 지금 착지 대상은 도보·자동차 첫 정보 행(`SheetFocus`)과 대중교통 상태 문장(`SheetControl.status`)이고, 둘 다 제목 아래 행이라 제목이 행으로 내려와도 부착 자리가 바뀌지 않는다. 가드 `guide-sheet-landing-guard.test.ts`·`transit-landing-guard.test.ts`가 그대로 초록이어야 한다.

### 2.2 동작 뒤 커서

- 목적지 바꾸기·경유지 추가/바꾸기: 종전과 같다(검색 시트가 닫힌 뒤 첫 정보 행, `landAfterDismiss`).
- 경유지 삭제: 종전과 같은 `requestInfoLanding(note: "waypointRemoved")`. 종전 근거(누른 버튼이 사라진다)는 없어졌지만, 경로를 바꾸는 제목 행 동작은 전부 새 경로의 첫 정보 행에 앉는다는 한 규칙으로 맞춘다.
- 다른 길로 가기: 성공하면 같은 규칙으로 첫 정보 행(채택 세대 `differentRouteAdoptedSeq` → `requestInfoLanding(note: "differentRoute")`, 통지가 끝난 뒤). 실패하면 커서는 제목 행에 남는다.

## 3. 「현재 경로와 다른 길로 가기」(판정 1)

자동 재조회와 같은 길(`fetchProposal`)을 사용자 선언 갈래로 연다.

- **예산 공유**: `proposalFetchCount`(세션 5회)를 함께 쓴다. 소진이면 조회 없이 실패 결말.
- **진행 중 조회**: 자동 조회가 돌고 있으면 버린다(토큰 증가, 선언이 이긴다). 버튼 재조회·줄 전환·앞선 선언이 돌고 있으면 새 조회를 열지 않고 접수 문장만 다시 말한다(버튼은 남긴다 — 숨기면 누를 때마다 동작 목록 순서가 당겨져 다른 동작이 실행될 수 있다, 증분 리뷰 m1).
- **접수 통지**: 받아들인 순간 「경로를 조회하고 있습니다.」(`ios.guide.destChangedFetching`, 목적지 바꾸기의 조회 중 문장)를 `.high`로 — 조회가 수 초 걸려 그동안 무반응 버튼이 되지 않게(헌장 §5, 리뷰 MAJOR 1·접근성 W2). 문안은 판정 요청(`judgment-*.md`)에 기본값으로 올렸다.
- **이탈 여부 무관**: 자동 조회의 `offRoute` 조건을 선언 갈래는 보지 않는다. 경로 위에서 눌러도 지금 위치에서 다시 조회한다. 선언이 도는 동안 경로로 돌아와도(`backOnRoute`) 그 조회를 버리지 않는다(이탈과 무관하게 연 조회다). 최종 접근 진입·경유지 도착·목적지 변경·세션 종료는 종전대로 버린다.
- **채택 검사**: 신선도(`RerouteProposalGate.isFresh` + 최근 fix 15초)는 그대로 지난다. 새 경로 첫 점 검사(A70 `routeStartsNearby`)는 사용자 조회 규칙을 따른다: 거부하지 않고 받으며 「경로 시작점이 {8방위}쪽으로 {거리} 떨어져 있습니다.」를 앞에 붙인다(A70 판정 Q3 — 사용자가 연 조회를 거부하면 막다른 길이다). 근거: 이 동작은 사용자 선언이다.
- **성공 문장**: 자동 재조회와 같은 `GuideText.autoReroute`(「새 경로로 다시 안내합니다. …」, 도보는 방향 머리말 포함). 상태 행은 머리말을 뺀 문장(A57). `.high`, 성공 진동. **시작점 고지가 붙으면 방향 머리말은 뺀다** — 머리말은 새 경로 시작점에서의 첫 15m 방향이라 "시작점 쪽"과 다른 쪽을 가리킬 수 있다(리뷰 MAJOR 2, 버튼 재조회에도 머리말이 없다).
- **실패 결말**(경로 없음·신선도 미달·조회 실패·예산 소진): 「새 경로를 찾지 못했습니다.」(`ios.guide.differentRouteFailed`, 위원장 판정 2026-10-19 — 직접 누른 동작이라 E69 ⓐ 자동 갈래 문장에서 「자동으로」를 뺐다. 자동 갈래는 그 문장 그대로)를 **`.high`로 매번** 말하고 상태 행에도 두며(버튼 재조회 실패와 같다) 실패 진동. 이탈 중이면 버튼 래치를 세워 「경로 다시 조회」가 선다(E69 ⓐ). 자동 갈래의 "회차당 한 번" 래치와 운전자 채널 침묵을 선언 갈래는 따르지 않는다 — 사용자가 방금 누른 동작의 응답이라, 말하지 않으면 무반응 버튼이 된다(헌장 §5 활성화 응답 `.high`).
- 로그: `differentRoute request n=`(예산 사용 수)·`rerouteAdopt source=declare result=…`(`adopted`·`none`·`stale`·`failed`·`budget`), 첫 점 거리는 `routeStartGap source=declare`.

## 4. 문자열(판정 5)

- `ios.guide.differentRoute`(신규): ko 「현재 경로와 다른 길로 가기」, en "Take a different route", ja 「今のルートとは別の道で行く」, es "Ir por otro camino", fr "Prendre un autre chemin", it "Prendi un'altra strada".
- `ios.guide.titleWaypointChange`(신규, `{label}`): ko 「{label}, 경유지 바꾸기」, en·ja는 `ios.guide.waypointChange`와 같은 값(en "change" 그대로). es·fr·it는 한 동작 목록에 나란히 들리는 경유지 추가·삭제와 명사를 맞췄다(es 「cambiar punto intermedio」, fr 「changer l’étape」, it 「cambia tappa」 — 접근성 감사 I8). 기존 키를 고치지 않는 이유: 정식판 경유지 행이 그 키를 쓰고 판정 6이 라벨 통일까지 실험판에 봉인했다. 졸업 때 옛 키와 옛 행을 함께 지운다.
- `ios.guide.differentRouteFailed`(신규): 자동 갈래 `guide.rerouteAutoGaveUp`의 각 로케일 번역에서 「자동으로」에 해당하는 말만 뺀 꼴(ko 「새 경로를 찾지 못했습니다.」, en "Couldn't find a new route.", ja 「新しい経路を見つけられませんでした。」, es "No se pudo encontrar una ruta nueva.", fr "Impossible de trouver un nouvel itinéraire.", it "Impossibile trovare un nuovo percorso."). 실험판 봉인 안의 유일한 소비자 `differentRouteFailed`. 가드 `reroute-button-visibility-guard.test.ts`.
- 경유지 추가·삭제·목적지 바꾸기·장소 상세 보기는 기존 키(`directions.addVia`·`ios.guide.waypointRemove`·`ios.guide.destMenuChange`·`ios.guide.destMenuDetail`).

## 5. 실기기·실보행 판정 항목(BACKLOG §2 E74 행)

1. 제목 행이 「헤딩」이면서 「동작 사용 가능」으로 읽히는가, 낭독이 어색하지 않은가.
2. 접기 아이콘이 같은 행에 있어도 동작 목록이 제목에서 들리는가, **접기 버튼에서도 들리는가**(행 안에 접근성 객체가 둘이다 — 둘 다에 붙거나 어디에도 안 붙으면 접기 아이콘을 행 밖으로 옮기거나 VoiceOver에서만 숨기는 갈래를 판정한다. 어디에도 안 붙으면 VoiceOver 사용자가 경유지·목적지 바꾸기를 잃으므로 졸업 문턱이다).
6. 최종 접근 직전·직후에 동작 목록 맨 앞의 「다른 길로 가기」가 사라져 순서가 당겨지는 것이 헷갈리지 않는가, 대중교통 시트에서 빈 오른쪽 밀기가 열리지 않는가, 실험판의 빈 섹션 헤더가 여백을 남기지 않는가.
3. 들리는 순서가 판정 3과 같은가, 보이는 밀기 버튼의 글자(「현재 경로와 다른 길로 가기」는 길다)가 읽히는가.
4. 경로 위에서 누르면 대개 같은 경로가 다시 온다(지금 위치에서 가장 좋은 길이 지금 길이다). 의도된 쓰임(다른 길로 걷기 시작한 뒤 누른다)에서 1분 대기와 이탈 경고를 건너뛰는가.
5. 실패 문장 「새 경로를 찾지 못했습니다.」가 들리는가(직접 누른 갈래), 자동 재조회 실패는 「새 경로를 자동으로 찾지 못했습니다.」 그대로인가.

## 6. 범위 밖

웹·안드로이드(실험판 봉인이 iOS에만 있다) · 나들이 시트 · 졸업.
