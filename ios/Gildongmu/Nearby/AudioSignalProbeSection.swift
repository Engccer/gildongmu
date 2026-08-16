import SwiftUI
import Observation
import GildongmuKit

// 음향신호기 BLE 진단 섹션(spec 2026-08-17 §2·§4·§6·§7). 보행 인프라 화면의 음향신호기
// 섹션 아래에 덧붙는 계측기다 — 제품 UI가 아니라 "조작할 수 있는가"에 답하는 원시 관측
// (MAC·RSSI·ACK 바이트·끊김 경과)이 목적이고, 진단 결론이 나면 통째로 버려진다.
// 재사용되는 것은 Kit의 순수 층·전송 층뿐이다(§3).
//
// 문구는 한국어 하드코딩이다(spec §6): 진단은 제품 UI가 아니라 xcstrings·6개 로케일
// 파이프라인에 태우지 않는다. `appLocalized`를 쓰지 않으므로 키 린터 대상도 아니다 —
// "i18n 누락"이 아니라 판정이다.
//
// ⚠ 게이트는 `#if DEBUG || EXPERIMENTAL` — Experimental 구성은 DEBUG를 정의하지 않는다.
// ⚠ 블루투스 권한 문구는 Info-Experimental.plist에만 있다(정식 plist 미선언, spec §5.2).
//   Debug 구성은 정식 Info.plist를 쓰므로 문구가 없고, 그 상태로 CBCentralManager를
//   만들면 iOS가 앱을 종료한다. 그래서 스캔 전에 번들 plist에 키가 있는지 확인하고
//   없으면 스캔을 열지 않고 그 사실을 화면에 적는다(조용한 크래시 대신 정직한 상태).
// ⚠ 모델 수명은 화면(WalkInfraNearbyView)이 쥔다 — `shutdown()`을 List 안 Section의
//   `onDisappear`에 걸면 lazy 렌더라 아래 섹션으로 스크롤하는 순간 스캔·연결이 죽는다
//   (DirectionsTabView 동형 함정). 화면 수준 onDisappear에서만 부른다.

#if DEBUG || EXPERIMENTAL

/// 진단 상태 + 로그 배선. 컨트롤러 이벤트를 좌표·seed 최근접 거리와 함께 로그로 내리고
/// 화면이 읽을 요약 문자열을 만든다.
@Observable @MainActor
final class AudioSignalProbeModel {
    enum Heard: String { case yes, no, multiple }

    let controller = AudioSignalController()
    /// seed 최근접 거리(로그 대조 열·화면 대조 줄). 화면이 payload에서 넣어 준다.
    var seedNearestMeters: Int?

    private(set) var lastCommand: AudioSignalCommand?
    private(set) var lastEventText = "아직 없음"
    /// 권한 알럿이 닫힌 뒤(첫 상태 콜백) 스캔 버튼으로 포커스를 되돌리기 위한 신호(§6).
    private(set) var permissionResolvedTick = 0
    /// 연결 대상 MAC — `discoveries`는 재스캔 때 비워지고 연결된 기기는 광고를 멈추므로
    /// 조회로 되찾을 수 없다. 연결 시점에 잡아 둔다(reply·disconnect·heard 로그의 mac 열).
    private(set) var connectedMac: String?
    /// 상태 줄 갱신 트리거(디스커버리 폭주에서 줄 재조립을 막으려 이벤트 종류로 가른다).
    private(set) var deviceCounts = (signal: 0, other: 0)
    private var awaitingFirstState = false
    private var aliveTask: Task<Void, Never>?
    private var lastLoggedDiscovery: [UUID: (at: Date, rssi: Int)] = [:]

    /// 이 빌드의 Info.plist에 블루투스 권한 문구가 있는가(없으면 스캔 자체를 막는다).
    let bluetoothUsageDeclared =
        Bundle.main.object(forInfoDictionaryKey: "NSBluetoothAlwaysUsageDescription") != nil

    init() {
        controller.onEvent = { [weak self] event in self?.handle(event) }
    }

