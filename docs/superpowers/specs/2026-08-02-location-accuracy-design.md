# iOS 현재 위치 취득 정확도 설계 (2026-08-02)

> 백로그 A3. 조사 근거는 `docs/RESEARCH-2026-08-02-realtime-walk-navigation.md` §9. 실시간 안내(E4)와 독립이며 그 착수 여부와 무관하게 성립한다.

## 1. 문제

`LocationService.currentCoordinate(force:)`가 "내 주변" 전 도메인·길찾기 출발지·채팅 위치의 단일 좌표 소스인데, 네 겹으로 부정확하다.

| # | 현행 | Apple 문서가 말하는 귀결 |
|---|---|---|
| ① | 최초 취득 `desiredAccuracy = kCLLocationAccuracyHundredMeters` | `requestLocation()`은 목표에 못 미치면 *"delivers a **less accurate** location value rather than reporting an error"*. 목표는 하한이 아니다 |
| ② | 첫 콜백을 accuracy·timestamp 검사 없이 채택 | *"the location manager object **sometimes returns cached events**"*. Apple 예제는 15초 신선도 검사를 권하며 *"If you are implementing a navigation app, you might want to lower the threshold"* |
| ③ | 캐시에 나이가 없어 수명 무한 | 세션 내내 옛 좌표 재사용 |
| ④ | `accuracyAuthorization` 미검사 | reduced면 좌표가 *"usually within **1–20 kilometers**"*이고 **`desiredAccuracy` 변경이 무효** |

**왜 심각한가**: `horizontalAccuracy`는 2D RMS라 그 반경이 참값을 담을 확률이 63~68%다(Apple 엔지니어 답변). 100m는 "100m 안"이 아니라 **3분의 1 확률로 100m 밖**이다.

**실증**: 같은 자리에서 100m 어긋나면 1순위 정류소가 바뀐다(길동역1번출구 188m → 천동초교입구사거리 114m, 전자는 3위 밖).

⚠ **비콘 경로에는 이미 신선도 게이트가 있다**(`2026-08-01-ios-distance-beacon-design.md` §4.4). 같은 저장소 안에서 단발 경로만 무방비라 **계약이 갈려 있는 상태**이고, 이 설계는 그 갈림을 닫는 것이다.

## 2. 범위 밖

- **`kCLLocationAccuracyBestForNavigation` 도입 안 함.** Apple이 *"use this level of accuracy only while the device is plugged in"*이라 상시 사용을 권하지 않는다.
- **결과 항목별 정확도 표기 안 함.** "내 주변" 각 항목에 오차를 병기하는 것은 별개 축이고, 지금 필요한 것은 좌표를 더 좋게 만드는 것이다.
- **백그라운드 위치 무관.**

## 3. 채택 설계

### 3.1 취득 절차

```
currentCoordinate(force:timeout:ttl:acceptAccuracy:)
  1. 비콘 추적 중 → 최신 스트림 fix 반환                (기존 유지)
  2. !force 이고 캐시를 재사용할 수 있으면 반환          (신규: 나이 AND 정확도 판정)
  3. 권한 확인 → denied/restricted면 throw               (기존)
  4. accuracyAuthorization 확인 → reduced면 throw        (신규)
  5. startUpdatingLocation으로 fix를 받으며 게이트 통과분을 채택   (신규)
     통과 조건: accuracy > 0 && accuracy <= 30m && 나이 <= 10초
     타임아웃 → 그때까지의 최선 fix 채택, 하나도 없으면 throw .unavailable
  6. 단발 업데이트 종료 (⚠ 비콘이 그 사이 시작됐으면 매니저를 멈추지 않는다)
```

**세 값을 한 타입으로 묶는다.** 캐시가 좌표만 들면 읽는 쪽이 그것이 40m짜리인지 2km짜리인지 알 수 없어, 게이트가 거부한 좌표가 캐시를 통해 "현재 위치"로 승격된다. `StoredFix(coord, accuracy, fixedAt)`가 후보 선택·캐시 쓰기·캐시 읽기에서 같은 값을 쓰게 만든다.

