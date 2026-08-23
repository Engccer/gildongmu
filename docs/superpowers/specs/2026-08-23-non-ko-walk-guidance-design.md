# 비-ko 도보 상세 안내 (E16 축 3) — 설계

> 백로그 [E16](../../BACKLOG.md) 작업 축 3. 순서 계약은 `1 → 3 → 2`이고 축 1은 2026-08-16 종결됐다.
> 이 문서가 열리는 것이 축 2(웹 단독 진입점 제거)의 **선행 조건**이다 — 축 3이 실호출로 성립하지
> 않으면 축 2를 하지 않는다(비-ko 사용자에게 남는 것이 0이 되므로).

## 1. 문제 — ko 전용인 이유는 게이트가 아니다

도보 상세 안내는 지금 5개 로케일(en·es·fr·it·ja)에서 **조회 자체가 없다**:

| 자리 | 현행 |
|---|---|
| 웹 `DirectionsView.tsx:479` | `canShowWalk && !prefersEnglish(locale)` — 도보 수단이 목록에 없다 |
| 웹 `useRouteGuide.ts:1646` | `prefersEnglish` → 상세 조회를 건너뛰고 `briefStarted`(직선거리)로 시작 |
| 웹 `useRouteGuide.ts:2064` | `canOfferDetail`에 `!prefersEnglish` |
| iOS `DirectionsTabView.swift:388` | `includeWalk = AppLanguage.current == "ko"` — 조회 자체 생략 |
| iOS `DirectionsTabView.swift:886` | 도보 안내 공지도 ko 게이트 |

게이트를 지우면 무엇이 나오는가 — **한국어 산문이 나온다**. 낭독 정본은 리듀서가 아니라
서버가 만든 `step.description`이고(웹 `unitText` → `route.steps[i].description`, Kit 동형),
그 문장은 `rewriteWalkGuidance`가 한국어 정규식으로 조립한다. 그러므로 축 3은
"게이트 해제"가 아니라 **en 산문 생성기 신설**이다. 부수적으로 판정 축도 걸린다:
`walkStepAction`이 한국어 부분 문자열(`좌회전`·`횡단보도`…)로 임박 큐 행동을 가르므로
en 문장에서는 전량 `null`(임박 큐 전면 침묵)이 된다.

⚠ 폐기 항목 "en 도보 경로 (provider에게 en을 받는 길)"와 **다른 접근**이다. 그쪽은
provider가 영어 문장을 주기를 요구했고 3중 실측으로 부재가 확정됐다. 이 설계는
**ko 구조화 데이터로 en 문장을 우리가 만든다**.

## 2. 실호출 관측 (2026-08-23, 이 설계의 근거)

### 2.1 Tmap 보행자는 행동·도로명·거리를 전부 구조화해 준다

`POST https://apis.openapi.sk.com/tmap/routes/pedestrian?version=1` 응답 실측:

- **Point feature** `properties`: `turnType`(회전 유형 코드) · `pointType`(SP/GP/PP1/EP) ·
  `name`(POI 상호) · `intersectionName` · `facilityType` · `description`(ko 완성 문장)
- **LineString feature** `properties`: `name`(**도로명** — "천호대로"·"진황도로"·"보행자도로") ·
  `distance`(m) · `time` · `roadType`

⚠ **귀속 규칙은 "합"이 아니라 "첫 LineString"이다**(30경로 435스텝 실측으로 정정). 한 Point 뒤에
LineString이 둘 이상 붙는 경우가 흔한데(짧은 연결 구간), 문장이 말하는 거리·도로명은 **첫 구간**의
것이다 — 예: `…2시 방향 우회전 후 봉은사로를 따라 306m 이동` 뒤에 `봉은사로 306m` + `논현로 8m`가
붙지만 문장은 306·봉은사로다. 합(314)으로 읽으면 모든 다중 구간 스텝에서 거리가 어긋난다.
`pathCoords` 귀속은 종전대로 **전부**(기하는 실경로를 따라야 한다) — 문장 축만 첫 구간이다.

