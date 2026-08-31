# 실시간 대중교통 안내 en 게이트 해제 (E27 잔여 ①) — 설계

> 백로그 [E27](../../BACKLOG.md) 잔여 첫 항목. 위원장 판정(2026-09-01, plan `docs/superpowers/plans/2026-09-01-en-locale-residual-parallel-plan.md` §1 판정 2 — **웹 정식판 + iOS 실험판 둘 다**)을 구현하는 설계. 병렬 세션 `transit-en-gate` 소유 범위(같은 문서 §2).
>
> **설계 리뷰 판정**: 새 판정 계층(표시/조인 분리)과 새 불변식(발화 sentinel)을 신설하므로 codex `adversarial-review` 대상(글로벌 규칙 ①). ✅ 2026-09-01 실행, 20건(BLOCKER 6). **이 문서는 반영 후 판본**이고 채택·기각 판정은 §9.

## 1. 문제

실시간 대중교통 안내는 웹 `!prefersEnglish(locale)`·iOS `AppLanguage.dataLocale == "ko"` 게이트 뒤에 있다. 게이트가 닫힌 이유는 봉인이 아니라 **문장이 통째로 한국어**이기 때문이다 — 안내 세션이 쓰는 모든 이름(노선·승차역·하차역·경유역·종착역·방향·실시간 도착 문장·현재역)은 ODsay/TOPIS/서울 실시간 응답의 한국어 원문이고, 안내 문구는 그 값을 i18n 틀에 그대로 꽂는다. 게이트만 열면 en 사용자는 **영어 틀 + 한국어 값**을 듣는다.

E27(2026-08-31)이 원천을 이미 만들었다: `/api/route/transit`의 `lang=en`이 `lineNameEn`·`fromNameEn`·`toNameEn`·`stops[].nameEn`·`departNameEn`·`arriveNameEn`을 additive로 싣고, `subwayLineNameEn` 표와 `arrivalMessageEn` 행렬과 `normalizeTransitNameEn`이 있다. 웹·iOS 둘 다 이미 `lang`을 실어 경로를 조회한다. 그러나 그 값들은 **안내 경로 DTO(`TransitGuideLeg`)에서 버려지고**, 실시간 폴링 라우트(`/api/transit/track`)에는 `lang` 자체가 없다.

E27 spec §3.7이 이 작업을 미루며 남긴 요구가 둘이다.

1. 게이트를 여는 날 `viaStops[].name`·실시간 provider 정류소명·차량 선택 문맥까지 **별도 display DTO**가 필요하다.
2. 불변식: 상태 머신 테스트가 **조인 필드에 식별 가능한 한국어 sentinel**을 넣고 **어떤 발화에도 그 값이 나오지 않는다**.

## 2. 이 설계가 푸는 핵심 긴장 — 한 문자열이 조인 키이자 표시 라벨이다

`TransitGuideLeg`의 이름 필드는 두 역할을 겸한다.

| 필드 | 조인 역할(한국어여야 한다) | 표시 역할(en에선 영문이어야 한다) |
|---|---|---|
| `lineName` | `subwayIdForOdsayLine` 매핑표 키 · `?line=` · TAGO `routeNo=` · 근사 잠금 `routeId` | 안내 문장 `{line}` |
| `boardName` | `?station=`(대기·boarding) | `{stop}`(대기·boarding 문맥) |
| `alightName` | `?station=`(riding) · `terminatesBeforeAlight` 인덱스 | `{stop}`(승차 문맥·프레임) |
| `viaStops[].name` | `viaStopCurrentIndex` · `terminatesBeforeAlight` · 재선택 값 | 경유역 목록 · 재선택 버튼 라벨 · 조망 행 |
| `TrackItem.destinationName` | `terminatesBeforeAlight` | `{dest}`(행선) |

**그러므로 "영문으로 바꾼다"는 선택지가 없다.** 조인 필드는 한국어로 동결하고, 표시는 additive 영문 조각과 `pickLine`만 지나게 한다.

⚠ 이 긴장은 조용히 실패한다. 조인 필드를 영문으로 바꾸면 오류가 아니라 "실시간 정보가 영영 안 뜬다"(매핑표 미스 → `unsupported`)나 "현재역 표식이 영영 안 붙는다"(정규화 불일치)로 나타나고, 낭독만 듣는 사용자에겐 반증 채널이 없다.

