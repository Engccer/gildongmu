# N4 자동차 경유지 접근 예고 설계 (2026-10-17)

설계 리뷰 판정: **적대적 설계 리뷰 대상**(정적 거리 임계를 속도 의존 임계로 바꾸는 판정 계층 변경, 실시간 안내 안전 축). codex `adversarial-review` 1회 이상.

## 1. 판정과 범위

위원장 판정 2026-10-17(`docs/BACKLOG.md` N4 "자동차 경유지 안내"):

- 자동차(택시 승객) 안내에도 경유지 접근 예고를 **약 1분 전에 한 번** 낸다. 문장은 도보 N4 진행 표시와 같은 "경유지 {label}까지 {distance}"(`directions.viaRemaining`, 기존 키 재사용, 새 키 없음).
- 거리는 속도 기준: K2 임박 큐의 `max(바닥, v×초)` 계열 산식을 1분 창으로 재사용하고, 표본이 부족하면 고정값. 실주행 판정 전까지 잠정.
- iOS 먼저(안드로이드는 자동차 안내가 없다). 리듀서는 웹 ↔ Kit ↔ `:kit` 미러 + 공유 fixture(`route-guide-scenarios.json`).
- 웹 `carGuideStartable`의 경유지 차단은 열지 않는다. 웹은 리듀서 미러와 fixture까지이고 화면 배선은 바꾸지 않는다.

범위 밖: 도보 동작(바이트 동일 유지), 안드로이드 앱 층, 웹 화면, 문장 문안.

## 2. 현재 구조 (관측 `ce2923ca`)

- 리듀서 두 자리가 `GuideTuning.waypointApproachM: number | null`을 본다.
  - **W0**(세대 첫 fix, `state.lastFixAt === null`): 세대가 이미 접근선 안에서 시작하면 래치 `waypointApproached`를 무발화로 세운다(시작·재조회 통지 바로 뒤 겹침 방지).
  - **W4**(6c 선행 전문·원거리 예고 뒤, 주기 앞): 수준 판정 + 래치. `!isOff && !jumped`, 잔여 `1 ≤ rem ≤ 임계`이면 `waypointApproaching{remainingMeters}` 1회, 톤 없음.
- walk `WAYPOINT_APPROACH_M = 50`, car·carDriver `null`(예고 없음).
- 래치는 `restateAt`(재획득·복귀)이 승계하고, 새 경로 세대(시작·재조회 채택의 `initialGuideState`)에서만 초기화된다.
- iOS `BeaconModel.consume`의 `.waypointApproaching` 처리는 수단을 가르지 않는다: `routeWaypointLabel`이 있으면 `directions.viaRemaining`을 `guideEventSpeechClass` 분류(`.actionable`)로 `announce`. 자동차 세션의 경유지 요청·도착(`waypointReached`)·남은 거리 행("경유지 {label}까지 …")은 이미 동작한다. **따라서 iOS 앱 코드는 바꾸지 않는다** — 프로파일이 이벤트를 내기 시작하면 기존 소비 경로가 그대로 말한다.
- 웹 `useRouteGuide`의 `waypointApproaching` 소비도 수단 무관이지만, 자동차는 경유지 조회에서 안내를 시작할 수 없으므로(`carGuideStartable`) 웹 사용자에게 닿는 변화는 없다.

## 3. 임계 산식

`GuideTuning`의 경유지 접근 필드를 임박 큐와 같은 세 필드 구조로 바꾼다(세 벌 미러, 전부 기본값 없는 필수 필드).

| 필드 | 뜻 | walk | car·carDriver |
|---|---|---|---|
| `waypointApproachM` | 거리 바닥(m). nullable을 없앤다(예고 없는 프로파일이 더는 없다 — 죽은 분기 제거) | 50 (`WAYPOINT_APPROACH_M`, 종전) | 150 (`CAR_WAYPOINT_APPROACH_FLOOR_M`) |
| `waypointApproachS` | 시간 축(초) | 0 | 60 (`CAR_WAYPOINT_APPROACH_S`) |
| `waypointApproachUnknownSpeedM` | 속도 표본 2개 미만일 때 임계(m) | 50 (=바닥) | 600 (`CAR_WAYPOINT_APPROACH_UNKNOWN_SPEED_M` ≈ 10m/s × 60초) |

임계 함수 `waypointApproachThreshold`(웹은 `state`를, Kit·`:kit`는 `speedSamples`를 받는다 — 각 플랫폼의 `imminentAheadMeters` 시그니처 관례를 따른다):