그러므로 **스텝당 (행동 코드, 도로명, 거리) 3요소가 전부 구조화 필드로 있다.**

### 2.2 관측 코퍼스 (30개 경로 435스텝 + 경유지 1경로, 전국)

| turnType | 건수 | pointType | 실문장 |
|---|---|---|---|
| 0 | 1 | PP1 | 경유지 후 보행자도로를 따라 43m 이동 |
| 11 | 57 | GP | 직진 후 보행자도로를 따라 169m 이동 |
| 12 | 107 | GP | …에서 좌회전 후 천호대로를 따라 1m 이동 |
| 13 | 90 | GP | …에서 우회전 후 263m 이동 |
| 17 | 2 | GP | 10시 방향 좌회전 후 91m 이동 |
| 18 | 8 | GP | 2시 방향 우회전 후 보행자도로를 따라 74m 이동 |
| 126 | 1 | GP | 서울역 2번출구에서 지하보도 진입 후 72m 이동 |
| 200 | 30 | SP | 보행자도로를 따라 30m 이동 |
| 201 | 30 | EP | 도착 |
| 211 | 56 | GP | …에서 횡단보도 후 보행자도로를 따라 33m 이동 |
| 212 | 27 | GP | 좌측 횡단보도 후 보행자도로를 따라 14m 이동 |
| 213 | 26 | GP | …에서 우측 횡단보도 후 보행자도로를 따라 44m 이동 |
| 216 | 1 | GP | 2시 방향 횡단보도 |

⚠ **관측이 공식 표를 반증했다.** Tmap 공식 표(readme.io "경로안내 샘플예제", 2026-08-23 확인)는
경유지를 184~189로 적었지만 **실호출 PP1 지점의 `turnType`은 `0`**이다. 표만 보고 박았다면
경유지가 있는 모든 en 경로가 "미지 코드"로 떨어졌다. `car-action.ts`가 코퍼스와 공식 표를
**둘 다** 근거로 쓴 이유가 여기서 재현됐다 — 이 설계의 표도 둘의 합집합이다.

### 2.3 juso가 도로명 로마자를 준다

`business.juso.go.kr/addrlink/addrLinkApi.do` 실호출(4/4 성공):

| 질의 | `rn` | `engAddr` |
|---|---|---|
| 천호대로 | 천호대로 | `975 Cheonho-daero, Gangdong-gu, Seoul` |
| 진황도로 | 진황도로 | `2 Jinhwangdo-ro, Gangdong-gu, Seoul` |
| 구천면로 | 구천면로 | `77 Gucheonmyeon-ro, Gangdong-gu, Seoul` |
| 천중로 | 천중로 | `6 Cheonjung-ro, Gangdong-gu, Seoul` |
| 봉은사로 | 봉은사로 | `B102 Bongeunsa-ro, Gangnam-gu, Seoul` |
| 성내로6길 | 성내로6길 | `11 Seongnae-ro 6-gil, Gangdong-gu, Seoul` |
| **보행자도로** | — | **totalCount 0** (도로명이 아니라 일반명사) |

**코퍼스의 고유 도로명 40개 중 39개 성공**(실패 1건은 `보행자도로` = 일반명사, 즉 정답).
`engAddr`의 첫 쉼표 앞 조각에서 **선행 번호 토큰 하나만** 벗기면 로마자 도로명이 나온다 —
⚠ 번호 토큰은 순수 숫자가 아닐 수 있고(`B102`) 뒤따르는 `6-gil`은 이름의 일부라 **첫 토큰만**
벗겨야 한다(`11 Seongnae-ro 6-gil` → `Seongnae-ro 6-gil`).
마지막 행이 중요하다 — **일반명사 필터를 코드에 박지 않아도 juso가 0건으로 걸러 준다**
(하드코딩 차단 목록 불필요).

### 2.4 문장 ↔ 구조 등가가 실측으로 성립한다

- `"{X}를/을 따라"` 절의 유무·값 **⟺ 첫 LineString `name`**: 212스텝 **불일치 0**.
  (이름이 빈 구간이면 문장에도 도로 절이 없다.)