## 3. 설계

### 3.0 원칙 다섯

1. **조인 필드는 언어와 무관하게 한국어 원문이다.** `lineName`·`boardName`·`alightName`·`viaStops[].name`·`destinationName`·`currentLocation`·`TransitLock.routeId`/`direction`은 en 세션에서도 값이 바뀌지 않는다. 실시간 추적·매핑표·종착 검사·재선택은 **한 줄도 바뀌지 않는다**.
2. **영문은 additive 조각이고 서버가 만든다.** 경로 축은 E27이 이미 실어 준다(그대로 통과시킨다). 실시간 축은 이 마일스톤이 `/api/transit/track`에 `lang`을 더해 만든다.
3. **한 줄(한 접근성 객체) 안에서 언어를 섞지 않는다.** 줄을 만드는 자리는 전부 공유 descriptor(§3.7)를 지나고, 조각이 하나라도 결측이면 줄 전체가 한국어 값이다.
4. **표시 계층에는 조인 필드가 타입에 없다**(§3.5). 소스 가드는 2선이지 1선이 아니다.
5. **게이트 해제는 봉인 해제가 아니다.** iOS는 여전히 `AppConfig.experimentalGuidanceEnabled` 안이다. 이 마일스톤이 여는 것은 **언어 게이트 한 축**이고, 웹은 정식판이라 en 사용자에게 즉시 도달한다.

### 3.1 언어 축은 `dataLocale`(비-ko 전부)이다 (리뷰 #2)

웹 `prefersEnglish(locale)` = `locale !== "ko"`, iOS `AppLanguage.dataLocale` = `current == "ko" ? "ko" : "en"`. 즉 **es·fr·it·ja 사용자도 영문 데이터를 받는다**(외부 소스가 ko/en 2종뿐이라 E27 이전부터 그렇다). 이 마일스톤의 `isEn` 축은 그 하나이고 **`locale === "en"` 같은 좁은 판정을 새로 쓰지 않는다** — 쓰면 프랑스어 틀에 한국어 값이 들어간다.

### 3.2 `/api/transit/track` — `lang` → 실시간 영문 조각

