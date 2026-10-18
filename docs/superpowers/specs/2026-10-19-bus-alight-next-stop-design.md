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

표시용 추적기(래치)의 판정을 그대로 하차 명령으로 승격하지 않는다(설계 리뷰 H3): 추적기의 "연속 두 관측"은 사이에 부정확·노선 밖 fix가 끼어도, 시간이 한참 벌어져도 이어지는 **표시용 완화**다(후보 index가 그 verdict들에서 보존되고, 래치 전 후보엔 만료가 없다). 하차 명령은 실패 방향이 "너무 이르게"라 따로 센다.

```
TransitBusAlightNotice = { legIndex, phaseGen, streak, lastAt, reached, announced }
busAlightNoticeStep(prev, state, leg, result: TransitBusStopStepResult, fix, now) -> { notice, speak }
```

- **적격 fix**: 추적기가 이 fix의 최근접을 하차 정류장(경유 목록의 마지막)으로 판정했고(`nearestIndex == last`) 그 판정이 `pending`·`observed`(= 추적기의 정확도 100m·나이 10초·노선 밖 300m·접힘 모호·하차 반경 50m를 전부 통과) ∧ **fix 정확도 ≤ 35m**(`BUS_ALIGHT_NOTICE_MAX_ACCURACY_M`, 알림 전용 문턱) ∧ **도착 피드가 두 정거장 이상 남았다고 말하지 않는다**(`state.remaining`을 읽기만 한다, 모르면 막지 않는다). 마지막 조건은 회차·순환 노선이 하차 정류장 50m 안(예: 교차로 모퉁이)을 먼저 지나는 곳에서 이르게 말하고, 그 기록 때문에 진짜 정류장의 한 마디와 「다음 정류장」까지 모두 막히는 경로를 끊는다(구현 리뷰 M1). 잔여가 한 폴 낡아 실제로는 이미 한 정거장일 때 놓치는 쪽은 안전 방향이다(GPS 한 마디만 빠지고 「다음 정류장」은 그대로 나간다).
- **연속**: 적격 fix가 직전 적격 fix와 10초(`BUS_ALIGHT_NOTICE_MAX_GAP_MS`) 안에 이어질 때만 `streak + 1`, 부적격 fix 한 건이나 10초 공백이 끊는다(`streak = 0`). `streak ≥ 2`이면 `reached = true`이고, `announced`가 거짓이면 참으로 바꾸며 `speak = true`.
- **적용 밖**(국면이 riding이 아니거나 버스 아님): 같은 결박의 기록은 두고 연속만 끊는다 — 도착 추정(`arrived(certain: false)`)과 재관측(`backOnTrack`)은 국면 세대를 바꾸지 않아(`transit-guide.ts` 도착 추정 분기가 세대를 유지) 이력이 남는다.
- **결박은 (구간, 국면 세대)**: 세대는 riding 진입·탑승 변경·구간 전진에서만 바뀐다. 구간이 바뀌거나 `[탑승 변경]`·`[이미 탔어요]`로 다시 타면 새 기록이다(구현 리뷰 m2 — 구간만으로 묶으면 잘못 선 기록이 다시 탄 버스의 두 신호를 막는다).
- 정확도 35m 근거: 2026-10-18 실승차 로그의 `busFix` 정확도는 대부분 14~34m(`NearestTenMeters` 프로파일), 이상값은 72m 이상. ⚠ 잠정값(실승차 판정).
- 50m 안 주행 중(정류장 40m 앞 → 30m 앞) 두 fix로도 나간다 — 위원장 판정 문언("50m 안에서 관측하면")이 정한 시점이고, 문은 정류장에서만 열린다. 막아야 하는 것은 **직전 정류장에서 나가는 것**이고 그 축은 정확도 문턱·연속성·추적기의 최근접 판정이 맡는다. 남는 위험: 직전 정류장이 하차 정류장과 80m 안팎으로 붙어 있고 하차 쪽으로 30m 넘게 치우친 fix가 연속하면 나갈 수 있다(실승차 관찰 항목).

### 2.2 오케스트레이터(iOS `TransitGuideModel`, 웹 `useTransitGuide`)