- 문장의 `NNNm 이동` **⟺ 첫 LineString `distance`**: 435스텝 **불일치 0**(±1m 허용, 실제 편차 0).
- 코드 ↔ 한국어 표지(§4.3.1): 435스텝 **오탐 0**.

이 셋이 §4.3.1 가드의 근거이자 en 문장이 *가정*이 아니라 *검증된 계약* 위에 선다는 증명이다.

## 3. 접근 비교

| | A. 서버가 en 문장을 만든다 (**채택**) | B. 서버는 구조화 필드만, 소비자가 조립 | C. 지명 없이 행동+거리만 |
|---|---|---|---|
| 미러 벌수 | 서버 1벌 | 웹·Kit·CLI 3벌 | 서버 1벌 |
| 기존 계약 | "낭독 문장은 서버가 만든다"(CLAUDE.md) 유지 | 그 계약 파기 | 유지 |
| 소비자 변경 | 없음(문자열이 영어로 올 뿐) | 전부 | 없음 |
| 6로케일 확장 | en 하나(=`dataLocale` 계약) | 로케일별 가능 | en 하나 |
| 방향 감각 | 도로명 있음 | 있음 | **없음** |

**A 채택.** B의 유일한 이득(로케일별 문장)은 `dataLocale` 계약이 이미 포기한 것이다 —
장소·주소 데이터도 비-ko 전부 영어 한 벌이다. 문장만 5벌로 갈 이유가 없고, 3벌 미러는
이 repo가 반복적으로 대가를 치른 축이다. C는 A의 **열화 상태**로 흡수한다(도로명 조회
실패·무명 도로는 도로명 없이 나간다) — 별도 접근이 아니라 A의 폴백이다.

## 4. 설계

### 4.1 provider — en은 Tmap 단독

카카오 도보는 완성 한국어 문장만 주고 회전 코드가 없다. 그러므로:

```
lang === "ko" → 현행 그대로 (카카오 기본 + Tmap 폴백)
lang !== "ko" → Tmap 단독. 키 없으면 도보 수단 자체가 없다.
```

게이트는 `hasWalkRouteKeyFor(lang)`(`env.ts`) 하나로 모은다: ko는 `hasKakaoKey() || hasTmapKey()`,
그 외는 `hasTmapKey()`. 라우트·페이지가 같은 함수를 쓴다(split-brain 금지).

⚠ 폴백 없음이 의도다. en에서 Tmap이 죽으면 카카오로 내려가 봐야 **한국어 문장**이 나오므로
"가용성 폴백"이 아니라 "언어 파괴"다. 실패는 throw(502).

### 4.2 판정 계층 — `src/lib/pedestrian-action.ts` (신규, **표 하나**)

`turnType` 하나를 **한 번만** 분류한다. 행동(임박 큐)과 en 문장을 **같은 항목**에서 꺼낸다.

```ts
type PedestrianStep = { action: GuideAction | null; phrase: string | null; observed: boolean };
pedestrianStepFor(turnType: number): PedestrianStep | null;   // null = 미지 코드
```

