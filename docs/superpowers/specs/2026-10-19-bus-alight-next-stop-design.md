# 서울버스 하차 통지: 「다음 정류장 {하차 정류장}」과 GPS 도착 한 마디 (A69)

설계 리뷰 판정: **한다** — E48 "기기 위치는 표시 전용"(판정서 2026-08-23 §3) 소스 가드의 의도된 예외 하나를 열고(안전·정확성 크리티컬 ④), 오케스트레이터에 세션 수명 래치를 하나 더한다. codex `adversarial-review`, 실패 신호면 `model: fable`.

판정 정본은 `docs/BACKLOG.md` A69(위원장 판정 2026-10-18, 둘 다). 재현 자료는 비공개 로그라 이 문서에 정류장 실명·좌표를 싣지 않는다.

## 0. 문제

A41 실호출대로 TOPIS 「곧 도착」(잔여 0)은 간선에서 90~211초 이어지는 상태라 **직전 정류장에 정차한 순간에 이미 켜진다**. 리듀서는 그 첫 관측에 `arrivingAtAlightStop`을 내고, 앱은 「이번 정류장에서 내리세요.」라고 말했다. 직전 정류장에 문이 열린 채 서 있는 사람에게 그 문장은 "여기서 내려라"다. 위원장은 그 말을 듣고 한 정거장 전에 내렸다. 기기 GPS는 그때 직전 정류장을 알고 있었지만 E48 설계상 표시 전용이었다.

## 1. 판정 ①: 문장 교체(웹·iOS·안드로이드 문자열)

| 키 | ko | en |
|---|---|---|
| `transitGuide.arrivingAtAlightStop` | 다음 정류장 {stop}에서 내리세요. | Get off at the next stop, {stop}. |
| `transitGuide.arrivingAtAlightStopUnnamed` (신규) | 다음 정류장에서 내리세요. | Get off at the next stop. |

"다음 정류장"은 차량이 직전 정류장에 서 있든 막 떠났든 언제나 하차 정류장이라 틀릴 수 없고, 이름이 들어가 차내 방송과 대조할 수 있다. ja·es·fr·it은 기존 문장의 경어·어휘(es `Bájese`)를 유지한 채 같은 구조로 옮긴다.

- **문장 판정은 descriptor 계층으로 옮긴다**: 종전엔 인자가 없어 플랫폼이 키를 직접 조회했다(`t("arrivingAtAlightStop")`). 이름이 들어가면 줄 언어 판정(E27 줄 원자성)이 생기므로 `transit-guide-text.ts` ↔ Kit `TransitGuideText.swift` ↔ `:kit` `TransitGuideText.kt`에 `arrivingAtAlightStopLine(isEn, leg)`를 둔다. 이름 언어는 같은 계층의 하차역 조각(`boardedAlightLine`)과 같은 규칙: `pickLabels` — 영어 세션에서 `alight.en`이 있으면 영어 줄, 없으면 줄 전체가 한국어 값(그 줄만 `lang: "ko"`). 영문 원천 없는 이름의 서버 로마자(E28)는 투영 단계에서 이미 `alight.en`으로 들어오므로 여기서 다시 판정하지 않는다.
- **이름이 없을 때**: 투영의 `alight.ko`가 빈 문자열이면(`alightName: leg.toName ?? alightStop?.name ?? ""` — 빈 값이 가능하다) `Unnamed` 키를 고른다. "다음 정류장 에서 내리세요."처럼 깨진 문장을 내지 않는다. 판정 축은 `ko` 하나다(`en`만 있고 `ko`가 빈 경우는 투영이 만들지 않는다).
- **다른 수단 영향 없음**: 이 이벤트는 리듀서의 `lock.mode === "seoulBus" ∧ remainingStops === 0` 분기에서만 나온다(웹 `transit-guide.ts`·Kit·`:kit` 같은 자리). 지하철·지방버스는 이 문장을 듣지 않으므로 "정류장"이라는 낱말이 그대로 참이다. 수단별 키(E39 `*Bus`)를 따로 두지 않는다.
- **ICU plural 없음**(수량 인자가 아니다). ko 플레이스홀더 하나라 `arg-order.json`은 새 항목만 생긴다(기존 키의 인자 수가 0 → 1로 바뀌는 것은 순서 변경이 아니라 추가다. 게이트가 막으면 `--update-arg-order`).

