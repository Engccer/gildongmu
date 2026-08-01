# iOS 목적지 거리 추적 이식 + 길찾기 초점 점검 설계 (2026-08-01)

> 백로그 B1의 iOS 판. 웹 구현(`src/lib/beacon.ts` 외)은 2026-07-04부터 prod에 있으나 실보행 검증이 안 된 상태였고, **주 사용처가 컴퓨터라 웹에서는 실보행 자체가 불가능**하다는 위원장 판단(2026-08-01)으로 "웹에서 가치 검증 먼저"라는 종전 게이트가 무효화됐다. iOS 이식이 곧 가치 검증 경로다.
>
> **개정 이력**: 초안을 적대적 검토(별도 컨텍스트)에 걸어 Critical 7 · Important 14 · Minor 6을 받았고, 그중 기각 2건(§9)을 빼고 전부 반영해 전면 개정했다. 초안의 치명적 오판은 **"웹 1:1 포팅"이라는 전제**였다. 플랫폼 계약이 갈리는 지점이 넷(음수 accuracy · watchPosition timeout · 캐시 첫 fix · 오디오 세션)이고, 웹의 결함 이력이 100% 오케스트레이터 계층인데 초안의 테스트 계획은 리듀서에만 두꺼웠다.

## 1. 목표

경로 조회를 마친 사용자가 **목적지에 가까워지는지 멀어지는지를 걸으면서 소리로** 알 수 있게 한다. 판정 단위는 실보행이고 자동 테스트로 대체 불가하다.

성과 지표(빌드 전 명명): 위원장이 실제 목적지까지 걸으면서 **화면을 보지 않고** 방향이 맞는지 판단할 수 있는가. 판단이 안 되면 이 기능은 실패이고 폐기 대상이다(그때 iOS `beacon.*` 11키도 함께 제거).

⚠ 이 지표는 **오염되기 쉽다**. 첫 fix가 캐시라 수백 m 튀면 기능이 아니라 첫 fix가 틀린 것인데 폐기 판정이 날 수 있다. §4.4가 그 방어다.

## 2. 범위 밖 (의도적 비목표)

- **턴바이턴 내비게이션이 아니다.** 직선거리 기준 방향 감각만 준다. 실주행·실보행 경로 안내는 네이티브 앱 위임(`nmap://`·`kakaomap://`)이 정본이다.
- **백그라운드 추적 없음** (위원장 결정, §8.1).
- **나침반·방위 안내 없음.** 기기 heading은 보행 중 신뢰도가 낮고 웹 구현에도 없다.
- **i18n 신규 작업 없음.** `beacon.*` 11키가 6개 로케일에 이미 미러돼 있다(`%1$@` 포맷 실측 확인). 단 §7.3의 권한 목적 문자열 한 줄은 예외다.

## 3. 아키텍처

```
GildongmuKit (순수·테스트 대상)              앱 (I/O만)
  Geo.swift          haversineMeters
  Beacon.swift       beaconStep          ◀── BeaconModel (얇은 껍데기)
  BeaconTones.swift  톤 시퀀스 데이터     ◀── BeaconTonePlayer (AVAudioEngine)
  BeaconGate.swift   톤 throttle·통지 판정 ◀── LocationService (연속 모드 신설)
                                              │
                                         DirectionsTabView (UI·소유자)
```

**계층 경계 원칙**: 이 기능의 실제 결함 이력은 **100% 오케스트레이터 계층**이다(웹 2026-07-04 감사 2건: Wake Lock 참조 불안정으로 즉시 `clearWatch`, throttle 창 공유로 추세 톤 소실. 리듀서 결함 0건). 그런데 **앱 타깃 테스트 번들이 존재하지 않는다**(Kit 테스트만, 실측 확인). 따라서 판정 로직을 앱에 두면 구조적으로 테스트가 불가능하다.

