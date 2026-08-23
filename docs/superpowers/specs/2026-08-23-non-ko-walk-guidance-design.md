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

Point 뒤에 붙는 LineString이 그 스텝의 구간이다(`normalizeTmapWalkRoute`의 `attachTarget`
귀속과 같은 짝). 그러므로 **스텝당 (행동 코드, 도로명, 거리) 3요소가 전부 구조화 필드로 있다.**

### 2.2 관측 코퍼스 (11개 경로, 전국·경유지 포함)

| turnType | 건수 | pointType | 실문장 |
|---|---|---|---|
| 0 | 1 | PP1 | 경유지 후 보행자도로를 따라 43m 이동 |
| 11 | 24 | GP | 직진 후 보행자도로를 따라 169m 이동 |
| 12 | 36 | GP | …에서 좌회전 후 천호대로를 따라 1m 이동 |
| 13 | 39 | GP | …에서 우회전 후 263m 이동 |
| 17 | 2 | GP | 10시 방향 좌회전 후 91m 이동 |
| 18 | 3 | GP | 2시 방향 우회전 후 보행자도로를 따라 74m 이동 |
| 126 | 1 | GP | 서울역 2번출구에서 지하보도 진입 후 72m 이동 |
| 200 | 10 | SP | 보행자도로를 따라 30m 이동 |
| 201 | 10 | EP | 도착 |
| 211 | 14 | GP | …에서 횡단보도 후 보행자도로를 따라 33m 이동 |
| 212 | 12 | GP | 좌측 횡단보도 후 보행자도로를 따라 14m 이동 |
| 213 | 12 | GP | …에서 우측 횡단보도 후 보행자도로를 따라 44m 이동 |

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
| **보행자도로** | — | **totalCount 0** (도로명이 아니라 일반명사) |

`engAddr`의 첫 쉼표 앞 조각에서 선행 건물번호 토큰을 벗기면 로마자 도로명이 나온다.
마지막 행이 중요하다 — **일반명사 필터를 코드에 박지 않아도 juso가 0건으로 걸러 준다**
(하드코딩 차단 목록 불필요).

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

### 4.2 판정 계층 — `src/lib/pedestrian-action.ts` (신규)

`turnType → GuideAction | null`. `car-action.ts`와 같은 자리·같은 계약이고 **투영은 서버가**
한다(provider가 `step.action`을 실어 보내고 Kit은 디코딩만 — `RouteGeometry.swift:38`이
이미 그 필드를 읽는다). **Kit에 새 판정 표를 만들지 않는다.**

| turnType | action | 근거 |
|---|---|---|
| 12 · 16(8시) · 17(10시) | `left` | 공식 표 + 17 관측 |
| 13 · 18(2시) · 19(4시) | `right` | 공식 표 + 18 관측 |
| 14 (U-turn) | `back` | 공식 표 |
| 211~217 (횡단보도 5종) | `crosswalk` | 211·212·213 관측, 214~217 공식 표 |
| 126 (지하보도) | `underpass` | 관측 |
| 0 · 1~7 · 11 · 184~189 · 200 · 201 · 233 | `null` | 행동 없음(직진·출발·도착·경유지) |
| 125(육교) · 127~129(계단·경사로) · 218(엘리베이터) | `null` | **대응하는 큐 문구·톤이 없다** |

⚠ 마지막 행이 판정이다. 육교를 `underpass`로 접으면 "지하보도로 건너세요"가 나가 거짓이 되고,
계단·엘리베이터에 `crosswalk` 톤을 붙이면 음향신호기 비프의 거짓 인용이 된다
(`imminentTone` 주석의 기존 판정 그대로). **미분류의 결과는 오안내가 아니라 침묵**이다.

리듀서는 `GuideTuning.actionSource`를 walk에서 `text` → **`stepThenText`**로 바꾼다
(`step.action ?? walkStepAction(description)`). car의 `step`(문장 폴백 없음)은 불변.
ko+카카오는 `action`이 없어 종전과 byte-identical, ko+Tmap 폴백은 구조화가 이긴다
(관측 12건 전부 문장 분류와 같은 결론 — fixture로 못 박는다).

### 4.3 en 산문 — `src/lib/walk-guidance-en.ts` (신규)

문장 틀: `{행동구}, then walk {거리}[ along {도로명}].` / 행동구가 없으면 `Walk {거리}[ along {도로명}].`