⚠ **두 표로 나누지 않는 것이 이 모듈의 존재 이유다**(설계 리뷰 #2). 행동표와 문장표를 따로 두면
같은 코드가 두 번 분류되어 "문장은 좌회전인데 임박 톤은 우회전"이 가능해지고, 각 표의 코드
커버리지 테스트를 둘 다 통과해도 그 불일치는 잡히지 않는다. 한 항목에서 꺼내면 그 결함이
구조적으로 불가능해진다.

| turnType | `action` | `phrase` | 관측 |
|---|---|---|---|
| 12 | `left` | `Turn left` | ✅ 36 |
| 13 | `right` | `Turn right` | ✅ 39 |
| 14 | `back` | `Make a U-turn` | 공식 표 |
| 16 / 17 | `left` | `Turn to your 8 o'clock` / `… 10 o'clock` | 17만 ✅ 2 |
| 18 / 19 | `right` | `Turn to your 2 o'clock` / `… 4 o'clock` | 18만 ✅ 3 |
| 125 | `null` | `Take the pedestrian overpass` | 공식 표 |
| 126 | `underpass` | `Take the underpass` | ✅ 1 |
| 127 / 128 / 129 | `null` | `Take the stairs` / `Take the ramp` / `Take the stairs or the ramp` | 공식 표 |
| 211 | `crosswalk` | `Cross the crosswalk` | ✅ 14 |
| 212 / 213 | `crosswalk` | `Cross the crosswalk on your left` / `… on your right` | ✅ 12 / 12 |
| 214·215·216·217 | `crosswalk` | `Cross the crosswalk at 8 / 10 / 2 / 4 o'clock` | 공식 표 |
| 218 | `null` | `Take the elevator` | 공식 표 |
| 0 · 1~7 · 11 · 184~189 · 200 · 233 | `null` | `null`(행동절 없음) | 0·11·200 ✅ |
| 201 | `null` | `Arrive at your destination.` | ✅ 10 |
| 그 외 | — | — | **`null` → throw**(§4.3) |

- ⚠ **시계 방위는 보존한다**(설계 리뷰 #8 수용). 종전 초안은 16~19를 `Bear left`·`Turn sharply left`로
  옮겼는데, 8·10·2·4시는 **갈림길에서 어느 가지인지를 지목하는 정보**라 좌우의 정밀도로 접으면
  다른 길로 진입시킬 수 있다. 자연스러움 때문에 공급자가 준 방향 정밀도를 버리지 않는다.
  횡단보도 시계 방위(214~217)와 표기를 통일한다.
- ⚠ **육교·계단·경사로·엘리베이터의 `action`이 `null`인 것은 판정이다.** 육교를 `underpass`로 접으면
  "지하보도로 건너세요"가 나가 거짓이고, 계단·엘리베이터에 `crosswalk` 톤을 붙이면 음향신호기
  비프의 거짓 인용이 된다(`imminentTone` 기존 판정). 문구는 있고 큐만 없다 — **미분류의 결과는
  오안내가 아니라 침묵**.

### 4.2.1 행동은 서버가 전량 싣는다 — 클라이언트 폴백을 없앤다

설계 리뷰 #3: `step.action ?? walkStepAction(description)`은 **의도된 `null`과 미투영을 구별하지
못한다**. 새 모드를 만드는 대신 **분류의 집을 서버 하나로 옮겨** 그 질문 자체를 없앤다.

- 파이프라인 마지막 단계 `attachStepActions(briefing, includeGeometry)`가 **모든** 도보 스텝에
  `action`을 채운다: Tmap 스텝은 `pedestrianStepFor(turnType).action`, 카카오 스텝은
  **주석까지 끝난 최종 문장**에 `walkStepAction`을 태운 결과(= 지금 클라이언트가 보는 것과 같은
  입력·같은 함수라 결론이 동일하다).
- 리듀서의 walk 프로파일 `actionSource`를 `text` → **`step`**으로 바꾼다(car와 같은 값, 한 줄 × 2).
  새 모드를 만들지 않는다.
- `action`은 **`includeGeometry` 응답에만** 싣는다(`live` 조각과 같은 게이트). 브리핑 응답은
  종전과 byte-identical이라 CLI·채팅·MCP는 아무 변화가 없다.
- ⚠ 배포 순서: **웹이 앱보다 먼저**. 옛 앱은 `actionSource: .text`라 새 필드를 무시하고 종전대로
  문장을 분류한다(같은 결론). 새 앱은 서버가 이미 필드를 싣고 있어야 하는데, 웹 배포가 push
  즉시라 그 순서는 자동으로 성립한다.
- Kit `walkStepAction`·`.text` 분기는 이 변경으로 **호출자가 없어진다.** 이번 마일스톤에서 지우지
  않고(car 영역의 `GuideActionSource`까지 연쇄한다) `docs/BACKLOG.md`에 정리 항목으로 남긴다 —
  조용한 죽은 코드가 되지 않게 하는 것이 목적이다.

### 4.3 en 산문 — `src/lib/walk-guidance-en.ts` (신규)

문장 틀은 **Tmap 한국어 원문의 구조를 그대로 옮긴다**:

| ko 원문 | en |
|---|---|
| `직진 후 보행자도로를 따라 169m 이동` | `Walk 169m.` |
| `…에서 우회전 후 진황도로를 따라 294m 이동` | `Turn right, then walk 294m along Jinhwangdo-ro.` |
| `좌측 횡단보도 후 보행자도로를 따라 14m 이동` | `Cross the crosswalk on your left, then walk 14m.` |
| `서울역 2번출구에서 지하보도 진입 후 72m 이동` | `Take the underpass, then walk 72m.` |
| `도착` | `Arrive at your destination.` |

⚠ 설계 리뷰 #9(시설 통과 거리의 의미)에 대한 판정: **원문이 이미 "진입 후 72m 이동"이라고 말한다.**
거리의 의미는 우리가 정하는 것이 아니라 공급자가 정한 것이고, ko 사용자는 오늘 그 문장을 그대로
듣고 있다. en이 같은 구조를 옮기는 한 새 위험이 아니다 — 새 위험은 구조를 **바꿀 때** 생긴다.

- POI 상호(`name`)·교차로명(`intersectionName`)은 뺀다 — juso가 로마자화하지 못하는 고유명사다.
  그 결과 `live.target`/`anchor`가 없고 주기 통지는 기존 `guide.periodicStraightNoName`으로 떨어진다.
- 거리 표기는 `formatDistance`만 지난다(3벌 미러 규칙). 낭독 단위 정정은 `spokenDistanceUnits`가 처리.

**미지 turnType은 throw**(라우트 502). 설계 리뷰 #1은 "소비자가 간략으로 조용히 강등한다"를
근거로 별도 상태를 요구했으나 **전제가 성립하지 않아 기각한다**: 간략 안내는 경로 주장을 하지
않는다(직선 방위·거리만 말한다). 즉 강등의 결과는 "회전이 직진 지시로 바뀌는 것"이 아니라
"경로 안내가 없는 것"이고, 그것이 바로 이 throw가 의도한 상태다. 별도 오류 코드는 소비자
4종에 분기를 늘리면서 사용자가 취할 행동을 바꾸지 않는다.

### 4.3.1 한국어 원문을 **가드**로 쓴다 (설계 리뷰 #4·#5 수용)

en 문장의 출처는 구조화 필드지만, 응답에는 한국어 `description`이 **여전히 실려 온다**. 그것을
대조 가드로 쓰면 미관측 코드와 귀속 가정이 조용히 틀리는 대신 즉시 실패한다. 두 축 모두 비용 0:

1. **코드 ↔ 한국어 표지**: 우선순위 있는 표지 목록(회전 → 시설 → 건널목, `walk-action.ts`의
   precedence 함정 그대로 — "천호역 횡단보도에서 좌회전"은 좌회전이다)으로 원문에서 표지 하나를
   뽑아, 그 표지가 허용하는 코드 집합에 실제 `turnType`이 없으면 **throw**.
2. **코드 ↔ 거리**: 원문의 `NNNm 이동`을 파싱해 귀속된 LineString `distance` 합과 ±1m 밖이면
   **throw**. 이것이 "Point 뒤 LineString이 그 스텝 구간"이라는 귀속 가정(#5)의 런타임 증명이다.

⚠ **가드는 새 실패 모드다.** 오탐 하나가 en 안내를 통째로 죽인다 — 그래서 설계 단계에서 먼저 쟀다:
**30경로 435스텝에서 표지 오탐 0 · 거리 오탐 0**(§2.4). 거리 축은 초기 초안의 "LineString 합"으로는
435스텝 중 48건이 어긋났고, 그 48건이 §2.1의 귀속 규칙 오류를 드러냈다 — **가드가 설계 결함을
설계 단계에서 잡았다**. 실호출 게이트가 이 수치를 회귀로 지킨다.

### 4.4 로마자 도로명 — `src/lib/providers/juso-road-name.ts` (신규)

```ts
roadNameEn(ko: string): Promise<string | null>   // null = 도로명이 아님(0건·불일치). 조회 실패는 throw.
```
- juso `addrLinkApi` `keyword=<도로명>`, `countPerPage=5`. **`rn === ko` 정확 일치**만 채택.
- `engAddr.split(",")[0]`에서 선행 건물번호 토큰(`/^[\d-]+\s+/`)을 벗겨 반환.
- `unstable_cache` 도로명 키, revalidate 30일. **실패는 throw라 캐시에 들어가지 않는다**(설계 리뷰 #7 수용 —
  종전 초안은 실패를 `null`로 접어 "도로명 없음"으로 30일 캐시할 수 있었다).
- 호출부는 `Promise.allSettled` + 총 1.5초 `AbortSignal.timeout`. rejected는 도로명 없이 진행
  (비블로킹 — 안내 시작 경로에 직렬로 끼므로 상한이 필수, [[client-timeout-must-mirror-both-platforms]]).

⚠ 설계 리뷰 #6(지역 제약 없는 동명 도로)은 **기각한다.** 로마자 표기는 한글 문자열의 함수라
동명 도로는 지역이 달라도 **같은 로마자**로 표기된다("천호대로" → `Cheonho-daero`, 어디서든).
지역을 캐시 키에 넣으면 역지오코딩 의존과 캐시 폭증을 얻고 정확도는 얻지 못한다. 실제 위험은
Tmap의 일반명(`보행자도로`)이 실재 도로명과 우연히 일치하는 경우인데, 그때 나오는 것도
**그 이름의 올바른 로마자**이지 엉뚱한 거리가 아니다. 사용자에게 잘못된 사실이 되지 않는다.

⚠ 설계 리뷰 #7의 사용자 3-state(`found|notFound|unavailable` 노출)도 **기각한다.** 세 경우 모두
사용자에게는 "도로명 없는 문장" 하나로 나타나고 취할 행동이 같다 — 사용자가 취할 행동이 같으면
한 문장이다(SR 통지 잉여 금지 규칙). 3-state는 **캐시 계층에만** 둔다(위 throw).

### 4.5 파이프라인 — `getWalkRoute({ lang })` (**required**)

설계 리뷰 #11 수용: `lang`은 **기본값 없는 필수 인자**다. 생략이 한국어로 조용히 복구되면 새
비-ko 호출부 하나가 타입 오류 없이 한국어 안내를 낸다([[no-default-for-safety-parameters]]).
기존 호출부(라우트 핸들러·채팅 도구·`getWalkRouteAlternatives`)는 `lang: "ko"`를 명시한다.

```
ko: 카카오|Tmap → rewriteWalkBriefing → annotateAudioSignals → annotateCrosswalkInfo → attachStepActions
en: Tmap        → buildEnBriefing     → annotateAudioSignals → (차로 수 미적용)        → attachStepActions
```

- `annotateCrosswalkInfo`는 `provider === "kakao"` 게이트라 en에서 자연히 침묵한다(E8 설계 유지).
- `annotateAudioSignals`의 건널목 판정은 **`step.action`이 있으면 그것을, 없으면 종전 한국어 문자열**을
  본다(Tmap 스텝은 normalize 시점에 이미 `action`을 달고 온다). ko+Tmap에서 211·212·213은 종전
  문자열 판정과 같은 결론이다. 주석 문구는 ko `", 음향신호기 있음"` / en `", audible pedestrian signal"`.
- `STEP_FREE_NOTICE`·`SHORTEST_STEPFREE_NOTICE`에 en 벌을 둔다(직접 API 소비자의 정직성).

### 4.6 부수 결함 — Tmap 폴백이 기하를 잃는다 (기존 버그)

`fetchPrimaryOrFallback`은 Tmap을 부를 때 `includeLineGeometry`·`noStore`를 **넘기지 않는다**.
그래서 카카오가 죽어 폴백한 실시간 안내 조회는 `pathCoords` 없는 브리핑을 받고 `buildGuideRoute`가
경로를 거부해 **상세가 조용히 간략으로 강등**된다. en은 Tmap 단독이라 이 경로가 상시 성립하므로
이번에 고친다(ko 폴백도 함께 나아진다).

### 4.6.1 회귀 주장의 정확한 범위 (설계 리뷰 #10 수용)

"ko byte-identical"은 과장이었다. 정확히는:

| 축 | ko 카카오 | ko Tmap(폴백·최단) |
|---|---|---|
| `description` 문자열 | **불변** | **불변** |
| 브리핑 응답(비기하) JSON | **불변**(`action`은 기하 응답에만) | **불변** |
| 기하 응답 JSON | `action` 필드 **추가** | `action` 필드 **추가** |
| 임박 큐 행동 | 같은 함수·같은 입력 → **결론 불변** | 문장 분류 → 구조화(관측 12코드 전부 같은 결론) |
| 음향신호기 주석 | **불변**(문자열 판정 그대로) | 판정 축이 문자열 → `action`(같은 결론) |
| 기하 전달 | 불변 | **개선**(§4.6, 종전엔 유실) |

게이트: ko 카카오·ko Tmap 각각의 직렬화 golden + 발화 시퀀스 회귀 테스트.

### 4.7 소비자 게이트 해제

| 자리 | 후 |
|---|---|
| `page.tsx` `canShowWalk` | `hasWalkRouteKeyFor(dataLocale(locale))` |
| `DirectionsView.tsx:479` | `canShowWalk` 단독(로케일 조건 제거) |
| `DirectionsView.tsx:840/845` | 도보 대안 조건에서 `prefersEnglish` 제거 |
| `DirectionsView.tsx:854` | **계단 회피 토글은 ko 유지**(아래) |
| `useRouteGuide.ts:1646` | 분기 삭제 — 전 로케일이 상세 조회로 시작 |
| `useRouteGuide.ts:2064` | `canOfferDetail`에서 `prefersEnglish` 제거 |
| iOS `DirectionsTabView.swift:388` | `includeWalk` 상수화(인자 삭제) |
| iOS `:886` | 도보 안내 공지 ko 게이트 제거 |
| iOS `:1060/1067/1079` | 도보 대안 ko 게이트 제거 |
| iOS `:1090` | **계단 회피 ko 유지** |

⚠ 설계 리뷰 #12 수용: **계단 회피 컨트롤은 비-ko에 노출하지 않는다.** en은 Tmap 단독이고 Tmap에는
검증된 계단 회피 축이 없어(M3에서 기각) 요청해도 항상 `unavailable`이다. 적용될 수 없는 옵션을
켤 수 있게 두고 조회 뒤에야 못 했다고 말하면, 스크린 리더 사용자는 그 사이 적용됐다고 믿는다.

⚠ iOS는 **실험판·정식판 둘 다 영향**이다(도보 안내는 2026-08-15 정식 졸업). `#if EXPERIMENTAL`은 불변.

## 5. 테스트

- `pedestrian-action.test.ts` — 공식 표 전 코드 매핑 존재(가드) + 관측 12코드 결론 + 육교/계단/
  엘리베이터의 `action`이 `null`인지(거짓 톤 차단) + `action`과 `phrase`의 좌우가 어긋나지 않는지
  (한 항목에서 나오므로 구조적으로 불가능하지만 표 오타를 잡는다).
- `walk-guidance-en.test.ts` — §4.2 표 전수 문장, 도로명 유·무, 도착 스텝, **미지 코드 throw**.
- `pedestrian-guard.test.ts` — §4.3.1 두 가드: 표지 precedence("천호역 횡단보도에서 좌회전"이
  좌회전으로 통과), 모순 코드 throw, 거리 불일치 throw, km 표기.
- `juso-road-name.test.ts` — engAddr 파싱(건물번호 벗기기·번호 없는 형태), `rn` 불일치 거절, 실패 시 null.
- `walk-route-en.test.ts` — en이 Tmap만 부르는지, 카카오 폴백을 하지 않는지, 주석 문구 en, 기하 전달.
- 리듀서: walk 프로파일 `actionSource: step`에서 발화 시퀀스가 종전과 같은지(§4.6.1 표) — 공유
  fixture에 ko 카카오·ko Tmap 케이스 추가, Kit `RouteGuideTests` 동조.
- `attachStepActions` — 비기하 응답에 `action`이 없는지(브리핑 byte-identical 가드).
- **실호출 게이트** `scripts/verify-non-ko-walk-guidance.mjs`: 실좌표쌍으로 `lang=en` 조회 →
  ①전 스텝 description이 ASCII(한글 0) ②`action`이 관측 코드에서 기대대로 ③도로명 로마자가
  적어도 1건 붙는지 ④`includeGeometry=1`에서 `pathCoords`와 `action`이 오는지 ⑤**30개 이상 경로
  코퍼스에서 §4.3.1 가드 오탐 0**(이 수치가 가드를 켜는 조건이다). 머지 게이트.

## 6. 범위 밖

- **축 2**(웹 단독 진입점 제거·강등 사유 3-state) — 이 문서가 실호출로 성립한 **뒤** 별도로 한다.
- es·fr·it·ja 전용 문장(= `dataLocale` 계약대로 en 한 벌).
- 카카오에서 en을 만드는 길(회전 코드 부재).
- en 계단 회피 적용(Tmap 동등 옵션이 실측상 추천과 같아 M3에서 이미 기각).
- CLI/MCP의 `lang` 노출(기본 ko라 동작 불변, 파일 소유권 밖).

## 7. 설계 리뷰 판정 (codex adversarial, 2026-08-23)

12건 중 8건 수용, 4건 기각. 리뷰는 신호이지 처방이 아니므로 기각 근거를 남긴다.

| # | 지적 | 판정 | 반영·근거 |
|---|---|---|---|
| 1 | 미지 코드 throw가 소비자에서 간략 강등된다 | **기각** | 전제 오류 — 간략 안내는 경로 주장을 하지 않는다(방위·거리만). 강등 결과는 "직진 지시"가 아니라 "경로 안내 없음"이고 그것이 의도한 상태다(§4.3) |
| 2 | 행동표·문장표 분리 → 드리프트 | **수용** | 표 하나, 한 항목에서 `action`·`phrase`를 함께 꺼낸다(§4.2) |
| 3 | `action ?? text`가 의도된 null과 미투영을 뭉갠다 | **수용** | 폴백 자체를 없앴다 — 서버가 전량 투영, 리듀서는 `actionSource: step`(§4.2.1) |
| 4 | 미관측 공식 코드가 안전 지시가 된다 | **수용(형태 변경)** | 실호출 표본 강제는 불가(유턴을 강제 생성할 수 없다) → 한국어 원문 표지 대조 가드로 런타임 검증(§4.3.1) |
| 5 | Point→LineString 귀속이 관측 가정이다 | **수용** | 거리 대조 가드가 그 가정의 런타임 증명(§4.3.1) |
| 6 | juso 동명 도로에 지역 제약 없음 | **기각** | 로마자는 한글의 함수라 동명이면 같은 표기다. 지역 키는 역지오코딩 의존만 늘고 정확도를 못 준다(§4.4) |
| 7 | 실패·0건·타임아웃을 null로 합침 / 실패 캐시 | **부분 수용** | 캐시 오염은 실재 → 조회 실패는 throw(캐시 회피). 사용자 3-state는 기각(행동이 같으면 한 문장) |
| 8 | 시계 방위를 bear/sharp로 축약 | **수용** | 갈림길 가지 지목 정보라 보존 — `Turn to your 10 o'clock`(§4.2) |
| 9 | 시설 통과 거리 의미 미확인 | **기각** | ko 원문이 "진입 후 72m 이동"이라고 말한다. 구조를 그대로 옮기는 한 새 위험이 아니다(§4.3) |
| 10 | "ko byte-identical" 과장 | **수용** | 축별 범위표로 축소(§4.6.1) |
| 11 | `lang` 기본값 | **수용** | required 인자(§4.5) |
| 12 | 적용 불가한 en 계단 회피 노출 | **수용** | 비-ko 컨트롤 미노출(§4.7) |