→ **결정: throttle·통지 억제 판정까지 Kit 순수 함수로 내린다**(`NearbyLoadCore` 선례 동형). `BeaconModel`은 상태 보관과 I/O 배선만 하는 껍데기가 된다.

### 3.1 Kit: `Geo.swift`

`haversineMeters(lat1:lng1:lat2:lng2:)`. 웹 `src/lib/geo.ts`(R=6,371,000 구면)의 포팅.

⚠ **`CLLocation.distance(from:)`를 쓰지 않는다.** 쓰면 Kit이 CoreLocation에 의존해 "실기기 없이 테스트, dodo 이식 시 그대로 이동"이라는 Kit 존재 이유가 무너지고, 타원체 거리라 웹과 값이 미세하게 갈려 경계값 케이스가 어긋난다.

### 3.2 Kit: `Beacon.swift`

웹 `beacon.ts`의 포팅. `BeaconFix`·`BeaconDest`·`BeaconState`·`BeaconAnnounce`·`Trend`·`AnnounceKind`와 상수 4종(`maxUsableAccuracy` 100, `baseDeadBand` 15, `arrivalBase` 20, `speakInterval` 50), 순수 함수 `beaconStep(state:fix:dest:)`.

**리듀서가 지키는 것**:
- accuracy로 데드밴드를 스케일한다(`max(15, accuracy)`). **이 스케일링이 이 기능의 전부**이며 빠지면 걷는 내내 추세가 번갈아 뒤집힌다.
- 도착 존은 래치 + 히스테리시스. 해제는 `threshold + deadBand`를 넘어야 한다.
- 발화는 추세 flip 또는 50m 마일스톤에서만.

**웹과 의도적으로 갈리는 단 한 지점 (C2)**: 약신호 판정을 `!isFinite(accuracy) || accuracy > 100`에서 **`!(accuracy > 0) || accuracy > 100`**으로 넓힌다. `CLLocation.horizontalAccuracy`는 **음수로 "좌표 무효"를 신호**하는데, 웹 `GeolocationCoordinates.accuracy`는 항상 양수라 원본에 그 분기가 없다. -1이 통과하면 `deadBand = max(15, -1) = 15`가 되어 **쓰레기 좌표가 앵커가 되고 추세를 뒤집는다**(실내·터널·지하 진입에서 발생).

⚠ **웹도 같이 고친다.** 웹 입력에는 음수가 오지 않아 동작은 불변이지만, 가드가 갈리면 "두 플랫폼 단일 정본"이 거짓이 된다. 웹에 음수 accuracy → `weak` 테스트를 추가한다.

### 3.3 Kit: `BeaconTones.swift`

웹 `beacon-tones.ts` 미러 + 웹 `useBeaconSound`의 시작·정지 톤.

| 종류 | 시퀀스 | 의미 |
|---|---|---|
| closer | 660 → 990 | 상승 = 가까워짐 |
| farther | 990 → 660 | 하강 = 멀어짐 |
| nearby | 880 → 1320 | 밝은 더블 = 도착 |
| tick | 330 단음 | 추적 중 하트비트 |
| start / stop | 웹 `useBeaconSound` 값 | 시작·정지 확인음 |

**음높이 방향이 정보다.** 이 표가 두 플랫폼의 단일 정본이다.

⚠ **드리프트 가드는 상수 단언이 아니라 교차 파일 대조여야 한다**(I11). Swift 상수를 Swift 리터럴과 비교하면 웹이 바뀌어도 아무것도 실패하지 않는다. 웹 Vitest에서 `BeaconTones.swift`를 읽어 주파수·순서를 대조한다(CLI/MCP 카탈로그 byte 해시 드리프트 테스트 선례).

### 3.4 Kit: `BeaconGate.swift` (신설, 초안에 없던 계층)

톤을 낼지·통지를 낼지 판정하는 순수 함수. **시각을 인자로 받으므로 실시간 대기 없이 테스트된다.**

