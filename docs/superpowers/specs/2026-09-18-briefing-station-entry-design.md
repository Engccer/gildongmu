# 경로 브리핑에서 지하철역 상세·전화 (E45)

> 2026-09-18 판정 세션. 판정 정본은 `docs/BACKLOG.md` §5 E45. **iOS 전용·서버 변경 없음**(심사 동결 정합 — 좌표는 길찾기 탭이 이미 `includeStops: true`로 받고 있다, `DirectionsTabView.swift:572`). 선례는 E33 안내 시트 역 진입(`2026-09-11-transit-station-to-place-and-landing-design.md`), E44 역 전화번호(`2026-09-17-station-detail-reorg-design.md`), 채팅 산문 계약(`ChatConversationView.blockView`). 착수는 별도 세션.
>
> **설계 리뷰 완료**(§9, 서브에이전트 1회 2026-09-18). BLOCKER 4건 전부 근거 확인 후 채택, 판정 ②를 위원장 재확인으로 뒤집었다. 이 문서는 그 반영본이다.

## 1. 문제

**요청**(위원장 2026-09-18): "길찾기 탭에서 경로를 조회했을 때 대중교통 브리핑에서 바로 지하철역 상세로 들어갈 수 있으면 좋겠어. 그리고 지하철역 항목에서 로터만으로 전화를 걸 수 있으면 좋겠어."

**현행 공백**: 같은 기능이 안내 시트에는 있고(E33 상태 문장 로터, E44 경유역 행) **출발 전 브리핑에는 없다**. 브리핑(`TransitRouteRows`)은 전부 순수 `Text`다.

**제약**: 브리핑은 처음부터 끝까지 순차로 읽는 화면이다. 줄을 늘리거나 한 줄을 여러 접근성 객체로 쪼개면 읽기 비용이 직접 올라간다(헌장 §4).

## 2. 판정 기록 (위원장 2026-09-18, 순차 문답)

| # | 판정 | 비고 |
|---|---|---|
| ① | **역 이름이 나오는 모든 줄**에 진입점 | 세션 초안("구간 줄 한 자리")을 기각. 그 안은 "어느 줄에서 열어야 하는가"를 사용자가 외워야 했다 |
| ② | ~~역 1개인 줄은 줄 전체 탭 = 역 상세~~ → **개정: 역 개수와 무관하게 순수 텍스트 + 로터 액션** | 아래 정정 ② |
| ③ | 로터는 **역별로 묶어** 등장 순 | "A역 상세 보기" → "A역에 전화 걸기" → "B역 상세 보기" → "B역에 전화 걸기" |
| ④ | 전화 액션은 **상시 노출 + 결과 통지** | 번호 없음·찾는 중·조회 실패를 액션 부재로 뭉개지 않는다(헌장 §1 3-state) |
| ⑤ | **안내 시트 경유역 목록도 상시 노출로 통일** | E44 §5.5 개정. ④의 근거가 그 화면에도 성립하고, 지하는 통신이 끊기기 쉬워 더 필요하다 |
| ⑥ | 문구는 다른 UI와 일관 | §6 |
| ⑦ | 실기기 판정에서 **버튼 로터 축 오염·로터 훑는 비용은 제외** | 위원장 경험상 우려 지점이 아니다. 정정 ②로 버튼 자체가 사라져 전자는 성립하지도 않는다 |

**정정 ①**(위원장 지적): 액션 라벨의 역 이름 언어를 앱 언어 기준으로 두려던 세션 판정을 **기각**하고 줄 언어에 묶었다(§6). 실측도 함께 했다(§6 말미).

**정정 ②**(위원장 판정, 리뷰 R1 + UI 일관성 축): 판정 ②의 "역 1개면 줄 전체 버튼"을 **기각**한다. 근거는 §3.3의 판별선이다 — 앱의 로터 UI 6곳을 전수로 세어 보니 뷰 종류를 가르는 축은 "역 개수"가 아니라 "그 줄의 주제가 열 수 있는 대상 하나인가"였고, 브리핑 줄은 주제가 이동 단계라 순수 텍스트 쪽이다. 역 개수로 가르면 한 화면에서 버튼과 글이 번갈아 나오고 그 기준이 낭독에 드러나지 않는다.

**세션이 강한 기본값으로 정한 것**(위원장 확인): 지하철 구간만(§7) · 역 상세에서 "여기까지 길찾기" 숨김(§7) · VoiceOver 힌트 없음(§7) · 문장 스캔 대신 구조 확정(§3.2) · 노선 힌트는 줄 종류가 정한다(§4).

## 3. 진입점 규칙

### 3.1 불변식 (정체성 축)

> **지하철 구간이 만든 줄에서 들린 역 이름에는, 그 역으로 가는 수단이 있다. 그 밖의 줄에는 없다.**

⚠ 초안은 이것을 "이름이 들리는가"(존재 축)로 썼다. **위험한 것은 존재가 아니라 정체성이다** — 들린 이름과 열리는 역이 다르면 불변식을 지킨 채로 틀린 역이 열린다(§3.2가 그 경로를 닫는다). 그리고 존재 축은 §7의 버스 제외로 이미 참이 아니다: 버스 정류장 이름은 "강남역"·"잠실역"처럼 역 이름과 낭독으로 구별되지 않으므로, 사용자가 외울 규칙은 "이름이 들렸다"가 아니라 "**지하철 구간 줄에서** 이름이 들렸다"다.

