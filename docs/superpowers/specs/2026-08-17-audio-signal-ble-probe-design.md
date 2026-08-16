# 음향신호기 BLE 진단 화면 설계 (2026-08-17)

> **다음 세션 실행 대본.** 조사 근거는 `docs/research/RESEARCH-2026-08-16-audio-signal-ble-control.md`, 작업 큐는 `docs/BACKLOG.md` E20. 이 문서만 읽으면 착수할 수 있게 쓴다.
>
> ⚠ **이 마일스톤이 만드는 것은 제품이 아니라 계측기다.** 목적은 "음향신호기를 앱에서 조작한다"가 아니라 **"조작할 수 있는가에 답한다"**이다. 그 구분이 흐려지는 순간 진단 UI가 제품 UI 흉내를 내기 시작하고, 정작 필요한 원시 관측(MAC·RSSI·ACK 바이트·끊김 시각)이 빠진다.

## 1. 성과 정의 — 무엇이 참이면 성공인가

이 화면을 들고 길동 후보 지점(research §4.2)에 서서 **다음 다섯 질문에 답이 나오면** 성공이다.

| # | 질문 | 답이 나오는 방식 |
|---|---|---|
| Q1 | 그 자리에 `AHG001` 기기가 있는가 | 스캔 개수 |
| Q2 | 몇 미터에서 잡히는가 | RSSI + 등록 seed 최근접 거리 대조 |
| Q3 | 연결에 비밀번호가 걸려 있는가 | 연결 후 10초 생존 여부 |
| Q4 | 명령이 먹는가 | ACK/NAK 수신 |
| Q5 | 한 번 눌렀을 때 몇 대가 우는가 | 위원장 청취를 §7.1 기록 버튼으로 로그에 박아 ACK와 대조 |

**Q1만 답해도 E20의 착수 게이트는 열린다.** Q3~Q5는 제품 spec의 입력이라 같은 걸음에 얻으면 이득이지, 이번 성공 조건은 아니다.

⚠ **0건도 결과다.** "안 잡힘"이 나오면 그것을 로그로 남기고 화면을 지우지 않는다. 다른 지점·다른 날 재시도의 대조군이 된다.

## 2. 어디에 만드는가 — 보행 인프라 화면 (위원장 제안 채택)

`ios/Gildongmu/Nearby/WalkInfraNearbyView.swift`의 **음향신호기 섹션(`audioSection`) 아래**에 진단 섹션을 덧붙인다. 근거 셋:

1. **대조가 이미 반쪽 있다.** 이 화면은 seed 기준으로 "주변에 음향신호기 N기"와 최근접 5곳을 이미 낭독한다(`deviceCount`·`sites`). 진단이 답해야 하는 것이 정확히 **"등록돼 있다(seed) vs 지금 응답한다(BLE)"**의 대조이고, 그 왼쪽 절반이 이 화면에만 있다. 새 화면을 만들면 그 절반을 복제해야 한다.
2. **판정 도구가 판정 대상 위에 선다.** E20은 이 화면의 존폐(M4 요청 ②)를 가르는 판정이다. 제거될 뻔한 화면이 자기 존속 근거를 스스로 측정한다.
3. **제품 UI가 같은 자리다.** 조작이 확정되면 `sites` 각 행에 조작 버튼이 붙는 모습이 된다. 즉 진단을 여기 두면 **제품 전환이 화면 이동이 아니라 섹션 교체**로 끝난다.

**조건 셋(어기면 기존 화면을 망가뜨린다)**:

- **봉인**: 진단 섹션 전체를 `#if DEBUG || EXPERIMENTAL`로 감싼다. ⚠ **`#if DEBUG`만으로는 안 된다** — Experimental 구성은 DEBUG를 정의하지 않는다(`GuideDiag.swift` 주석이 같은 함정을 적고 있다).
- **기존 계약 불변**: `NearbyLoadCore` 껍데기 구조, `coverage: .none`, `nearbyFocusOnLoad`(첫 로드에만 착지), 3그룹 heading, 항목 무heading 관례를 **건드리지 않는다.** 진단은 **덧붙이는 섹션**이고 기존 섹션의 렌더 경로에 분기를 넣지 않는다.
- **웹 미러 없음**: iOS Safari에 Web Bluetooth가 없어 원천 불가다. `WalkInfraNearby.tsx`는 손대지 않는다. 이건 갭이 아니라 플랫폼 능력의 경계이므로 미러 드리프트로 계상하지 않는다.