```
struct BeaconGateState { lastTrendToneAt, lastTickAt: Double?; nearbyToneDone: Bool; previousKind: AnnounceKind? }
beaconGateStep(state, announce, now) -> (state, tone: BeaconTone?, notice: BeaconNotice?)
```

판정 규칙:
- **추세 톤 2초 창, tick 3초 창은 서로 독립**이다. 창을 공유하면 데드밴드 안 미세 흔들림이 잦을 때 tick이 예산을 잠식해 정작 핵심인 추세 톤이 소실된다(웹에서 실제로 난 회귀).
- **`nearby` 톤은 존 진입 1회만 (C1).** 초안의 치명적 오판이 여기였다. 리듀서의 래치는 `speak`(음성)만 억제하고 톤은 매 fix 흐른다. 웹 원본은 `nearby`를 **throttle 없이** 재생하므로, 도착해서 서 있는 동안 가장 밝은 톤이 GPS 주기로 무한 반복된다. 시각장애 사용자가 도착해 주변을 탐색하려는 바로 그 순간에 가장 시끄럽다. 존을 벗어났다 재진입하면 다시 1회.
- **`weak` 통지는 비-weak → weak 전이에서만 1회 (I8).** 초안 §4.4는 "발화는 리듀서 `speak`가 정한다"고 썼는데 **틀렸다**. 웹에서 `weak`은 항상 `speak: false`이고 UI가 별도 분기로 통지를 낸다. 초안대로 구현하면 신호 약함이 영영 통지되지 않는다.
- `notice`는 문자열이 아니라 **열거값 + 미터**로 반환한다(Kit은 로컬라이즈하지 않는다). 앱이 `appLocalized`로 매핑한다.
- **`nearby` 통지의 미터는 distance가 아니라 accuracy다 (I9).** 문구가 "목적지 근처 (약 ±%1$@m)"로 **오차 반경**을 말한다. distance를 넣으면 의미가 뒤집힌다. 반올림은 `Math.round` 동형.

### 3.5 앱: `LocationService` 연속 모드

기존 싱글턴에 연속 모드를 더한다. **별도 `CLLocationManager`를 만들지 않는다**(매니저 단일 소유 불변식).

```
startBeaconUpdates(onFix:onError:onAuthChange:)   // 싱크 3종(초안은 onFix 하나뿐이었다)
stopBeaconUpdates()
```

- **fix 페이로드에 `timestamp`와 `horizontalAccuracy`를 포함한다 (C7).** 초안은 `(lat,lng,accuracy)`만 실어 캐시 판정 수단을 버렸다.
- **오류·권한 변경 싱크 필수 (C4).** 기존 `didFailWithError`·`locationManagerDidChangeAuthorization`은 one-shot continuation만 resume하므로 추적 중에는 **no-op이 되어 오류가 소실**된다. 걷는 중 권한을 회수당하면 라벨은 "중지"(추적 중)인데 소리만 사라진다.
- **매니저 설정 (I3)**: `pausesLocationUpdatesAutomatically = false`(기본 true라 서 있으면 시스템이 자동 정지 → tick 소실 → "죽었나"와 구분 불가), `activityType = .fitness`, `desiredAccuracy = kCLLocationAccuracyBest`, `distanceFilter = kCLDistanceFilterNone`(데드밴드가 이미 필터라 이중 필터링 금지).
- **추적 중 one-shot 규칙 (I4)**: `currentCoordinate()`가 추적 중에 호출되면 **`requestLocation()`을 부르지 않고 최신 스트림 fix로 즉시 resume**한다. 근거 둘. ①`:65`가 one-shot마다 `desiredAccuracy`를 재대입하므로 그대로 두면 추적 중 정확도가 100m로 깎이고 복원되지 않는다(도달 경로 실재: 재조회, 시트의 "현재 위치" 재선택). ②`startUpdatingLocation()` 활성 중 `requestLocation()`의 안전성이 문서로 보장되지 않는다(1회 전달 후 스스로 정지시키는 의미론이라 스트림을 죽일 수 있다). 이 규칙이 두 위험을 한 번에 제거한다.
- **스트림 fix가 `lastCoordinate`를 갱신한다 (I5).** 안 하면 500m 걷고 조회했을 때 출발 전 캐시 좌표로 경로가 계산된다. "현재 위치는 공유 스토어 1곳" 불변식은 호출 경로만이 아니라 **값의 단일성**까지를 뜻한다.
- 싱크는 `[weak]`로 잡는다 (M5). 싱크는 1개만 유지하며 두 번째 소비자가 생기면 덮어쓴다(현재 YAGNI 수용).