역방향도 성립한다. 진입점이 있는데 이름이 안 들리는 줄은 만들지 않는다.

### 3.2 대상 역은 이름 조인으로 고른다 (위치 인덱스 금지)

⚠ **`stops.first`/`stops.last`를 승차·하차역으로 쓰지 말 것.** 이 저장소가 그 전제를 이미 거부한다.

- `src/lib/providers/odsay.ts:212-219` `previousStopName`은 목록 마지막이 하차역인지 **정규화 비교로 확인한 뒤** 쓰고 불일치면 `null`을 낸다. 주석이 근거를 적어 두었다: "순서가 뒤집혔거나 부분 목록이면 '끝에서 두 번째'가 직전역이 아니고, 그때 나오는 값은 반대편 승강장 안내가 된다."
- `src/lib/providers/odsay.ts:177` `toLegStops`는 이름이나 좌표가 무효한 항목을 `flatMap`으로 **떨어뜨린다**. 첫·마지막 정차역 한 건이 떨어지면 `stops.first`/`stops.last`가 조용히 중간역이 된다.
- `ios/GildongmuKit/…/TransitGuide.swift:485` `let alightStop = stops.count > 1 ? stops.last : nil` — 1개면 믿지 않는다. 같은 자리 `:492-493`이 이름을 `leg.fromName ?? boardStop?.name` 순으로 쓴다. **기존 코드의 믿음은 "이름이 정본, `stops`가 폴백"이다.**

그리고 줄에서 들리는 이름도 `stops`가 아니다. 구간 줄은 `leg.fromName`/`leg.toName`(`RouteBriefing.swift:223-231`), 하차 줄은 `transitAlightStationName`이 읽는 `leg.toName`(`TransitExitLines.swift:76-79`), 도보 줄은 서버가 다음 탑승 leg의 `fromName`을 복사해 넣은 `toName`(`odsay.ts:411-421`)이다. 이름과 대상이 다른 필드에서 오면 어긋날 수 있다.

**그래서 이름으로 조인한다.** 기존 술어를 쓴다(Kit `normalizeStopName`, `TransitGuide.swift:692` — 같은 모듈이라 그대로 호출. 자체 정규화 신설 금지, CLAUDE.md "역명 매칭은 확장 정규화가 정본").

Kit 순수 함수 신설 — `ios/GildongmuKit/Sources/GildongmuKit/TransitBriefingStations.swift`:

```swift
/// 브리핑 렌더 순서의 한 줄.
public enum TransitBriefingRow: Sendable, Hashable {
    case walk(legIndex: Int)
    case transit(legIndex: Int)
    case alight(legIndex: Int)
}

/// 그 줄에서 열 수 있는 역 하나. 순서는 줄에 이름이 들리는 순서다.
public struct TransitBriefingStation: Sendable, Hashable {
    public let stop: TransitLegStop
    /// 전화번호 조회 노선 힌트(§4). `leg.lineName`의 빈 문자열만 접어 넘긴다 —
    /// 노선 표 판정은 `StationPhoneStore.key` 한 곳이 한다(복제 금지, 리뷰 MINOR 4).
    public let lineName: String?
}

public func transitBriefingStations(
    _ legs: [TransitRouteLeg], row: TransitBriefingRow
) -> [TransitBriefingStation]
```

| 줄 | 이름 출처 | 대상 선택 | 개수 |
|---|---|---|---|
| `.walk(i)` | `legs[i].toName` (non-empty) | **다음 non-walk leg**가 `subway`일 때 그 leg의 `stops`에서 `legs[next].fromName` 조인 | 0~1 |
| `.transit(i)` | `fromName`·`toName` (각 non-empty) | 같은 leg `stops`에서 `fromName`은 **앞에서부터** 첫 일치, `toName`은 **뒤에서부터** 첫 일치 | 0~2 |
| `.alight(i)` | `leg.toName` (줄 존재 조건과 동일) | `.transit`의 하차 항목과 같은 술어 | 0~1 |

**규칙 다섯**:
1. **조인 실패는 진입점 없음**이다(추측으로 고르지 않는다). 그 줄은 현행 `Text` 그대로다.
2. **`.walk`의 "다음 leg"는 `legs[i+1]`이 아니라 `next non-walk leg`다** — 서버가 이름을 그렇게 유도한다(`odsay.ts:415` `legs.slice(i+1).find(l => l.mode !== "walk")`). 게이트가 이름의 출처와 같은 술어를 써야 도보가 연달아 나오는 응답에서 "같은 이름인데 한 줄에는 진입점이 있고 한 줄에는 없다"가 생기지 않는다.
3. **이름 게이트는 non-nil이 아니라 non-empty다.** `transitLegText`는 `fromName.map { … }`이라 `""`도 값으로 통과시켜 "에서 승차"를 낸다(같은 파일이 `lineName`에만 이 함정을 막아 뒀다, `RouteBriefing.swift:219-222`). non-nil로 구현하면 라벨이 " 상세 보기"가 된다.
4. **`.alight`의 줄 존재 판정과 대상 판정이 같은 필드를 본다.** 호출부의 `if let text = alightLineText(…)`는 `station`(= `toName`)으로 줄을 세우고(`TransitExitLines.swift:31`·`QuickExitText.swift:23`), 이 함수도 `toName`으로 대상을 고른다. 초안은 줄 존재를 `toName`, 대상을 `stops.last`로 갈라 두어 두 술어가 어긋날 수 있었다.
5. **승차·하차가 같은 역이면 1개로 접는다**(정규화 결과 일치).

