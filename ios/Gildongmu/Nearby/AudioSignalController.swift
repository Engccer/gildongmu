import Foundation
import CoreBluetooth
import Observation
import GildongmuKit

// 음향신호기 BLE 전송 층(spec 2026-08-17 §3.2). CoreBluetooth를 감싸 스캔·연결·write·
// notify를 제공하고, 관측은 전부 `onEvent`로 흘린다(로그 포맷·화면은 소비자 몫).
// 진단 UI가 버려져도 제품이 이 API를 그대로 부른다 — 여기에 진단 문구·로그 파일을
// 넣지 말 것.
//
// ⚠ 이 파일은 Kit이 아니라 앱 타깃에 있고 통째로 `#if DEBUG || EXPERIMENTAL` 안이다
// (2026-08-20 이전, spec §5.1 개정). Kit에 두면 SPM 패키지는 Experimental 구성을 모르므로
// 정식 바이너리에도 CoreBluetooth가 링크되고, Apple의 업로드 검사는 **심볼 참조만으로**
// 권한 문구를 요구한다(ITMS-90683, 1.8~1.10 세 버전 연속 경고). 권한 문구는 의도적으로
// 실험판 plist에만 있으므로(§5.2) 정식판에서 빼야 할 것은 문구가 아니라 이 코드다.
// 제품으로 승격할 때 Kit으로 되돌리고 그때 정식 plist에 문구를 넣는다(둘은 한 커밋이다).
// 가드는 `check-release-artifact.mjs`가 정식 산출물의 링크 목록에서 CoreBluetooth를 본다.
//
// 유닛 테스트 없음이 의도다: 이 층에서 알고 싶은 것이 전부 "실물이 규격대로 답하는가"라
// 목이 답할 수 없다(외부 통합은 실호출이 게이트, spec §8).

#if DEBUG || EXPERIMENTAL

/// 광고에서 본 BLE 기기 하나. `name`이 nil이면 규격 이름 형식이 아닌 주변 기기 —
/// 그래도 목록에 남긴다(spec §11.1: "없다"와 "형식이 다르다"를 가르는 대조군).
public struct AudioSignalDiscovery: Identifiable, Sendable, Equatable {
    public let id: UUID
    public let name: AudioSignalName?
    /// 광고 실시간 값(`CBAdvertisementDataLocalNameKey`) — 1순위 판정 근거
    public let localName: String?
    /// 캐시된 GAP 이름(`peripheral.name`) — 광고값과 다를 수 있어 둘 다 관측
    public let peripheralName: String?
    public let rssi: Int
    /// 광고 패킷에 실린 서비스 UUID(`CBAdvertisementDataServiceUUIDsKey`) —
    /// 백그라운드 자동 작동 가능 여부가 이 값에 달렸다(research §2.6 추론의 실물 확정).
    public let advertisedServiceUUIDs: [String]
    /// 광고 manufacturer specific data 원문(`CBAdvertisementDataManufacturerDataKey`).
    /// 앞 2바이트(LE)가 Bluetooth SIG 회사 ID — 이름 없는 기기를 가르는 거의 유일한 단서다
    /// (1차 실측 2026-08-19: 6m 지점 최강 기기가 무명·UUID 없음이라 정체 판별 불가였다).
    public let manufacturerData: Data?
    /// 광고 connectable 플래그(`CBAdvertisementDataIsConnectable`). nil이면 키 부재.
    public let isConnectable: Bool?

    /// manufacturer data 앞 2바이트(LE) = 회사 ID. Apple 0x004C·Samsung 0x0075 등.
    public var manufacturerCompanyId: UInt16? {
        guard let data = manufacturerData, data.count >= 2 else { return nil }
        let bytes = [UInt8](data.prefix(2))
        return UInt16(bytes[0]) | (UInt16(bytes[1]) << 8)
    }

    /// 이름이 광고 실시간 값에서 잡혔는가(false면 캐시된 GAP 이름에서만).
    public var nameFromAdvertisement: Bool { AudioSignalName.parse(localName) != nil }

    public var advertisesUartService: Bool {
        advertisedServiceUUIDs.contains { $0.caseInsensitiveCompare(AudioSignalController.serviceUUIDString) == .orderedSame }
    }
}