### 3.6 앱: `BeaconTonePlayer`

`AVAudioEngine` + `AVAudioPlayerNode`로 사인파 버퍼를 합성한다. Kit 톤 테이블을 구동하므로 주파수 정본이 하나다.

**대안 기각**: mp3 4개 번들은 웹과 따로 렌더돼 드리프트하고 주파수가 데이터로 안 남는다. 시스템 사운드는 음높이 방향을 표현할 수 없다.

**오디오 세션 (I1)**: 초안의 "선례 상속"을 폐기한다. `SoundPlayer`(채팅 효과음)는 **가끔 한 번**이고 비콘은 **보행 내내 2~3초마다**라 사용 프로파일이 다르다. 기본 `.soloAmbient`는 타 앱 오디오를 정지시켜 음악·팟캐스트를 들으며 걷는 사용자의 재생을 첫 tick에 끊는다. 반대로 그 세션에 TTS를 썼다면 `.playback`이 남아 무음 스위치를 무시한다. **유일한 연속 피드백 채널의 동작이 "그 세션에 TTS를 썼는지"에 좌우되면 안 된다.**

→ 톤 재생 직전 `.ambient` + `.mixWithOthers`를 명시 선언한다.

**인터럽션 복구 (I1)**: repo 전체에 인터럽션 처리가 0건이다. 전화 한 통이나 `SpeechService.teardown()`의 `setActive(false)`가 엔진을 멈추면 톤이 영영 사라진다. `AVAudioSession.interruptionNotification`과 엔진 configuration change를 관찰해 재시작하고, **재시작 실패는 무음이 아니라 통지 대상**이다(초안의 "조용히 무음 강등"은 `hold`·tick에 통지가 없다는 사실을 놓쳤다. 톤이 죽으면 추세 flip까지 아무것도 안 들린다).

**받아쓰기 중 톤 억제 (C6)**: 목적지 검색 시트에 `SpeechService` + `HoldDictationButton`이 있고, §5.5에 따라 시트 표시 중에도 추적은 계속된다. 헌장 §6의 "녹음 중 발화 0"은 이 repo가 세 번 데인 계열이고 스피커→마이크 오염은 실측된 경로다. `SpeechService`가 청취 중이면 **톤 재생을 건너뛴다**(추적·통지는 유지).

### 3.7 앱: `BeaconModel` (얇은 껍데기)

`@Observable @MainActor`. 상태 보관 + 싱크 배선 + Kit 위임만 한다.

- 매 fix → **신선도 게이트**(§4.4) → `beaconStep` → `beaconGateStep` → 톤·통지 라우팅.
- 시작: 권한 확인(§4.3) → `isIdleTimerDisabled = true` → 시작 톤 → `startBeaconUpdates`.
- 중지: `stopBeaconUpdates` → idle timer 해제 → 정지 톤. **idle timer 해제는 `defer` 성격으로 보장한다**(전역 가변 상태라 누수되면 화면이 영영 안 꺼진다).
- 상태: `idle` · `tracking` · `denied` · `unavailable`. 셋 이상으로 가르는 이유는 3-state 불변식이다.

## 4. 침묵 방지 (초안이 통째로 빠뜨린 절)