⚠ **문장 스캔(`transitStationMentions`)을 쓰지 않는다.** E33은 상태 문장이 폴마다 다르게 조립돼 코드가 내용을 모르기 때문에 문장을 훑는다. 브리핑 줄은 우리가 조립하므로 어느 이름이 들어갔는지 코드가 안다. 구조로 확정하면 정규식을 웹·Kit에 미러할 때 문자 클래스가 어긋나 **iOS만 전량을 놓치는** 함정(CLAUDE.md 실사고)을 지나가지 않는다.

### 3.3 뷰 종류: 순수 텍스트 + 로터 (판정 ② 개정)

**모든 줄은 `Text`로 남고, 진입은 항상 로터 커스텀 액션이다.** 역 개수는 액션 **개수**만 정하고 뷰 종류를 정하지 않는다.

| 역 개수 | 뷰 | 로터 커스텀 액션 |
|---|---|---|
| 0 | `Text` (현행) | 없음 |
| 1 이상 | `Text` (현행) | 역별 (상세, 전화) × N, 등장 순 |

⚠ **현재 실제 최대는 2다.** 역이 여럿 실리는 줄은 구간 줄뿐이고 거기엔 승차·하차 둘만 들어간다. 함수는 일반형(N개)으로 두어 줄 구성이 바뀌면 전제가 깨진 것이 드러나게 한다 — 상한 2를 코드에 박지 않는다.

⚠ **로터 액션 선언은 역순**이다(VoiceOver 로터가 빌더 선언의 역순으로 노출된다 — `PlaceRow`·채팅·E33 실측). 역별 묶음 안의 (상세 → 전화) 순서도 함께 뒤집어야 등장 순으로 들린다.

**판별선 (앱 전반 규칙, 실측 근거)**

> **로터 진입점의 뷰 종류는 "그 줄의 주제가 열 수 있는 대상 하나인가"로 가른다.** 그렇다면 줄 전체가 버튼이고 로터는 부가 동작이다. 아니라면 순수 텍스트에 로터만 단다. **한 섹션 안에서 두 종류가 섞이지 않는다.**

앱의 로터 UI 전수 6곳(2026-09-18 실측):

| 자리 | 뷰 | 기본 동작 | 주제 |
|---|---|---|---|
| 검색 결과 장소 행 (`SearchView.swift:364`) | `NavigationLink` | 장소 상세 | 그 장소 |
| 채팅 장소 카드 (`ChatConversationView.swift:612`) | `Button` | 장소 상세 | 그 장소 |
| 안내 시트 경유역 행 (`TransitTrackingSheet.swift:1004`) | `Button` | 역 상세 | 그 역 |
| 검색·채팅 주소 행 (`SearchView.swift:310`·`ChatConversationView.swift:623`) | **순수 `Text`** | 없음 | 그 주소(열 곳이 없다) |
| 안내 시트 상태 문장 (`TransitTrackingSheet.swift:477`) | **순수 `Text`** (역 1개여도) | 없음 | 지금 상황 |
| 채팅 산문 블록 (`ChatConversationView.swift:497`) | 1개면 `Button`(로터 없음), 2개 이상이면 `Text`+로터 | 장소 상세 | 그 블록의 서술 대상 |

브리핑 줄의 주제는 역이 아니라 **이동 단계**다("천호역 5번 출구까지 걸어간다", "어떻게 내려서 나가는가"). 상태 문장과 같은 종류다. 그리고 기존 UI는 **한 섹션의 모든 행이 같은 종류**인데(검색 결과 전부 링크, 경유역 목록 전부 버튼, 주소 섹션 전부 글), 역 개수로 가르면 브리핑 안에서 버튼과 글이 번갈아 나오고 그 기준은 낭독에 드러나지 않는다.

**얻는 것**: 사용자가 외울 규칙 하나 · 무엇을 하는지 모르는 버튼 0 · `Button` 래핑에서 `accessibilityLabel`이 전파되지 않아 병기 괄호가 낭독될 위험 0(§8) · 판정 ⑦이 넘긴 로터 축 오염이 성립하지 않음 · 뷰 종류 분기 코드 0.
**잃는 것**: 시각 사용자의 줄 탭 진입. 브리핑은 텍스트 정본 화면이고 §7이 웹·채팅 카드를 이미 범위 밖으로 두었으므로 손실이 작다.

### 3.4 왜 E33은 "1개면 버튼" 갈래를 기각했는가 (그 근거도 여기엔 없다)

E33이 상태 문장에서 기각한 이유는 하나다: 그 문장은 15초마다 다시 조립돼 언급 수가 오가고, 뷰 종류가 `Button` ↔ `Text`로 갈리면 포커스가 얹힌 줄이 파괴·재생성된다(헌장 §5).

브리핑 줄은 `route.legs`만 읽고(`RouteBriefing.swift:56-77`) `legs`는 조회 응답의 불변 값이라 그 근거가 성립하지 않는다. 즉 브리핑에서는 두 갈래가 **다 가능했고**, 정정 ②는 그중 하나를 일관성 축으로 고른 것이다(불가능해서 고른 것이 아니다). 전화번호 도착·언어 변경·대안 전환·안내 세션 시작은 뷰 종류를 바꾸지 않는다.