`turnType → 행동구` **완전 표**(§4.2 표의 전 코드 + 나머지 공식 코드). 예:

| turnType | 행동구 |
|---|---|
| 12 / 13 | `Turn left` / `Turn right` |
| 16 / 19 | `Turn sharply left` / `Turn sharply right` |
| 17 / 18 | `Bear left` / `Bear right` |
| 14 | `Make a U-turn` |
| 125 / 126 | `Take the pedestrian overpass` / `Take the underpass` |
| 127 / 128 / 129 | `Take the stairs` / `Take the ramp` / `Take the stairs or the ramp` |
| 218 | `Take the elevator` |
| 211 / 212 / 213 | `Cross the crosswalk` / `Cross the crosswalk on your left` / `… on your right` |
| 214 / 215 / 216 / 217 | `Cross the crosswalk at 8 o'clock` (10 / 2 / 4) |
| 0 · 1~7 · 11 · 184~189 · 200 · 233 | (없음) |
| 201 | `Arrive at your destination.` (거리·도로명 없음) |

⚠ **회전은 자연어(bear/sharp), 횡단보도는 시계 방위**로 갈린다. 회전에서 시계는 좌우의
*정밀도*지만, 횡단보도에서 시계는 **여러 횡단보도 중 어느 것인지를 지목하는 정보**라
버리면 안 된다(보행 훈련의 시계 방위 관용도 그 자리다).