시각장애 사용자에게 **"추적 중인데 안 움직이는 것"과 "죽은 것"은 구분 불가능**하다. 초안에는 무한 침묵으로 가는 경로가 넷 있었다.

### 4.1 무-fix 타임아웃 (C3a)

웹은 `watchPosition`에 `timeout: 15_000`을 걸어 초과 시 `weak`을 통지한다. `startUpdatingLocation()`에는 대응 개념이 **없다**. → 시작 후 15초 내 첫 fix가 없으면 `weak` 통지. 이후에도 30초 이상 fix가 끊기면 재통지.

### 4.2 위치 서비스·권한 3-state (C3b)

**`.notDetermined`인 사용자가 이 버튼에 도달할 수 있다**. §5.2의 노출 조건은 출발지·도착지가 둘 다 `.place`인 조회로도 충족되는데, 그 경로는 측위를 하지 않는다(`performQuery`는 `from == .current || to == .current`일 때만 측위, 실측 확인).

→ 시작 시 권한 상태로 가른다:
- `.notDetermined` → `requestWhenInUseAuthorization()`(팝업 자체가 신호), 허용되면 시작
- `.denied`·`.restricted` → `denied` 상태 + `beacon.denied` 통지, 추적 시작 안 함
- 기기 위치 서비스 off → `unavailable` 상태 + 별도 문구

### 4.3 추적 중 상태 변화 (C4)

권한 회수·위치 오류가 `onError`·`onAuthChange`로 도달해 상태를 바꾸고 통지한다. §3.5의 싱크 3종이 이 요구에서 나왔다.

### 4.4 첫 fix 신선도 게이트 (C7)

`startUpdatingLocation()`의 첫 콜백은 흔히 **캐시 위치**다. 이건 이미 알려진 미적용 후속이고(`PROGRESS.md`: "first-fix 게이팅 ... 실보행 스모크 선행으로 판정"), **그 유예 근거가 이 마일스톤으로 소멸했다**. 이 설계가 바로 그 실보행 판정 경로다(§1).

→ fix 수용 조건: `horizontalAccuracy > 0` **그리고** `timestamp`가 5초 이내. 불합격 fix는 앵커·추세에 반영하지 않는다(`weak`과 같은 취급).

근거: 앵커가 수백 m 어긋난 채 잡히면 진짜 GPS fix가 오는 순간 거짓 "가까워지는 중/멀어지는 중"이 발화된다. §1의 성과 지표가 **기능이 아니라 첫 fix 때문에** 오염되고, §1은 "판단이 안 되면 폐기"라 못 박았으므로 되돌리기 비싸다.

## 5. UI 계약

### 5.1 배치

`DirectionsTabView`의 결과 영역, **수단 섹션들보다 앞**에 `Section`을 둔다.

**근거**: 도보 섹션은 인라인 전개라 천호역 실측 수백 행이다. 뒤에 두면 선형 주파 비용이 몇 행에서 수백 행으로 뒤집힌다. 조회 완료 시 포커스가 첫 성공 수단 heading으로 가므로 거기서 **heading 로터 1회**(선형 스와이프로는 3회)면 닿는다.

### 5.2 노출 조건

도착지가 `.place(label:lat:lng:)`이고 조회를 한 번 마쳤을 때만 렌더한다. `.current`면 "현재 위치까지의 거리"라 무의미하다.

⚠ **수단 조회가 전부 실패해도 렌더한다.** 목적지 좌표는 확정돼 있고, 경로를 못 찾은 상황일수록 방향 감각이 더 필요하다. 노출 조건은 **경로 성공 여부가 아니라 목적지 확정 여부**다.

### 5.3 구성

```
Section(header: "목적지 거리 추적, {목적지 이름}")     ← I6
  [버튼]   거리 추적 시작  ↔  거리 추적 중지
  [텍스트] 상태 1줄 (거리·추세 또는 신호 약함)          ← I2, 추적 중에만
  [텍스트] 직선거리 기준입니다…                        (추적 전에만)
  [텍스트] 화면을 켜고 손에 든 채…                     (추적 중에만)
```

