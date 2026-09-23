# 버스 승차 중 현재 정류장을 기기 위치로 표시한다 (E48 후보 ①)

> 판정 한 줄(리뷰 게이트): 승차 상태 옆에 붙는 새 표시 상태(결박·래치·보존 창)와 위치 스트림 프로파일 변경이라 **설계 단계 적대적 리뷰 대상**이다(글로벌 codex 운영 ①). 리뷰 결과는 §9.

## 0. 요지

버스 승차(riding) 중 경유 정류장 목록에는 "현재 위치" 표식이 없다 — 서울버스·TAGO 도착 API는 내 버스의 현재 정류소를 주지 않고, E35의 열차 위치는 지하철 전용이다. 버스는 지상을 달리므로 기기 위치(fix)가 있다. E36이 riding 동안 열어 둔 **keep-alive 위치 스트림의 fix**로 경유 정류장 좌표(`viaStops` lat/lng) 중 가장 가까운 정류장을 골라 **표식만** 붙인다(위원장 판정 2026-09-23, BACKLOG E48 후보 ①).

이것이 E36 ⓐ′("keep-alive 좌표를 실제로 쓴다")의 첫 소비다 — 위치 백그라운드 모드의 쓰임이 "프로세스 유지"에서 "승차 중 현재 정류장 표시"로 진짜가 된다(BACKLOG §2 E36 ⑩ 심사 서술).

**표시 전용 계약**(E35와 같은 경계, 판정서 `2026-08-23-express-stop-data-verdict-design.md` §3): 승차 상태 머신(`transitGuideReduce`)의 입력·상태·전이는 한 줄도 바뀌지 않는다. 도착·riding 승격·하차 통지·`neverSeen`은 도착 API가 그대로 한다. 기기 위치 상태는 리듀서 밖에 있고 리듀서는 그 존재를 모른다(소스 가드).

## 1. 범위

| 면 | 무엇이 바뀌나 |
|---|---|
| 순수 계층 | 웹 `src/lib/transit-bus-stop.ts` ↔ Kit `TransitBusStop.swift` 미러 + 공유 fixture `transit-bus-stop-cases.json` |
| iOS 위치 | `LocationService` keep-alive 스트림이 fix를 싱크로 넘기고(공유 스토어엔 여전히 쓰지 않는다), **버스 riding 동안만** 정밀 프로파일로 올린다(§4) |
| iOS 안내 | `TransitGuideModel`이 fix를 순수 계층에 넣고, 경유 정류장 목록 표식(`viaStopHereIndex`)·조망(`overview`)이 읽는다 |
| 웹 | `useTransitGuide` 폴 끝에 공유 위치 스토어를 조용히(`silent`) 한 번 재고, 경유 정류장 목록 표식이 읽는다 |
| 안드로이드 | 없다. 새 Kit 파일은 미러 등록부 `guide.json`에 `pending`(대중교통 안내 화면이 안드로이드에 아직 없다) |

**범위 밖**: 지하철(E35가 열차 위치로 채운다 — 지상 구간 보조는 E48 후보 ②) · 상태 문장("하차 정류장에 가까워지면 버스 위치가 표시됩니다." 등 신호 문장은 그대로, §6) · `neverSeen` 경고 보류(E35 판정 2는 **잠근 열차**가 경로를 따라 움직이는 것이 보일 때의 규칙이다 — 기기 위치는 잠근 버스를 증언하지 않는다) · 주변 확인 앵커(E35 §5 ⑤와 같은 이유로 따르지 않는다) · 하차 판정·잔여 정거장.

## 2. 판정 계층 (웹 ↔ Kit 미러, 공유 fixture)

```
TransitDeviceFix       = { lat, lng, accuracy(m), ageSeconds }      // 호출자가 fix 측정 시각으로 나이를 잰다
TransitBusStopTracker  = { legIndex, phaseGen, stopIndex?, lastObservedAt?, behindSince? }
TransitBusStopVerdict  = notApplicable | inaccurate | stale | offRoute | ambiguous | observed | behind | restarted
```