public enum AudioSignalConnection: Sendable, Equatable {
    case idle
    case connecting(id: UUID)
    /// `serviceReady`는 write·notify characteristic을 둘 다 찾은 뒤에만 참
    case connected(id: UUID, serviceReady: Bool)
    /// `elapsedSeconds`는 연결 성립 후 끊길 때까지(연결 성립 전 실패면 nil) —
    /// Q3(비밀번호 여부)의 유일한 판정값
    case disconnected(id: UUID, reason: String, elapsedSeconds: Double?)
}

/// 소비자(로그·화면)가 받는 관측 이벤트. 시각은 소비자가 찍는다.
public enum AudioSignalEvent: Sendable {
    case managerState(String)
    case scanStart
    case scanStop
    case discovered(AudioSignalDiscovery)
    case connect(id: UUID, mac: String?)
    case connected(id: UUID)
    /// 연결 성립 전 실패(타임아웃 포함) — 경과 초 없음
    case connectFailed(id: UUID, reason: String)
    /// 발견된 서비스·특성 전부(UUID + properties 원값). 규격과 다른 실물을 볼 수 있게
    /// UUID 필터 없이 발견한 결과다. `writeFound`·`notifyFound`는 그중 규격 UUID 매칭 여부.
    case serviceFound(id: UUID, services: [String], characteristics: [String], writeFound: Bool, notifyFound: Bool)
    case notifyOn(id: UUID, ok: Bool, reason: String?)
    /// `withResponse`는 특성이 `.write`를 지원할 때만(아니면 `.withoutResponse`) — 그 여부도 관측
    case write(id: UUID, command: AudioSignalCommand, packet: Data, withResponse: Bool)
    case reply(id: UUID, reply: AudioSignalReply, raw: Data)
    case disconnect(id: UUID, reason: String, elapsedSeconds: Double?)
    case error(String)
}

@Observable @MainActor
public final class AudioSignalController: NSObject {
    // 규격서 Ⅶ (다) ② Custom UUID.
    // ⚠ 방향을 규격서 표기대로 읽지 말 것. 규격서의 "TX"(cdd1)·"RX"(cdd2)는 **모듈**
    // (USR-BLE100 계열) 기준 이름이라 앱은 반대다: cdd2에 write, cdd1을 notify 구독.
    // 틀리면 증상이 "연결은 되는데 아무 일도 일어나지 않음"이라 원인이 보이지 않는다.
    // 문자열 상수만 nonisolated로 둔다 — CBUUID는 비-Sendable이라 전역 저장이 막힌다.
    nonisolated public static let serviceUUIDString = "0003cdd0-0000-1000-8000-00805f9b0131"
    /// 모듈 "UART RX" — 앱이 `command.packet`을 write하는 곳
    nonisolated public static let writeUUIDString = "0003cdd2-0000-1000-8000-00805f9b0131"
    /// 모듈 "UART TX" — 앱이 notify 구독해 ACK/NAK를 받는 곳
    nonisolated public static let notifyUUIDString = "0003cdd1-0000-1000-8000-00805f9b0131"
    static var serviceUUID: CBUUID { CBUUID(string: serviceUUIDString) }
    static var writeUUID: CBUUID { CBUUID(string: writeUUIDString) }
    static var notifyUUID: CBUUID { CBUUID(string: notifyUUIDString) }

    /// 연결 시도 상한. CoreBluetooth `connect`는 타임아웃이 없어 범위 밖 기기면 영영
    /// `.connecting`에 머문다 — "연결 자체가 안 됨"과 "연결 후 끊김"을 가르는 데도 필요.
    public static let connectTimeout: Duration = .seconds(15)

    public private(set) var managerState: CBManagerState = .unknown
    public private(set) var isScanning = false
    /// 발견 순 유지(RSSI 갱신은 제자리). 정렬은 소비자 몫.
    public private(set) var discoveries: [AudioSignalDiscovery] = []
    public private(set) var connection: AudioSignalConnection = .idle
    public private(set) var lastReply: (reply: AudioSignalReply, raw: Data)?

    /// 관측 싱크. 화면·로그가 여기 걸린다(MainActor에서 호출).
    public var onEvent: (@MainActor (AudioSignalEvent) -> Void)?