**목적지 이름을 헤더에 흡수한다 (I6)**: §5.5가 화면 이탈 시 중지하는 근거로 "출처 없는 소리는 SR 사용자에게 해석 불가"를 드는데, 초안 UI에는 정작 **무엇을 추적 중인지가 없었다**. 웹은 장소 상세 안이라 바로 위 `h2`가 장소명이었고, 길찾기 결과로 옮기면 그 맥락이 사라진다. "한 줄 = 한 객체"에 맞게 쉼표 결합.

**가시 상태 텍스트 1줄 (I2)**: 웹에는 **눈에 보이는** live region이 있어 거리·상태가 항상 화면에 있다. 초안엔 없어서 VO를 끈 사람이 버튼을 누르면 라벨 변화 외에 화면 변화가 0이었다. **이 앱은 정확히 같은 구조로 2.1(a) 반려당한 전력이 있다**(홀드 버튼을 짧게 탭한 심사자에게 무반응으로 보임 → 3초 가시 안내로 대응). 이건 잉여가 아니라 완결성이다. VO 사용자에겐 포커스 시에만 읽히므로 통지와 역할이 겹치지 않는다.

### 5.4 접근성 계약

- **사용자가 조작한 전이**: 버튼 라벨 전환(`beacon.start` ↔ `beacon.stop`)이 상태 신호다. 별도 통지를 겹치지 않는다.
- **사용자가 유발하지 않은 전이는 통지한다 (I7).** 초안은 이 비대칭을 구분하지 않았다. 라벨 전환이 신호가 되는 것은 **그 컨트롤을 조작했을 때**뿐인데(헌장 §5), 자동 중지 시 포커스는 다른 곳에 있으므로 신호가 0이 된다.
- **포커스는 시작·중지 버튼에 유지**한다. `disabled` 금지(포커스가 body로 떨어진다). 재진입 차단은 핸들러 가드로.
- 거리 안내는 polite `AccessibilityNotification.Announcement`, 단일 채널.
- **한 줄 = 한 접근성 객체**: 상태 텍스트는 단일 `Text`. 미터는 `%1$@` 포맷이라 `String(meters)`로 넘긴다(Int를 그대로 주면 포맷이 깨진다).
- 섹션 header에 heading trait.

### 5.5 생명주기

- **`.onDisappear`는 화면 수준에 붙인다 (C5).** 기존 `List`의 `.onDisappear { model.cancel() }`와 같은 지점이다. ⚠ **행 수준 부착 금지**: `List`는 lazy라 비콘 행이 스크롤로 뷰포트를 벗어나면 발동한다. §5.1이 스스로 근거로 든 "도보 섹션 수백 행"이 그 조건이고, **걸으면서 도보 안내를 훑는 가장 자연스러운 행동이 추적을 죽인다**. `BeaconModel`의 소유자는 `DirectionsTabView`(`@State`)다.
- 검색 시트 표시에서는 발동하지 않는다(시트는 아래 화면을 사라지게 하지 않는다). 그래서 §3.6의 받아쓰기 톤 억제가 필요하다.
- **중지 조건은 `resultsRevision`이 아니라 목적지 좌표 변화다 (I7).** 목적지는 `setEndpoint`로도 바뀌고 그건 revision을 올리지 않는다. revision으로 잡으면 그 사이 구간에서 옛 목적지를 추적하는 창이 생긴다.
- **앱 생명주기 (I12)**: `.background` 진입 시 추적 일시정지 + 앵커 무효화 + idle timer 해제. `.active` 복귀 시 첫 fix로 앵커 재설정(통지 없이). 10분 초과 유휴 리셋(`IdleReset`)으로 세션이 재생성되면 idle timer가 확실히 해제되는지 보장한다.