    /// 발견 순 그대로(RSSI로 실시간 재정렬하면 행 순서·버튼 라벨이 초당 흔들린다).
    var signalDevices: [AudioSignalDiscovery] { controller.discoveries.filter { $0.name != nil } }
    var isScanning: Bool { controller.isScanning }
    var isServiceReady: Bool {
        if case .connected(_, serviceReady: true) = controller.connection { return true }
        return false
    }

    // MARK: - 사다리 1단: 스캔

    func toggleScan() {
        guard bluetoothUsageDeclared else {
            announce("이 빌드에는 블루투스 권한 문구가 없어 스캔할 수 없습니다", high: true)
            return
        }
        if controller.isScanning {
            controller.stopScan()
        } else {
            awaitingFirstState = controller.managerState == .unknown
            controller.startScan()
        }
    }

    // MARK: - 사다리 2단: 연결 확인(가장 센 신호 1대, 12초 생존 관찰)

    func connectStrongest() {
        guard let target = signalDevices.max(by: { $0.rssi < $1.rssi }) else {
            announce("연결할 음향신호기가 없습니다. 먼저 스캔하세요", high: true)
            return
        }
        controller.connect(target.id)
    }

    // MARK: - 사다리 3단: 명령(시험)

    func send(_ command: AudioSignalCommand) {
        guard isServiceReady else {
            announce("서비스 준비 전입니다. 연결 확인 후 응답 구독이 켜지면 보낼 수 있습니다", high: true)
            return
        }
        lastCommand = command
        controller.send(command)
    }

    // MARK: - 청취 기록(§7.1) — 앱이 못 남기는 유일한 관측

    func recordHeard(_ heard: Heard) {
        let commandText = lastCommand.map(Self.label) ?? "명령 없음"
        log(AudioSignalDiagLine(event: "heard(\(heard.rawValue))", mac: connectedMac,
                                note: "직전 명령 \(commandText)"))
        lastEventText = "청취 기록: \(Self.heardLabel(heard)) (직전 명령 \(commandText))"
        announce("기록했습니다: \(Self.heardLabel(heard))", high: true)
    }

    /// 화면 이탈. 이후 도착하는 늦은 콜백(didDisconnect 등)은 로그만 남기고 통지는 억제한다 —
    /// 다른 화면에서 "연결 끊김"이 발화하면 맥락 밖 통지다(헌장 §6 ⑨ 이탈 게이트 동형).
    func shutdown() {
        aliveTask?.cancel()
        muted = true
        controller.shutdown()
    }
    private var muted = false

    // MARK: - 상태 줄(고정 슬롯 — 문자열을 identity로 쓰면 갱신마다 행이 교체돼 포커스가 이탈한다)

    var stateLine: String { "블루투스 상태 \(controllerStateText)" }
    var scanLine: String {
        isScanning
            ? "스캔 중, 음향신호기 \(deviceCounts.signal)대, 기타 BLE 기기 \(deviceCounts.other)대"
            : "스캔 꺼짐, 마지막 결과 음향신호기 \(deviceCounts.signal)대, 기타 \(deviceCounts.other)대"
    }
    var seedLine: String {
        seedNearestMeters.map { "등록된 최근접 음향신호기 \(formatDistance($0))" } ?? "등록된 음향신호기 없음"
    }
    var connectionLine: String {
        switch controller.connection {
        case .idle: "연결 없음"
        case .connecting: "연결 중"
        case .connected(_, let ready): "연결됨, 서비스 \(ready ? "준비됨" : "탐색 중")"
        case .disconnected(_, let reason, let elapsed): "끊김: \(Self.elapsedText(elapsed)), \(reason)"
        }
    }
    var replyLine: String? {
        controller.lastReply.map { "마지막 응답 \(Self.describe($0.reply)), 원시 \(audioSignalHex($0.raw))" }
    }
    var lastEventLine: String { "마지막 이벤트: \(lastEventText)" }

    // MARK: - 이벤트 → 로그·상태·통지