## 3. 재사용 설계 — "그대로 재사용"이 아니라 계층 분리 (위원장 질문 2의 답)

⚠ **진단 UI를 제품에 재사용하려 하지 말 것.** 진단은 MAC 주소·RSSI·원시 바이트·수동 3단 조작을 노출하고, 제품은 그중 무엇도 노출하면 안 된다. 두 UI는 요구가 반대다.

**재사용은 아래 계층 분리로 자동으로 얻는다.** 진단 화면을 통째로 지웠을 때 남는 것이 곧 제품이 쓸 것이 되도록 자른다.

| 계층 | 파일 | 운명 |
|---|---|---|
| **프로토콜(순수)** | `ios/GildongmuKit/Sources/GildongmuKit/AudioSignalProtocol.swift` | **100% 재사용.** 지금 테스트까지 끝낸다 |
| **전송(CoreBluetooth)** | `ios/GildongmuKit/Sources/GildongmuKit/AudioSignalController.swift` | **재사용.** 제품이 같은 API로 부른다 |
| **진단 UI** | `ios/Gildongmu/Nearby/AudioSignalProbeSection.swift` | **버려진다** |
| **진단 로그** | `ios/Gildongmu/Nearby/AudioSignalDiag.swift` | **버려진다** |

⚠ **순수 층 파일에 `import CoreBluetooth`를 넣지 말 것.** Kit은 macOS도 플랫폼으로 선언하고 `swift test`가 거기서 돈다. 순수 층이 CoreBluetooth에 의존하면 스캔 권한 없는 CI/로컬 테스트에서 계약 테스트를 돌릴 수 없게 된다. 이 repo의 기존 패턴(`toneLayerStep`·`WalkAction`·`CourseDerivation` 등 순수 판정 + fixture)과 같다.

### 3.1 순수 층 API (`AudioSignalProtocol.swift`)

```swift
/// 규격서 Ⅶ (다) ① — DEVICE NAME 20 Bytes: "AHG001" + "+" + MAC 12자리 + "+"
public struct AudioSignalName: Sendable, Equatable {
    public let mac: String          // 12자리 HEX ASCII, 대문자 정규화
    public static func parse(_ advertisedName: String?) -> AudioSignalName?
}

/// 규격서 Ⅶ (다) ③ — 3바이트 명령
public enum AudioSignalCommand: UInt8, Sendable, CaseIterable {
    case locate = 0x01     // 위치안내
    case signal = 0x02     // 신호안내
    case describe = 0x03   // 음성안내(설치 위치 정보)
    public var packet: Data { Data([0x31, 0x00, rawValue]) }
}

/// 규격서 Ⅶ (다) ③ 3) — 응답 3바이트
public enum AudioSignalReply: Sendable, Equatable {
    case ack(spec: UInt8)     // 상위니블 = 수신기 사양 정보
    case nak(spec: UInt8)
    case malformed(Data)
    public static func parse(_ data: Data) -> AudioSignalReply
}
```

파싱 규칙(규격서 원문 그대로, 파싱본 `docs/research/refs/police-audio-signal-spec-2022-04-27.md` §Ⅶ):
- 이름: 접두사 `AHG001+`, 총 20바이트, 끝이 `+`. **셋 다 만족할 때만** 유효로 본다.
- 응답: `[0] == 0x32 && [1] == 0x00`이고 `[2]`의 **하위니블 0 = ACK, 1 = NAK**, 상위니블은 사양 정보.
- ⚠ **길이가 3이 아니면 `.malformed`로 둔다.** 실기기가 규격과 다르게 답할 수 있고, 그 사실 자체가 관측 대상이다. 조용히 버리면 "응답이 없다"와 구분되지 않는다.

### 3.2 전송 층 (`AudioSignalController.swift`)

`CBCentralManagerDelegate`/`CBPeripheralDelegate`를 감싼 `@Observable @MainActor` 클래스.

