# 도착 추정 자동 종료(잊힌 안내 세션 정리) 설계

2026-08-13. 위원장 실사용 피드백 접수 세션에서 방향 합의(도착 추정 자동 종료 + 리마인더 중 전자만, 리마인더는 백로그).

## 1. 배경 (실사고)

2026-08-13 귀가 실보행(`docs/superpowers/specs/logs/guide-diag-2026-08-13.log.gz`, 17:03 KST 세션): 17:08:31Z `finalApproachEnter` 직후 usable fix가 0건이 되며 로그가 침묵한다. 도착 자동 종료(`handleFinalApproach`의 `arrived` 경로)는 **usable fix + 도착 반경 15m 이내**가 조건이라, 도착 반경을 밟기 전에 실내로 진입해 fix가 unusable(무효 정확도·stale)로 떨어지면 도착 판정이 영영 오지 않는다. 세션은 사용자가 수동 종료할 때까지 무한 생존하며 워치독 unreliable 톤과 "신호 약함" 음성만 간헐 반복했다(위원장 체감 보고 일치: "가끔 신호 약함 톤·음성이 났다"). 이 시나리오는 `tickWatchdog` 주석에 알려진 한계로 이미 적혀 있었다("목적지에서 건물로 들어가 GPS가 끊기면 사용자가 직접 멈추기 전까지 '신뢰할 수 없음'이 무한 반복된다").

한편 백그라운드 생존 자체는 의도된 설계다(장거리 이동 중 잠금·타 앱 사용 후 복귀 시 안내가 죽어 있던 문제의 해결, 라운드1 ⑦). 그 설계를 유지한 채 "목적지 부근에서 잊힌 세션"만 정리하는 것이 이번 작업이다.

## 2. 목표·비목표

- **목표**: 최종 접근 국면에서 실내 진입 신호가 지속되면 도착으로 간주하고 도착 종을 울린 뒤 자동 종료한다.
- **비목표(범위 제외, §7)**: 경로 중간 무진행 리마인더, 대중교통 세션의 잊힌 세션 정리, 웹 UI 배선.

## 3. 판정 계층 (새 순수 함수, 웹·Kit 미러)

`presumedArrivalStep` — Kit `FinalApproach.swift` + 웹 `src/lib/final-approach.ts`(기존 최종 접근 미러 자리)에 나란히 둔다.

입력:
- `inFinalApproach: Bool` — 최종 접근 국면 여부.
- `secondsSinceUsableFix: Double` — 마지막 usable fix 이후 경과.
- `secondsSinceProgress: Double` — 마지막 "진행 관측" 이후 경과. 진행 관측 = usable fix가 직전 관측 좌표에서 `progressEpsilonMeters` 이상 이동. 기준 시점은 최종 접근 진입 시각과 마지막 진행 관측 시각 중 나중.

출력: `.none` | `.presumedArrived(reason: .noFix | .stationary)`

판정(순서 고정):
1. `inFinalApproach == false` → 항상 `.none`. **경로 중간 자동 종료 금지의 1선 방어는 이 구조다** — 판정 함수가 국면 입력 없이는 도착을 낼 수 없다.
2. `secondsSinceUsableFix >= presumedArrivalNoFixSeconds` → `.presumedArrived(.noFix)` (오늘 실사고 모양: 실내 진입으로 fix 두절).
3. `secondsSinceProgress >= presumedArrivalStationarySeconds` → `.presumedArrived(.stationary)` (fix는 오는데 도착 반경 밖에서 제자리 — 실내 wifi 측위로 오프셋 좌표에 고정되는 모양).
4. 그 외 `.none`.

### 상수 (전부 잠정값 — 실보행 재판정이 정본)

| 상수 | 값 | 근거 |
|---|---|---|
| `presumedArrivalNoFixSeconds` | 180 | 최종 접근 구간은 목적지 ≤ ~100m(오프셋 실측 16~89m). 보행 1.5분 거리에서 3분 무신호면 실내 진입이 유력. 너무 짧으면 GPS 협곡 오탐, 너무 길면 도착 종이 무의미하게 늦는다. |
| `presumedArrivalStationarySeconds` | 300 | 목적지 코앞 벤치 휴식 오탐을 줄이기 위해 noFix보다 길게. |
| `progressEpsilonMeters` | 10 | GPS 지터(acc ~15m)가 진행으로 오인되지 않는 하한. |

## 4. iOS 배선 (`BeaconModel`)

트리거 지점 2곳(모양별로 도달 경로가 다르다):
- **워치독 틱**(`tickWatchdog`, 기존 2초 주기에 얹는다 — 새 타이머 없음): `.noFix` 모양은 fix가 안 오므로 fix 경로에는 걸 수 없다(기존 "fix 부재는 타이머 워치독" 원칙 동형).
- **`handleFinalApproach`**: `.stationary` 모양(usable fix 수신 중). 진행 관측 갱신도 여기서.