### 3.5 소비자는 길찾기 탭 하나다 (옵트인)

⚠ `TransitRouteRows`를 부르는 자리는 **둘**이다.

- `ios/Gildongmu/Directions/DirectionsTabView.swift:1391` — 길찾기 탭(이 설계의 대상)
- `ios/Gildongmu/Directions/GuideOverviewSheet.swift:500` — **안내 조망의 "다른 경로" 후보 목록**

조망 쪽은 루트가 `List`이고(`:98`) 그 파일에 `NavigationStack`·`navigationDestination`이 **0건**이다(`.sheet(item: $subsheet)` 하나뿐, `:128`). 그런데 그 후보 경로도 `includeStops: true`로 받으므로(`TransitGuideModel.swift:788`) 진입점 게이트가 전부 통과한다. 조건 없이 달면 그 화면의 로터에 "{역} 상세 보기"가 서고 **아무 일도 일어나지 않는다** — 스크린 리더 사용자에게 무반응 액션은 진단 불가한 고장이다. 파급 둘 더: 미리 조회가 펼친 후보마다 돌아 안내 세션 중 카카오 호출이 곱해지고(후보 최대 5 × 역 2~4), E33·`place-detail-sheet-guard.test.ts`가 정한 "시트 안 장소 상세는 닫기 버튼 필수"(`PlaceDetailView.swift:339`)를 우회한다.

**그래서 진입점은 옵트인이다**: `TransitRouteRows`에 `stationEntry: Bool = false`를 두고 길찾기 탭만 `true`. 기본값이 꺼짐이라 새 소비자가 생겨도 조용히 켜지지 않는다.

**push 목적지는 구현 항목이다.** 길찾기 탭에 `NavigationStack`은 있지만(`DirectionsTabView.swift:666`) `navigationDestination`·`NavigationLink`가 **0건**이다. 로터 액션은 값 기반 링크로 열 수 없으므로 `navigationDestination(for: Place.self)` 등록 + 프로그래매틱 push 경로(`@State private var path`)를 함께 만든다. Place는 `transitStopPlace(stop)`(`PlaceProjection.swift:192`)로 만들고 `PlaceDetailView(place:stationLineHint:showsDirectionsEntry:)`에 노선 힌트를 넘긴다.

## 4. 노선 힌트 — 줄 종류가 정한다

E44 전화번호 조회는 노선 힌트를 요구한다(같은 역·같은 노선·1km 후보만, `2026-09-17` spec §5.2·§5.4).

| 줄 | 노선 힌트 |
|---|---|
| `.transit(i)` · `.alight(i)` | `legs[i].lineName` |
| `.walk(i)` | **다음 non-walk leg의 `lineName`**(그 역은 다음에 탈 노선의 역이다) |

⚠ **환승역은 줄에 따라 다른 번호가 나올 수 있고 그것이 맞다.** 5호선 → 9호선 환승에서 여의도는 구간 줄·하차 줄에서 5호선으로, 다음 구간 줄에서 9호선으로 조회된다. 내리는 노선의 역무실이 그 승강장을 아는 곳이다. 저장소 키가 노선을 포함하므로(E44 §5.6) 두 번호가 서로를 덮지 않는다.

노선 표가 모르는 노선이면 `StationPhoneStore.key`가 `nil`을 내고 `result()`가 `.unavailable`을 즉답한다(`StationPhoneStore.swift:61·72`). **그 판정을 Kit 함수에 복제하지 않는다** — 표 갱신 때 두 자리가 갈린다.

## 5. 전화 3상태

### 5.1 상시 노출 + 결과 통지 (판정 ④)

전화 액션은 **저장소 상태와 무관하게 항상 로터에 있다.** 액션 목록 길이가 불변이라 로터를 열어 둔 사이 목록이 변하지 않는다.

| 상태 | 동작 |
|---|---|
| 번호(역 직통) | `tel:` 연결. 통지 없음(전화 앱 전환이 응답이다) |
| 번호(대표번호) | 같음. 라벨이 이미 대표번호임을 말한다(§6) |
| 없음(`.unavailable`) | `.high` 통지 + `ResultHaptic.fire(.attention)` |
| 모름(`nil`) | **`resolve`를 킥오프한 뒤** "찾고 있습니다" 통지 + `.attention` |
| 조회 실패(`.failed`) | `.high` 통지 + `ResultHaptic.fire(.failure)` |

⚠ **`nil`은 세 상태를 겹쳐 들고 있다.** 주석이 직접 열거한다(`StationPhoneStore.swift:67`): "조회 전 · 첫 조회 중 · 갱신 시도 없이 보관 한도로 지워짐". 그래서 `nil`에 "찾고 있습니다"를 그냥 배당하면 **문장이 거짓이 될 수 있다** — `record`가 6분(`evictAfterSeconds = 300 + 2×30`) 뒤 `results[key] = nil`로 지우고(`:121`), 아무도 `resolve`를 다시 부르지 않으면 그 뒤로 번호가 돌아오지 않는다. 브리핑은 출발 전에 오래 머무는 화면이라 6분 초과가 평범한 사용이다. 판정 ④가 액션 부재로 뭉개지 않으려 한 3-state를 문장 층에서 다시 뭉개는 자리다.