```
표본 < 2  → waypointApproachUnknownSpeedM
그 외     → max(waypointApproachM, estimateSpeedMps(표본) × waypointApproachS)
```

- 표본은 임박 큐와 같은 **직전 fix까지의 창**(`state.speedSamples`, 10초)이다. 현재 fix를 넣지 않는다(인과 — 6a와 같은 표본).
- **walk 바이트 동일**: 바닥 50·시간 0·미지 50이라 어느 분기든 50이다.
- 상수 근거(전부 잠정, B1 계열 실주행 판정 대상):
  - 60초: 판정 문언 "약 1분". 임박 큐의 fix 지연 1초 보정은 1분 창에서 의미가 없어 더하지 않는다.
  - 바닥 150m: 정체·서행(v×60이 150m 미만, 즉 9km/h 미만)에서도 예고가 도착 직전이 아니라 한 블록쯤 앞에서 나가고, 도착(W1)과 겹치지 않게 한다. 자동차의 기하 없는 최종 접근 진입선(`handoffDistM` 150)과 같은 값에서 시작하되 이름을 따로 둔다(한쪽만 바뀔 수 있다).
  - 미지 600m: 임박 큐의 미지 값(`CAR_IMMINENT_UNKNOWN_SPEED_M` = 10m/s × 6초)과 같은 10m/s 가정(시내 주행).
- 상한은 두지 않는다. 고속도로 30m/s면 1.8km 앞이고 그것이 1분이다. 속도 추정이 튀어 이르게 나가는 경우(§5-5)는 거짓 문장이 아니라(거리는 그 순간 실측 잔여) 이른 예고라 감수한다.

## 4. 래치·전달 계약

- **래치는 이벤트를 낸 순간에 선다(종전과 같음).** 판별 질문 "이 통지를 놓치면 누가 대신 말해 주는가?"의 답이 있다: 도착 문장(`waypointReached` → "경유지 {label} 도착. 이제 목적지 {dest} 안내합니다")이 반드시 뒤따르고, 남은 거리 행이 같은 정보를 상시 보인다. 1회성 안전 경고(전달 성공 시점 래치 원칙)가 아니라 진행 안내 쪽이다. 도보 N4가 같은 판정이었다("예고는 버리고 도착만 갚는다", spec 2026-09-24).
- 받아쓰기 억제 중이면 예고는 버린다(거리 문장은 시간이 지나면 거짓). 갚지 않는다 — 도보와 같은 소비 코드다.
- 우선순위: W4 위치를 옮기지 않는다. 같은 fix에 임박 큐(6a)·경유지 도착(W1/W2)·최종 접근(6b)·선행 전문(6c)·원거리 예고가 걸리면 그쪽이 이기고, 수준 판정이라 다음 fix에 예고가 나간다. 그 사이 도착선을 넘으면 도착이 예고를 대신한다.
- 톤 뒤 발화 계약(`speechDeferStep`): 예고는 톤이 없는 문장이라 새 경로가 없다. 직전 fix의 톤 뒤라면 기존 `announce` 창구가 미룬다.
- 백그라운드 음성(E53): `guideEventSpeechClass(.waypointApproaching)`는 이미 `.actionable`이라 토글이 켜져 있으면 잠금 중에도 말한다. 분류를 바꾸지 않는다.
- 운전자 모드(`carDriver`, 실험판 봉인): 리듀서 프로파일이 `CAR_TUNING`을 펼치므로 같은 임계로 이벤트가 나가고, 소비는 `announce`의 운전자 채널(`TtsPlayer.speakGuidance`)로 간다. 거르지 않는다 — 도착(`waypointReached`)도 운전자 모드에서 말하고, 세션당 한 번인 짧은 문장이라 "낮은 빈도"에 반하지 않는다. 운전자 모드의 임박 시간 축(9초)과는 독립이다.

## 5. 경계 사례