⚠ **미지 turnType은 throw**(라우트 502). 근거: 이 문장은 시각장애 사용자의 낭독 채널이고,
행동절을 빼고 `Walk 90m`만 내면 *회전을 말하지 않은 직진 지시*가 되어 조용히 틀린다.
`normalizeTmapWalkRoute`가 총거리 이상에 throw하는 것과 같은 계약("깨진 경로를 확정
낭독하지 않는다"). 표는 공식+관측 합집합이라 발화 확률이 낮고, 가드 테스트가 공식 표
전 코드의 매핑 존재를 강제한다.

- POI 상호(`name`)·교차로명(`intersectionName`)은 **en 문장에서 뺀다** — juso가 로마자화하지
  못하는 고유명사다. 그 결과 `live.target`/`anchor`도 없고, 주기 통지는 이미 있는
  `guide.periodicStraightNoName` 틀로 떨어진다(en 메시지 존재 확인).
- 거리 표기는 `formatDistance`만 지난다(3벌 미러 규칙). 낭독 단위 정정은 기존
  `spokenDistanceUnits`가 en 로케일에서 그대로 처리한다.

### 4.4 로마자 도로명 — `src/lib/providers/juso-road-name.ts` (신규)

```ts
roadNameEn(ko: string): Promise<string | null>
```
- juso `addrLinkApi` `keyword=<도로명>`, `countPerPage=5`. `rn === ko`인 **정확 일치** 항목만 채택
  (부분 일치가 다른 도로를 물어오는 것 차단).
- `engAddr.split(",")[0]`에서 선행 건물번호 토큰(`/^[\d-]+\s+/`)을 벗겨 반환.
- `unstable_cache` 도로명 키, revalidate 30일(도로명은 정적). 실패는 캐시하지 않는다(throw 회피 관례).
- **비블로킹**: 실패·0건·타임아웃이면 `null` → 그 스텝은 도로명 없이 나간다(접근 C로 열화).
- 경로당 고유 도로명 3~5개를 `Promise.allSettled` 병렬 + **총 1.5초 `AbortSignal.timeout`**.
  ⚠ 이 조회는 안내 시작 경로에 직렬로 끼므로 상한이 필수다([[client-timeout-must-mirror-both-platforms]]).

### 4.5 파이프라인 — `getWalkRoute({ lang })`

`lang`은 **기본값 없는 필수 인자가 아니다**(기존 호출부 전량을 건드리지 않기 위해
`lang: "ko" | "en" = "ko"`). 대신 웹 URL 조립점 `walkRouteUrl`은 **required `lang`**로 둔다
— 그 모듈의 존재 이유가 "생략 가능한 안전 인자 금지"이기 때문이다(A4 전례).

```
ko: 카카오|Tmap → rewriteWalkBriefing → annotateAudioSignals → annotateCrosswalkInfo   (현행 불변)
en: Tmap        → buildEnBriefing     → annotateAudioSignals(en) → (차로 수 단계 미적용)
```

- `annotateCrosswalkInfo`는 이미 `provider === "kakao"` 게이트라 en에서 자연히 침묵한다(E8 설계 유지).
- `annotateAudioSignals`의 횡단보도 판정은 한국어 부분 문자열이라 en에서 열리지 않는다 →
  **`step.action === "crosswalk"`가 있으면 그것을 보고, 없으면 종전 문자열**을 본다. 주석 문구는
  ko `", 음향신호기 있음"` / en `", audible pedestrian signal"`.
- `STEP_FREE_NOTICE`·`SHORTEST_STEPFREE_NOTICE`에 en 벌을 둔다. en은 Tmap 단독이라 계단 회피는
  항상 `unavailable`이고, 그 사실을 침묵으로 두면 계단 회피를 켠 사용자가 적용됐다고 믿는다.

### 4.6 부수 결함 — Tmap 폴백이 기하를 잃는다 (기존 버그)

`fetchPrimaryOrFallback`은 Tmap을 부를 때 `includeLineGeometry`·`noStore`를 **넘기지 않는다**.
그래서 카카오가 죽어 폴백한 실시간 안내 조회는 `pathCoords` 없는 브리핑을 받고,
`buildGuideRoute`가 경로를 거부해 **상세가 조용히 간략으로 강등**된다. en은 Tmap 단독이라
이 경로가 상시 성립하므로 이번에 고친다(ko 폴백도 함께 나아진다).

### 4.7 소비자 게이트 해제

| 자리 | 후 |
|---|---|
| `page.tsx` `canShowWalk` | `hasWalkRouteKeyFor(dataLocale(locale))` |
| `DirectionsView.tsx:479` | `canShowWalk` 단독(로케일 조건 제거) |
| `DirectionsView.tsx:840/845/854` | 도보 대안·계단 회피 조건에서 `prefersEnglish` 제거 |
| `useRouteGuide.ts:1646` | 분기 삭제 — 전 로케일이 상세 조회로 시작 |
| `useRouteGuide.ts:2064` | `canOfferDetail`에서 `prefersEnglish` 제거 |
| iOS `DirectionsTabView.swift:388` | `includeWalk = true`(상수화 → 인자 삭제) |
| iOS `:886` | 도보 안내 공지 ko 게이트 제거 |
| iOS `:1060/1067/1079/1090` | 도보 관련 ko 게이트 제거(대안·계단 회피) |

⚠ iOS는 **실험판·정식판 둘 다 영향**이다(도보 안내는 2026-08-15 정식 졸업). `#if EXPERIMENTAL`
게이트는 건드리지 않는다.

## 5. 테스트

- `pedestrian-action.test.ts` — 공식 표 전 코드 매핑 존재(가드) + 관측 12코드 결론 + 육교/계단/
  엘리베이터가 `null`인지(거짓 톤 차단).
- `walk-guidance-en.test.ts` — §4.3 표 전수 문장, 도로명 유·무, 도착 스텝, **미지 코드 throw**.
- `juso-road-name.test.ts` — engAddr 파싱(건물번호 벗기기·번호 없는 형태), `rn` 불일치 거절, 실패 시 null.
- `walk-route-en.test.ts` — en이 Tmap만 부르는지, 카카오 폴백을 하지 않는지, 주석 문구 en, 기하 전달.
- 리듀서: `stepThenText`가 ko 카카오(문장)·Tmap(구조화) 양쪽에서 같은 결론인지 — 공유 fixture에
  ko+Tmap 케이스 추가, Kit `RouteGuideTests` 동조.
- **실호출 게이트** `scripts/verify-non-ko-walk-guidance.mjs`: 실좌표쌍으로 `lang=en` 조회 →
  ①전 스텝 description이 ASCII(한글 0) ②`action`이 관측 코드에서 기대대로 ③도로명 로마자가
  적어도 1건 붙는지 ④`includeGeometry=1`에서 `pathCoords`가 오는지. 머지 게이트.

## 6. 범위 밖

- **축 2**(웹 단독 진입점 제거·강등 사유 3-state) — 이 문서가 실호출로 성립한 **뒤** 별도로 한다.
- es·fr·it·ja 전용 문장(= `dataLocale` 계약대로 en 한 벌).
- 카카오에서 en을 만드는 길(회전 코드 부재).
- en 계단 회피 적용(Tmap 동등 옵션이 실측상 추천과 같아 M3에서 이미 기각).
- CLI/MCP의 `lang` 노출(기본 ko라 동작 불변, 파일 소유권 밖).