| UUID | 상수명 | 앱이 할 일 |
|---|---|---|
| `0003cdd0-0000-1000-8000-00805f9b0131` | `serviceUUID` | 서비스 발견 |
| `0003cdd2-…0131` | `writeUUID` | **여기에 `command.packet`을 write** |
| `0003cdd1-…0131` | `notifyUUID` | **여기를 notify 구독**해 응답 수신 |

⚠ **방향을 규격서 표기대로 읽지 말 것.** 규격서는 `0003cdd1`을 "UART TX", `0003cdd2`를 "UART RX"라고만 적는데 **그건 모듈 기준 이름**이다(하부 부품이 USR-BLE100/WH-BLE102임을 UUID 검색으로 확인, research §2.6). 앱 기준으로는 반대다. **틀리면 증상이 "연결은 되는데 아무 일도 안 일어남"이라 원인이 보이지 않는다.**

스캔 계약:
- `scanForPeripherals(withServices: nil, options: [CBCentralManagerScanOptionAllowDuplicatesKey: true])` — **전경 전용이라 nil 스캔이 가능하고, 그게 이번엔 오히려 정확하다**(광고에 서비스 UUID가 실리는지가 미확인이므로 UUID 필터를 걸면 관측 자체를 잃는다). 중복 허용은 RSSI 갱신용이며 배터리를 먹으므로 **화면을 벗어나면 반드시 `stopScan()`**.
- 이름 판정은 `advertisementData[CBAdvertisementDataLocalNameKey]`를 1순위, `peripheral.name`을 2순위로 본다. ⚠ **`peripheral.name`은 캐시된 GAP 이름이라 광고 실시간 값과 다를 수 있다.** 둘 다 로그에 남겨 어느 쪽에서 잡혔는지 기록한다(이것도 관측 대상이다).
- **광고 패킷에 서비스 UUID가 실렸는지를 로그에 남긴다**(`CBAdvertisementDataServiceUUIDsKey` 유무). research §2.6이 "31바이트에 20바이트 이름과 128비트 UUID가 함께 못 들어간다"고 추론한 그 결론을 실물로 확정하는 값이며, **백그라운드 자동 작동 가능 여부가 여기에 달렸다.**

## 4. 안전 사다리 — 3단, 순서 고정

진단 섹션은 세 단계를 **버튼 셋으로 나눠** 노출한다. 한 버튼이 전부를 하지 않는다.

| 단 | 버튼 | 하는 일 | 소리 |
|---|---|---|---|
| 1 | 스캔 시작/중지 | `AHG001` 기기 수·MAC·RSSI | **안 남** |
| 2 | 연결 확인 | 연결 후 12초 대기, 끊김 시각 기록 | **안 남** |
| 3 | 위치 설명 / 위치 안내 / 신호 안내 | 각각 `0x03` / `0x01` / `0x02` | **남** |

**3단 안에서도 순서가 있다: `0x03`(설치 위치 음성안내) → `0x01`(위치안내) → `0x02`(신호안내).**

- `0x03`이 첫째인 이유: 가장 무해하면서 **"지금 잡힌 이 MAC이 어느 횡단보도인가"에 답하는 유일한 채널**이다. 스캔 목록에는 MAC밖에 없다.
- `0x02`가 마지막인 이유: 실제 신호 상태를 안내하므로 **오작동이 곧 안전 문제**다. 규격서가 "음향신호기의 오작동으로 인한 교통사고와 시각장애인의 혼란을 방지하기 위하여"라고 쓴 자리다.
- ⚠ **버튼 라벨에 "시험"임을 넣는다**(예: "신호 안내 보내기(시험)"). 실보행 중 이 화면을 열었을 때 진짜 안내와 혼동하면 안 된다.
- ⚠ **한 번 눌렀을 때 여러 대가 울 수 있다**(대비표상 가운데 바이트가 원래 기기 주소였고 `0x00`이 "모두 동작"이었다, research §2.4). 놀랄 일이 아니라 관측 대상이므로 **화면에 미리 한 줄 고지**하고, 발생하면 로그에 남긴다.