⚠ **시각은 fix의 `timestamp`이지 수신 시각이 아니다.** 수신 시각으로 도장을 찍으면 나이가 최대 `acceptAge`만큼 과소평가되어 캐시 실효 수명이 늘어난다.

**타임아웃 감시에는 세대 토큰이 필요하다.** 감시 Task는 비구조 태스크라 성공한 취득의 타이머도 끝까지 잔다. 그 사이 새 취득이 시작되면 옛 타이머가 새 취득을 판정해 예산을 잘라먹고 거짓 "새로고침 실패"가 낭독된다(새로고침이 정확히 이 경로다).

**권한 팝업만 필요한 소비자는 `primeAuthorization()`을 쓴다.** 채팅 전송 전 워밍과 비콘의 `.notDetermined` 분기는 **좌표를 버린다.** 그런데 `currentCoordinate()`를 부르면 목적이 팝업인데 최대 8초 측위를 완주하고, 그 구간엔 진행 통지가 없어 무신호 침묵이 된다.

**왜 `requestLocation()`이 아니라 `startUpdatingLocation()`인가**: `requestLocation()`은 목표 미달 시 조용히 나쁜 값을 주고 스스로 멈춘다. 여러 fix를 받아 개선을 기다리는 것이 Apple 문서가 뒷받침하는 패턴이다(*"the receiver may send another notification if the hardware gathers a more accurate location reading"*).

**타임아웃에 최선값을 쓰는 이유**: 무한 대기는 침묵이고, 침묵은 시각장애 사용자에게 "고장"과 구분되지 않는다. `INTULocationManager` 관행(임계값 + 타임아웃 쌍, 초과 시 최선값 + 상태)과 같다.

### 3.2 상수와 근거

| 상수 | 값 | 근거 |
|---|---|---|
| `acceptAccuracy` | 30m | 도심 실측 평균 오차 7~13m라 대개 빠르게 충족된다. 100m는 최근접 정류소 순위를 뒤집는 것이 실측됐고 30m는 그 절반 이하 |
| `acceptAge` | 10초 | Apple 예제 15초에서 보행 이동분을 감안해 낮춤(문서가 내비 앱은 더 낮추라고 명시) |
| `timeout` | 8초 | 이보다 길면 "내 주변"이 멈춘 것처럼 느껴진다 |
| `freshTTL` | 60초 | 보행 1.2m/s로 60초면 약 72m. 100m가 순위를 뒤집었으므로 그 아래로 잡는다 |
| `softTTL` | 300초 | 검색 근접 블렌딩 전용. 순위 가중이라 정밀도 요구가 낮고, 매 검색마다 재측위하면 지연이 붙는다 |
| `softTimeout` | 2초 | 검색어를 넣고 기다리는 자리라 8초는 그대로 침묵이다. 좌표를 못 얻으면 좌표 없이 진행하는 소비자라 짧게 끊는다 |
| `storeCeiling` | 100m | **저장 상한은 수용 기준(30m)보다 느슨하다.** 스트림에는 "더 나은 것을 기다리는 창"이 없어 상한을 좁히면 정확도가 계속 30m를 넘는 구간에서 값이 낡은 채 굳는다. 다만 셀·Wi-Fi의 km급 좌표는 어떤 용도로도 위치가 아니라 여기서 막는다 |

⚠ **저장 상한과 재사용 기준이 다르므로 캐시 읽기가 나이만 봐서는 안 된다.** 나이만 보는 읽기는 게이트가 거부한 30~100m 좌표를 그대로 "현재 위치"로 승격시킨다(지하철 안 좌표가 지상에서 60초간 재사용되는 경로). 재사용은 `canReuseCachedFix`가 나이와 정확도를 함께 본다.

### 3.3 reduced accuracy는 새 상태다 (3-state 불변식)

"정확한 위치"가 꺼진 좌표는 1~20km 오차라 **"주변"이라는 주장 자체가 성립하지 않는다.** 이를 `denied`나 `unavailable`로 뭉개면 사용자는 원인을 알 수 없고, 그대로 조회하면 **있지도 않은 정류소를 안내**한다. 화면으로 확인할 수 없는 사용자에게 이는 오답보다 나쁘다.

→ Kit에 상태를 추가한다.

