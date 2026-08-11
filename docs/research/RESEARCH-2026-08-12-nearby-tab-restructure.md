# 조사 — iOS "내 주변" 탭 재편 (2026-08-12)

> **성격**: 착수 전 코드 분석. spec은 아직 쓰지 않는다(위원장 지시). 이 문서는 **지금 코드가 어떻게 생겼는가**와 **요청을 그대로 구현하면 무엇이 걸리는가**만 담고, 설계 결정은 내리지 않는다.
> 시점 고정 문서라 낡는 것이 정상이다. 백로그 항목은 `docs/BACKLOG.md` §H M4.

## 1. 위원장 요청 (원문 분해)

| # | 요청 | 성격 |
|---|---|---|
| R1 | "현재 위치 확인"과 "둘러보기"를 **둘러보기 하나로 통합** | 화면 병합 |
| R2 | 통합된 둘러보기를 목록 **최상단**으로 | 배치 |
| R3 | "주변 보행 인프라" **제거** | 삭제 |
| R4 | 둘러보기 화면 첫 섹션 제목 **"한눈에 보기"** + 주변 조망을 **문장형 불릿** | 신규 계층 |
| R5 | 조망 5종: **대중교통 인프라 · 식당 및 카페 · 아이 놀 곳 · 문화 행사 · 무장애 관광지** | 신규 계층의 내용 |
| R6 | 그 아래 "주변 확인" 버튼의 정보를 **버튼 없이 즉시 펼침** | 상호작용 계약 변경 |
| R7 | 펼쳐진 각 POI는 **장소 상세로 열리는 버튼** | 데이터 계약 변경 |

적용 대상은 **App Store 배포판 = iOS가 먼저**이고, **웹은 후속 이식**이다(위원장 확정 2026-08-12 — §6).

**R4의 성과 정의**(위원장 확정 2026-08-12): "한눈에 보기"는 **브리핑**이다 — *가까운 곳에 어떤 POI가 있는지 30초 안에 파악한다*. 통계가 아니다(§3.5).

## 2. 현재 구조 실측

### 2.1 탭 진입점 — `ios/Gildongmu/NearbyHubView.swift`

`List` 하나에 `LocationBarView` + `NavigationLink` 11개가 평면 나열돼 있다(파일 전체가 27줄).

| 순서 | 라벨 키 | 목적지 뷰 | 재편 후 |
|---|---|---|---|
| 1 | `whereAmI.button` | `WhereAmIView` | R1 통합으로 소멸 |
| 2 | `ios.nearby.subway` | `SubwayNearbyView` | 유지 |
| 3 | `ios.nearby.bus` | `BusNearbyView` | 유지 |
| 4 | `ios.nearby.bike` | `BikeNearbyView` | 유지 |
| 5 | `ios.nearby.clinic` | `ClinicNearbyView` | 유지 |
| 6 | `ios.nearby.barrierFree` | `BarrierFreeNearbyView` | 유지 |
| 7 | `ios.nearby.kids` | `KidsNearbyView` | 유지 |
| 8 | `ios.nearby.around` | `AroundNearbyView` | **1번으로 승격 + 통합** |
| 9 | `ios.nearby.events` | `EventsNearbyView` | 유지 |
| 10 | `walkInfra.button` | `WalkInfraNearbyView` | **R3 제거** |
| 11 | `ios.nearby.conditions` | `ConditionsView` | 유지 |

11 → 9로 줄고, 순서가 `둘러보기 → 지하철 → 버스 → 따릉이 → 소아진료 → 무장애 → 아이 놀 곳 → 문화행사 → 공기질·날씨`가 된다.

⚠ 이 화면은 **위치 요청을 하지 않는다**(파일 주석: "각 도메인 화면 진입 시, When In Use 계약"). R4 조망을 허브가 아니라 둘러보기 화면 안에 두라는 요청은 이 계약과 정합한다.

### 2.2 통합 대상 A — `WhereAmIView.swift` (137줄)

화면 구성이 네 층이다:

1. **헤더**(`Section header`) — 조회 시각 + 위치 출처 라벨. `.isHeader`, VO 착지 지점(`nearbyFocusOnLoad`). ⚠ 이 문구가 "수동 위치인가 GPS인가"를 선언하는 유일한 자리다(`headerText`, 주석 66~69행).
2. **산문 2~3단락** — Kit `buildLocationNarrative`가 조립한 결정론 템플릿(LLM 아님). "현재 위치는 X입니다 / 가장 가까운 지하철역은 … / 주변에는 … 등이 있습니다". 단락마다 `distanceText`로 m→로케일 단어 낭독 정정.
3. **"이 위치에 관해 물어보기"** 버튼 → `ChatView(place:)` sheet.
4. **`SurroundingsSceneSection`** (M1 부근 재구성) — 아래 2.4.

데이터원은 `/api/where-am-i`(`src/lib/where-am-i.ts` `assembleWhereAmI`): 역지오코딩 주소 + 행정동 + 둘러보기 500m + 지하철 seed 1km, 4조각 `allSettled`.

**R1이 삭제하는 것**: 1~3층. **여기서 사라지면 대체 불가한 정보**는 (a) 수동 위치 vs GPS 선언 (b) 최근접 지하철역 방위·거리 (c) 도로명주소 문장이다. R4 조망 5종에 이 셋이 없다.

### 2.3 통합 대상 B — `AroundNearbyView.swift` (125줄)

평면 목록. 각 행 = `NavigationLink → PlaceDetailView`, label은 `PlaceRow`(장소명 + `joinText(카테고리, 방위, 거리)` 단일 텍스트). `onAskAbout`로 장소 채팅 sheet. "더 보기" +10, 첫 로드 시 첫 행 착지(`nearbyFocusOnLoad`).

데이터원은 `/api/places/around` → `findSurroundingsNear` (카카오 카테고리 검색, **반경 500m**, 10종 group code `CS2 SW8 FD6 CE7 BK9 PM9 HP8 MT1 PO3 AT4`, `SERVER_CAP=50`).

**R7이 요구하는 "장소 상세로 열리는 버튼"은 이 화면에 이미 있는 계약이다.** 즉 R7은 새 발명이 아니라 **이 계약을 2.4로 옮기는 일**이다.

### 2.4 "주변 확인" 버튼 — `SurroundingsSceneSection.swift` (257줄)

`surroundings.button`("주변 확인") 버튼을 누르면 `/api/surroundings/scene`을 조회해 **입구 기준 왼쪽/오른쪽/맞은편/건물 너머**(축 실패 시 8방위 폴백) 묶음으로 150m 안을 재구성한다. 카카오 카테고리 **18종 전부**(`ALL_CATEGORY_GROUPS`), `SCENE_CAP=150`.

**R6이 건드리는 계약 전부**:

| 요소 | 현재 근거 | 자동 펼침이 되면 |
|---|---|---|
| 트리거 버튼 | 조회 진행 신호를 **라벨 교체**로 전달(`surroundings.loading`) — 별도 announce 금지 | 신호 채널 소멸. 대체 필요 |
| `busy` 플래그 | 중복 탭 차단 | 무의미 |
| `closed` + "닫기" 버튼 | 사용자가 펼친 것을 접는다 | 존재 근거 소멸(자동으로 나타난 것을 닫는 의미가 약하다) |
| `landAfterLoad` | 트리거 누른 뒤 결과 헤딩/메시지 행으로 착지 | 사용자 행동 없이 포커스가 움직이면 **탈취**다. 화면 전체 `nearbyFocusOnLoad`와 경합 |
| `refreshFailed` | 재조회 실패를 화면 표식으로(코어 계약 #11이 직전 데이터를 유지하므로) | 유지 필요 |
| Announcement 금지 | "감싸는 화면이 단일 통지 채널을 소유"(주석 8~11행) | 감싸는 화면이 조망+장면 **두 개**의 완료를 알려야 함 |
| 각 항목 렌더 | `distanceText(itemLine(item))` — 단순 `Text` | **R7: `NavigationLink → PlaceDetailView`로 승격** |

**R7의 실제 비용**: `SceneItem`은 `{ name, distanceMeters, road, category }`뿐이다(`src/lib/surroundings-scene.ts:41`). **좌표도 place id도 없다.** `PlaceDetailView(place:)`가 요구하는 `Place`를 만들 수 없다. 서버가 이미 카카오 doc에서 좌표를 갖고 있으므로 응답 스키마 확장은 가능하지만, 이건 UI 변경이 아니라 **API 계약 변경 + Kit 모델 + 웹 미러 동조**다.

## 3. R4·R5 "한눈에 보기" — 신규 계층

### 3.1 5종 데이터원 실측

전부 이미 존재한다. 새 API 발급·활용신청은 **0건**이다.

| 조망 항목 | 라우트 | 게이트 | 조회 반경 | 특수 상태 |
|---|---|---|---|---|
| 대중교통 인프라 | `/api/station/subway-arrival/nearby` · `/api/bus/nearby` (또는 `/api/station/meta`) | 서울지하철 실시간키 · `DATA_GO_KR_API_KEY` | 지하철 seed 근접(0건이면 `nearest` 동봉) · TAGO **~700m 고정** | 지하철 **4-state**(ok/unavailable/closed/unknown), 버스 `isUncoveredBusRegion` |
| 식당 및 카페 | `/api/places/around` (FD6·CE7) | `KAKAO_REST_API_KEY` | **500m** | — |
| 아이 놀 곳 | `/api/places/kids` | `KAKAO_REST_API_KEY` | **2,000m** | 실내/외 3-state |
| 문화 행사 | `/api/events/nearby` | `SEOUL_OPEN_DATA_KEY` | **3,000m** | **`unavailableHere: "seoulOnly"`** |
| 무장애 관광지 | `/api/places/barrier-free` | `DATA_GO_KR_API_KEY` | **3,000m** | — |

**반경이 500m~3km로 6배 벌어져 있다.** "한눈에 보기"라는 제목은 하나의 공간 범위를 암시하는데 실제 근거는 항목마다 다르다. 시각 사용자는 목록을 열어 거리를 보고 보정하지만, 조망 불릿만 듣는 SR 사용자에게는 그 보정 경로가 없다. **각 불릿이 자기 반경을 말하든지, 조망을 공통 반경으로 재조회하든지 둘 중 하나여야 한다**(후자는 5종 provider의 `radiusMeters` 옵션이 이미 있어 기술적으로는 가능하다 — `surroundings.ts:165`, `culture-events.ts:54`, `tour-barrier-free.ts:138`).

### 3.2 집계 위치 — 클라 병렬 vs 서버 라우트

| 축 | 클라이언트 5회 병렬 | 서버 집계 라우트 1개 |
|---|---|---|
| 새 서버 코드 | 0 | 라우트 + 서비스 + 문장 조립 |
| 왕복 | 화면 진입당 5(조망) + 1(scene) = **6회** | 2회 |
| 문장 조립 | iOS·웹 각각 중복 | 한 곳, CLI/MCP도 공유 가능 |
| 3-state 보존 | 소비자마다 재구현 | 서버가 판정, 소비자는 렌더만 |
| 선례 | — | **`/api/where-am-i`가 정확히 이 패턴**(4조각 `allSettled` + 결정론 산문) |

repo 관례(`assembleWhereAmI`, `getWalkInfrastructure`, `findNightClinicsNow` — 전부 "진입점 하나, provider 직접 호출 금지")를 따르면 **서버 집계가 강한 디폴트**다. 단 조망 5종 중 지하철 도착은 실시간(`no-store`)이라 캐시 정책이 다른 조각과 섞인다 — 조망에 필요한 것이 "도착 정보"가 아니라 "역·정류장이 있는가"뿐이라면 준정적 `/api/station/meta`(revalidate 86400)가 더 맞다. **이 판정이 조망 비용을 좌우한다.**

### 3.3 문장형 불릿의 3-state 함정

조망 한 줄이 뭉갤 수 있는 상태가 항목마다 최소 넷이다:

```
"문화 행사 3건"          ← 정상
"문화 행사 없음"          ← 0건 (반경 3km 안에 오늘 진행 중인 것이 없다)
"문화 행사 정보 없음"      ← 서울 밖 (unavailableHere: seoulOnly)
"문화 행사 조회 실패"      ← 502
"문화 행사 —"            ← 키 없음 (게이트, 항목 자체 미노출이 정본)
```

버스는 여기에 `isUncoveredBusRegion`(TAGO 미커버)이, 지하철은 4-state가 더 붙는다. **불릿 다섯 줄에 상태 조합이 20가지 이상** 된다. 접근성 헌장 §1의 3-state 불변식이 이 계층의 주된 설계 부담이고, 짧은 문장에 밀어 넣을수록 뭉개진다.

### 3.4 부분 실패의 렌더

5조각이 `allSettled`면 3개 성공·2개 실패가 정상 경로다. 현재 `NearbyLoadCore`의 `NearbyLoadPhase`는 **전체 화면 단위 단일 상태**(loaded/empty/failedServer/…)라 조각별 부분 실패를 표현하지 못한다. `where-am-i`는 조각이 비면 그 문장을 생략하는 방식으로 회피하는데, 조망은 "없음"과 "실패"를 구분해야 하므로 같은 회피가 안 된다. **`NearbyLoadCore` 껍데기로 그대로 감쌀 수 있는지가 열린 질문**이다(감싸지 못하면 이 화면만 상태 머신이 갈린다 — spec `2026-07-31-ios-nearby-skeleton-design.md` §5 전이표의 예외가 된다).

### 3.5 "30초 브리핑"의 예산 — 실측

30초는 어림할 값이 아니라 잴 값이다. `say -v "Jian (Premium)" -o *.aiff` + `afinfo`로 한국어 낭독 시간을 쟀다(2026-08-12):

| 후보 문장 | 자수 | r=250 | r=300 | r=400 |
|---|---|---|---|---|
| 식당과 카페가 500미터 안에 12곳, 가장 가까운 곳은 남쪽 40미터 스타벅스입니다. | 48 | 4.91s | 4.22s | 3.15s |
| 식당과 카페 12곳, 가장 가까운 곳은 남쪽 40미터 스타벅스입니다. | 38 | 4.11s | 3.51s | 2.63s |
| 식당과 카페 12곳, 남쪽 40미터 스타벅스가 가장 가깝습니다. | 35 | 3.71s | 3.16s | 2.33s |
| 문화 행사는 서울에서만 안내합니다. | 19 | 1.76s | 1.50s | 1.11s |

**한국어 약 0.10초/자**(r=250, 보수적). 5불릿 × 48자 = **약 25초**로 반경을 병기해도 30초 예산 안에 든다(스와이프 간격·섹션 제목 제외).

**따라서 제약은 시간이 아니라 문장 수다.** 불릿이 5개를 넘거나 항목당 두 문장이 되면 즉시 초과한다. 이것이 §3.3의 3-state 문제를 더 조인다 — "0건"과 "정보 없음"과 "실패"를 **한 문장 안에서** 구분해야 하고, 설명을 덧붙여 해소할 여유가 없다.

⚠ **§3.1의 반경 문제를 낭독 시간으로 논증하면 안 된다**(초안이 그렇게 프레이밍했고 실측이 정정했다). 반경을 통일해야 하는 이유는 길이가 아니라 **일관성**이다: 성과 정의가 "**가까운 곳**에 무엇이 있나"인데 그 "가까운"이 500m와 3km를 오가면 브리핑 자체가 거짓이 된다. 무장애 관광지 3km는 걸어서 40분이라 식당 500m와 같은 문장에 놓일 수 없다.

**"통계가 아니다"가 배제하는 것**: `식당 12곳 / 아이 놀 곳 3곳 / 문화 행사 5건` 식의 수치 나열은 "어떤 POI가 있나"에 답하지 않는다. 최소 형태는 **개수 + 대표 장소 명명**이고, 대표를 무엇으로 고를지(최근접? 카테고리 대표?)가 spec 판정이 된다.

## 4. R3 보행 인프라 제거 — 경계 실측

**iOS 제거 범위는 자기완결적이다.**

| 대상 | 소비자 | 판정 |
|---|---|---|
| `ios/Gildongmu/Nearby/WalkInfraNearbyView.swift` | `NearbyHubView` 19행뿐 | **삭제 가능** |
| Kit `WalkInfraService.swift` · `WalkInfraModels.swift` | 위 뷰뿐(전수 grep 확인) | 삭제 가능. 단 웹·CLI와의 모델 미러를 유지하려면 남길 근거는 있다 |
| `WalkInfraModelsTests.swift` | Kit 테스트 | 모델 삭제 시 동반 |
| `walkInfra.*` i18n 키(ko/en/es/fr/it/ja 6종) | 웹 `WalkInfraNearby.tsx`도 사용 | **삭제 금지**(웹 유지 시) |

**절대 건드리면 안 되는 것** — 같은 이름을 쓰지만 다른 계층이다:

- `src/lib/providers/audio-signals.ts` + `scripts/build-audio-signals.mjs`: **도보 경로의 음향신호기 주석**이 직접 쓴다(`src/lib/walk-route.ts:3` `hasAudioSignalNear`). 보행 인프라 화면과 무관하게 살아 있어야 한다.
- `src/lib/walk-infra.ts` (`getWalkInfrastructure`): `/api/walk/nearby` + **채팅 도구 `get_walk_infrastructure`**(`src/lib/chat/router.ts:30`, 20개 도구 중 1) + 타일 캐시 설정(`api/chat/route.ts`)이 쓴다.
- CLI/MCP `endpoint-catalog-shared.ts`의 `walk/nearby` 항목(양쪽 미러, drift 테스트가 byte 해시로 강제).

즉 **R3은 "iOS 탭에서 화면 하나를 뺀다"이지 "기능을 없앤다"가 아니다.** 웹·채팅·CLI에서는 계속 살아 있다. 그 상태가 의도인지(플랫폼 갭 수용) 아니면 전 계층 제거인지가 판정 사항이다.

## 5. 접근성 계약 파급 (헌장 대조)

1. **§3 발견 경로 규칙의 판정선이 뒤집힌다.** 현재 `SurroundingsSceneSection`은 "버튼으로 펼치는 패널"이라 heading 없이 성립하는 부분이 있는데(트리거가 발견 경로), R6 이후엔 "조용히 나타나는 섹션"이 되어 **heading이 유일한 발견 수단**이 된다. 묶음 제목 heading은 이미 있으나(`bucketTitle`), 섹션 전체 제목("주변 상황" `surroundings.ready`)의 계층과 "한눈에 보기" 제목의 계층을 함께 정해야 한다.
2. **heading 레벨 설계가 새로 필요하다.** iOS는 `.isHeader` trait만 있고 레벨이 없어 웹만큼 계층이 드러나지 않지만, 화면에 제목이 3층(한눈에 보기 / 주변 상황 / 묶음 12종)이 되면 로터 점프의 유용성이 제목 수에 반비례한다.
3. **포커스 착지가 이중화된다.** `nearbyFocusOnLoad`는 "첫 로드에만 착지"가 계약인데(허브 공유 계층 `NearbyFocus.swift`), 이 화면은 완료 시점이 다른 두 로드(조망·장면)를 갖는다. 늦게 온 쪽이 포커스를 움직이면 헌장 §5의 탈취다.
4. **통지 채널 단일성.** 지금은 `nearbyAnnouncer`가 화면당 하나다. 조망 5조각 + 장면의 완료·실패를 어떻게 한 채널로 합산할지가 열려 있다(웹 `combinedLiveMessage`가 검색 3섹션에서 같은 문제를 푼 선례다).
5. **"한 줄 = 한 접근성 객체"**: 조망 불릿은 `joinText`로 단일 텍스트여야 하고, 반경·수치·상태가 인라인 `span`/별도 `Text`로 갈라지면 안 된다.

## 6. 웹 — 갭이 아니라 단계 (위원장 확정 2026-08-12)

웹 `src/components/NearbyHub.tsx`는 같은 11개 구조를 아코디언으로 갖는다(`canShow*` prop 10개 + `WalkInfraNearby`). **웹도 후속 이식하므로 백로그 축 4(플랫폼 갭)에 등재하지 않는다** — iOS 출하 시점의 어긋남은 종착 상태가 아니라 통과 구간이다.

단계 순서에 걸리는 것 둘:

1. **§3.2의 집계 위치 판정이 웹 이식 비용을 결정한다.** 서버 집계면 웹은 렌더만 갈아 끼우고, 클라 조립이면 웹이 같은 조립을 다시 짓는다(문장 조립·3-state 판정·반경 통일 전부 두 벌). **웹 이식을 전제하면 서버 집계 쪽 논거가 한 단계 더 강해진다.**
2. **`SurroundingsScene.tsx`(웹) ↔ `SurroundingsSceneSection.swift`(iOS)는 M1 이식으로 계약을 공유한다.** R6·R7이 iOS만 바꾸면 그 미러가 깨진 구간이 생기고, 웹 이식이 끝나야 닫힌다. **그 구간의 길이가 리스크**이므로 spec에서 phase 경계를 명시한다. R7의 응답 스키마 확장(좌표 추가)은 서버 쪽이라 **양 플랫폼이 동시에 받는다** — 깨지는 것은 스키마가 아니라 렌더·상호작용 계약이다.

## 7. 비용·쿼터

화면 진입 1회당 upstream 호출이 늘어난다.

| 조각 | upstream | 현재 | 재편 후 |
|---|---|---|---|
| where-am-i | 카카오 ×2 + 둘러보기 1 | 진입 시 | (통합으로 소멸 또는 흡수) |
| 둘러보기 | 카카오 카테고리 10종 | 진입 시 | 진입 시 |
| scene | 카카오 카테고리 **18종** + 역지오코딩 + juso 축 | **버튼 누를 때만** | **진입 시 자동** |
| 조망 5종 | 카카오 2 + 서울 열린데이터 1 + data.go.kr 2(+지하철 실시간) | 없음 | 진입 시 |

**`SEOUL_OPEN_DATA_KEY`는 일 1,000회를 따릉이·문화행사·혼잡도가 공유한다**(CLAUDE.md). 문화행사 조회가 "둘러보기 화면 진입마다"로 바뀌면 이 공유 쿼터의 소비 패턴이 달라진다 — 단 문화행사는 일자 키 `unstable_cache` 6시간으로 감싸여 있어 실제 upstream 증가는 완충된다. `DATA_GO_KR_API_KEY`도 공유 쿼터(백로그 C4가 이미 사용량 트리거로 열려 있다).

## 8. 확인이 필요한 것 (이 조사로 답하지 못함)

1. **브리핑 반경을 얼마로 두면 5종이 전부 의미 있는 수를 내는가.** §3.1의 통일 판정이 서면 그 값을 골라야 한다 — 500m면 무장애 관광지·문화 행사가 대부분 0이고, 3km면 "가까운 곳"이라는 말이 깨진다. **실호출로만 정해진다**(판정 기준 5). 상권·주거지·지방을 각각 재야 한다.
2. **대표 장소를 무엇으로 고르는가.** "개수 + 대표 명명"이 최소 형태인데, 대표가 최근접인지 카테고리 대표인지에 따라 브리핑이 달라진다(최근접은 "바로 옆에 뭐가 있나", 카테고리 대표는 "이 동네가 어떤 동네인가").
3. **`SceneItem`에 좌표를 실어 상세로 여는 것이 M1 spec의 "실재성 한계 고지"(`surroundings.source`)와 충돌하지 않는가.** 현재 장면 항목을 단순 텍스트로 둔 데에는 "이름을 그대로 말하는 대신 출처로 헤지"라는 판정이 있었다(spec 판정 5).
4. **통합 후 화면 제목·탭 라벨.** "둘러보기"가 지금은 `ios.nearby.around`("내 주변 둘러보기")이고 통합 후 담는 것이 더 넓어진다.
5. **`WhereAmIView`의 산문 3층을 어디로 보내는가.** 특히 수동 위치 vs GPS 선언은 `LocationBarView`가 허브 최상단에서 이미 하고 있으나, 그건 "조회 기준"이고 정위 산문은 "여기가 어디인가"라 층이 다르다.