    private var central: CBCentralManager?
    /// 세션 내 누적(재스캔에도 유지 — 연결된 기기는 광고를 멈춰 다시 채워지지 않는다).
    private var peripherals: [UUID: CBPeripheral] = [:]
    private var target: CBPeripheral?
    /// 읽기 전용 연결(`connect(_:readOnly: true)`) — 서비스·특성 발견까지만 하고 notify 구독·
    /// `serviceReady` 승격을 하지 않는다. 이름 무관 서비스 확인(진단 0단)이 쓰며, 그 연결로는
    /// `send`가 구조적으로 막힌다(serviceReady가 영영 false).
    private var targetReadOnly = false
    private var writeCharacteristic: CBCharacteristic?
    private var notifyCharacteristic: CBCharacteristic?
    private var connectedAt: Date?
    private var connectTimeoutTask: Task<Void, Never>?
    /// 첫 스캔은 매니저 생성 직후라 상태가 `.unknown`이다 — 권한 알럿·상태 콜백 뒤
    /// `.poweredOn`이 오면 이어서 시작한다(사용자 누름의 연장이지 자동 시작이 아니다).
    private var pendingScan = false

    public override init() { super.init() }

    /// 매니저는 첫 사용 시점에 만든다 — 생성 즉시 권한 알럿·상태 콜백이 시작되므로
    /// 화면이 열리기만 해도 팝업이 뜨는 것을 막는다.
    private func ensureCentral() -> CBCentralManager {
        if let central { return central }
        let created = CBCentralManager(delegate: self, queue: .main)
        central = created
        return created
    }

    // MARK: - 스캔

    /// `withServices: nil` — 광고에 서비스 UUID가 실리는지가 미확인이라 UUID 필터를 걸면
    /// 관측 자체를 잃는다(전경 전용이라 nil 스캔이 허용된다). 중복 허용은 RSSI 갱신용이고
    /// 배터리를 먹으므로 화면을 벗어나면 반드시 `stopScan()`.
    public func startScan() {
        let central = ensureCentral()
        switch central.state {
        case .poweredOn:
            guard !isScanning else { return }
            discoveries = []
            central.scanForPeripherals(withServices: nil,
                                       options: [CBCentralManagerScanOptionAllowDuplicatesKey: true])
            isScanning = true
            onEvent?(.scanStart)
        case .unknown, .resetting:
            pendingScan = true
        default:
            onEvent?(.error("블루투스 상태 \(Self.describe(central.state)) — 스캔 불가"))
        }
    }

    public func stopScan() {
        pendingScan = false
        guard isScanning else { return }
        central?.stopScan()
        isScanning = false
        onEvent?(.scanStop)
    }

    // MARK: - 연결

    /// `readOnly`는 서비스 목록만 읽는 연결 — 규격 이름과 무관한 기기에 붙어 UART 서비스
    /// 유무를 보는 용도. 이 연결에서는 notify 구독·`serviceReady` 승격을 건너뛰어 명령이
    /// 미검증 기기로 나갈 길을 구조로 막는다.
    public func connect(_ id: UUID, readOnly: Bool = false) {
        guard let central, central.state == .poweredOn else {
            onEvent?(.error("블루투스 상태 \(Self.describe(central?.state ?? .unknown)) — 연결 불가"))
            return
        }
        guard let peripheral = peripherals[id] else {
            onEvent?(.error("연결 대상 없음 \(id.uuidString)"))
            return
        }
        if case .connecting = connection {
            onEvent?(.error("이미 연결 시도 중 — 끝나기를 기다린다"))
            return
        }
        // 같은 기기에 재연결하면 옛 didDisconnect가 정체성 가드를 통과해 새 상태를 지운다 — 거부.
        if case .connected(let currentId, _) = connection, currentId == id {
            onEvent?(.error("이미 연결돼 있습니다"))
            return
        }
        // 이전 연결은 동기 정리한다. 옛 기기의 늦은 didDisconnect는 아래 정체성 가드가
        // 흘려보내므로 그 기기의 끊김·경과 초는 여기서 직접 기록한다("replaced").
        if case .connected(let oldId, _) = connection {
            let seconds = connectedAt.map { Date().timeIntervalSince($0) }
            onEvent?(.disconnect(id: oldId, reason: "replaced", elapsedSeconds: seconds))
        }
        disconnect()
        target = peripheral
        targetReadOnly = readOnly
        peripheral.delegate = self
        writeCharacteristic = nil
        notifyCharacteristic = nil
        connectedAt = nil
        connection = .connecting(id: id)
        onEvent?(.connect(id: id, mac: discoveries.first { $0.id == id }?.name?.mac))
        central.connect(peripheral, options: nil)
        connectTimeoutTask?.cancel()
        connectTimeoutTask = Task { [weak self] in
            try? await Task.sleep(for: Self.connectTimeout)
            guard !Task.isCancelled, let self else { return }
            guard case .connecting(let pendingId) = connection, pendingId == id else { return }
            central.cancelPeripheralConnection(peripheral)
            clearTarget()
            connection = .disconnected(id: id, reason: "connectTimeout", elapsedSeconds: nil)
            onEvent?(.connectFailed(id: id, reason: "timeout \(Self.connectTimeout)"))
        }
    }