## 5. 봉인과 권한 — 정식판에 새지 않게

### 5.1 코드 게이트

- 진단 섹션·컨트롤러 사용처 전부 `#if DEBUG || EXPERIMENTAL`.
- **Kit의 두 파일은 게이트하지 않는다.** 아무도 부르지 않으면 죽은 코드일 뿐이고, 게이트를 Kit에 넣으면 제품 승격 때 지울 것이 늘어난다. 진입점만 막는다(`guidance-gate-drift.test.ts`가 "판정 축은 플래그 참조가 아니라 진입점 전수"라고 못 박은 것과 같은 정신).

### 5.2 권한 문구 — ⚠ 정식 plist를 건드리지 말 것

BLE 스캔에는 `NSBluetoothAlwaysUsageDescription`이 필요하다. **`ios/Support/Info-Experimental.plist`에만 넣는다.**

정식 `ios/Support/Info.plist`에 넣으면 **정식판이 쓰지도 않는 권한을 선언**하게 되고, 그건 심사 신호이자 개인정보 3자 일치(웹 privacy 카피 · `PrivacyInfo.xcprivacy` · ASC 영양 라벨)의 근거 없는 확장이 된다.

⚠ 이 두 plist는 **수동 동기화 계약**이라 "공통 항목은 양쪽에"가 기본이다. 이 키는 **의도적으로 한쪽에만 두는 첫 항목**이므로, 양쪽 파일 주석에 그 이유를 적는다. 안 적으면 다음 사람이 "동기화 누락"으로 보고 정식판에 복사한다.

### 5.3 역방향 가드 (신규)

`ios/scripts/check-release-artifact.mjs`에 검사를 추가한다: **릴리스 산출물의 `Info.plist`에 `NSBluetoothAlwaysUsageDescription`이 있으면 실패.**

2026-08-15 교훈의 거울상이다. 그때는 실험판에만 있던 백그라운드 모드를 정식으로 **올리는 것을 잊어** 화면을 끄면 안내가 죽었고, 산출물 검사만이 그걸 잡았다. 이번엔 반대로 실험 전용 권한이 정식으로 **새는** 경우이고, 역시 소스 검사로는 안 잡힌다(어느 `INFOPLIST_FILE`이 병합됐는지가 산출물에만 있다).

⚠ 이 검사를 넣을 때 **`asc-submit`이 부르는 경로로 한 번 밟아 본다.** 같은 파일의 검사 둘이 "손으로 인자를 주면 통과하고 `asc-submit`이 부르면 항상 실패"하는 형태로 두 번 1.7 제출을 막은 전례가 있다(CLAUDE.md). 게이트는 "있다"가 아니라 "그 자리에서 돈다"가 성립해야 게이트다.

## 6. 접근성 계약

기준은 글로벌 헌장. 이 화면 고유의 것만 적는다.

- **권한 팝업 뒤 포커스 복원.** 스캔 첫 실행에서 iOS 블루투스 권한 알럿이 뜬다. 헌장 §5(비동기·상태 경계에서 포커스 이탈)의 전형이므로, 알럿이 닫힌 뒤 **스캔 버튼으로 명시 재포커스**한다.
- **스캔 결과는 polite 통지 한 번, 그리고 라벨.** 중복 허용 스캔이라 RSSI가 초당 여러 번 바뀐다. **RSSI 변화를 통지에 싣지 않는다**(발화 폭주). 통지는 "기기 수가 바뀔 때"만, 나머지는 각 행의 라벨로 읽게 한다.
- **버튼 비활성화는 `aria-disabled` 상당 처리**: 스캔 중 "연결 확인"을 막을 때 `.disabled()`를 쓰면 포커스가 떨어진다. `.accessibilityAddTraits(.isButton)` 유지 + 핸들러 가드 + **in-flight ref 가드**.
- **행 하나 = 한 객체.** MAC·RSSI·거리를 인라인으로 쪼개지 말고 `joinText`로 한 줄로 합친다.
- **진단 섹션 헤더는 heading.** 기존 3그룹과 같은 층위(`.accessibilityAddTraits(.isHeader)`)로 두어, 헤딩 내비로 바로 도달하게 한다. 이 화면은 자동 로드라 heading이 발견 경로다(헌장 §3).
- **문구는 한국어 하드코딩.** 진단은 제품 UI가 아니므로 xcstrings·6개 로케일 파이프라인에 태우지 않는다. `appLocalized`를 쓰지 않으므로 키 린터 대상도 아니다. (이 판정을 코드 주석에 남긴다 — 안 남기면 다음 사람이 "i18n 누락"으로 본다.)