1. **출발 직후 1분 안에 경유지가 있을 때**: 세대 첫 fix는 표본이 없어 임계가 미지 값 600m다. 경유지가 경로상 600m 안이면 W0가 예고를 무발화로 소비하고 도착만 나간다. 시작 문장(`GuideText.carStart`)은 경유지를 말하지 않지만, 시트 첫 정보 행(E57 착지)이 "경유지 {label}까지 …"를 보인다. 시작 문장 바로 뒤 "경유지 X까지 400m"가 겹쳐 나오는 것을 피하는 쪽을 택한다(도보 W0와 같은 원리).
2. **세대 첫 fix 직후 임계가 커지는 경우**: 재조회 채택 직후 표본이 비어 임계 600m로 W0를 통과했는데(잔여 900m), 두 fix 뒤 20m/s 표본으로 임계가 1,200m가 되면 그 fix에서 예고가 나간다(재조회 문장 수 초 뒤). 예고 문장이 새 정보(새 경로 기준 경유지 거리)라 감수한다.
3. **재조회 뒤 다시 예고**: 래치는 경로 세대 단위다. 예고를 들은 뒤 경로를 벗어나 재조회되고 새 경로의 경유지 잔여가 임계 밖이면, 다시 다가갈 때 한 번 더 나간다. 새 경로의 거리라 같은 문장의 반복이 아니다. 임계 안에서 재조회되면 W0가 소비한다.
4. **공백 뒤 따라잡기(`silentCatchUp`)**: 점프 fix는 W4 조건 `!jumped`로 발화하지 않고(J 조기 반환도 W4보다 앞), 점프 표본은 속도 창에 들어가지 않는다. uncertain 국면은 W4 이전에 조기 반환한다. 터널을 지나 재획득된 fix에서 잔여가 임계 안이면 그 fix 또는 다음 신뢰 fix에서 예고가 나간다(거리는 그 순간 실측). 공백 중 도착선을 지났으면 W1이 도착을 세우고 예고는 다시 서지 않는다. uncertain 진입과 재획득 분기가 `speedSamples`를 비우므로 복귀·재획득 직후 두 fix는 미지 600m 임계다.
5. **속도 추정 튐**: `estimateSpeedMps`는 `max(직전 구간, 중앙값)`이라 직전 구간 하나가 튀면 임계가 커진다. car는 정확도 50m 초과·점프 표본을 버린다. 남는 위험은 "이른 예고 한 번"이고 낭독 거리는 실측 잔여라 거짓이 아니다.
6. **정체**: v가 0에 가까우면 임계는 바닥 150m다. 정체 속에서 150m 앞에 오면 예고가 나간다.
7. **1m 미만**: 종전과 같이 내지 않고 W1 도착에 맡긴다.

## 6. 미러·테스트

- 웹 `src/lib/route-guide.ts` 기준본 → Kit `RouteGuide.swift`·`:kit` `RouteGuide.kt` 동형. 새 상수 셋은 세 벌 같은 이름 관례(웹 `CAR_WAYPOINT_APPROACH_*`, Kit·`:kit` `carWaypointApproach*Meters/Seconds`).
- 공유 fixture `route-guide-scenarios.json`:
  - 기존 "자동차 프로파일은 경유지 접근 예고를 내지 않는다(waypointApproachM null)" 시나리오는 판정이 뒤집혀 **교체**한다(삭제가 아니라 같은 경로·fix 위에서 기대를 새 판정으로).
  - 신규: ①10m/s 주행에서 잔여 ≤ 600m 첫 신뢰 fix에 1회(표본 ≥2) ②서행 2m/s에서 미지 값을 지난 뒤 바닥 150m에서 1회 ③세대가 미지 임계 600m 안에서 시작하면 무발화 소비, 도착만 ④25m/s에서 1분 창이 1,500m로 커져 원거리에서 1회 ⑤운전자 프로파일도 같은 임계 ⑥같은 fix에 선행 전문이 걸리면 다음 fix로 밀린다.
- 단위 테스트(세 벌): 프로파일 상수 단언을 새 필드로 갱신, 임계 함수 직접 단언(walk 50 고정, car 미지·바닥·속도 분기).
- 도보 회귀: 기존 walk fixture 전량이 그대로 통과(바이트 동일 증거).

## 7. 실주행 판정 (BACKLOG §2·FIELD-TEST)

실험판·정식판 자동차 안내(택시 승객)에서 경유지가 있는 경로로:

1. 예고 "경유지 {label}까지 {거리}"가 경유지 약 1분 전에 한 번 나오는가(이른가·늦은가 — 상수 60초·바닥 150m·미지 600m 잠정).
2. 예고가 선행 전문·원거리 예고·임박 명령과 겹칠 때 순서가 자연스러운가.
3. 출발 직후 1분 안 경유지(예고 없이 도착만)가 결함으로 들리는가.
4. 재조회 뒤 다시 들리는 예고가 거슬리는가.
5. 잠금 중(백그라운드 음성 켬)에도 예고가 들리는가.