**트레이드오프 기록**: 화면을 떠나면 추적이 끊긴다. 반대안(앱 전경인 동안 유지)은 화면을 떠난 뒤에도 톤이 나서 무엇을 추적 중인지 근거가 없는 상태를 만든다. SR 사용자에게 출처 없는 소리는 해석 불가라 끊기는 쪽을 택한다.

## 6. 테스트 계획

**초안의 계획은 실행 불가능했다.** 앱 타깃 테스트 번들이 없어 `LocationService`·`BeaconModel` 행을 돌릴 수 없었고, 리듀서에 추가하겠다던 3종은 웹 `beacon.test.ts`에 이미 전부 있었다. 위험 지대(오케스트레이터)는 그대로 비어 있었다. §3.4의 Kit 이관이 이 문제를 푼다.

| 대상 | 계층 | 방법 |
|---|---|---|
| `haversineMeters` | Kit | 웹 값과 대조(경계값 포함) |
| `beaconStep` | Kit | 웹 케이스 이식 + **음수 accuracy → weak**(C2 신규) |
| `beaconGateStep` | Kit | **시각 주입**으로 추세·tick 독립 창, nearby 1회 래치, weak 전이 억제 |
| 톤 테이블 | 웹 Vitest | **Swift 파일을 읽어 교차 대조**(상수 단언은 드리프트를 못 잡는다) |
| 신선도 게이트 | Kit | timestamp·음수 accuracy 불합격 fix가 앵커를 안 건드리는지 |
| UI | 시뮬 | `snapshot-ui`로 섹션·버튼 라벨 회귀 탐지 |
| **실보행** | **위원장** | **자동 테스트로 대체 불가하며 이 기능의 유일한 진짜 판정** |

**변이 주입으로 검출력을 실측한다**: 데드밴드 제거 · 래치 제거 · **throttle 창 공유**(실제로 났던 회귀) · nearby 래치 제거 · 신선도 게이트 제거. 초안에서는 "throttle 창 공유" 변이를 주입할 자리가 없었다.

## 7. 남는 위험 (설계로 못 닫고 실기기에서 확인)

1. **`requestLocation()` + 활성 스트림 조합**: §3.5의 규칙으로 회피했으므로 이 조합을 만들지 않는다. 만약 다른 경로로 발생하면 스트림이 죽을 수 있다.
2. **`horizontalAccuracy`의 신뢰 수준**: 웹 `accuracy`는 95% 신뢰 반경이고 Apple은 신뢰 수준을 명시하지 않는다. 실무상 같을 가능성이 높아 임계값 4종(100/15/20/50)을 재보정하지 않는다. 실보행에서 데드밴드가 과하거나 부족하면 **이 축을 먼저 의심한다.**
3. **권한 목적 문자열 (M2)**: `NSLocationWhenInUseUsageDescription`이 "가까운 …을 찾기 위해"로 **지속 추적을 설명하지 않는다**. 5.1.1 심사 대상이라 한 줄 확장한다(6로케일). 개인정보 3자 갱신은 여전히 불필요하다.

## 8. 결정 기록

### 8.1 전경 전용 (위원장 결정 2026-08-01)

백그라운드 위치는 `UIBackgroundModes` + "항상 허용" 권한이 필요하고 App Review 소명과 개인정보 3자(웹 privacy 카피·`PrivacyInfo.xcprivacy`·ASC 영양 라벨) 동시 갱신을 부른다. 1.2 심사 대기 중이라 다음 제출에 그 부담이 얹힌다. 전경 전용으로 실보행해 보고 주머니 사용이 꼭 필요하면 그때 승격한다.

**개인정보 3자 일치: 갱신 불필요.** 새 데이터 유형 없음(`PrivacyInfo.xcprivacy`에 PreciseLocation/AppFunctionality 이미 선언), 새 제3자 없음(기기 안 계산, 서버 전송 0), 권한도 기존 When In Use 그대로다.