**둘로 닫는다.**
1. **재확인 루프**: 역 액션을 든 줄의 하위 뷰에 `ViaStopStationRow`와 같은 `.task(id:)` 루프를 둔다(`TransitTrackingSheet.swift:1020-1025` 동형, `recheckSeconds` 30초). 축출이 오기 전에 갱신된다.
2. **누를 때 킥오프**: 그래도 `nil`이면 `resolve`를 시작한 뒤 통지한다. 문장이 사후적으로 참이 된다.

⚠ **역 액션을 든 줄은 하위 뷰로 뗀다(저장소 관찰 경계).** 라벨이 직통·대표번호로 갈리므로(§6) 라벨 계산이 `phoneStore.result(...)`를 읽어야 하고, 그 읽기가 `TransitRouteRows` 본문에 있으면 번호 도착·30초 재확인·6분 축출마다 **브리핑 전체가 다시 그려진다**. E44가 리뷰 M5로 명시적으로 피한 것이 이것이고(`2026-09-17` spec §6: "하위 뷰만 저장소를 관찰하고 시트 본문은 읽지 않는다") `ViaStopStationRow`가 그 답이다.

**통지 우선순위 `.high`의 근거**: 화면 변화가 없는 활성화 응답이라 통지가 유일한 증거다(CLAUDE.md의 "주소 복사 '복사됨'"과 같은 계열). 성공은 기본 우선순위가 아니라 **통지 자체가 없으므로** 비대칭이 아니다.

**진동**은 문장이 나가는 조건과 같다(`ResultHaptic` 계약). 3상태를 촉각에도 싣는다.

**통지 문구에 역 이름을 넣지 않는다.** 방금 누른 액션 라벨이 "천호에 전화 걸기"였고 통지가 그 직후에 오므로 역 이름은 새 정보가 아니다(헌장의 "뻔한 꼬리 문장 금지").

**통지·진동 매핑은 Kit 순수 함수로 뺀다** — `briefingPhoneAnnouncement(_ result: StationPhoneResult?) -> (key: String, haptic: ResultHapticKind)`. 뷰 안에 두면 테스트 레인이 없다(§8).

### 5.2 미리 조회는 두 건씩만

브리핑 줄이 렌더되면 그 줄의 역 전화번호를 미리 조회한다(E44 §6이 "목록을 펼치는 순간"으로 정한 근거와 같다 — 행이 실현될 때 조회하면 VO 커서와 조회가 같이 도착해 결과가 조용히 늦는다).

⚠ **`StationPhoneStore.prefetch(stops:lineName:)`에 `leg.stops`를 그대로 넘기지 말 것.** 그 함수는 받은 배열 **전부**에 `resolve`를 돈다(`:127-131`) — E44가 경유역 전체 목록에 맞춰 만든 것이다. 브리핑이 넘기는 배열은 **`transitBriefingStations`가 돌려준 것뿐**(줄당 최대 2건)이고, 노선 힌트가 줄마다 다르므로(§4) 줄 단위로 부른다. leg 하나에 12~20건이 도는 것을 막는다 — 프로덕션과 쿼터를 공유한다([[real-call-gate-shares-production-quota]]).

접힌 대안 경로는 `DisclosureGroup` 본문이 렌더되지 않으므로 펼칠 때 조회된다. 고유 조회는 보통 2~4건이고 저장소가 같은 키 중복을 막는다.

### 5.3 안내 시트 경유역 목록 통일 (판정 ⑤ — E44 §5.5 개정)

`ViaStopStationRow`(`TransitTrackingSheet.swift:995`)의 `.accessibilityActions`를 상태 `switch`에서 **무조건 1개**로 바꾼다. 라벨은 종전 그대로 이름 없는 `ios.place.call` / `ios.place.callRepresentative`(행 이름이 곧 역명이다), 그 밖의 상태에서도 `ios.place.call`을 쓰고 통지·진동은 §5.1과 같은 한 벌을 지난다. 그 행은 이미 하위 뷰이고 재확인 루프도 있어 §5.1의 두 처방이 충족돼 있다.

E44 §5.5 표의 "경유역 로터" 열에 개정 표기를 남긴다 — 그 spec 안에서도 **역 상세 줄은 실패를 표시하는데 경유역 로터는 액션을 없애 뭉개는** 불일치가 있었다. E44 리뷰 반영(M5 하위 뷰 관찰·M6 펼침 일괄 조회·M9 6분 축출·L6 공유 조회 비취소)은 전부 보존된다.

**역 상세 전화 줄은 손대지 않는다.** 그 줄은 로터 액션이 아니라 보이는 줄이고, "없음"을 줄 부재로 두는 기존 관례를 따른다(`PlaceDetailView.swift:146`이 `.unavailable`과 `nil`을 둘 다 `EmptyView`로 떨어뜨린다 — E44 §5.5가 "주소 없는 장소와 같은 관례"로 의도한 설계다).

## 6. 문구

**상세 쪽은 신설 없음.** 채팅 `ios.chat.openPlace`와 안내 시트 `transitGuide.openStation`이 이미 둘 다 `{이름} 상세 보기`다. 브리핑은 `transitGuide.openStation`을 재사용한다 — 브리핑이 안내 세션 키를 재사용하는 선례가 이미 있다(`transitGuide.exitBound`를 앱 층 클로저로 받는 배선, `TransitExitLines.swift:14-17`·`RouteBriefing.swift:73`).

**신설 4개**:

| 키 | ko | 자리 |
|---|---|---|
| `transitGuide.callStation` | `{station}에 전화 걸기` | `messages/`(6로케일). 이름을 붙이는 선례 `clinicNearby.callAction` 계승 |
| `transitGuide.callStationRepresentative` | `{station} 대표번호로 전화 걸기` | 같음 |
| `ios.station.phoneMissing` | `역 전화번호가 없습니다.` | `ios/i18n/ios-extra` |
| `ios.station.phonePending` | `역 전화번호를 찾고 있습니다.` | 같음 |

**세부 셋**:
- 실패 통지는 기존 `ios.station.phoneError`(`역 전화번호를 불러오지 못했습니다.`)를 재사용한다. ⚠ 그 키는 지금 **보이는 줄** 문구로도 쓰이므로(`PlaceDetailView.swift:145`) 한쪽 문안 수정이 다른 쪽을 조용히 바꾼다. 신설 둘의 어투("역"을 붙인다)를 이 형제에 맞춰 3상태가 한 벌로 들리게 했다.
- **라벨의 역 이름에 "역" 접미가 없다.** 원천은 `stop.name`이고 ODsay 정차역 이름은 접미 없이 온다(E33 라벨도 `transitLabel(stop.name, stop.nameEn)`으로 접미가 없다, `TransitDisplayProjection.swift:81-83`). 실제 낭독은 "천호에 전화 걸기"다. 접미를 붙이려면 별도 판정이 된다.
- **동조 수정 2건**: `kidsNearby.call`·`surroundingsNearby.call`이 `전화하기`로 어긋나 있다. `전화 걸기`로 맞춘다(문구만).
- `messages/`에 키를 더하면 `i18n-messages.test.ts`가 6로케일 동일 키 집합과 비-ko 한글 잔존 0을 강제하므로(`:65`·`:86`) **번역 10건이 같은 커밋에 필요하다**. `arg-order.json`은 신설 키의 게이트가 아니다(`messages-to-xcstrings.mjs:33` "신규 키는 자동 등록").

### 액션 라벨의 역 이름은 어느 언어인가

**그 줄이 쓴 이름과 같은 언어다.** `.transit`·`.alight`는 `transitLegUsesEnglish(leg, lang:)`, `.walk`는 그 도보 줄 자신의 판정을 지나 영문 자격이 있으면 `stop.nameEn`, 없으면 `stop.name`을 쓴다.

⚠ **앱 언어 기준(`bilingual(...).primary`)으로 고르지 말 것.** 그러면 줄은 한국어인데 라벨은 로마자가 되어 같은 역이 한 화면에서 두 언어로 들린다. 위원장 판정이 이미 선을 그었다: "한국어 폴백은 설계지만 **한 줄 안 혼용과 침묵은 결함**"(`docs/BACKLOG.md` §2 E27 실승차 행). 세션 초안의 근거("라벨 언어가 줄마다 튀는 것이 더 나쁘다")는 틀렸다 — 라벨을 줄에 묶으면 줄이 갈릴 때 함께 갈리므로 새로운 튐이 생기지 않는다.

E33도 같은 판정이다(설계 리뷰 E1: "영문이 없으면 라벨 전체가 ko"). ⚠ 단 E33의 `transitOpenStationLine`은 줄 언어로 **포맷 문자열까지** 고르지는 못한다(코드 주석이 알려진 결함으로 기록, `TransitGuideText.swift:412-414`·BACKLOG E28-①). 줄 언어에 묶인 것은 역 **이름**뿐이라 차이가 작다.

**실측(2026-09-18, `lang=en&includeStops=1` 실호출 15경로 / 66루트 / 226 leg, 전부 200)**: **영문 자격 미달 0건**. 지하철 22 · 버스 63 · 도보 141 leg 전부 영문이고 `*En` 값에 한글이 남은 것도 0건이다.

- 지하철 노선 12종(수도권 1·2·4·5·7·9급행·수인분당·신분당, 부산 2, 대구 1, 대전 1, 인천 1)이 전부 표에 맞았다 — `subway-line-names-drift.test.ts`의 전수 매핑 게이트가 실효 중이다.
- ⚠ **세션 초안의 위험 추정("버스 한글 번호가 `isDisplayableEnglish`에서 탈락한다")은 틀렸다.** ODsay `lang=1`은 버스 번호도 영문으로 준다(`송암73` → `Songam73`, `좌석02` → `Express City Bus 02`, `202(동진)` → `202(Dongjin)`). provider는 en 응답에서 한국어를 `busNoKor`로, 영문을 `busNo`로 받는다(`odsay.ts:355·363`). 표본의 고유 버스 57종 중 한국어 번호 19종이 **모두** 영문을 받았다.
- 표본에 실제로 든 것(부재는 미실측으로 적는다): 마을버스류 한글 번호 · 지방 지하철 4개 도시 · 인천1호선 · 급행 · 광역/직행좌석 · 지하철 0개인 버스 전용 경로. 전부 PASS.

**그래서 한국어 폴백 분기는 실데이터 표본으로 재현되지 않는다** — fixture로만 검증된다. ⚠ 죽은 코드로 보고 지우지 말 것: 새 노선 개통(표 미스)·ODsay 영문 미제공 신규 정류소에서 살아나고, 그때 이 분기가 없으면 영어 세션이 **침묵**한다(빈 라벨). 표본 15경로는 전국 전수가 아니다.