1. **적용 조건**(`transitBusStopApplies`): `phase == riding` ∧ `leg.mode == "bus"` ∧ 경유 정류장 1개 이상. 잠금 종류(식별·근사)와 신호(`tracking`·`notYetVisible`·소실·실패)는 보지 않는다 — 기기 위치는 도착 피드와 독립이다.
2. **결박** = (`legIndex`, `phaseGen`). riding 진입·탑승 변경·다음 구간·새 경로(phaseGen 0부터 — 모델이 비운다)에서 새로 시작한다. **열차번호가 결박에 없다**: E35는 잠근 열차의 위치라 늦은 응답이 다른 열차에 붙는 것을 막아야 했지만(E35 설계 리뷰 M1), 기기 위치는 언제 도착하든 "지금 이 사람의 위치"라 현재 결박에 넣는 것이 참이다.
3. **fix 한 건의 판정**(`transitBusStopStep(prev, state, leg, fix, now)` → `{tracker, verdict}`), 순서대로:
   - 적용 조건 밖 → `notApplicable`, tracker `nil`.
   - 결박이 prev와 다르면 새 tracker. **보존 창이 지난 래치는 먼저 버린다**(E35 설계 리뷰 M2와 같은 이유 — 표시되지 않는 래치가 뒤의 진짜 관측을 막지 않게).
   - `accuracy ≤ 0` 또는 `> 100m` → `inaccurate`. `|ageSeconds| > 10` → `stale`(Kit은 `isUsableFix(accuracy:ageSeconds:maxAge:)`를 지난다 — 음수 정확도·캐시 fix·미래 시각을 함께 거른다).
   - 경유 정류장 중 최근접 `i`(하버사인). `d_i > 300m` → `offRoute`.
   - `|j − i| ≥ 2`인 정류장 `j`가 `d_j ≤ d_i + 50m`면 → `ambiguous`(노선이 접힌다: 회차·U턴·순환에서 길 건너 정류장이 같은 거리에 있다). 인접 정류장끼리 비슷한 거리는 모호가 아니다 — 두 정류장 사이 중간 지점이 곧 표식이 바뀌는 자리다(E35에서 위원장이 요청한 "역간 중간 지점에서 바뀌면 좋겠다"와 같은 모양).
   - 래치가 없거나 `i ≥ 래치` → `observed`: `stopIndex = i`, `lastObservedAt = now`, `behindSince = nil`.
   - `i < 래치` → 래치 유지. `behindSince`가 없으면 `now`로 두고 `behind`. `now − behindSince ≥ 60초`면 `restarted`: `stopIndex = i`, `lastObservedAt = now`, `behindSince = nil`. 뒤 관측은 `lastObservedAt`을 갱신하지 않는다(래치를 확인하지 않았으므로).
   - `inaccurate`·`stale`·`offRoute`·`ambiguous`는 래치·`behindSince`를 건드리지 않는다(관측이 아니므로 뒤 관측의 연속도 끊지 않는다 — E35 "연속"의 뜻과 같다).
4. **표식 index**(`transitBusStopShownIndex(state, leg, tracker, now)`): 적용 조건 ∧ 결박 일치 ∧ `stopIndex` 있음 ∧ `now − lastObservedAt ≤ 90초`. `now`가 `lastObservedAt`보다 이르면(렌더 시계가 fix보다 먼저 굳었다) 보인다.
5. **경유 목록의 세 번째 출처**(`transitViaStopHereIndexWithBusStop`): E35 `transitViaStopHereIndex`(도착 `arvlMsg3` · 열차 위치)와 버스 표식 중 큰 값. 버스 leg에서 앞의 둘은 언제나 없으므로 사실상 버스 표식이고, 지하철 leg에서 버스 표식은 언제나 없다 — `max`는 두 출처가 한 leg에서 겨루지 않는다는 사실을 코드가 가정하지 않게 하는 방어다.
6. **조망 후처리**(`transitOverviewApplyingBusStop`): `here == .notApplicable(.bus)`이고 표식 index `p`가 있으면 `.station(p)`로 바꾸고 현재 leg 정차역 행의 `here` 플래그를 맞춘다. 그 밖의 `here`(지하철·국면 밖)는 불변. silence 행·`reboardOffered`는 불변. E35 후처리 뒤에 얹는다(두 후처리는 서로 다른 leg 종류에서만 일한다).