    /// 연결 중이면 취소하고 즉시 idle(대기 중 취소는 didDisconnect 콜백을 보장하지 않아
    /// 비동기에 맡기면 `.connecting`에 영구 고착한다). 연결됨이면 취소만 — 상태는
    /// didDisconnect가 경과 초와 함께 닫는다.
    public func disconnect() {
        guard let central, let target else { return }
        connectTimeoutTask?.cancel()
        central.cancelPeripheralConnection(target)
        if case .connecting(let id) = connection {
            clearTarget()
            connection = .disconnected(id: id, reason: "cancelled", elapsedSeconds: nil)
            onEvent?(.connectFailed(id: id, reason: "cancelled"))
        }
    }

    // MARK: - 명령

    public func send(_ command: AudioSignalCommand) {
        guard let target, let writeCharacteristic,
              case .connected(_, serviceReady: true) = connection else {
            onEvent?(.error("서비스 준비 전 write 시도 \(command)"))
            return
        }
        let packet = command.packet
        let withResponse = writeCharacteristic.properties.contains(.write)
        target.writeValue(packet, for: writeCharacteristic, type: withResponse ? .withResponse : .withoutResponse)
        onEvent?(.write(id: target.identifier, command: command, packet: packet, withResponse: withResponse))
    }

    // MARK: - 정리

    /// 화면 이탈 시 호출 — 스캔 중지 + 연결 해제(중복 허용 스캔은 배터리를 먹는다).
    public func shutdown() {
        stopScan()
        disconnect()
    }

    // MARK: - 내부

    private func clearTarget() {
        connectTimeoutTask?.cancel()
        connectTimeoutTask = nil
        target = nil
        targetReadOnly = false
        writeCharacteristic = nil
        notifyCharacteristic = nil
        connectedAt = nil
    }

    /// 옛 기기의 늦은 콜백이 새 연결 상태를 덮지 않게 — 현재 target에 대한 콜백만 상태를 만진다.
    private func isCurrent(_ peripheral: CBPeripheral) -> Bool {
        target?.identifier == peripheral.identifier
    }

    static func describe(_ state: CBManagerState) -> String {
        switch state {
        case .unknown: "unknown"
        case .resetting: "resetting"
        case .unsupported: "unsupported"
        case .unauthorized: "unauthorized"
        case .poweredOff: "poweredOff"
        case .poweredOn: "poweredOn"
        @unknown default: "state(\(state.rawValue))"
        }
    }

    fileprivate func handleState(_ state: CBManagerState) {
        managerState = state
        onEvent?(.managerState(Self.describe(state)))
        if state != .poweredOn, isScanning {
            isScanning = false
            onEvent?(.scanStop)
        }
        if pendingScan, state != .unknown, state != .resetting {
            pendingScan = false
            startScan()
        }
    }

    fileprivate func handleDiscovery(_ peripheral: CBPeripheral, advertisement: [String: Any], rssi: Int) {
        peripherals[peripheral.identifier] = peripheral
        let localName = advertisement[CBAdvertisementDataLocalNameKey] as? String
        let peripheralName = peripheral.name
        let serviceUUIDs = (advertisement[CBAdvertisementDataServiceUUIDsKey] as? [CBUUID] ?? [])
            .map(\.uuidString)
        let manufacturerData = advertisement[CBAdvertisementDataManufacturerDataKey] as? Data
        let isConnectable = (advertisement[CBAdvertisementDataIsConnectable] as? NSNumber)?.boolValue
        // 이름 판정 1순위 광고 실시간 값, 2순위 캐시된 GAP 이름(spec §3.2).
        let name = AudioSignalName.parse(localName) ?? AudioSignalName.parse(peripheralName)
        let entry = AudioSignalDiscovery(
            id: peripheral.identifier, name: name, localName: localName,
            peripheralName: peripheralName, rssi: rssi, advertisedServiceUUIDs: serviceUUIDs,
            manufacturerData: manufacturerData, isConnectable: isConnectable)
        if let index = discoveries.firstIndex(where: { $0.id == entry.id }) {
            discoveries[index] = entry
        } else {
            discoveries.append(entry)
        }
        onEvent?(.discovered(entry))
    }