## 7. 범위 밖·판정 기록

| 항목 | 판정 |
|---|---|
| **안내 조망 "다른 경로"**(`GuideOverviewSheet`) | **제외**(§3.5). 같은 `TransitRouteRows`를 쓰지만 push 스택이 없다. 옵트인 기본값 꺼짐으로 구조적으로 닫는다 |
| **버스 정류장** | **제외.** 근거는 `transitStopPlace`가 `category: "지하철역"`을 박고 그 주석이 "버스 정류장은 이 함수를 지나지 않는다"를 계약으로 적은 것이다(`PlaceProjection.swift:189-191`). ⚠ 초안의 "상세가 빈 화면이 된다"는 과장이었다 — 주소·전화는 없지만 주변·무장애 섹션은 좌표로 성립한다 |
| **역 상세의 "여기까지 길찾기"** | **숨긴다**(`showsDirectionsEntry: false`). 프리필은 목적지만 바꾸는 것이 아니라 `directionsEpoch`를 올려 `DirectionsTabView`를 **재생성**하므로 조회 결과 전체가 사라진다(`GildongmuApp.swift:310-315`). 그 기제는 push된 역 상세도 함께 파괴한다 |
| **VoiceOver 힌트** | **넣지 않는다.** 정정 ②로 버튼이 사라져 "무슨 버튼인지 모른다"는 문제 자체가 없어졌고, 로터 액션 라벨이 동작을 직접 말한다 |
| **자동차·도보 브리핑** | 범위 밖(역이 없다) |
| **웹 브리핑** | 범위 밖. iOS 선행이고 `docs/BACKLOG.md` §4에 B8(채팅 산문) 계열로 등록. 심사 동결로 배포도 막혀 있다 |
| **채팅 대중교통 카드** | 범위 밖. `TransitRouteRows` 호출부 전수 2건에 없다(확인됨) |
| **경유역 전체 접근** | 범위 밖. 브리핑은 출발 전 화면이라 필요한 역은 승차·하차·환승이고, 중간 경유역은 안내 세션의 맥락이다 |
| **빈 `fromName`/`toName`이 렌더되는 것** | 인접 결함. `transitLegText`가 `""`를 통과시켜 "에서 승차"를 낼 수 있다(§3.2 규칙 3). 이 설계는 게이트를 non-empty로 두어 **진입점에서만** 막는다. 렌더 자체의 수정은 BACKLOG에 한 줄 남긴다 |

## 8. 검증

| 층 | 무엇 |
|---|---|
| Kit 단위(Swift Testing) | `transitBriefingStations` 전수: 줄 종류 3 × (다음 non-walk leg 없음·도보·버스·지하철) × (`stops` nil·빈 배열·1개·다수) × (이름 nil·`""`·정상). **조인 실패 시 진입점 0**(역순 목록·부분 목록·첫/마지막 항목 누락 fixture), 도보 연속 2개에서 두 줄이 같은 결과를 내는지, 승차 = 하차 접기, `.walk`가 **다음 non-walk leg**를 보는지 |
| Kit 단위 | `briefingPhoneAnnouncement` 5상태 → (키, 진동) 매핑 |
| 실호출 게이트 | `/api/route/transit?includeStops=1` 실표본 다수로 **조인이 실제 응답에서 성립하는 비율**을 잰다. ⚠ 선정 단계가 표본을 자른다 — 확인하려는 케이스(환승 2회 이상, 버스↔지하철 혼합, **0m 도보가 제거되어 도보 줄이 없는 지하철-지하철 연속 구간**)를 전체 후보 위에서 별도 PASS로 단언하고 부재는 FAIL로 적는다([[real-call-gate-weak-predicate]]). ⚠ 초안의 "0m 도보 leg" 항목은 **영구 FAIL**이었다 — 서버가 응답에서 제거하므로(`odsay.ts:406`) 존재할 수 없다 |
| 앱 소스 가드(Vitest) | ① **`TransitRouteRows` 호출부 전수와 `stationEntry` 값**(부착 자리 수를 세는 술어로는 §3.5 결함을 통과시킨다) ② 로터 선언이 `reversed()`를 지나는지 ③ 전화 액션 블록에 **저장소 상태 분기가 없는지**(§5.1 상시 노출의 핵심) ④ 저장소를 읽는 뷰가 하위 뷰인지(§5.1 관찰 경계) ⑤ `showsDirectionsEntry: false` ⑥ `transitStationMentions`를 브리핑에서 **부르지 않는지** ⑦ `prefetch`에 `leg.stops`를 넘기지 않는지 |
| 변이 주입 | 커밋 뒤에 돌린다([[mutation-injection-commit-first]]). 축 다섯: 조인을 **위치 인덱스로 되돌림**(조인 실패 fixture가 빨개지는가 — B1이 노리는 결함) · `reversed()` 제거 · `.walk` 게이트를 `legs[i+1]`로 · 이름 게이트를 non-nil로 · `stationEntry` 기본값을 `true`로 |
| a11y 감사 | `a11y-auditor`(하위 repo·worktree에서는 general-purpose + 역할 파일 Read) — 줄이 한 접근성 객체로 남는지, 과잉 ARIA·중복 낭독이 없는지 |
| **실기기 VoiceOver(정본)** | ① 로터 액션이 **등장 순**으로 들리는가(역순 선언이 맞는지 — 역 2개 줄에서 승차가 먼저) ② 전화 액션 `.high` 통지가 실제로 들리는가(액션 활성화 직후 발화가 VO 처리에 잠식되지 않는지 — 헌장 §5 실측 계열) ③ 구간 줄 병기(`Yeouido (여의도)`)가 로터를 달아도 한 객체로 남고 괄호가 낭독되지 않는가(E28) |