상수(웹·Kit 동일값, **전부 잠정값** — 실승차 판정 대상, §8):

| 상수 | 값 | 근거 |
|---|---|---|
| 정확도 상한 | 100m | 앱 공유 스토어 저장 상한(`isStorableFix`)과 같다. 서울 시내버스 정류장 간격(대개 300~500m)의 중간 지점까지 150~250m라 100m 오차는 중간 지점 근처에서만 표식을 흔들고, 흔들림은 단조 래치가 흡수한다 |
| fix 나이 상한 | 10초 | 캐시 fix(스트림 첫 콜백)를 거른다. 웹은 측정 시각(`Coord.at`)이 초 단위라 iOS 도보 안내의 5초보다 여유를 둔다 |
| 최근접 거리 상한 | 300m | 노선 밖(내려서 걷는 중·다른 길)에서 엉뚱한 정류장을 말하지 않게. 정류장 간격이 600m를 넘는 구간의 가운데는 표식이 없다 — 그 구간에서 뒤 정류장을 계속 말하는 것보다 정직하다 |
| 모호 여유 | 50m | 길 건너 정류장(대개 20~40m)을 잡는다 |
| 보존 창 | 90초 | 웹은 riding 미관측 폴(60초)마다 한 번 재므로 한 번의 측위 실패는 견디고 두 번 연속이면 내린다. iOS는 스트림이 계속 흐르므로 90초 공백은 터널·지하차도 같은 실제 공백이다 |
| 뒤 재시작 | 60초 | 뒤 관측이 60초 동안 이어질 때만 그 정류장에서 다시 시작한다. 중간 지점의 흔들림(수 초 간격 fix가 앞뒤로 오간다)은 사이에 같거나 앞 관측이 끼어 끊긴다. E35의 "2회 연속"을 그대로 쓰면 초 단위 fix에서 중간 지점마다 표식이 한 칸 뒤로 튄다 |

## 3. 불변식

- **표식은 "있다"만 주장한다**(E35 §5 ④ 그대로). 부정확·오래된·노선 밖·모호 fix와 권한 없음·스트림 없음은 모두 표식 부재로 나가고 새 문구를 만들지 않는다. 사유는 iOS 계측 로그가 가른다(§4).
- **오래된 fix로 정류장을 말하지 않는다**: fix 나이 10초 상한(관측 시점) + 보존 창 90초(표시 시점) 두 겹. 버스가 90초 동안 움직였다면 정류장 한두 개를 지났을 수 있다.
- **정류장을 뒤로 말하지 않는다**: 래치는 앞으로만 간다. 예외(재시작)는 60초 연속 뒤 관측뿐이고, 그것은 첫 래치가 틀렸던 경우(노선이 접히는 곳의 첫 fix)를 고치는 길이다.

## 4. iOS

### 4.1 keep-alive fix 싱크 — 공유 스토어는 여전히 오염시키지 않는다

- `LocationService`에 `keepAliveFixSink: ((BeaconFixPayload) -> Void)?`를 둔다. `isKeepAliveActive`인 동안 들어온 fix를 **판정 없이 원값으로** 넘긴다(판정은 Kit). 비콘 싱크와 같은 페이로드 타입(`timestamp`로 나이를 잰다). 단 **정밀 위치가 꺼진 세션(`accuracyAuthorization == .reducedAccuracy`)의 fix는 넘기지 않는다** — 공유 스토어 저장과 같은 규칙이다("reduced fix는 km급 정확도로 보고된다"는 가정에 기대지 않는다, `LocationService` 주석).
- **공유 스토어 쓰기 규칙은 불변**: keep-alive 단독 구간의 fix는 여전히 `stored`에 쓰지 않는다(E36 spec §4.2.3 ⓐ — 저정밀 스트림이 앱 전역 "현재 위치"를 덮지 않게). 싱크는 이 안내 세션만 읽는다.
- 싱크는 모델이 keep-alive를 켤 때 걸고 끌 때·세션 종료 때 푼다.