    private func handle(_ event: AudioSignalEvent) {
        switch event {
        case .managerState(let state):
            log(AudioSignalDiagLine(event: "managerState", note: state))
            lastEventText = "블루투스 상태 \(state)"
            if awaitingFirstState {
                awaitingFirstState = false
                permissionResolvedTick += 1
            }
        case .scanStart:
            lastLoggedDiscovery = [:]
            deviceCounts = (0, 0)
            log(AudioSignalDiagLine(event: "scanStart",
                                    note: "discovered 로그 표본: 첫 발견·RSSI 6dB 이상 변화·5초 경과 중 하나"))
            lastEventText = "스캔 중"
            announce("스캔 시작")
        case .scanStop:
            log(AudioSignalDiagLine(event: "scanStop",
                                    note: "AHG001 \(deviceCounts.signal)대, 기타 \(deviceCounts.other)대"))
            lastEventText = "스캔 중지: 음향신호기 \(deviceCounts.signal)대, 기타 \(deviceCounts.other)대"
            announce("스캔 중지, 음향신호기 \(deviceCounts.signal)대")
        case .discovered(let device):
            // 중복 허용 스캔이라 기기당 초당 여러 번 온다. 통지는 AHG 기기 수가 바뀔 때만
            // (§6 — RSSI 변화를 통지에 실으면 발화 폭주). 로그는 첫 발견·RSSI 6dB 이상
            // 변화·5초 경과 중 하나면 남긴다 — 전부 남기면 교차로의 수십 대 광고가 2MB
            // 회전을 몇 분 만에 채워 앞부분(스캔 시작 직후)이 사라진다.
            if shouldLogDiscovery(device) {
                log(AudioSignalDiagLine(
                    event: "discovered", mac: device.name?.mac, rssi: device.rssi,
                    localName: device.localName, peripheralName: device.peripheralName,
                    advServiceUUIDs: device.advertisedServiceUUIDs,
                    note: device.name == nil ? "형식 불일치" : Self.nameSource(device)))
            }
            let signal = signalDevices.count
            let other = controller.discoveries.count - signal
            guard (signal, other) != deviceCounts else { return }
            if signal != deviceCounts.signal { announce("음향신호기 \(signal)대 잡힘") }
            deviceCounts = (signal, other)
        case .connect(_, let mac):
            connectedMac = mac
            log(AudioSignalDiagLine(event: "connect", mac: mac))
            lastEventText = "연결 시도 \(mac ?? "-")"
        case .connected:
            log(AudioSignalDiagLine(event: "connected", mac: connectedMac))
            lastEventText = "연결됨, 12초 생존 관찰 중"
            announce("연결됨. 12초 동안 유지되는지 봅니다", high: true)
            startAliveWatch()
        case .connectFailed(_, let reason):
            aliveTask?.cancel()
            log(AudioSignalDiagLine(event: "connectFailed", mac: connectedMac, note: reason))
            lastEventText = "연결 실패: \(reason)"
            announce("연결 실패", high: true)
        case .serviceFound(_, let services, let characteristics, let writeFound, let notifyFound):
            log(AudioSignalDiagLine(
                event: "serviceFound", mac: connectedMac,
                note: "write=\(writeFound) notify=\(notifyFound) services=[\(services.joined(separator: ","))] chars=[\(characteristics.joined(separator: ","))]"))
            lastEventText = "서비스 탐색: write \(writeFound ? "있음" : "없음"), notify \(notifyFound ? "있음" : "없음"), 서비스 \(services.count)개"
        case .notifyOn(_, let ok, let reason):
            log(AudioSignalDiagLine(event: "notifyOn", mac: connectedMac, note: ok ? "ok" : (reason ?? "fail")))
            let ready = ok && isServiceReady
            lastEventText = ok
                ? (ready ? "응답 구독 켜짐, 명령을 보낼 수 있습니다" : "응답 구독 켜짐, write 특성 없음")
                : "응답 구독 실패: \(reason ?? "-")"
            announce(ready ? "명령을 보낼 수 있습니다" : (ok ? "응답 구독은 켜졌으나 write 특성이 없습니다" : "응답 구독 실패"), high: true)
        case .write(_, let command, let packet, let withResponse):
            log(AudioSignalDiagLine(event: "write(\(Self.code(command)))", mac: connectedMac,
                                    note: "\(audioSignalHex(packet)) \(withResponse ? "withResponse" : "withoutResponse")"))
            lastEventText = "\(Self.label(command)) 보냄 (\(audioSignalHex(packet)))"
        case .reply(_, let reply, let raw):
            let text = Self.describe(reply)
            log(AudioSignalDiagLine(event: "reply(\(text))", mac: connectedMac, note: audioSignalHex(raw)))
            lastEventText = "응답: \(text), 원시 \(audioSignalHex(raw))"
            announce("응답 \(text)", high: true)
        case .disconnect(_, let reason, let elapsed):
            aliveTask?.cancel()
            let elapsedText = Self.elapsedText(elapsed)
            log(AudioSignalDiagLine(event: "disconnect", mac: connectedMac, note: "\(reason), \(elapsedText)"))
            lastEventText = "끊김: \(elapsedText), 이유 \(reason)"
            announce("연결 끊김, \(elapsedText)", high: true)
        case .error(let message):
            log(AudioSignalDiagLine(event: "error", mac: connectedMac, note: message))
            lastEventText = "오류: \(message)"
            announce("오류: \(message)", high: true)
        }
    }