- fix를 반영한 뒤(`ingestKeepAliveFix` / 웹 `watchPosition` 콜백) `busAlightNoticeStep`을 돌리고 `speak`면 문장을 낸다. **리듀서에는 아무것도 넣지 않는다** — 상태 전이(승격·`arrived`·폴 주기)는 바뀌지 않고, 도착 확정은 여전히 `declareArrived`뿐이다.
- **관측 이력과 전달 장부를 가른다**(설계 리뷰 H4): `reached`는 관측 사실이라 지우지 않는다. `announced`는 전달 장부라, iOS 지연 창구가 문장을 버리면(`onDropped` — latest-wins 선점·억제·백그라운드 게이트) 같은 구간일 때 거짓으로 되돌린다. 하차 정류장에 서 있는 동안 fix는 1초 간격으로 계속 오므로(`NearestTenMeters`·거리 필터 없음) 다음 적격 fix가 다시 말한다. 재시도의 소유자는 그 하나다: 억제(받아쓰기) 중 버려진 이 문장은 일반 억제 복구(`droppedWhileSuppressed`)에서 빼고(해제 때 위치 재검증 없이 재생되면 정류장을 벗어난 뒤의 「도착」이나 중복이 된다), 백그라운드에서 버려진 문장은 되돌리지 않고 복귀 시 현재 상태 낭독(`missedAnnouncement`, E53)에 맡긴다(되돌리면 음성 토글 끔에서 fix마다 재시도하고 복귀 낭독과 겹친다). 웹 live region은 버림을 알 수단이 없어 장부를 되돌리지 않는다(웹은 전경 한정·polite 단일 창구).
- **iOS 출력**: 톤 `.nearby`(리듀서 `arrived`와 같은 "도착" 톤, `allowedInBackground: false` — 백그라운드 톤 허용 집합은 `trackingStarted` 하나라는 E36 판정 그대로) 뒤 `announce(text, highPriority: true, speechClass: .actionable)` — 톤 뒤 발화 계약의 기존 창구(`deferredAnnouncer`)를 지난다. `.actionable`이라 백그라운드 음성 설정이 켜져 있으면 화면이 꺼진 채로도 말한다(E53, 하차 임박 문장과 같은 분류). `highPriority`는 진행 중 낭독을 끊는다 — 지금 내려야 한다는 말이 앞 문장 뒤에 줄 서면 문이 닫힌다.
- **웹 출력**: 기존 polite live region `announce(text, lang)` 하나(웹 대중교통 안내엔 톤이 없다). 웹 스트림은 전경에서만 열리므로(E48 §5) 웹의 한 마디도 전경 한정이다.
- **기록 수명**: 세션 시작·경로 변경·세션 종료에서 비운다(유휴 진입은 비우지 않는다: 같은 세션, 같은 구간이다).
- **역순 방지**: 그 구간에 `reached`가 서 있으면 늦게 오는 `arrivingAtAlightStop`(「다음 정류장 …」)은 **내지 않는다**(톤·문장 모두). 하차 정류장에 닿은 사람에게 "다음 정류장 X"는 한 정거장 더 가라는 말로 들린다. TOPIS 잔여 0은 차량이 하차 정류장에 서 있는 동안에도 이어지므로(소실은 떠난 뒤), riding 첫 조회가 늦거나 잔여 1 소실 → 도착 추정 → 0 재관측(`backOnTrack` 뒤 다음 폴) 경로에서 이 이벤트가 정차 중에 올 수 있다(설계 리뷰 H1). 리듀서의 래치(`ladderAnnounced = 0`)는 그대로 선다 — 출력만 거른다.
- ⚠ **남는 경로**: GPS가 없을 때(권한 없음·웹 백그라운드·정확도 미달) 늦은 첫 관측의 「다음 정류장 X」는 이미 X에 선 사람에게 거짓이 된다. 종전 「이번 정류장」이 그 경우에만 참이었던 것과 맞바꾼 것이고, 위원장 판정의 근거("정차 중이든 막 떠났든 다음 정류장은 하차 정류장")가 다룬 정상 순서는 직전 정류장 정차 → 출발이다. 정상 경로에서 riding 첫 조회는 출발(승격) 뒤 15초라 이 경로는 폴 실패가 겹친 짧은 구간에 한정된다. 실승차 관찰 항목으로 남긴다.

### 2.3 표시 전용 계약의 예외 범위

판정서 2026-08-23 §3의 경계는 "**리듀서**가 기기 위치를 모른다"이고 그것은 유지된다(`transit-bus-stop-guard.test.ts` 첫 블록 불변). 예외는 "기기 위치가 **통지**를 하나 낸다"는 것 하나이며, 소스 가드에 허용 목록 한 자리로 잠근다: 오케스트레이터에서 `busAlightNoticeStep`을 부르는 곳이 플랫폼마다 정확히 한 곳이고, 그 결과가 리듀서 입력(`dispatch`)으로 흘러가지 않는다.

## 3. 안드로이드

- **문자열·descriptor는 옮긴다**: `messages` → `strings.xml` 생성물, `:kit` `TransitGuideText.kt`의 `transitArrivingAtAlightStopLine`·`transitAlightStopReachedLine`과 공유 fixture `transit-guide-text-cases.json`.
- **GPS 한 마디는 옮기지 않는다**: 안드로이드엔 대중교통 안내 화면도 E48 추적기도 없다(`android/kit/mirrors/guide.json` `TransitBusStop.swift: pending`). 계획 §1 판정 4대로 새 위치 추적을 만들지 않고, BACKLOG A69에 "안드로이드: 추적기 없음, 규칙만 대기"를 적는다. 이식 메모는 그 등록부 항목의 `note`에 한 구절 더한다(대중교통 안내가 생길 때 함께).

## 4. 검증