- 쿼리 `lang`: `langParam()`(`src/lib/lang-param.ts`, 미지 값 400). `mode`·`phase` 분기 **앞에서** 한 번 파싱한다(갈래마다 스키마가 달라 넷에 흩으면 하나를 빠뜨린다).
- 응답 항목(`TrackItem`)의 additive optional 필드 넷: `messageEn`·`directionEn`·`destinationNameEn`·`currentLocationEn`.
- **`lang` 부재·`ko`면 한 필드도 싣지 않는다** — 종전 응답과 byte-identical(CLI/MCP·구앱 무변화). 이 단언이 이 마일스톤의 최대 회귀 방어선이다.
- **provider × 국면 × 필드 행렬**(리뷰 #13 — 무엇이 필수·선택·구조적 부재인지 구현자가 임의로 정하지 않게):

| mode/phase | `messageEn` | `directionEn` | `destinationNameEn` | `currentLocationEn` |
|---|---|---|---|---|
| `subway/track` | 선택(행렬 밖 부재) | 선택(4값 표 밖 부재) | 선택(seed 미매칭 부재) | 선택(모순·부재 시 부재) |
| `seoulBus/wait`·`ride` | 선택(모양 밖 부재) | **구조적 부재**(ko도 `""`) | **구조적 부재**(ko도 `null`) | **구조적 부재** |
| `tagoBus/track` | **`""` 고정**(ko도 `""` — 완성 문장 없음) | **구조적 부재** | **구조적 부재** | **구조적 부재** |
| `tagoBus/resolve` | — | — | — | — (정류소명은 `stop.name`, `nameEn` additive) |

  "구조적 부재"는 ko에도 값이 없다는 뜻이라 en 조각을 **만들지 않는다**(빈 문자열로 채우지 않는다 — §3.4 ⚠ 참조).
- **지하철**: E27의 `enrichArrivalEn`을 그대로 태운 뒤 투영한다(새 문장 생성기를 만들지 않는다 — 행렬이 둘로 갈리면 같은 코드가 두 문장을 낸다). 종착역은 `trainLineNmEn`("To X via Y" 문장)이 아니라 `stationNameEn(ctx, arrival.destination, arrival.line)` 단독 호출.
- **서울버스**: §3.11의 `busArrivalMessageEn(parse, phase)`.
- **TAGO**: `messageEn: ""`. 여기서 필드를 빼면 en 사용자의 지방버스 줄이 전부 ko로 폴백한다(값이 애초에 없는데도).
- 레이트리밋·`no-store`·`force-dynamic`은 불변.

### 3.3 클라이언트가 실제로 `lang`을 보낸다 (리뷰 #3)

서버에 파라미터를 더하는 것만으로는 아무 일도 일어나지 않는다. 폴링 URL을 만드는 **모든 자리**에 세션 언어를 싣는다.

- 웹 `trackTargetUrl`(4갈래 전부) + TAGO `resolve` 경로.
- iOS Kit `TransitTrackService`의 `seoulWait`·`seoulRide`·`tagoResolve`·`tagoTrack`·`subwayTrack`. **`lang`은 기본값 없는 필수 인자**(walk·transit 규율 — 생략이 컴파일을 통과하면 조용히 ko가 된다).
- 테스트가 **실제 요청 URL 문자열**을 단언한다 — 파라미터 이름 오타는 400도 아니고 그냥 무시된다.

### 3.4 안내 DTO·이벤트가 나르는 영문 조각

`buildTransitGuideRoute`가 지금 버리는 영문을 실어 나른다. 필드는 additive optional이고 조인 필드는 그대로다.

| 신규 필드 | 원천 |
|---|---|
| `TransitGuideLeg.lineNameEn?` | `leg.lineNameEn` |
| `TransitGuideLeg.boardNameEn?` | `leg.fromNameEn ?? boardStop?.nameEn` |
| `TransitGuideLeg.alightNameEn?` | `leg.toNameEn ?? alightStop?.nameEn` |
| `TransitGuideLeg.viaStops[].nameEn?` | 이미 `TransitLegStop`에 있다(무변경) |
| `TransitPrewalkTarget.nameEn?` | `leg.boardNameEn` |
| `TrackItem.messageEn?`·`directionEn?`·`destinationNameEn?`·`currentLocationEn?` | §3.2 |
| 이벤트 `messageEn?`(`trackingStarted`·`countdown`·`messageChanged`·`backOnTrack`·`approaching`·`approxVehicleChanged`) · `currentLocationEn?`(`countdown`) | 잠금 항목 |

⚠ **이벤트가 영문을 함께 실어야 한다**(리뷰 #6·#11). 소비자는 이벤트만 보고 문장을 만들고 폴 항목을 붙들지 않는다 — ko만 실으면 소비자가 "마지막 항목"을 따로 기억해 짝지어야 하고, 그 짝은 늦은 폴·국면 전이에서 **조용히 어긋난다**(한국어 현재역과 직전 항목의 영문 현재역이 한 문장에). 같은 관측에서 나온 두 값은 같은 이벤트에 실린다.

⚠ **폴백 순서 짝**: `boardName`(`fromName ?? boardStop.name`)과 `boardNameEn`(`fromNameEn ?? boardStop.nameEn`)의 폴백 순서가 어긋나면 같은 자리에서 서로 다른 정류소를 가리킬 수 있다. §5의 계약 테스트가 그 짝을 잠근다.

⚠ **빈 문자열은 `TrackItem.message` 한 자리에서만 유효한 영문 조각이다**(리뷰 #12). 이름·방향·종착역·노선명의 `""`는 "비어도 된다"가 아니라 **정보 소실**이라, 그대로 두면 완비로 읽혀 `Boarded . Get off at .` 같은 줄이 된다. 조각 추출기가 **message 슬롯을 제외한 전 슬롯에서 `""` → 부재로 정규화**한다.

### 3.5 좁은 표시 투영 — 조인 필드가 타입에 없다 (리뷰 #4, 1선 = 구조)

문장을 만드는 계층은 `TransitGuideLeg`·`TrackItem` **원본을 받지 않는다**.

```ts
export interface TransitLabel { ko: string; en?: string }

export interface TransitDisplayLeg {
  mode: "bus" | "subway";
  line: TransitLabel;
  board: TransitLabel;        // boardOverride가 있으면 그 정류소
  alight: TransitLabel;
  stops: TransitLabel[];
  stationCount: number | null;
  walkBeforeMinutes: number | null;
  boardOverridden: boolean;   // 선행 도보 문구 분기 축
}

export interface TransitDisplayItem {
  message: TransitLabel;          // "" 자리 표시 허용(유일)
  direction: TransitLabel;
  destination: TransitLabel | null;
  currentLocation: TransitLabel | null;
  express: boolean;
  remainingStops: number | null;
  selectable: boolean;            // vehicleId 유무 — 원문 식별자는 넘기지 않는다
}
```

- 투영기 `transitDisplayLeg(leg, boardOverrideIndex)`·`transitDisplayItem(item)`은 순수이고 웹 ↔ Kit 미러다.
- 조인은 **투영을 거치지 않는 계층**(URL 조립·리듀서·`TransitLock`·`terminatesBeforeAlight`)이 원본에서 직접 읽는다. 두 계층이 각자 읽되 **한쪽에는 반대쪽 필드가 존재하지 않는다** — 이것이 §3.7이 요구한 "별도 display DTO"의 실체다.
- ⚠ 투영에 `vehicleId`·`routeId`·`arsId`·좌표를 넣지 않는다. 넣는 순간 표시 계층이 다시 조인할 수 있게 된다.

### 3.6 `boardOverride`는 이름이 아니라 인덱스다 (리뷰 #10)

지금 재선택 상태는 역 **이름 문자열**이고 표시·조회 양쪽이 그 문자열을 쓴다. 영문을 붙이려면 `viaStops`에서 이름으로 역조회해야 하는데, 정규화 후 동명 역이 둘이면 **첫 일치를 골라 다른 역의 영문명이 표시된다**(오류 없음).

→ 상태를 `boardOverrideIndex: number | null`(세션 경로 `viaStops` 인덱스)로 바꾼다. 조회 쿼리는 `viaStops[i].name`(무변경), 표시는 `viaStops[i]`의 라벨. 인덱스는 세션 경로에 결박되고 leg 전진·경로 교체에서 함께 비운다. 공개 API(`changeBoardingAt`)의 인자도 인덱스로 바꾼다 — 이름을 받는 판을 남기면 그것이 다시 모호 경로가 된다.

### 3.7 문장 조립 — 공유 descriptor + 플랫폼 어댑터 (리뷰 #7·#16)

문장 판정(어떤 키를 쓰는가, 어떤 인자를 어떤 순서로, 이 줄이 ko인가 en인가)은 **순수 공유 계층**이 하고, 플랫폼은 자기 카탈로그로 조회만 한다. `TransitWalkLegText` 선례 그대로다.

```ts
export interface TransitTextDescriptor {
  key: string;            // transitGuide 네임스페이스 안의 키
  args: string[];         // ko 문장의 플레이스홀더 등장 순서
  lang: "ko" | "en";      // 값의 언어
}
```

- 정본: `src/lib/transit-guide-text.ts` ↔ Kit `TransitGuideText.swift`. 공유 fixture `transit-guide-text-cases.json`이 두 구현을 한 표로 잠근다.
- **웹 어댑터**: 키 → 인자 이름 표(`TRANSIT_TEXT_ARG_NAMES`) 하나로 위치 인자를 named로 옮기고 `t(key, named)`를 부른다. 표 완전성(모든 descriptor 키가 표에 있고 이름 수가 메시지 플레이스홀더 수와 같다)을 테스트가 강제한다.
- **iOS 어댑터**: 키 리터럴 `switch`(카탈로그 키 린터 계약). `default`는 `assertionFailure` + 키 노출. **switch 망라성은 웹 테스트가 Swift 소스를 읽어 descriptor 키 집합과 대조**한다(앱 타깃에 테스트 레인이 없으므로 이 대조가 그 자리를 대신한다).
- 언어 판정은 descriptor 안에서 끝난다(전 조각 완비일 때만 en). 플랫폼은 `lang`을 **표시 태그**로만 쓰고 키 선택에 쓰지 않는다.

### 3.8 발화 채널의 언어 (리뷰 #1·#8·#9)

- **웹**: 단일 live region(`TransitGuidePanel`의 `role="status" aria-live="polite"`)에 문장과 `lang`을 **함께** 대입한다.
- ⚠ **ko 폴백 줄은 영어 틀 + 한국어 값이고, 그 줄 전체에 `lang="ko"`를 준다**(E27 `pickLine` 관례). 리뷰 #1은 이를 "영어까지 한국어 음성으로 읽힌다"고 지적했는데, 대안(영어 엔진이 한글을 만남)은 **그 이름이 통째로 침묵**하는 결과라 더 나쁘다. 낭독에서 잃으면 안 되는 것은 억양이 아니라 **역 이름 그 자체**다. 이 선택은 의도이며, 되돌리려면 이름을 로마자로 바꾸는 별도 판정이 선행한다(E27이 노선명 음차를 금지한 것과 같은 축이라 여기서 결정하지 않는다).
- **iOS는 줄 단위 언어 태깅 수단이 아직 없다**(통지가 평문 `String`). ko 폴백 이름이 영어 음성에 삼켜질 수 있다 — **수용 위험**이고 판정 정본은 BACKLOG §2 `E28-①`(같은 축). 이 마일스톤은 그것을 만들지 않되 **관측 가능하게** 만든다: `TransitGuideDiag`가 줄마다 폴백 사유(어느 조각이 없었나)를 남기고 FIELD-TEST가 "한글이 들리는가, 침묵인가"를 묻는다(§7).
- **통지 객체는 플랫폼당 하나**이고 표시 행은 live가 아니다(리뷰 #9). 웹 live region 수 1을 테스트가 잠근다.

### 3.9 늦은 응답·언어 전환 (리뷰 #5)

리듀서는 이미 `phaseGen`·`seq` 일치에서만 커밋하므로 "대기 응답이 승차 상태에 적용"되는 경로는 **이미 없다**(기존 계약). 새로 생기는 축은 언어 하나다.

- 세션 도중 앱 언어를 바꾸면 비행 중 응답이 옛 언어 조각을 들고 온다. 조각은 항목 단위 additive라 전환 직후 한 폴 주기가 ko 폴백이 되고 다음 폴에서 회복한다 — **자기 치유이고 조인 필드는 어느 쪽에서도 한국어**라 오조인이 없다. 세션을 재시작하지 않는다.
- 버스 `messageEn`은 국면에 따라 문장이 다른데 **국면이 URL을 가르고 `phaseGen`이 커밋을 가른다** — 국면이 어긋난 en 문장이 커밋될 경로가 없다.

### 3.10 조망(E15-1) 행

`TransitOverviewRow`의 `leg`(lineName·boardName·alightName)·`stop`(name) 행에 영문 optional을 additive로 더한다. 순수 판정(`transitProgressOverview`)의 로직은 바뀌지 않고 어댑터(`GuideOverviewSheet`)가 descriptor로 조립한다. 입력에 영문이 없으면 출력에도 없으므로 **기존 공유 fixture는 무변경**이다.

### 3.11 버스 도착 문장 — 공유 parser (리뷰 #18)

TOPIS `arrmsg1`은 닫힌 모양 집합이다: `{N}분{M}초후[K번째 전]` · `{N}분후[…]` · `{M}초후[…]` · `곧 도착` · `출발대기` · `운행종료`.

ko 재작성(`rewriteBusArrivalMessage`)과 en 생성이 원문을 각자 파싱하면 provider 변형이 한쪽에만 반영돼 **잔여 수와 영어 문장이 서로 다른 해석**을 하게 된다. 그래서 순수 parser를 먼저 둔다.

```
parseBusArrmsg(message): { kind: "eta" | "soon" | "waiting" | "ended" | "unknown"; minutes; seconds; remainingStops }
busArrivalMessageEn(parsed, phase: "wait" | "ride"): string | undefined
```

- 시간 모양 → `wait`: `In 6 min 47 sec` / `In 15 min` / `In 55 sec`. `ride`: `6 min 47 sec left` / `15 min left` / `55 sec left`. **국면 인자에 기본값을 두지 않는다**(`slotToItem` 선례).
- `곧 도착` → `Arriving soon` · `출발대기` → `Waiting to depart` · `운행종료` → `Service ended` · `unknown` → 부재 + `console.warn`(숫자를 `N`으로 마스킹한 모양만 — 지하철 `warnShape` 동형).
- 범위 가드: 초 0~59, 분 ≥0. 어긋나면 부재.
- 계약 테스트가 전 fixture 코퍼스에서 `parseBusArrmsg(...).remainingStops`와 기존 `remainingFromArrmsg(...)`의 **일치**를 단언한다. ko 재작성은 출하된 경로라 이번에 갈아엎지 않는다 — 두 해석이 갈리는 순간을 테스트가 잡게 하는 것이 이 마일스톤의 몫이다.

### 3.12 게이트 해제 자리

| 자리 | 조치 |
|---|---|
| 웹 `DirectionsView.tsx:1033` `startable` | `&& !prefersEnglish(locale)` **제거** |
| 웹 `DirectionsView.tsx:1621` `guideStartable` | 〃 |
| iOS `DirectionsTabView.swift` `transitGuideStartable` | `AppLanguage.dataLocale == "ko"` **제거**(실험 플래그 가드는 유지) |
| iOS `DirectionsTabView.swift` `altTransitGuideStartable` | 〃 |
| 웹 `DirectionsView.tsx:406` `stepFreeSupported` | **불변**(계단 회피는 의도적 비-ko 미노출) |
| 웹 `DirectionsView.tsx:934` `carGuideStartable` | **불변**(자동차 축) |
| iOS `DirectionsTabView.swift` 출입구 승격·계단 회피·도보·자동차 검사 | **불변** |

⚠ **간략 폴백 게이트**("시작 가능한 수단 0개")는 대중교통 게이트가 열리면 성립 조건이 저절로 바뀐다 — 별도 수정 없음이 정답이지만 회귀 확인 대상이다.

## 4. 하지 않는 것

- **A27 `subwayRidingMessage`** — 언어 무관 문장 **종류** 판정이고 이미 6로케일 키다.
- **조인 필드 영문화·`TransitLock` 변경**(§3.0-1).
- **채팅 산문·CLI/MCP** — 채팅은 ko 산문 정본, CLI/MCP `lang`은 병렬 세션 `cli-lang` 몫.
- **자동차·도보·계단 회피 게이트** — 다른 축(§3.12).
- **iOS 줄 단위 `lang` 태깅** — E28-① 실기기 판정 선행(§3.8).
- **실승차 판정** — 위원장 시간은 W2 마감(2026-09-04 05:00)이 먼저다. `docs/FIELD-TEST.md`에 대본만 남긴다.

## 5. 검증

### 5.1 sentinel 불변식 (§3.7이 요구한 것)

**모든 ko 필드에 서로 다른 토큰**을 넣는다(리뷰 #14 — 하나의 공통 sentinel이면 board/alight 교환·이전 값 재사용·상수 반환이 전부 통과한다). 예: `노선ᛥ`·`승차ᛥ`·`하차ᛥ`·`경유0ᛥ`·`경유1ᛥ`·`종착ᛥ`·`현재ᛥ`·`메시지ᛥ`. 영문도 자리마다 다른 값.

- **완비 입력**: 각 descriptor의 **정확한 `{key, args, lang}`**을 단언한다("ᛥ가 없다"만으로는 부족 — 리뷰 #14).
- **역방향(리뷰 #15)**: 영문 조각을 **하나씩** `undefined`로 바꿔 가며, 그 조각을 쓰는 descriptor가 **정확한 ko args + `lang: "ko"`**를 내는지 단언한다. `""`가 허용되는 슬롯(`message`)은 반대로 **en 줄이 유지**되는지.
- **열거는 case registry로**(리뷰 #16): descriptor 함수마다 유효 입력·기대값을 담은 표를 두고, **모듈의 전 export가 그 표에 등장하는지**를 별도 단언한다(export 순회만으로는 인자·분기 조합을 못 만든다).
- Kit 쪽은 같은 표를 공유 fixture로 읽어 같은 단언을 한다.

### 5.2 소스 가드 (2선)

- 웹 `useTransitGuide.ts`·`TransitGuidePanel.tsx`에서 `leg.lineName`·`leg.boardName`·`leg.alightName`·`stop.name`·`item.message`·`item.direction`·`item.destinationName`·`state.currentLocation` **직접 참조는 allowlist 라인에만**(조인·URL·핸들러 값 전달). 그 밖은 실패.
- iOS `TransitGuideModel.swift`·`TransitTrackingSheet.swift`·`GuideOverviewSheet.swift`에 같은 규칙(Swift 소스를 웹 테스트가 읽는 선례: `guidance-gate-drift.test.ts`·`place-hours-tts-drift.test.ts`).
- **iOS switch 망라성**: descriptor 키 집합 ⊆ `TransitGuideModel`의 리터럴 키 집합.

### 5.3 게이트 가드 (리뷰 #17 — 개수만 세지 않는다)

- **행동**: 웹 `DirectionsView`를 ko·en 로케일로 렌더해 대중교통 안내 시작 버튼의 유무를 단언한다(en에서 나타나야 한다).
- **소스**: iOS 두 게이트 식에 **로케일 조건이 없고 실험 플래그가 있다**를 각각 단언한다(자리 수만 세면 같은 자리에 조건이 되돌아와도 통과한다).

### 5.4 단위·계약

- `bus-arrival-en.test.ts`: 6모양 × 2국면 + 미지 모양 부재 + 범위 밖 부재 + `remainingFromArrmsg` 일치(§3.11).
- `transit-guide.test.ts` 증분: `buildTransitGuideRoute`의 영문 승계와 **ko/en 폴백 순서 짝**(§3.4 ⚠).
- 상태 머신 공유 fixture에 **영문 조각을 실은 시나리오**를 더한다(리뷰 #6): 대기 → 차량 선택 → boarding → riding → 현재역 갱신 → 하차. 이벤트 payload의 영문까지 비교.
- `/api/transit/track` 라우트: `lang` 미지 값 400 · `lang` 부재 응답 키 집합이 종전과 **정확히 동일** · `lang=en`에서 §3.2 행렬대로 투영.
- **디코드 배선 end-to-end**(리뷰 #19): 서버 응답 fixture JSON을 웹 파서와 Swift `Codable`이 각각 디코드 → 리듀서 통과 → descriptor까지 en이 살아 있는지. 중간 계층이 미지 키를 버리면 여기서 잡힌다.

### 5.5 실호출 게이트

`scripts/verify-transit-track-lang.mjs`(신규): 지하철·서울버스·TAGO 각 1건을 `lang=en`으로 실호출해 ①영문 조각이 실제로 실리는지 ②한국어 필드가 en 응답에서도 한국어인지(원칙 1) ③행렬 밖 모양이 부재로 떨어지는지. **항목 0건(운행 시간 밖)은 합격이 아니라 미실측**으로 기록한다(리뷰 #20 — 0건을 통과로 세면 아무것도 검증하지 않고 게이트를 지난다). 최소 한 provider에서 비어 있지 않은 응답 증거가 있어야 하고, 없으면 exit 2다.

**2026-09-01 실행 결과: 8/8 PASS, 미실측 1건.**

- 지하철(천호·수도권 5호선, 4항목): 한국어 필드 불변 확인, 영문 조각 `messageEn`·`directionEn`·`destinationNameEn`·`currentLocationEn` 전부 관측(`Arrived at previous station` · `Up` · `Banghwa` · `Olympic Park (Korea National Sport Univ.)`), 영문에 한글 혼입 0, ko 응답의 영문 키 0.
- 서울버스(천호역.풍납시장 24101 × 30-3): `곧 도착 → Arriving soon` · `15분후[6번째 전] → In 15 min` 관측. 방향·종착역 자리를 만들지 않음(구조적 부재) 확인.
- **TAGO는 미실측** — `getCrdntPrxmtSttnList`가 HTTP 에러(upstream 장애). 우리 계약의 실패가 아니라 관측 부재이므로 그렇게 기록한다(재시도 반복 금지). `messageEn: ""` 자리 표시는 단위 테스트가 덮는다.
- **부수 관측(E27 축, 이 마일스톤 밖)**: 실데이터에 `arvlCd=1` + `arvlMsg2="전역 도착"` 조합이 있다. E27의 코드×문장 정확 행렬은 이를 불일치로 보아 `messageEn`을 부재로 떨어뜨린다(설계대로 fail-closed). 같은 문장이 코드 5로도 오므로 코드가 정본이 아니라는 신호다 — `docs/BACKLOG.md` E27 잔여에 관측으로 남긴다.

### 5.6 접근성

`a11y-auditor` 점검: 패널 줄 `lang` 조건부화 · 재선택 버튼의 라벨(en)/값(ko) 분리 · live region 단일 · 발화 중복 없음.

## 6. 위험과 수용

- **en 사용자가 한국어 값을 듣는 잔여 경로가 남는다**(노선 표 미스·seed 미매칭·미지 도착 모양). 결함이 아니라 정책이다 — 거짓 영문보다 정직한 폴백이고, 안내를 침묵시키는 것은 안전상 더 나쁘다.
- **iOS 폴백 줄의 낭독 언어**(§3.8) — 수용 위험, 관측 장치와 FIELD-TEST 항목으로 남긴다.
- **웹은 정식판이라 즉시 도달한다.** 그래서 ko 사용자 무변화가 최대 위험이고, `lang` 부재 응답의 키 집합 동일 단언이 그 축이다.

## 7. 실승차 대본 (FIELD-TEST)

앱 언어를 English로 두고 안내를 시작해, ①대기 후보 목록 ②차량 선택 ③승차 문맥 ④승차 중 상태줄 ⑤경유역 목록 ⑥역 재선택 ⑦조망 ⑧하차 통지에서 **한글이 들리거나 보이는 자리**를 적는다.

⚠ **한글이 나왔을 때 그것이 정상 폴백인지 배선 누락인지 화면만으로는 못 가른다**(리뷰 #20). `TransitGuideDiag` 로그의 폴백 사유 줄을 함께 회수하고, "**들렸는가, 침묵이었는가**"를 별도로 적는다(iOS 낭독 언어 축, §3.8).

## 8. 파일

(구현 후 채운다.)

## 9. 설계 리뷰 판정 (codex adversarial-review, 2026-09-01 · 20건)

| # | 심각도 | 판정 | 근거 |
|---|---|---|---|
| 1 | BLOCKER | **부분 채택** | ko 폴백에 `lang="ko"`를 주는 것은 유지(§3.8 — 대안이 침묵이라 더 나쁘다). 테스트가 "정확한 ko 문장"을 단언해야 한다는 지적은 채택(§5.1). |
| 2 | BLOCKER | **기각(전제 오류) + 명문화** | `dataLocale`·`prefersEnglish`는 비-ko 전부를 en으로 합친다(실측). 다만 구현자가 좁은 판정을 쓸 여지가 있어 §3.1로 못 박았다. |
| 3 | BLOCKER | **채택** | §3.3 신설 — 클라이언트 5+1 자리에 `lang` 필수 인자, URL 문자열 단언. |
| 4 | BLOCKER | **채택** | §3.5 좁은 투영 — 조인 필드가 표시 타입에 없다. 소스 가드는 2선으로 내렸다. |
| 5 | BLOCKER | **부분 기각** | 늦은 응답은 기존 `phaseGen`·`seq` 커밋 가드가 이미 막는다. 새 축인 언어 전환만 §3.9로 명문화. |
| 6 | MAJOR | **채택** | 이벤트가 영문을 나른다(§3.4) + 영문 시나리오 fixture(§5.4). |
| 7 | BLOCKER | **채택** | Kit descriptor + 앱 리터럴 switch, 망라성은 소스 대조(§3.7·§5.2). |
| 8 | BLOCKER | **부분 채택** | 웹 live region `lang` 동반 대입은 채택. iOS 태깅은 E28-① 선행이라 수용 위험 + 관측 장치로(§3.8). "해결 전까지 게이트를 열지 말라"는 위원장 판정과 충돌해 기각. |
| 9 | MAJOR | **채택** | 통지 객체 단일 계약 + live region 수 테스트(§3.8·§5.6). |
| 10 | MAJOR | **채택** | `boardOverride`를 인덱스로(§3.6). |
| 11 | MAJOR | **채택** | 같은 관측의 ko·en을 같은 이벤트에(§3.4). |
| 12 | MAJOR | **채택** | `""`는 `message` 슬롯 전용, 나머지는 부재로 정규화(§3.4 ⚠). |
| 13 | MAJOR | **채택** | provider × 국면 × 필드 행렬(§3.2). |
| 14 | MAJOR | **채택** | 자리마다 다른 토큰 + 정확한 결과 단언(§5.1). |
| 15 | MAJOR | **채택** | 조각별 제거 + 정확한 ko 문장·`lang` 단언(§5.1). |
| 16 | MAJOR | **채택** | case registry + export 등록 강제(§5.1). |
| 17 | MAJOR | **채택** | 행동 테스트 + 조건 부재·플래그 존재 단언(§5.3). |
| 18 | MAJOR | **채택** | 공유 parser + `remainingFromArrmsg` 일치 계약(§3.11). |
| 19 | MAJOR | **채택** | 디코드 end-to-end 계약 테스트(§5.4). |
| 20 | MAJOR | **채택** | 0건은 미실측으로 기록, 폴백 사유 계측, FIELD-TEST 판별 항목(§5.5·§7). |