    fileprivate func handleConnected(_ peripheral: CBPeripheral) {
        guard isCurrent(peripheral) else { return }
        connectTimeoutTask?.cancel()
        connectedAt = Date()
        connection = .connected(id: peripheral.identifier, serviceReady: false)
        onEvent?(.connected(id: peripheral.identifier))
        // UUID 필터 없이 전부 발견한다 — 규격과 다른 실물(다른 서비스·특성 속성)을 보는 것이
        // 진단의 존재 이유다. 규격 UUID 매칭은 결과에서 고른다.
        peripheral.discoverServices(nil)
    }

    fileprivate func handleConnectFailed(_ peripheral: CBPeripheral, error: (any Error)?) {
        guard isCurrent(peripheral) else { return }
        let reason = error?.localizedDescription ?? "unknown"
        clearTarget()
        connection = .disconnected(id: peripheral.identifier, reason: "connectFailed: \(reason)", elapsedSeconds: nil)
        onEvent?(.connectFailed(id: peripheral.identifier, reason: reason))
    }

    fileprivate func handleDisconnected(_ peripheral: CBPeripheral, error: (any Error)?) {
        guard isCurrent(peripheral) else { return }
        let reason = error.map { "\(($0 as NSError).domain)#\(($0 as NSError).code) \($0.localizedDescription)" } ?? "clean"
        let seconds = connectedAt.map { Date().timeIntervalSince($0) }
        clearTarget()
        connection = .disconnected(id: peripheral.identifier, reason: reason, elapsedSeconds: seconds)
        onEvent?(.disconnect(id: peripheral.identifier, reason: reason, elapsedSeconds: seconds))
    }

    fileprivate func handleServices(_ peripheral: CBPeripheral, error: (any Error)?) {
        guard isCurrent(peripheral) else { return }
        if let error {
            onEvent?(.error("discoverServices 실패: \(error.localizedDescription)"))
            return
        }
        let services = peripheral.services ?? []
        guard let uart = services.first(where: { $0.uuid == Self.serviceUUID }) else {
            // 규격 서비스가 없다 — 그래도 실물이 무엇을 여는지는 관측이다: 서비스마다 특성을
            // 발견해 각각 serviceFound로 흘린다(write·notify는 당연히 false).
            onEvent?(.serviceFound(id: peripheral.identifier, services: services.map(\.uuid.uuidString),
                                   characteristics: [], writeFound: false, notifyFound: false))
            for service in services { peripheral.discoverCharacteristics(nil, for: service) }
            return
        }
        peripheral.discoverCharacteristics(nil, for: uart)
    }

    fileprivate func handleCharacteristics(_ peripheral: CBPeripheral, service: CBService, error: (any Error)?) {
        guard isCurrent(peripheral) else { return }
        if let error {
            onEvent?(.error("discoverCharacteristics 실패: \(error.localizedDescription)"))
            return
        }
        let chars = service.characteristics ?? []
        guard service.uuid == Self.serviceUUID else {
            onEvent?(.serviceFound(
                id: peripheral.identifier, services: [service.uuid.uuidString],
                characteristics: chars.map { "\($0.uuid.uuidString):props=\($0.properties.rawValue)" },
                writeFound: false, notifyFound: false))
            return
        }
        let write = chars.first { $0.uuid == Self.writeUUID }
        let notify = chars.first { $0.uuid == Self.notifyUUID }
        if !targetReadOnly {
            writeCharacteristic = write
            notifyCharacteristic = notify
        }
        onEvent?(.serviceFound(
            id: peripheral.identifier,
            services: (peripheral.services ?? []).map(\.uuid.uuidString),
            // properties 원값(CBCharacteristicProperties rawValue)을 함께 — write/
            // writeWithoutResponse/notify/indicate 중 무엇이 열렸는지가 방향 가정의 판정 근거.
            characteristics: chars.map { "\($0.uuid.uuidString):props=\($0.properties.rawValue)" },
            writeFound: write != nil,
            notifyFound: notify != nil))
        // 읽기 전용 연결은 여기서 끝 — 구독도 승격도 없다.
        guard !targetReadOnly else { return }
        if let notifyCharacteristic {
            peripheral.setNotifyValue(true, for: notifyCharacteristic)
        }
        if writeCharacteristic != nil, notifyCharacteristic != nil {
            connection = .connected(id: peripheral.identifier, serviceReady: true)
        }
    }