- 공유 fixture: `transit-guide-text-cases.json`(새 descriptor 두 개 × ko·en·영문 없음·이름 없음), `transit-bus-stop-cases.json`에 `fn: "alightNotice"` 시퀀스 사례(첫 적격 fix 침묵 → 10초 안 두 번째 말함 → 이미 말한 구간 침묵 → 부적격 fix가 끊음 → 10초 공백이 끊음 → 정확도 35m 초과 부적격 → 50m 밖 부적격 → 마지막 아닌 정류장 부적격 → 적용 밖이 기록을 지우지 않음 → 다음 구간 새 기록). 웹·Kit·`:kit`(text만)이 같은 파일을 돈다.
- 소스 가드: §2.3 허용 목록 + iOS 기록 비우기 세 자리 + 역순 방지 + 톤 허용 인자 `false` + `onDropped` 장부 되돌림.
- 리듀서 fixture(`transit-guide-scenarios.json`)는 이벤트 이름만 쓰므로 바뀌지 않는다(문장 교체는 렌더 계층).
- 실승차(BACKLOG §2 행, FIELD-TEST 대본): ① 직전 정류장 정차 중 「다음 정류장 {이름}에서 내리세요」가 나오는가 ② 하차 정류장에 서면 「{이름} 도착. 내리세요」가 한 번 나오는가, 늦지 않은가(문이 열려 있는 동안), 이르지 않은가 ③ 화면을 끈 채 백그라운드 음성 켬에서 ②가 들리는가. 로그 토큰 `busAlightReached leg=`.

## 5. 비채택

- **GPS로 「다음 정류장」 문장 시점을 고치기**(직전 정류장 출발을 GPS로 확인한 뒤 말하기): 판정이 문장 교체를 택했다 — 문장이 시점과 무관하게 참이 되면 시점 판정이 필요 없다.
- **GPS 관측으로 리듀서 `arrived` 확정**: 판정서 §3 경계를 넘는다. 위원장 판정이 "리듀서 전이는 바꾸지 않는다"를 명시했다.
- **50m 안 첫 fix 한 건에 바로 말하기**: 1초 빠르지만 튄 fix 한 건이 아직 오지 않은 정류장을 "도착"으로 만든다(E48 M1과 같은 이유). 실승차에서 늦다고 판정되면 그때 문턱을 본다.
- **표시용 래치가 하차 정류장에 서는 순간 말하기**(초안): 래치의 연속성은 표시용 완화라 떨어진 이상 fix 두 건으로도 선다(설계 리뷰 H3).
- **TOPIS 0만으로는 "다음"을 단정하지 않는 문구**(설계 리뷰 H1 권고): 위원장 판정 문구를 바꾸는 제품 판단이다. 판정이 고른 문장을 두고 GPS 관측 이력으로 거짓이 되는 경로를 줄였다.

## 6. 설계 리뷰

구현 리뷰(opus, `review-impl-202610190621.md`): MAJOR 1(회차 노선의 이른 「도착」과 그 뒤 신호 전부 침묵) → 잔여 2 이상 부적격, MINOR m1(억제·백그라운드 재시도) → 위 2차 수정과 같음, m2 → 세대 결박, m3(가드·경계 사례 부족) → 발화 배선 가드·정확도 35/36m·간격 정확히 10초 사례 추가, 중복 술어(`busStopApplies`) 제거.

1차 codex `adversarial-review`(base `641739f8`, HEAD spec 커밋, 보고 `~/gildongmu-wt/a69-bus-alight-reports/review-design-202610190608.md`): needs-attention, high 4. H1(늦은 첫 관측의 「다음 정류장」 거짓) → 역순 방지를 GPS 관측 이력으로 넓히고 GPS 없는 잔여 경로를 §2.2에 명시, 문구 변경 권고는 위원장 판정이라 기각. H2(50m 안 두 좌표는 정차를 증명하지 않는다) → 판정 문언이 정한 시점이라 유지하되 알림 전용 정확도 문턱 35m를 더하고 남는 위험(붙은 직전 정류장)을 §2.1에 명시. H3(추적기의 연속 두 관측은 연속이 아니다) → 채택, 알림 전용 연속 판정으로 분리. H4(예약을 전달로 기록하면 영구 소실) → 채택, 관측 이력과 전달 장부 분리 + iOS `onDropped` 되돌림.

2차 codex(HEAD `0951aa50`, 보고 `review-design-202610190617.md`): high 1 — 억제 복구와 `onDropped`의 이중 소유(해제 때 위치 재검증 없는 재생·중복) → 채택, 이 문장을 일반 억제 복구에서 뺐다. 접근성 감사(opus, `review-a11y-202610190619.md`): MINOR 3 — M1은 같은 수정으로 해소, M2(백그라운드 음성 끔에서 fix마다 재시도) → 백그라운드 버림은 되돌리지 않는다, M3(도착 종 약 2.25초가 「내리세요」 앞에 붙는다) → 실승차 관찰 항목(늦으면 짧은 `.ahead`로).