## 2. 판정 ②: GPS 도착 한 마디(iOS·웹)

E48 버스 정류장 추적기가 **하차 정류장(경유 목록의 마지막)을 래치하는 순간** 한 번:

| 키 | ko | en |
|---|---|---|
| `transitGuide.alightStopReached` | {stop} 도착. 내리세요. | Arrived at {stop}. Get off here. |
| `transitGuide.alightStopReachedUnnamed` | 하차 정류장 도착. 내리세요. | Arrived at your stop. Get off here. |

### 2.1 판정(순수, 웹 `transit-bus-stop.ts` ↔ Kit `TransitBusStop.swift`, 공유 fixture)

```
busStopAlightReached(result: TransitBusStopStepResult, leg, announcedLegIndex: number | null): boolean
  = result.verdict == "observed"
  ∧ result.tracker != null
  ∧ result.tracker.stopIndex == leg.viaStops.length - 1
  ∧ result.tracker.legIndex != announcedLegIndex
```

- **관측 문턱은 추적기 그대로다**: 마지막 정류장은 `BUS_STOP_ALIGHT_RADIUS_M`(50m) 안이어야 후보가 되고(밖이면 `approachingAlight`), 래치 전진은 같은 정류장의 **연속 두 관측**이 필요하다(E48 설계 리뷰 M1). 정확도 100m·나이 10초·노선 밖 300m·접힘 모호 판정도 그대로 지난다. 이 기능을 위해 문턱을 새로 만들거나 완화하지 않는다 — 이 문장의 실패 방향은 "너무 이르게"이고(A69의 원래 사고가 그것이다), 추적기의 문턱들은 전부 그 방향을 막으려고 서 있다.
- `verdict == "observed"`로 묶는 이유: 이 fix가 래치를 확인·전진시킨 경우만이다. `restarted`는 뒤 정류장으로의 복구라 마지막 정류장에 설 수 없지만 술어로 가정하지 않는다.
- **중복 방지 키는 구간 번호(`legIndex`)다**(세션 안, 구간당 1회). 추적기 결박(`phaseGen`)으로 잡지 않는 이유: 도착 추정(`arrived(certain: false)`) 뒤 재관측(`backOnTrack`)은 국면 세대를 바꿔 새 추적기를 만든다 — 정류장에 서 있는 동안 그 일이 일어나면 같은 말을 두 번 한다. `[탑승 변경]`으로 같은 구간을 다시 타도 말하지 않는다(그 경우 이미 하차 정류장에 닿았다는 뜻이라 다시 말할 사건이 없다).

### 2.2 오케스트레이터(iOS `TransitGuideModel`, 웹 `useTransitGuide`)

- fix를 반영한 뒤(`ingestKeepAliveFix` / 웹 `watchPosition` 콜백) 판정이 참이면 래치(`busAlightReachedLeg = legIndex`)를 세우고 문장을 낸다. **리듀서에는 아무것도 넣지 않는다** — 상태 전이(승격·`arrived`·폴 주기)는 바뀌지 않고, 도착 확정은 여전히 `declareArrived`뿐이다. 하차 뒤 도착 피드 소실이 종전 도착 추정을 낸다.
- **iOS 출력**: 톤 `.nearby`(리듀서 `arrived`와 같은 "도착" 톤, `allowedInBackground: false` — 백그라운드 톤 허용 집합은 `trackingStarted` 하나라는 E36 판정 그대로) 뒤 `announce(text, highPriority: true, speechClass: .actionable)` — 톤 뒤 발화 계약의 기존 창구(`deferredAnnouncer`)를 지난다. `.actionable`이라 백그라운드 음성 설정이 켜져 있으면 화면이 꺼진 채로도 말한다(E53, 하차 임박 문장과 같은 분류). `highPriority`는 진행 중 낭독을 끊는다 — 지금 내려야 한다는 말이 앞 문장 뒤에 줄 서면 문이 닫힌다.
- **웹 출력**: 기존 polite live region `announce(text, lang)` 하나(웹 대중교통 안내엔 톤이 없다). 웹 스트림은 전경에서만 열리므로(E48 §5) 웹의 한 마디도 전경 한정이다.
- **래치 수명**: 세션 시작·경로 변경·세션 종료에서 비운다(`clearBusStop()`과 같은 세 자리 — 유휴 진입은 비우지 않는다: 유휴는 같은 세션이고 구간도 그대로다).
- **역순 방지**: GPS 한 마디를 이미 낸 구간에서 늦게 오는 `arrivingAtAlightStop`(「다음 정류장 …」)은 **내지 않는다**(톤·문장 모두). 하차 정류장에 이미 닿은 사람에게 "다음 정류장 X"는 한 정거장 더 가라는 말로 들린다. 정상 순서(곧 도착 → 정차)에서는 일어나지 않지만, 짧은 구간에서 riding 첫 조회(15초)가 늦거나 폴이 실패하면 일어날 수 있다. 리듀서의 래치(`ladderAnnounced = 0`)는 그대로 선다 — 출력만 거른다.