발동 시(기존 확정 도착 경로 동형, 문구만 분리):
1. 통지 문장을 먼저 조립(기존 주석 계약: `stop()`이 dest·statusText를 지운다).
2. `playTone(.nearby)` — 도착 종. 배경 가청은 기존 `endSession` 잔여 대기 규칙이 보장.
3. `stop()` 후 `arrivalDest` 대입 — 시트를 도착 종료 화면으로 유지(기존 presentation 바인딩 재사용).
4. `guide.arrivedPresumed` 낭독, **`.high`** — "{목적지} 부근에서 위치 신호가 약해져 도착한 것으로 보고 안내를 종료했습니다." 자동 종료는 이 통지가 유일한 증거다(성공 통지 `.high` 규칙). 백그라운드 음성 억제 시 기존 전경 복귀 상환 메커니즘을 태운다.
5. 도착 시트 헤딩도 추정 전용 문구(`ios.beacon.arrivedPresumedHeading`) — 확정 도착과 뭉개지 않는다(3-state 정직성).

리셋(오탐 방어): usable fix가 오면 `.noFix` 축이 리셋되고, 그 fix가 10m 이상 변위를 보이면 `.stationary` 축도 리셋된다(아직 걷는 중). 걸어서 멀어지는 경우도 변위가 리셋을 만들므로 세션은 살아서 farther 톤을 계속 낸다.

## 5. 불변식

- 자동 종료 경로는 정확히 두 곳: 확정 도착(반경 15m)과 추정 도착(이 설계). 그 외 어디서도 세션을 소리 없이 끝내지 않는다.
- 추정 도착은 최종 접근 국면에서만 가능하다(판정 함수 구조가 강제).
- 추정 도착 발동은 세션당 최대 1회다(`stop()`이 상태를 소거하므로 재트리거 경로가 없다 — 구현에서 이 성질을 검증한다).
- 확정·추정 도착의 낭독·헤딩 문구는 다르다. 추정 문구는 "신호가 약해져 ~ 도착한 것으로 보고"라는 근거·한계를 담는다(뻔한 꼬리 아님 — 새 정보).
- 수단 무관(walk·car 공통): 자동차도 주차장 진입이 같은 모양이다. 임박 층 같은 walk 전용 분기를 만들지 않는다.

## 6. 검증

- **단위(공유 fixture, 웹·Kit 동조)**: 両모양 발동, 경계값(±1초), `inFinalApproach=false` 상시 none, usable fix·변위 리셋, 리셋 후 재경과 발동.
- **리플레이**: 2026-08-13 로그 17:03 세션 — `finalApproachEnter` 이후 무 usable fix 3분 경과 시점에 `.noFix` 발동을 리플레이 테스트로 못 박는다(기존 `course-derivation-replay.test.ts` 계열).
- **변이 주입**: 판정 순서 1(국면 게이트)을 제거한 변이가 테스트에 잡히는지 확인한다.
- **실보행 게이트**: 다음 귀가에서 실기기 판정 — 실내 진입 ~3분 뒤 도착 종+낭독+세션 종료. 상수 3종은 이 판정 전까지 잠정값이다.

## 7. 범위 제외 (백로그 등록)

- **경로 중간 무진행 리마인더**: 위원장 판정으로 백로그(2026-08-13). 백그라운드 음성 억제 정책 때문에 도달 채널이 로컬 알림(권한 요청 신설)이어야 하는데, 그 권한·UX 판정을 포함해 별도 설계가 필요하다. 경로 중간 이탈은 offRoute 경고음이 이미 시끄럽게 우는 점도 긴급도를 낮춘다.
- **대중교통 세션**: 지하 구간 fix 부재가 정상이라 이 판정을 재사용할 수 없다. 별도 축(예: 하차 후 무진행)이 필요.
- **웹 UI 배선**: 판정 함수 미러+공유 fixture까지만 이번에. 화면 배선은 PORTS 후속(iOS 먼저·웹 후속 관례).
- **최종 접근 진입 전 fix 두절 케이스**(목적지 200m 전 GPS 사망 후 도보 귀가): 자동 종료 없음 — 의도적 수용. 리마인더 축이 열리면 그쪽이 덮는다.

## 8. 설계 리뷰 판정

①새 판정 계층 신설(세션 수명을 끝내는 판정) + ④실보행 안내 안전 크리티컬 축 해당 → 구현 착수 전 codex adversarial-review 실행. 결과는 이 섹션에 기록한다.