### 4.2 버스 riding 동안만 정밀 프로파일

keep-alive 프로파일(`kCLLocationAccuracyKilometer` · 거리 필터 500m)은 프로세스 유지용이라 정류장 판정에 못 쓴다 — 오차가 수백 m~km이고 500m를 움직여야 fix가 온다(정류장 한두 개 간격). 그래서 **버스 riding 동안만** 프로파일을 올린다:

| | keep-alive(현행) | 버스 승차(신규) |
|---|---|---|
| `desiredAccuracy` | Kilometer | **HundredMeters** |
| `distanceFilter` | 500m | **없음** |
| `activityType` | otherNavigation | **automotiveNavigation**(도로 위 차량) |
| `pausesLocationUpdatesAutomatically` | false | false |

- 거리 필터를 끄는 이유: 필터가 있으면 신호 대기·정체 중 fix가 끊겨 보존 창(90초)이 지나 표식이 사라진다(버스는 멈춰 있을 뿐인데). 필터 없이 흐르는 fix가 "아직 여기"를 계속 증언한다.
- `Best`(도보 안내)가 아니라 `HundredMeters`: 정확도 상한이 100m라 그보다 정밀한 요청은 판정을 바꾸지 않고 배터리만 쓴다.
- **배터리는 늘어난다** — 버스 승차 구간만이다. 지하철 riding·boarding(A46)·지하철/버스 대기는 현행 저정밀 그대로. 실측은 BACKLOG §2 E36 ③(30분 승차 전후 %)에 버스 축을 더한다.
- 구현: `LocationService.setKeepAliveBusRiding(_:)` — 플래그를 바꾸고, keep-alive **단독** 구간(비콘·단발 없음)이면 즉시 프로파일을 다시 적용한다. `applyProfile(.keepAlive)`가 이 플래그로 두 설정 중 하나를 고르므로, 단발 취득·비콘이 끝나고 keep-alive로 내려올 때(`endOneShotIfIdle`·`stopBeaconUpdates`)도 같은 값으로 돌아온다. `stopKeepAliveUpdates`는 플래그를 내린다(다음 세션이 정밀로 시작하지 않게).
- 모델: `updateKeepAlive()`가 keep-alive 상태와 함께 `phase == riding ∧ currentLeg.mode == "bus"`를 매번 반영한다(국면 전이·구간 전진·유휴 정지 경로가 이미 이 함수를 부른다).
- ⚠ **비관측 잠금 riding**(A34 ① — 서울버스 "이미 탔어요"의 근사 폴백)은 폴 주기 0이라 keep-alive 자체가 꺼진다 → fix가 없어 표식도 없다(정직한 부재). 이 구간을 위해 keep-alive를 따로 켜지 않는다 — 폴 없는 세션을 백그라운드에서 살려 둘 이유를 새로 만드는 일이라 E36 판정 범위 밖이다(§8 열린 판정).

### 4.3 모델 배선