## 7. 로그 — 실측의 실제 산출물

`GuideFileLog` 선례를 그대로 따른다(`ios/Gildongmu/Directions/GuideDiag.swift`): 콘솔 + `Documents/audio-signal-diag.log`, 2MB 초과 시 `.old` 교체, `#if DEBUG || EXPERIMENTAL` 게이트, 릴리스에서 no-op.

⚠ 그 파일의 함정 하나를 그대로 승계한다: **`FileHandle.write(_:)`는 실패 시 Swift에서 못 잡는 ObjC 예외를 던진다** — throwing 형태를 쓴다.

한 줄에 남길 것:

```
ISO8601 | event | mac | rssi | localName | peripheralName | advServiceUUIDs | 좌표 | seed최근접거리 | 비고
```

`event`는 최소 이것들: `scanStart` `discovered` `connect` `serviceFound` `notifyOn` `write(cmd)` `reply(ack/nak/malformed, raw hex)` `disconnect(reason, 연결후 경과초)` `scanStop`.

⚠ **`disconnect`에 연결 후 경과 초를 반드시 넣는다.** Q3(비밀번호 여부)의 판정이 **"10초 언저리에 끊겼는가"** 하나이므로, 그 숫자가 없으면 걸음 전체가 답을 못 낸다.

### 7.1 청취 결과는 사람만 안다 — 기록 버튼을 둔다

**앱이 로그로 못 남기는 관측이 정확히 하나 있다: 실제로 소리가 났는가.** 그런데 Q4(명령이 먹었는가)와 Q5(몇 대가 우는가)의 진짜 답이 거기 있다. ACK가 왔는데 소리가 안 날 수도, ACK가 없는데 소리가 날 수도 있고, **그 어긋남 자체가 가장 값어치 있는 관측**이다.

그래서 명령 버튼 아래에 **기록 버튼 셋**을 둔다: `소리 남` · `소리 안 남` · `여러 대 남`. 누르면 그 순간이 직전 명령과 묶여 로그에 `heard(yes/no/multiple)`로 박힌다.

⚠ **기억에 의존하게 두지 말 것.** 후보 지점이 14곳이고 각 지점에서 명령이 셋이다. 걸음이 끝난 뒤 "몇 번째 교차로에서 소리가 났더라"를 되살리는 것은 불가능하고, 그러면 로그의 ACK 열이 대조군을 잃은 채 남는다. 버튼 한 번이 그걸 막는다.

### 7.2 회수

`xcrun devicectl device copy from --domain-type appDataContainer` (선례: `docs/superpowers/specs/logs/transit-guide-diag-2026-08-16.log`). 회수한 로그는 같은 `logs/` 폴더에 `audio-signal-diag-<날짜>.log`로 두고 research 문서에서 가리킨다.

## 8. 테스트

- **순수 층 계약 테스트** `ios/GildongmuKit/Tests/GildongmuKitTests/AudioSignalProtocolTests.swift`: 이름 파싱(정상·접두사 불일치·길이 불일치·끝 `+` 없음·소문자 MAC), 명령 3종 바이트, 응답 파싱(ACK·NAK·사양 상위니블·길이 3 아님 → `.malformed`).
- **전송 층은 실기기가 게이트다.** CoreBluetooth를 목으로 감싸 유닛 테스트를 만들지 않는다 — 이 층에서 알고 싶은 것이 전부 "실물이 규격대로 답하는가"라서 목이 답할 수 없다(리뷰로 대체할 수 없는 게이트: 외부 통합은 실호출).
- 기존 스위트(`NearbyLoadCoreTests` 등)는 **건드리지 않는다.** 건드리게 된다면 §2 조건 2(기존 계약 불변)를 어긴 것이다.