    fileprivate func handleNotifyState(_ peripheral: CBPeripheral, characteristic: CBCharacteristic, error: (any Error)?) {
        guard isCurrent(peripheral) else { return }
        onEvent?(.notifyOn(id: peripheral.identifier,
                           ok: error == nil && characteristic.isNotifying,
                           reason: error?.localizedDescription))
    }

    fileprivate func handleValue(_ peripheral: CBPeripheral, characteristic: CBCharacteristic, error: (any Error)?) {
        guard isCurrent(peripheral) else { return }
        if let error {
            onEvent?(.error("notify 값 오류: \(error.localizedDescription)"))
            return
        }
        let raw = characteristic.value ?? Data()
        let reply = AudioSignalReply.parse(raw)
        lastReply = (reply, raw)
        onEvent?(.reply(id: peripheral.identifier, reply: reply, raw: raw))
    }

    fileprivate func handleWriteResult(_ peripheral: CBPeripheral, error: (any Error)?) {
        guard isCurrent(peripheral), let error else { return }
        onEvent?(.error("write 응답 오류: \(error.localizedDescription)"))
    }
}

// MARK: - 델리게이트
// 매니저를 main 큐에 만들었으므로 콜백은 이미 MainActor다. `@preconcurrency` 적합으로
// 델리게이트 메서드를 MainActor 격리 그대로 두고 런타임이 큐를 검증하게 한다 —
// CBPeripheral·CBService·CBCharacteristic이 비-Sendable이라 `nonisolated`+
// `assumeIsolated` 클로저 캡처는 Swift 6 영역 격리 검사(sending)에 걸린다.
// ⚠ 큐를 main 외로 바꾸면 이 전제가 깨져 런타임 크래시다(`ensureCentral` 고정).

extension AudioSignalController: @preconcurrency CBCentralManagerDelegate {
    public func centralManagerDidUpdateState(_ central: CBCentralManager) {
        handleState(central.state)
    }

    public func centralManager(_ central: CBCentralManager, didDiscover peripheral: CBPeripheral,
                               advertisementData: [String: Any], rssi RSSI: NSNumber) {
        handleDiscovery(peripheral, advertisement: advertisementData, rssi: RSSI.intValue)
    }

    public func centralManager(_ central: CBCentralManager, didConnect peripheral: CBPeripheral) {
        handleConnected(peripheral)
    }

    public func centralManager(_ central: CBCentralManager, didFailToConnect peripheral: CBPeripheral,
                               error: (any Error)?) {
        handleConnectFailed(peripheral, error: error)
    }

    public func centralManager(_ central: CBCentralManager, didDisconnectPeripheral peripheral: CBPeripheral,
                               error: (any Error)?) {
        handleDisconnected(peripheral, error: error)
    }
}

extension AudioSignalController: @preconcurrency CBPeripheralDelegate {
    public func peripheral(_ peripheral: CBPeripheral, didDiscoverServices error: (any Error)?) {
        handleServices(peripheral, error: error)
    }

    public func peripheral(_ peripheral: CBPeripheral, didDiscoverCharacteristicsFor service: CBService,
                           error: (any Error)?) {
        handleCharacteristics(peripheral, service: service, error: error)
    }

    public func peripheral(_ peripheral: CBPeripheral, didUpdateNotificationStateFor characteristic: CBCharacteristic,
                           error: (any Error)?) {
        handleNotifyState(peripheral, characteristic: characteristic, error: error)
    }

    public func peripheral(_ peripheral: CBPeripheral, didUpdateValueFor characteristic: CBCharacteristic,
                           error: (any Error)?) {
        handleValue(peripheral, characteristic: characteristic, error: error)
    }

    public func peripheral(_ peripheral: CBPeripheral, didWriteValueFor characteristic: CBCharacteristic,
                           error: (any Error)?) {
        handleWriteResult(peripheral, error: error)
    }
}

#endif