    /// Q3(비밀번호 여부)의 판정선이 "10초 언저리에 끊기는가"라 12초 생존을 명시 기록한다.
    private func startAliveWatch() {
        aliveTask?.cancel()
        aliveTask = Task { [weak self] in
            try? await Task.sleep(for: .seconds(12))
            guard !Task.isCancelled, let self else { return }
            guard case .connected = controller.connection else { return }
            log(AudioSignalDiagLine(event: "alive(12s)", mac: connectedMac))
            lastEventText = "연결 12초 생존"
            announce("연결 12초 유지됨", high: true)
        }
    }

    private func shouldLogDiscovery(_ device: AudioSignalDiscovery) -> Bool {
        let now = Date()
        if let previous = lastLoggedDiscovery[device.id],
           now.timeIntervalSince(previous.at) < 5, abs(previous.rssi - device.rssi) < 6 {
            return false
        }
        lastLoggedDiscovery[device.id] = (now, device.rssi)
        return true
    }

    private var controllerStateText: String {
        switch controller.managerState {
        case .poweredOn: "켜짐"
        case .poweredOff: "꺼짐"
        case .unauthorized: "권한 없음"
        case .unsupported: "미지원"
        case .resetting: "재설정 중"
        case .unknown: "미확인(스캔을 시작하면 권한을 묻습니다)"
        @unknown default: "알 수 없음"
        }
    }

    private func log(_ line: AudioSignalDiagLine) {
        var line = line
        line.coordinate = LocationService.shared.lastCoordinate
        line.seedNearestMeters = seedNearestMeters
        audioSignalDiagLog(line)
    }

    /// 사용자 행동의 직접 응답(연결·응답·오류)은 .high — 버튼 라벨 재낭독에 잠식되지 않게.
    private func announce(_ message: String, high: Bool = false) {
        guard !muted else { return }
        var attributed = AttributedString(message)
        if high { attributed.accessibilitySpeechAnnouncementPriority = .high }
        AccessibilityNotification.Announcement(attributed).post()
    }

    static func nameSource(_ device: AudioSignalDiscovery) -> String {
        device.nameFromAdvertisement ? "이름 출처 광고" : "이름 출처 캐시"
    }

    /// 경과는 문장으로(슬롯 조립 금지 — nil이면 "연결 후 연결 전" 같은 문장이 된다).
    static func elapsedText(_ elapsed: Double?) -> String {
        elapsed.map { String(format: "연결 후 %.1f초", $0) } ?? "연결 성립 전"
    }

    static func label(_ command: AudioSignalCommand) -> String {
        switch command {
        case .describe: "위치 설명"
        case .locate: "위치 안내"
        case .signal: "신호 안내"
        }
    }

    static func code(_ command: AudioSignalCommand) -> String {
        String(format: "0x%02X", command.rawValue)
    }

    static func heardLabel(_ heard: Heard) -> String {
        switch heard {
        case .yes: "소리 났음"
        case .no: "소리 안 났음"
        case .multiple: "여러 대 울렸음"
        }
    }