⚠ 정정 ②로 **`Button` 래핑에서 `accessibilityLabel`이 전파되는가**라는 항목이 사라졌다. 그것이 실기기 위험 1순위였다 — 대중교통 구간 줄은 `distanceText`를 지나지 않고 `transitLegRow`가 `Text(line.visual).accessibilityLabel(Text(spokenUnits(line.spoken)))`를 직접 만들며(`RouteBriefing.swift:113-116`), 시각 문자열과 낭독 문자열이 **병기 때문에 다르다**. 전파가 실패하면 단위 오독만이 아니라 괄호 한글까지 낭독됐다.

뷰 계층은 테스트 레인이 없으므로 배선은 소스 가드로 잠근다(E33·A35 선례).

**Kit 파일을 추가하므로 `android/kit/mirrors/{foundation,core,guide}.json` 중 하나에 `pending`으로 등재한다**(`mirror-registry.test.ts`가 등록부에 없는 Kit 파일을 빨갛게 만든다, 갱신법 `android/README.md` §5).

## 9. 설계 리뷰 반영 (2026-09-18, 서브에이전트 1회)

리뷰 지시문에 "진단 자체가 틀렸다면 그렇게 말하라"를 넣었다. **BLOCKER 4건·MAJOR 5건 전부 근거를 직접 확인했고 오탐은 0건이었다.**

| # | 지적 | 판정 |
|---|---|---|
| 토대 §3.4 | E33 기각 근거가 브리핑에 성립하지 않는다는 주장은 맞다 | 유지(§3.4에 "두 갈래가 다 가능했다"를 명시) |
| 토대 §3.1 | 불변식 축이 존재이고 위험은 정체성이다 | **채택** — §3.1 재작성 |
| B1 | `stops.first`/`last` 전제를 저장소가 이미 거부한다 | **채택** — §3.2 이름 조인으로 전환 |
| B2 | 소비자가 둘이고 조망 쪽에 push 스택이 없다 | **채택** — §3.5 옵트인 |
| B3 | `nil`이 3상태를 겹쳐 "찾고 있습니다"가 영구 거짓 | **채택** — §5.1 재확인 루프 + 킥오프 |
| B4 | `prefetch`가 배열 전부를 돈다 | **채택** — §5.2 |
| M1 | 저장소 관찰 주체 미지정 | **채택** — §5.1 하위 뷰 경계 |
| M2 | 버튼이 무엇을 하는지 낭독에 없다 | **소멸**(정정 ②) |
| M3 | `.alight` 줄 존재 판정 이원화 | **채택** — §3.2 규칙 4 |
| M4 | 도보 게이트가 `legs[i+1]`만 본다 | **채택** — §3.2 규칙 2 |
| M5 | 전제 잠금이 순환, 0m 도보 항목 관측 불가 | **채택** — §8(전제 의존 제거로 순환 소멸, 0m 항목 교체) |
| MINOR 1 | 라벨에 "역" 접미가 없다 | **채택** — §6 |
| MINOR 2 | 통지 3형제 어투 불일치·`phoneError` 겸용 | **채택** — §6 |
| MINOR 3 | §5.2 "3상태가 줄 종류로 드러난다"가 부정확 | **채택** — §5.3 근거 수정 |
| MINOR 4 | `lineName` 표 판정 중복 | **채택** — §3.2·§4 |
| MINOR 5 | 게이트가 non-empty여야 한다 | **채택** — §3.2 규칙 3 + §7 인접 결함 |
| MINOR 6 | `navigationDestination`이 0건 | **채택** — §3.5 구현 항목 |
| MINOR 7 | "여기까지 길찾기" 근거가 실제보다 약하다 | **채택** — §7(`directionsEpoch` 재생성) |
| MINOR 8 | 실기기 항목의 인용 함수가 틀렸다 | **채택** — §8 말미(항목 자체는 정정 ②로 소멸, 근거는 기록) |
| MINOR 9 | E33 대비 서술이 과하다 | **채택** — §6 |
| MINOR 10 | 번역 10건 필요 | **채택** — §6 |
| NIT 1 | 버스 제외 근거 교체 | **채택** — §7 |
| NIT 2 | whole-row Button의 `contentShape` | **소멸**(정정 ②) |
| NIT 3 | mirrors 그룹 셋 중 하나 | **채택** — §8 |
| R1 | 역 1개 줄의 버튼을 뺀다 | **채택**(위원장 판정 2026-09-18) — 정정 ②. 리뷰는 "위원장에게 물을 것"을 명시했고 그 절차를 지켰다 |
| R2 | `.alight` 케이스 정리 제안 | **부분 채택** — 케이스는 남기고 술어를 `toName` 조인으로 통일(M3) |

**이 리뷰가 잡은 것 중 자체 검토로는 못 잡았을 것**: B2(호출부를 한 곳만 확인했다)와 B1(저장소가 전제를 거부하는 자리가 provider·Kit에 흩어져 있었다). 둘 다 "spec 문장이 아니라 코드를 읽어야" 나오는 지적이다.