- `busStop: TransitBusStopTracker?`(표시 상태, 리듀서 밖). 싱크 콜백에서 `transitBusStopStep`을 돌리고 **값이 바뀔 때만** 대입한다(fix는 초 단위로 온다 — 같은 값 대입이 매번 뷰를 다시 그리게 두지 않는다).
- 렌더 시계는 E35의 `positionClock`을 함께 쓴다(폴마다 굳는다). 새 fix의 `lastObservedAt`은 그보다 늦어 곧바로 보이고, 만료는 다음 폴에서 판정된다(폴 주기 ≤ 60초 — keep-alive가 켜져 있으면 폴도 돈다).
- `viaStopHereIndex`는 `transitViaStopHereIndexWithBusStop`, `overview`는 E35 후처리 뒤 `transitOverviewApplyingBusStop`. 조망의 "다른 경로" 출발점은 GPS 우선이고 실패할 때만 `.station`을 읽는다(현행 정책 그대로 — 버스 표식 정류장 좌표도 90초 안의 fix에서 나온 것이다).
- `beginSession`·`changeRoute`·`stop`이 `busStop`을 비운다(E35 `ridingPosition`과 같은 자리).
- 계측(`transitGuideLog`): `busFix verdict= idx= latched= acc= age=` — **판정 종류나 래치가 바뀔 때만** 1줄(초 단위 fix마다 쓰면 로그가 넘친다). 실승차 사후에 "부정확이었나·노선 밖이었나·모호였나"를 가르는 유일한 증거다. keep-alive 시작 줄에 프로파일(`profile=bus|default`)을 싣는다.

## 5. 웹

- 웹은 keep-alive 스트림이 없다(전경 전용 폴). 폴(`pollOnce`)의 위치 조회(`refreshPosition`) 뒤에 **기다리지 않고**(`void`) 한 번 잰다 — 측위가 최대 15초(`PRECISE_OPTS`) 걸려도 다음 도착 폴 예약을 밀지 않게.
- 조건: 적용 조건(§2 ①) ∧ 공유 스토어가 이미 `ready`. `ready`가 아니면(권한 전·거부·실패) 재지 않는다 — **권한 팝업을 새로 띄우지 않는다**(대중교통 안내는 권한 요청 지점이 아니다, iOS keep-alive와 같은 규칙).
- 측위: `awaitGeolocation({ silent: true, maxAgeSeconds: 10 })` — 웹 위치 스토어 규칙(CLAUDE.md "화면이 요청하지 않은 측위는 표시 상태를 흔들지 않는다" + 나이 상한). 캐시가 10초보다 낡았으면 정밀 재측위, 실패하면 직전 좌표 그대로(→ 나이로 `stale`).
- 결과: `Coord.accuracy`(없으면 판정 불가 → `inaccurate`)·`Coord.at`(측정 시각, 없으면 `stale`)로 `TransitDeviceFix`를 만들어 **도착 시점의 현재 상태**로 step한다(§2 ② — 결박에 늦은 응답 문제가 없다). 이어 `positionClock`을 지금으로 굳힌다.
- 비행 중 가드 ref 하나로 겹친 측정이 같은 fix를 두 번 넣지 않게 한다.
- 경유 목록 표식 `viaStopHere`가 `viaStopHereIndexWithBusStop`을 읽는다. 웹은 조망 화면이 없다(후처리 함수는 fixture 미러로만 둔다 — E35 `overviewApplyingPosition`과 같은 관례).

## 6. 사용자에게 보이는 변화

**새 문구 키는 없다.** 경유 정류장 목록의 기존 표식 문구(`viaCurrent` "현재 위치")가 버스 leg에서도 붙는다. 조망 정차역 행도 같은 표식을 쓴다.

> 현행(버스 승차 중, 경유 정류장 펼침): 길동사거리, 승차 / 강동역 / 천호역 / 천호사거리 / 광나루역, 하차
> 변경: 길동사거리, 승차 / 강동역, 현재 위치 / 천호역 / 천호사거리 / 광나루역, 하차

(렌더 순서·구분자는 `transitViaStopLine`이 정한다 — 이 설계는 `here` 플래그만 바꾼다.)

상태 문장은 그대로다: 버스 신호 문장 "하차 정류장에 가까워지면 버스 위치가 표시됩니다."의 "버스 위치"는 도착 피드의 잔여 정류장 수를 말하고, 목록의 "현재 위치"는 기기 위치다. E35 판정 1(신호 문장 자리를 현재역 문장이 차지)을 버스로 넓힐지는 제품 판단이라 이 설계가 정하지 않는다(§8).