### 8.2 기존 i18n 문구가 이미 이 계약을 말한다

`beacon.screenHint` = "화면을 켜고 손에 든 채 사용하세요. 화면이 꺼지면 안내가 멈춥니다." 웹 문구가 전경 전용 계약과 정확히 일치해 카피 변경이 없다.

## 9. 검토 지적 중 기각한 것

- **진입점을 장소 상세에도 두자 (I14)**: 기각. 근거는 오프라인 상황에서 비콘이 유일하게 살아 있는 안내라는 것인데, 목적지는 이 탭에서만 정해지고 §5.2가 **조회 전멸 시에도 렌더**하므로 실제 공백은 "한 번도 조회 못 한 경우"뿐이다. 반대로 진입점을 둘로 늘리는 것은 2026-07-30에 **의도적으로 일원화한 것을 되돌리는** 일이다(장소 상세의 단일 수단 브리핑 진입점 제거, 재도입 금지 판정). 위원장이 "길찾기 탭이 더 자연스럽다"고 지정한 것과도 어긋난다.
- **§7.1 초점 가설 1을 먼저 고치자**: 기각(M3 수용). 현행 트리거는 이미 revision이고, 이 repo의 자체 관찰은 반대다(`@AccessibilityFocusState`는 양방향이라 VO가 포커스를 옮기면 시스템이 nil을 되쓰므로 같은 값 재대입도 실변화). 먼저 "고치면" 이미 있는 배선을 중복시킨다. **가설 2를 우선 검증한다.**

## 10. M2: 길찾기 탭 자동 초점 점검 (M1 완료 후)

현행은 `.onChange(of: resultsRevision) { focusedModeHeading = results?.firstSuccess }`와 `.onChange(of: walkRefetchRevision) { focusedModeHeading = .walk }` 두 줄이다.

### 10.1 가설 (검증 순서)

1. **List 렌더 전 대입** (우선). `onChange`가 새 Section이 그려지기 전에 실행되면 포커스 타깃이 없어 유실된다. 채팅이 같은 계열을 지연 + 1회 재시도로 해결한 선례가 있다.
2. **검색 시트 이후 착지점 부재**. 웹은 출발지를 고르면 도착지 입력, 도착지를 고르면 조회 버튼으로 보낸다(`focusAfterResolve`). iOS엔 대응이 없다. ⚠ 다만 **iOS는 시트 dismiss 시 제시 요소로 포커스를 되돌리는 것이 기본**이라 웹과 같은 문제가 아닐 수 있다. **재현 실패 시 기각이 정답**이고 웹 계약을 기계적으로 이식하지 않는다.
3. **같은 값 재대입 no-op** (가능성 낮음, §9 참조). 앞의 둘이 기각됐을 때만 본다.

### 10.2 판정

**실기기 VoiceOver가 정본이다.** 시뮬 접근성 트리는 낭독과 1:1이 아니라 회귀 탐지 신호로만 쓴다. 가설별로 재현 → 수정 → 재현 불가 확인 순으로 닫고, **재현되지 않는 가설은 기각을 기록에 남긴다**(오탐도 기록 대상).

수정 시 **비대칭에 주의**: 조회 완료의 포커스 이동(헌장 §1 "동적 콘텐츠 등장 시 이동")과 시트 복귀의 포커스 착지(헌장 §5 "경계에서 이탈 방지")는 방향이 다른 규칙이다. 전자는 새 콘텐츠로 옮기고 후자는 다음 행동 지점에 놓는다.

## 11. 게이트

Kit 테스트 → 웹 테스트(톤 드리프트·음수 accuracy) → 앱 빌드 → 시뮬 UI 실측 → 별도 컨텍스트 리뷰 → 커밋·push → 실기기 배포 → **위원장 실보행**.

리뷰어에게는 요구사항(이 spec)과 산출물(diff)만 준다. 세션 히스토리·생성 의도는 넘기지 않는다.