## 9. 실행 순서 (다음 세션 대본)

1. `AudioSignalProtocol.swift`(순수) + `AudioSignalProtocolTests.swift` → `swift test` 통과.
2. `AudioSignalController.swift`(CoreBluetooth) — 스캔·연결·write·notify, `@Observable`.
3. `AudioSignalDiag.swift`(로그) — `GuideDiag` 복제 후 이벤트만 교체. §7.1 `heard` 이벤트 포함.
4. `AudioSignalProbeSection.swift`(UI) + `WalkInfraNearbyView`에 한 줄 삽입(`#if DEBUG || EXPERIMENTAL`). 버튼은 스캔 2 + 연결 1 + 명령 3 + 청취 기록 3.
5. `Info-Experimental.plist`에 권한 문구 + 양쪽 plist 주석.
6. `check-release-artifact.mjs`에 역방향 가드 + **`asc-submit` 경로로 실행 확인**.
7. 빌드 → `CONFIGURATION=Experimental ./ios/deploy-device.sh`.
8. ⚠ **정식판도 함께 배포**([[ios-device-deploy-both-configurations]])할지 판단: 이번 변경은 **전부 실험 게이트 안**이므로 정식판 재배포는 불필요하다. 실험판만 올린다.
9. 위원장 실측 → 로그 회수 → research 문서에 §11 실측 결과 절 추가 → E20 게이트 판정.

**예상 규모**: 신규 4파일 + 기존 3파일 소폭 수정. 순수 층과 UI를 합쳐도 크지 않다.

## 10. 판정 기록

- **설계 적대적 리뷰: 생략.** 근거: 이 단계는 외부 계약을 *정의*하는 것이 아니라 *관측*하는 것이라 리뷰가 검증할 기준선 자체가 아직 없다. 파급은 실험판 한 화면으로 국소·가역이고, 안전 축은 §4 사다리와 §5 봉인으로 구조적으로 통제된다. ⚠ **제품 단계 spec은 적대적 리뷰 필수** — 그때는 판정 기준 ②(새 외부 통합의 계약 가정 첫 정의)와 ④(안전·정확성 크리티컬: 실보행 안내)가 둘 다 성립한다.
- **구현 방식: inline.** 근거: 단일 도메인이고 순차 의존이 강하다(순수 층 API가 확정돼야 컨트롤러가, 컨트롤러가 확정돼야 UI가 정해진다). 게다가 탐색적이라 실측이 설계를 뒤집을 수 있다. 수정 파일이 겹치고 선행 관계가 명확하므로 위임 이득이 없다.
- **리뷰는 별도 컨텍스트.** 구현을 inline으로 한다고 리뷰까지 자기가 하지 않는다. 순수 층 + UI 묶음에 spec-compliance·code-quality 리뷰를 건다.

## 11. 실측이 뒤집을 수 있는 것 (미리 적어 둔다)

이 설계가 틀릴 수 있는 자리를 먼저 명명한다. 여기 적힌 것이 현실로 나오면 **패치가 아니라 이 문서를 고친다.**

1. **이름이 규격과 다를 수 있다.** 접두사가 `AHG001`이 아니거나 20바이트 형식이 아니면 §3.1 파싱이 전부 0건을 낸다. → **파싱 실패 기기도 로그에 남긴다**(주변 BLE 기기 전체를 한 줄씩). 그러면 "없다"와 "형식이 다르다"를 가를 수 있다.
2. **연결이 즉시 끊길 수 있다.** 10초가 아니라 즉시면 비밀번호가 아니라 다른 이유(동시 연결 제한 등)다. 경과 초가 그걸 가른다.
3. **응답이 안 올 수 있다.** notify 구독이 안 되거나 응답 형식이 다르면 §3.1 `.malformed`로 잡힌다. 그때도 **명령은 먹었을 수 있다**(소리가 났는가를 위원장 청취로 대조).
4. **광고에 서비스 UUID가 실려 있을 수 있다.** research §2.6의 추론이 틀린 경우이며, 그러면 **백그라운드 자동 작동의 길이 열린다** — 좋은 소식이므로 로그가 이 값을 반드시 남겨야 한다.