## 7. 비채택안

- **keep-alive 저정밀 그대로 쓰기**: 1km 오차·500m 필터로는 정류장을 가를 수 없어 표식이 거의 서지 않는다 — ⓐ′의 "좌표를 실제로 쓴다"가 이름만 남는다.
- **승차 내내 `Best`**: 정확도 상한(100m)이 판정을 정하므로 그 이상은 배터리만 쓴다.
- **도로 선형(polyline) 위 투영으로 진행 거리 계산**: `viaStops`는 점뿐이라 선형이 없다. 경로 응답에 선형을 추가하는 것은 서버·앱 계약 변경이고, 정류장 간격 규모의 표식에는 최근접 정류장으로 충분하다.
- **E35 모듈(`transit-riding-position`)에 합치기**: 결박(열차번호 유무)·관측 출처(서버 응답 vs 기기 fix)·빈도(분 vs 초)·뒤 재시작 규칙이 다르다. 한 타입에 두 출처를 넣으면 한쪽의 규칙이 다른 쪽에 새어 들어간다. 합류 지점은 표식 index의 `max` 하나다.
- **정류장 근접 통지("○○ 정류장 지남")**: 표시 전용 범위 밖. 하차 통지는 도착 피드가 정본이다.

## 8. 검증·열린 판정

- **공유 fixture** `transit-bus-stop-cases.json`: 적용 조건·결박 교체·정확도/나이 경계(100m·10초 포함, 음수·미래)·노선 밖·모호(접힘)·전진·같은 정류장·뒤 1회·뒤 60초 재시작·뒤 뒤 같은 관측으로 연속 끊김·만료 래치 버림·표식 보존 창 경계(90초)·렌더 시계가 fix보다 이른 경우·세 번째 출처 `max`·조망 후처리(버스 → station, 지하철·국면 밖 불변). 웹 vitest·Kit `swift test`가 같은 입력·기대로 돈다.
- **소스 가드**: 상태 머신 파일(`transit-guide.ts`·`TransitGuide.swift`)이 새 모듈을 참조하지 않는다 · keep-alive 단독 fix는 공유 스토어에 쓰지 않는다(`!self.isKeepAliveOnly` 유지) · 싱크 전달은 `isKeepAliveActive` 조건.
- **웹 배선 테스트**: 버스 riding + 공유 스토어 `ready`에서 경유 목록에 "현재 위치"가 서고, 스토어가 `ready`가 아니면 측위를 요청하지 않는다(권한 팝업 없음).
- **변이 주입**(커밋 뒤): 단조 가드 제거 · 보존 창 무시 · 모호 판정 제거 · 나이 검사 제거 · 웹 `ready` 가드 제거 — 각각 빨개지는지.
- **실호출 없음**: 기기 fix 소비라 외부 API를 부르지 않는다.
- **실승차**(BACKLOG §2 E48 행, 신설): ①표식이 실제 정류장을 따라가는가(중간 지점에서 바뀌는가, 뒤로 튀지 않는가) ②정체·신호 대기에서 표식이 유지되는가 ③지하차도·터널 뒤 복귀 ④회차·U턴 노선에서 모호로 비는 구간의 길이 ⑤배터리(E36 ③에 버스 축) ⑥상태 문장("버스 위치가 표시됩니다")과 목록 "현재 위치"의 공존이 헷갈리는가 — 헷갈리면 E35 판정 1을 버스로 넓히는 판정을 연다.
- **잠정 상수 여섯**(§2 표) — 실승차 로그(`busFix`)로 판정.
- **열린 판정**: 비관측 잠금 riding(서울버스 "이미 탔어요" 근사 폴백)은 keep-alive가 꺼져 표식이 없다 — 이 구간에도 표식을 원하면 "폴 없는 세션의 위치 스트림"을 새로 판정해야 한다.

## 9. 설계 리뷰

(리뷰 뒤 채운다)