- `NearbyLocationError.reducedAccuracy`
- `NearbyLoadPhase.reducedAccuracy`
- 전이는 `denied`와 동형(loaded에서 전락하면 통지, 아니면 phase 전환)

문구는 원인과 해결을 함께 준다. `ios.common.geoReducedTitle` = "정확한 위치가 꺼져 있습니다", `ios.common.geoReducedDesc` = "설정 앱에서 길동무의 정확한 위치를 켜 주세요". 6로케일.

⚠ **꼬리 문장 금지 규칙 적용**: "다시 시도해 주세요"류를 붙이지 않는다. 설정을 켜라는 문장이 곧 조건 안내이므로 그것으로 끝낸다.

### 3.4 캐시는 버리지 않고 재사용 자격만 잃는다

`lastCoordinate`는 "직전 성공 좌표"로 **실패 시 폴백 의미가 있어 무기한 유지**한다(기존 계약). 나이·정확도는 재사용 자격 판정에만 쓰므로, 자격을 잃은 캐시는 **버려지는 것이 아니라 재취득을 시도하되 실패하면 그대로 폴백**된다. 새로고침 실패 시 데이터를 포기하지 않는 기존 원칙과 같다.

### 3.5 소비자마다 예산이 다르다

`timeout`은 "내 주변"을 기준으로 정당화된 값이라 다른 소비자에 그대로 쓰면 새 침묵을 만든다.

| 소비자 | 무엇이 필요한가 | 예산 |
|---|---|---|
| "내 주변"·길찾기 | 정확한 좌표 | `timeout` 8초 |
| 검색 근접 블렌딩 | 대략의 좌표(순위 가중) | `coordinateForRanking()`: `softTimeout` 2초, `softTTL`, 바 100m, 실패 시 저장값 폴백 |
| "현재 위치" 주소 병기 | **표시되는 좌표** | `coordinateForDisplay()`: 엄격한 바, **폴백 없음** |
| 채팅 전송 전 | 좌표(스토어 갱신이 목적) | `softTimeout` 2초 |
| 비콘 `.notDetermined` | **좌표가 아니라 권한 팝업** | `primeAuthorization()`(측위 없음) |

⚠ **"반환값을 버린다"가 "좌표가 필요 없다"를 뜻하지 않는다.** 채팅 전송 전 호출은 값을 버리지만 **부수효과로 공유 스토어를 갱신**하고 직후 `requestBody()`가 그 값을 읽는다. 이것을 `primeAuthorization()`으로 바꿨다가 이미 허용된 모든 세션에서 채팅이 좌표 없이 전송되는 회귀를 만들었고(최초 설치 세션만 우연히 동작), 리뷰가 잡았다. 호출부를 바꿀 때는 반환값이 아니라 **부수효과의 소비자**를 찾아야 한다.

⚠ **가중용과 표시용을 함수로 가른다.** 한 함수가 셋을 다 먹이면 폴백이 표시 소비자까지 닿는다: 아침에 잡은 좌표가 점심에 역지오코딩되어 "현재 위치, 〈아침에 있던 곳〉"으로 낭독된다. 거칢을 이유로 reduced를 막은 것과 **같은 판단이고 축만 다르다**(낡음). 순위는 결과 목록을 훑으면 이상함을 알 수 있지만 주소는 반증할 수단이 없다.

⚠ **두 함수 모두 권한 가드를 유지한다.** `currentCoordinate`를 직접 부르면 `.notDetermined`에서 팝업이 떠, 탭 진입만으로 권한을 묻는 회귀가 된다(계약: 권한 요청은 "내 주변" 최초 사용 시점).

⚠ **검색도 reduced 좌표를 받지 않는다.** (표시용을 분리한 뒤로는 이 금지의 원래 근거가 가중 경로에는 더 이상 해당하지 않는다. 순위는 반증 가능하므로 원리상 열 수 있으나, 열려면 `isPrecise` 저장 게이트를 우회하는 별도 경로가 필요하고 이득은 "정밀 위치를 끈 사용자의 검색 순위"로 한정된다. **현행 유지**이며, 그 손실이 실측으로 문제가 되면 이 문단부터 갱신한다.)