### 2.3 표시 전용 계약의 예외 범위

판정서 2026-08-23 §3의 경계는 "**리듀서**가 기기 위치를 모른다"이고 그것은 유지된다(`transit-bus-stop-guard.test.ts` 첫 블록 불변). 예외는 "기기 위치가 **통지**를 하나 낸다"는 것 하나이며, 소스 가드에 허용 목록 한 자리로 잠근다: 오케스트레이터에서 `busStopAlightReached`를 부르는 곳이 플랫폼마다 정확히 한 곳이고, 그 결과가 리듀서 입력(`dispatch`)으로 흘러가지 않는다.

## 3. 안드로이드

- **문자열·descriptor는 옮긴다**: `messages` → `strings.xml` 생성물, `:kit` `TransitGuideText.kt`의 `transitArrivingAtAlightStopLine`·`transitAlightStopReachedLine`과 공유 fixture `transit-guide-text-cases.json`.
- **GPS 한 마디는 옮기지 않는다**: 안드로이드엔 대중교통 안내 화면도 E48 추적기도 없다(`android/kit/mirrors/guide.json` `TransitBusStop.swift: pending`). 계획 §1 판정 4대로 새 위치 추적을 만들지 않고, BACKLOG A69에 "안드로이드: 추적기 없음, 규칙만 대기"를 적는다. 이식 메모는 그 등록부 항목의 `note`에 한 구절 더한다(대중교통 안내가 생길 때 함께).

## 4. 검증

- 공유 fixture: `transit-guide-text-cases.json`(새 descriptor 두 개 × ko·en·영문 없음·이름 없음), `transit-bus-stop-cases.json`에 `fn: "alightReached"` 사례(하차 정류장 첫 관측은 pending이라 거짓 → 연속 두 번째 observed는 참 → 이미 말한 구간은 거짓 → 마지막 아닌 정류장 래치는 거짓 → 50m 밖 `approachingAlight`는 거짓). 웹·Kit·`:kit`(text만)이 같은 파일을 돈다.
- 소스 가드: §2.3 허용 목록 + iOS 래치 비우기 세 자리 + 역순 방지 + 톤 허용 인자 `false`.
- 리듀서 fixture(`transit-guide-scenarios.json`)는 이벤트 이름만 쓰므로 바뀌지 않는다(문장 교체는 렌더 계층).
- 실승차(BACKLOG §2 행, FIELD-TEST 대본): ① 직전 정류장 정차 중 「다음 정류장 {이름}에서 내리세요」가 나오는가 ② 하차 정류장에 서면 「{이름} 도착. 내리세요」가 한 번 나오는가, 늦지 않은가(문이 열려 있는 동안), 이르지 않은가 ③ 화면을 끈 채 백그라운드 음성 켬에서 ②가 들리는가. 로그 토큰 `busAlightReached leg=`.

## 5. 비채택

- **GPS로 「다음 정류장」 문장 시점을 고치기**(직전 정류장 출발을 GPS로 확인한 뒤 말하기): 판정이 문장 교체를 택했다 — 문장이 시점과 무관하게 참이 되면 시점 판정이 필요 없다.
- **GPS 관측으로 리듀서 `arrived` 확정**: 판정서 §3 경계를 넘는다. 위원장 판정이 "리듀서 전이는 바꾸지 않는다"를 명시했다.
- **50m 안 첫 fix 한 건에 바로 말하기**: 1초 빠르지만 튄 fix 한 건이 아직 오지 않은 정류장을 "도착"으로 만든다(E48 M1과 같은 이유). 실승차에서 늦다고 판정되면 그때 문턱을 본다.