    static func describe(_ reply: AudioSignalReply) -> String {
        switch reply {
        case .ack(let spec): "ACK 사양 \(spec)"
        case .nak(let spec): "NAK 사양 \(spec)"
        case .malformed(let data): "규격 밖 \(audioSignalHex(data))"
        }
    }
}

struct AudioSignalProbeSection: View {
    let model: AudioSignalProbeModel
    /// seed 요약(로그·화면 대조 열: 최근접 등록 지점 거리). 소스 실패면 nil.
    let seed: NearbyAudioSignals?
    @AccessibilityFocusState private var scanButtonFocused: Bool

    var body: some View {
        Section {
            Text("시험용 화면입니다. 명령을 보내면 주변 신호기 여러 대가 함께 울릴 수 있습니다.")
            if !model.bluetoothUsageDeclared {
                Text("이 빌드에는 블루투스 권한 문구가 없어 스캔할 수 없습니다. 실험판(Experimental)으로 설치하세요.")
            }
            Text(model.stateLine)
            Text(model.scanLine)
            distanceText(model.seedLine)
            Text(model.connectionLine)
            if let reply = model.replyLine { Text(reply) }
            Text(model.lastEventLine)

            // 1단 — 스캔(소리 안 남)
            Button(model.isScanning ? "스캔 중지(시험)" : "스캔 시작(시험)") { model.toggleScan() }
                .accessibilityFocused($scanButtonFocused)
            ForEach(model.signalDevices) { device in
                Text(deviceText(device))
            }
            if model.deviceCounts.other > 0 {
                Text("규격 이름이 아닌 BLE 기기 \(model.deviceCounts.other)대(로그에만 기록)")
            }

            // 2단 — 연결 확인(소리 안 남). 가장 센 신호 1대에 붙어 12초 생존을 본다.
            // 라벨은 고정 — 대상 MAC은 통지·마지막 이벤트 줄로(포커스 요소 라벨 변경은 재낭독).
            Button("연결 확인(시험): 가장 가까운 1대") { model.connectStrongest() }

            // 3단 — 명령(소리 남). 순서 고정: 위치 설명(0x03) → 위치 안내(0x01) → 신호 안내(0x02).
            // `.disabled` 금지(포커스가 떨어진다) — 준비 전엔 핸들러 가드가 통지로 답한다.
            Button("위치 설명 보내기(시험)") { model.send(.describe) }
            Button("위치 안내 보내기(시험)") { model.send(.locate) }
            Button("신호 안내 보내기(시험)") { model.send(.signal) }

            // 청취 기록 — 앱이 못 남기는 관측을 로그에 박는다(직전 명령과 묶임). 라벨은
            // 동작 서술(상태 줄과 같은 어형이면 상태로 들린다).
            Button("소리 났음 기록") { model.recordHeard(.yes) }
            Button("소리 안 났음 기록") { model.recordHeard(.no) }
            Button("여러 대 울렸음 기록") { model.recordHeard(.multiple) }
        } header: {
            Text("음향신호기 BLE 진단(시험)").accessibilityAddTraits(.isHeader)
        }
        .onChange(of: seed?.sites.first?.distanceMeters, initial: true) { _, meters in
            model.seedNearestMeters = meters
        }
        // 권한 알럿이 닫히면 커서가 body로 떨어진다(헌장 §5) — 스캔 버튼으로 명시 복원.
        .onChange(of: model.permissionResolvedTick) { _, _ in scanButtonFocused = true }
    }

    /// 한 행 = 한 객체(§6): MAC·RSSI·광고 서비스 UUID 유무·이름 출처를 한 줄로.
    private func deviceText(_ device: AudioSignalDiscovery) -> String {
        joinText(
            "MAC \(device.name?.mac ?? "-")",
            "RSSI \(device.rssi)",
            device.advertisedServiceUUIDs.isEmpty ? "광고에 서비스 UUID 없음"
                : (device.advertisesUartService ? "광고에 UART 서비스 UUID 있음" : "광고에 다른 서비스 UUID 있음"),
            AudioSignalProbeModel.nameSource(device))
    }
}
#endif