원래 근거는 이랬다. "순위 가중이라 대략의 좌표라도 낫다"는 논리가 여기서는 성립하지 않는다. 같은 함수의 다른 소비자(`loadCurrentAddressIfAuthorized`)가 그 좌표를 **역지오코딩해 "현재 위치, 〈주소〉"로 표시**하기 때문이다. km급 좌표로 만든 주소는 화면으로 반증할 수 없는 **거짓 위치 주장**이 되고, 그것은 순위가 나빠지는 것보다 나쁘다.

→ 정밀 위치가 꺼진 세션에서 검색은 좌표 없이 나가고(전국 정확도순) 주소 병기는 생략된다. 둘 다 정직한 축소다. **종전에는 reduced를 감지하지 못해 km급 좌표로 주소를 만들어 표시하고 있었으므로, 이 축소는 회귀가 아니라 거짓 표시의 제거다.**

## 4. ⑤ 임시 정밀 위치: 이번 범위 밖 (미착수 기록)

`NSLocationTemporaryUsageDescriptionDictionary`는 **딕셔너리**인데 이 프로젝트는 `GENERATE_INFOPLIST_FILE = YES`이고 `INFOPLIST_KEY_*`는 스칼라·배열만 받는다(실측 확인). 부분 plist를 `INFOPLIST_FILE`로 주었을 때 생성 키와 병합되는지는 **아직 실측하지 않았다.**

**이번 사이클에서는 ①~④만 닫고 ⑤는 넣지 않았다.** ⑤가 주는 것은 "설정 앱으로 보내는 대신 그 자리에서 한 번 물어보는" 편의이고, ④가 이미 원인과 해결 경로를 정직하게 알린다. 빌드 설정 구조를 바꾸는 변경이라 정확도 수정과 같은 사이클에 섞으면 회귀 원인 분리가 어려워진다.

착수할 때의 순서: 부분 plist 병합 실측 → 병합되면 reduced 감지 시 `requestTemporaryFullAccuracyAuthorization(withPurposeKey:)`를 먼저 시도하고 실패·거부일 때만 §3.3 상태로 → 병합이 안 되면 §3.3만 유지하고 그 사실을 이 절에 기록.

⚠ 완료 핸들러의 `error == nil`은 **허가를 뜻하지 않는다**(프롬프트를 띄웠다는 뜻). 결과는 `accuracyAuthorization`을 다시 읽어 판정한다.

## 5. 테스트

앱 타깃 테스트 번들이 없어 `LocationService`는 직접 테스트할 수 없다(비콘 설계에서 확인된 제약). 따라서 **판정 로직을 Kit 순수 함수로 내린다**(비콘의 `beaconGateStep` 선례 동형).

- Kit `LocationFix.swift`: `shouldAcceptFix` · `isStorableFix` · `canReuseCachedFix` · `isBetterFix` · `isCacheFresh` 순수 함수 + 테스트
- Kit `NearbyLoadCore`: `reducedAccuracy` 전이 케이스 추가(기존 스위트에 편입)
- **변이 주입으로 검출력 확인**(7종 실행, 전부 의도한 테스트가 red): 정확도 게이트 제거 · 나이 게이트 제거 · 나이 없는 캐시를 신선 처리 · 음수 accuracy 허용 · reduced를 denied로 뭉개기 · **캐시 재사용에서 정확도 검사 제거** · **저장 상한 제거**

⚠ **순수 함수 스위트의 사각지대**: 함수 각각이 옳아도 앱 타깃의 **조합**이 게이트를 우회할 수 있다(후보 선택이 나이를 안 보는 합성 결함이 실제로 났고, 리뷰가 잡았다). 앱 타깃에 테스트가 없는 한 이 축은 리뷰와 실기기가 정본이다.

## 6. 게이트

Kit 테스트 → 웹 테스트(i18n 키 일관성) → xcstrings 재생성 → iOS 빌드 → 별도 컨텍스트 리뷰 → 커밋·push → 실기기 확인(F-a 편입).

⚠ **실기기 확인 항목**: "정확한 위치"를 끈 상태에서 "내 주변"을 열었을 때 새 문구가 낭독되는가. 이는 시뮬레이터로도 재현 가능하다(설정 앱에서 토글).
