import SwiftUI
import Observation
import GildongmuKit

// 음향신호기 BLE 진단 섹션(spec 2026-08-17 §2·§4·§6·§7, 2026-08-20 개정). "내 주변" 허브
// 최상단에 놓인 계측기다 — 제품 UI가 아니라 "조작할 수 있는가"에 답하는 원시 관측
// (MAC·RSSI·서비스 UUID·ACK 바이트·끊김 경과)이 목적이고, 진단 결론이 나면 통째로
// 버려진다. 재사용되는 것은 Kit의 순수 층·전송 층뿐이다(§3).
//
// 2026-08-20 개정(1차 실측 `AHG001` 0건 뒤, research §11): 버튼 하나로 한 자리 진단이
// 끝나게 했다 — **진단 시작 = 20초 스캔 → 규격 이름과 무관하게 가장 센 후보 3대에
// 연결해 서비스 목록만 읽고 끊기 → 요약 통지**. 1차 실측이 "없다"와 "이름·프로토콜이
// 다르다"를 못 가른 이유가 ①연결 확인을 `AHG001` 파싱 성공 기기에만 걸어 둔 것
// ②무명 기기 식별자 없음 ③좌표가 세션 시작 fix 고정이어서다. 셋을 여기서 고친다.
// 서비스 확인은 읽기만 한다 — 명령(소리)은 여전히 `AHG001` 기기에 사람이 단계별로 보낸다(§4).
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
// ⚠ 모델 수명은 화면(NearbyHubView)이 쥔다 — `shutdown()`을 List 안 Section의
//   `onDisappear`에 걸면 lazy 렌더라 아래 섹션으로 스크롤하는 순간 스캔·연결이 죽는다
//   (DirectionsTabView 동형 함정). 화면 수준 onDisappear에서만 부른다.

#if DEBUG || EXPERIMENTAL

/// 진단 상태 + 로그 배선. 컨트롤러 이벤트를 좌표·seed 최근접 거리와 함께 로그로 내리고
/// 화면이 읽을 요약 문자열을 만든다.
@Observable @MainActor
final class AudioSignalProbeModel {
    enum Heard: String { case yes, no, multiple }

    /// 자동 진단 국면. 상태 줄 한 줄이 이 값으로 갈린다.
    enum Phase: Equatable {
        case idle
        case scanning
        /// `index`는 1부터, `total`은 후보 수
        case probing(index: Int, total: Int)
        case done(summary: String)
    }

    /// 한 자리 진단의 스캔 길이. 횡단보도 대기 한 주기 안에 스캔+연결 확인이 끝나야
    /// "어딜 가든 빠르게"가 성립한다(20초 + 후보 3대 × 최대 ~20초).
    static let scanWindow: Duration = .seconds(20)
    /// 이름 무관 연결 확인 후보 수. 교차로엔 수백 대가 잡히므로 전부 붙을 수 없다.
    static let probeCandidateCap = 3
    /// 연결 후 서비스 목록이 모이길 기다리는 창(서비스 발견은 서비스별로 콜백이 온다).
    static let serviceWindow: Duration = .seconds(5)
    /// 후보에서 뺄 회사 ID — 소비자 기기 대군. USR-BLE100 계열 모듈은 이들이 아니다.
    /// (Apple·Samsung·Microsoft·Google). Nordic(0x0059)은 모듈이 쓰므로 빼지 않는다.
    static let excludedCompanyIds: Set<UInt16> = [0x004C, 0x0075, 0x0006, 0x00E0]
    /// 후보 최저 RSSI. 이보다 약하면 연결 시도가 15초 타임아웃만 태운다.
    static let probeMinRssi = -80

    let controller = AudioSignalController()
    /// seed 최근접 거리(로그 대조 열·화면 대조 줄). 진단 시작 시 현재 좌표로 1회 조회.
    private(set) var seedNearestMeters: Int?
    private(set) var phase: Phase = .idle

    private(set) var lastCommand: AudioSignalCommand?
    private(set) var lastEventText = "아직 없음"
    /// 권한 알럿이 닫힌 뒤(첫 상태 콜백) 진단 버튼으로 포커스를 되돌리기 위한 신호(§6).
    private(set) var permissionResolvedTick = 0
    /// 연결 대상 MAC — `discoveries`는 재스캔 때 비워지고 연결된 기기는 광고를 멈추므로
    /// 조회로 되찾을 수 없다. 연결 시점에 잡아 둔다(reply·disconnect·heard 로그의 mac 열).
    private(set) var connectedMac: String?
    /// 연결 대상 식별자(무명 후보의 로그 열).
    private(set) var connectedId: UUID?
    /// 상태 줄 갱신 트리거(디스커버리 폭주에서 줄 재조립을 막으려 이벤트 종류로 가른다).
    private(set) var deviceCounts = (signal: 0, other: 0)
    private(set) var strongestRssi: Int?
    private var awaitingFirstState = false
    private var aliveTask: Task<Void, Never>?
    private var diagnosisTask: Task<Void, Never>?
    private var locationTask: Task<Void, Never>?
    private var lastLoggedDiscovery: [UUID: (at: Date, rssi: Int)] = [:]
    /// 이름 무관 연결 확인 중 모인 서비스(후보별). `serviceFound`는 서비스마다 따로 온다.
    private var probeServices: [UUID: (services: Set<String>, uartFound: Bool)] = [:]
    private var muted = false

    private let walkService = WalkInfraService(client: APIClient(baseURL: AppConfig.apiBaseURL))

    /// 이 빌드의 Info.plist에 블루투스 권한 문구가 있는가(없으면 스캔 자체를 막는다).
    let bluetoothUsageDeclared =
        Bundle.main.object(forInfoDictionaryKey: "NSBluetoothAlwaysUsageDescription") != nil

    init() {
        controller.onEvent = { [weak self] event in self?.handle(event) }
    }

    /// 발견 순 그대로(RSSI로 실시간 재정렬하면 행 순서·버튼 라벨이 초당 흔들린다).
    var signalDevices: [AudioSignalDiscovery] { controller.discoveries.filter { $0.name != nil } }
    var isRunning: Bool {
        switch phase {
        case .scanning, .probing: true
        case .idle, .done: false
        }
    }
    var isServiceReady: Bool {
        if case .connected(_, serviceReady: true) = controller.connection { return true }
        return false
    }

    // MARK: - 한 자리 진단(스캔 → 이름 무관 서비스 확인 → 요약)

    func toggleDiagnosis() {
        if isRunning { stopDiagnosis(reason: "사용자 중지"); return }
        guard bluetoothUsageDeclared else {
            announce("이 빌드에는 블루투스 권한 문구가 없어 스캔할 수 없습니다", high: true)
            return
        }
        muted = false
        phase = .scanning
        seedNearestMeters = nil
        probeServices = [:]
        startLocationRefresh()
        awaitingFirstState = controller.managerState == .unknown
        controller.startScan()
        diagnosisTask?.cancel()
        diagnosisTask = Task { [weak self] in
            try? await Task.sleep(for: Self.scanWindow)
            guard !Task.isCancelled, let self else { return }
            await runProbes()
        }
    }

    private func stopDiagnosis(reason: String) {
        diagnosisTask?.cancel()
        diagnosisTask = nil
        locationTask?.cancel()
        locationTask = nil
        controller.stopScan()
        controller.disconnect()
        if isRunning {
            log(AudioSignalDiagLine(event: "probeStop", note: reason))
            phase = .idle
            lastEventText = "진단 중지"
            announce("진단 중지", high: true)
        }
    }

    /// 스캔을 멈추고 규격 이름과 무관하게 가장 센 후보 N대에 붙어 서비스 목록을 읽는다.
    /// 읽기만 한다 — write·notify 구독 없이 `discoverServices(nil)` 결과만 로그에 남기고
    /// 끊는다. "없다"와 "이름이 다르다"를 가르는 유일한 판별(cdd0 UART 서비스 유무).
    private func runProbes() async {
        controller.stopScan()
        // 권한 알럿이 떠 있어 스캔이 아직 안 돈 상태(managerState unknown)면 후보가 없다 —
        // 그 사실을 요약으로 남기고 끝낸다(다음 누름이 정상 경로).
        let candidates = probeCandidates()
        log(AudioSignalDiagLine(event: "probeStart",
                                note: "후보 \(candidates.count)대: " + candidates.map {
                                    "\(String($0.id.uuidString.prefix(8)))@\($0.rssi)"
                                }.joined(separator: " ")))
        var uartCount = 0
        var connectedCount = 0
        for (offset, candidate) in candidates.enumerated() {
            guard !Task.isCancelled else { return }
            phase = .probing(index: offset + 1, total: candidates.count)
            let result = await probeOne(candidate)
            if result.connected { connectedCount += 1 }
            if result.uartFound { uartCount += 1 }
        }
        guard !Task.isCancelled else { return }
        locationTask?.cancel()
        locationTask = nil
        // 자동 확인 대상 표식은 여기서 지운다 — 남겨 두면 같은 기기를 나중에 사다리로 수동
        // 연결할 때 "자동 확인 중"으로 오판해 생존 관찰·통지를 건너뛴다(리뷰 검출).
        probeServices = [:]
        let summary = "음향신호기 \(deviceCounts.signal)대, 기타 \(deviceCounts.other)대, 연결 확인 \(connectedCount)/\(candidates.count)대, UART 서비스 \(uartCount)대"
        log(AudioSignalDiagLine(event: "probeSummary", note: summary))
        phase = .done(summary: summary)
        lastEventText = "진단 완료: \(summary)"
        announce("진단 완료. \(summary)", high: true)
    }

    /// 후보: connectable(미상 포함)·RSSI 하한 이상·소비자 대군 회사 ID 제외·규격 이름 기기 제외
    /// (규격 기기는 §4 사다리로 사람이 붙인다), RSSI 내림차순 상위 N.
    private func probeCandidates() -> [AudioSignalDiscovery] {
        controller.discoveries
            .filter { $0.name == nil }
            .filter { $0.isConnectable ?? true }
            .filter { $0.rssi != 127 && $0.rssi >= Self.probeMinRssi }
            .filter { $0.manufacturerCompanyId.map { !Self.excludedCompanyIds.contains($0) } ?? true }
            .sorted { $0.rssi > $1.rssi }
            .prefix(Self.probeCandidateCap)
            .map { $0 }
    }

    private struct ProbeResult { var connected: Bool; var uartFound: Bool }

    private func probeOne(_ candidate: AudioSignalDiscovery) async -> ProbeResult {
        probeServices[candidate.id] = (services: [], uartFound: false)
        // 읽기 전용 — 서비스 목록만. notify 구독·serviceReady 승격이 없어 이 연결로는 명령이
        // 구조적으로 못 나간다(컨트롤러 계약).
        controller.connect(candidate.id, readOnly: true)
        // 연결 성립/실패 대기 — 컨트롤러 타임아웃(15초)이 실패를 확정한다.
        let connected = await waitConnection(for: candidate.id, timeout: AudioSignalController.connectTimeout + .seconds(2))
        guard connected else { return ProbeResult(connected: false, uartFound: false) }
        // 서비스 발견은 서비스별 콜백이라 잠시 모은다. 그동안 끊기면 그대로 끝.
        try? await Task.sleep(for: Self.serviceWindow)
        let uart = probeServices[candidate.id]?.uartFound ?? false
        controller.disconnect()
        _ = await waitDisconnected(timeout: .seconds(3))
        return ProbeResult(connected: true, uartFound: uart)
    }

    /// `.connected`면 true, `.disconnected`(실패·타임아웃)면 false. 폴링 0.2초 — 컨트롤러는
    /// 콜백 기반이라 대기 프리미티브가 없고, 진단 한 자리에 수십 번뿐이라 비용이 없다.
    private func waitConnection(for id: UUID, timeout: Duration) async -> Bool {
        let deadline = ContinuousClock.now + timeout
        while ContinuousClock.now < deadline, !Task.isCancelled {
            switch controller.connection {
            case .connected(let cid, _) where cid == id: return true
            case .disconnected(let cid, _, _) where cid == id: return false
            default: break
            }
            try? await Task.sleep(for: .milliseconds(200))
        }
        return false
    }

    private func waitDisconnected(timeout: Duration) async -> Bool {
        let deadline = ContinuousClock.now + timeout
        while ContinuousClock.now < deadline, !Task.isCancelled {
            switch controller.connection {
            case .idle, .disconnected: return true
            default: break
            }
            try? await Task.sleep(for: .milliseconds(200))
        }
        return false
    }

    /// 진단 중 좌표를 10초마다 갱신한다(1차 실측은 세션 시작 fix 한 점이었다). 첫 갱신 뒤
    /// seed 최근접 거리를 1회 조회한다(로그 대조 열). 위치 실패는 조용히 넘긴다 — 진단의
    /// 본체는 BLE이고 좌표는 대조 열이다(단 첫 fix 실패는 로그에 남긴다).
    private func startLocationRefresh() {
        locationTask?.cancel()
        locationTask = Task { [weak self] in
            var seedFetched = false
            while !Task.isCancelled {
                do {
                    let coord = try await LocationService.shared.currentCoordinate(ttl: 10)
                    if !seedFetched, let self {
                        seedFetched = true
                        await fetchSeedDistance(lat: coord.lat, lng: coord.lng)
                    }
                } catch {
                    self?.log(AudioSignalDiagLine(event: "locationError", note: String(describing: error)))
                }
                try? await Task.sleep(for: .seconds(10))
            }
        }
    }

    private func fetchSeedDistance(lat: Double, lng: Double) async {
        guard let walk = try? await walkService.nearby(lat: lat, lng: lng),
              case .ok(let data) = walk.audioSignals else { return }
        seedNearestMeters = data.sites.first?.distanceMeters
    }

    // MARK: - 사다리 2단(규격 기기만): 연결 확인(가장 센 신호 1대, 12초 생존 관찰)

    func connectStrongest() {
        muted = false
        guard !isRunning else {
            announce("진단이 끝난 뒤 연결하세요", high: true)
            return
        }
        guard let target = signalDevices.max(by: { $0.rssi < $1.rssi }) else {
            announce("연결할 음향신호기가 없습니다. 먼저 진단을 실행하세요", high: true)
            return
        }
        controller.connect(target.id)
    }

    // MARK: - 사다리 3단: 명령(시험)

    func send(_ command: AudioSignalCommand) {
        muted = false
        guard !isRunning else {
            announce("진단이 끝난 뒤 보내세요", high: true)
            return
        }
        guard isServiceReady else {
            announce("서비스 준비 전입니다. 연결 확인 후 응답 구독이 켜지면 보낼 수 있습니다", high: true)
            return
        }
        lastCommand = command
        controller.send(command)
    }

    // MARK: - 청취 기록(§7.1) — 앱이 못 남기는 유일한 관측

    func recordHeard(_ heard: Heard) {
        muted = false
        let commandText = lastCommand.map(Self.label) ?? "명령 없음"
        log(AudioSignalDiagLine(event: "heard(\(heard.rawValue))", mac: connectedMac,
                                note: "직전 명령 \(commandText)", peripheralId: connectedId))
        lastEventText = "청취 기록: \(Self.heardLabel(heard)) (직전 명령 \(commandText))"
        announce("기록했습니다: \(Self.heardLabel(heard))", high: true)
    }

    /// 화면 이탈. 이후 도착하는 늦은 콜백(didDisconnect 등)은 로그만 남기고 통지는 억제한다 —
    /// 다른 화면에서 "연결 끊김"이 발화하면 맥락 밖 통지다(헌장 §6 ⑨ 이탈 게이트 동형).
    /// 다음 진단 시작이 다시 켠다(`muted = false`).
    func shutdown() {
        aliveTask?.cancel()
        diagnosisTask?.cancel()
        diagnosisTask = nil
        locationTask?.cancel()
        locationTask = nil
        if isRunning {
            log(AudioSignalDiagLine(event: "probeStop", note: "화면 이탈"))
            phase = .idle
        }
        muted = true
        controller.shutdown()
    }

    // MARK: - 상태 줄(고정 슬롯 — 문자열을 identity로 쓰면 갱신마다 행이 교체돼 포커스가 이탈한다)

    var statusLine: String {
        switch phase {
        case .idle:
            "대기 중, 블루투스 \(controllerStateText)"
        case .scanning:
            "스캔 중(\(Int(Self.scanWindow.components.seconds))초), 음향신호기 \(deviceCounts.signal)대, 기타 \(deviceCounts.other)대\(strongestRssi.map { ", 최강 \($0)dBm" } ?? "")"
        case .probing(let index, let total):
            "연결 확인 중 \(index)/\(total), 음향신호기 \(deviceCounts.signal)대, 기타 \(deviceCounts.other)대"
        case .done(let summary):
            "완료: \(summary)"
        }
    }
    var seedLine: String {
        seedNearestMeters.map { "등록된 최근접 음향신호기 \(formatDistance($0))" } ?? "등록된 최근접 음향신호기 미확인"
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
            strongestRssi = nil
            log(AudioSignalDiagLine(event: "scanStart",
                                    note: "discovered 로그 표본: 첫 발견·RSSI 6dB 이상 변화·5초 경과 중 하나"))
            lastEventText = "스캔 중"
            announce("스캔 시작")
        case .scanStop:
            log(AudioSignalDiagLine(event: "scanStop",
                                    note: "AHG001 \(deviceCounts.signal)대, 기타 \(deviceCounts.other)대"))
            lastEventText = "스캔 중지: 음향신호기 \(deviceCounts.signal)대, 기타 \(deviceCounts.other)대"
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
                    note: device.name == nil ? "형식 불일치" : Self.nameSource(device),
                    peripheralId: device.id, manufacturer: Self.manufacturerText(device),
                    connectable: device.isConnectable))
            }
            if device.rssi != 127, device.rssi > (strongestRssi ?? Int.min) { strongestRssi = device.rssi }
            let signal = signalDevices.count
            let other = controller.discoveries.count - signal
            guard (signal, other) != deviceCounts else { return }
            if signal != deviceCounts.signal { announce("음향신호기 \(signal)대 잡힘") }
            deviceCounts = (signal, other)
        case .connect(let id, let mac):
            connectedMac = mac
            connectedId = id
            log(AudioSignalDiagLine(event: "connect", mac: mac, peripheralId: id))
            lastEventText = "연결 시도 \(mac ?? String(id.uuidString.prefix(8)))"
        case .connected(let id):
            log(AudioSignalDiagLine(event: "connected", mac: connectedMac, peripheralId: id))
            if probeServices[id] != nil {
                lastEventText = "연결됨(서비스 확인 중)"
            } else {
                lastEventText = "연결됨, 12초 생존 관찰 중"
                announce("연결됨. 12초 동안 유지되는지 봅니다", high: true)
                startAliveWatch()
            }
        case .connectFailed(let id, let reason):
            aliveTask?.cancel()
            log(AudioSignalDiagLine(event: "connectFailed", mac: connectedMac, note: reason, peripheralId: id))
            lastEventText = "연결 실패: \(reason)"
            if probeServices[id] == nil { announce("연결 실패", high: true) }
        case .serviceFound(let id, let services, let characteristics, let writeFound, let notifyFound):
            let uart = services.contains { $0.caseInsensitiveCompare(AudioSignalController.serviceUUIDString) == .orderedSame }
            if var bucket = probeServices[id] {
                bucket.services.formUnion(services)
                bucket.uartFound = bucket.uartFound || uart
                probeServices[id] = bucket
            }
            log(AudioSignalDiagLine(
                event: "serviceFound", mac: connectedMac,
                note: "uart=\(uart) write=\(writeFound) notify=\(notifyFound) services=[\(services.joined(separator: ","))] chars=[\(characteristics.joined(separator: ","))]",
                peripheralId: id))
            lastEventText = "서비스 탐색: UART \(uart ? "있음" : "없음"), write \(writeFound ? "있음" : "없음"), notify \(notifyFound ? "있음" : "없음"), 서비스 \(services.count)개"
        case .notifyOn(let id, let ok, let reason):
            log(AudioSignalDiagLine(event: "notifyOn", mac: connectedMac, note: ok ? "ok" : (reason ?? "fail"), peripheralId: id))
            let ready = ok && isServiceReady
            lastEventText = ok
                ? (ready ? "응답 구독 켜짐, 명령을 보낼 수 있습니다" : "응답 구독 켜짐, write 특성 없음")
                : "응답 구독 실패: \(reason ?? "-")"
            announce(ready ? "명령을 보낼 수 있습니다" : (ok ? "응답 구독은 켜졌으나 write 특성이 없습니다" : "응답 구독 실패"), high: true)
        case .write(let id, let command, let packet, let withResponse):
            log(AudioSignalDiagLine(event: "write(\(Self.code(command)))", mac: connectedMac,
                                    note: "\(audioSignalHex(packet)) \(withResponse ? "withResponse" : "withoutResponse")",
                                    peripheralId: id))
            lastEventText = "\(Self.label(command)) 보냄 (\(audioSignalHex(packet)))"
        case .reply(let id, let reply, let raw):
            let text = Self.describe(reply)
            log(AudioSignalDiagLine(event: "reply(\(text))", mac: connectedMac, note: audioSignalHex(raw), peripheralId: id))
            lastEventText = "응답: \(text), 원시 \(audioSignalHex(raw))"
            announce("응답 \(text)", high: true)
        case .disconnect(let id, let reason, let elapsed):
            aliveTask?.cancel()
            let elapsedText = Self.elapsedText(elapsed)
            log(AudioSignalDiagLine(event: "disconnect", mac: connectedMac, note: "\(reason), \(elapsedText)", peripheralId: id))
            lastEventText = "끊김: \(elapsedText), 이유 \(reason)"
            // 이름 무관 확인의 끊김은 진단이 스스로 일으킨 것이라 통지하지 않는다(요약이 답).
            if probeServices[id] == nil { announce("연결 끊김, \(elapsedText)", high: true) }
        case .error(let message):
            log(AudioSignalDiagLine(event: "error", mac: connectedMac, note: message, peripheralId: connectedId))
            lastEventText = "오류: \(message)"
            // 자동 확인 중의 컨트롤러 가드 오류는 진단이 스스로 일으킨 것 — 요약이 답한다.
            if case .probing = phase { return }
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
            log(AudioSignalDiagLine(event: "alive(12s)", mac: connectedMac, peripheralId: connectedId))
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
        case .unknown: "미확인(진단을 시작하면 권한을 묻습니다)"
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

    static func manufacturerText(_ device: AudioSignalDiscovery) -> String? {
        guard let data = device.manufacturerData else { return nil }
        let company = device.manufacturerCompanyId.map { String(format: "%04X", $0) } ?? "????"
        return "\(company):\(data.count)"
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

/// 허브 최상단 섹션. 읽기 순서: 버튼 → 상태 → 대조 → 마지막 이벤트 순이다 — 자주 누르는
/// 버튼을 정보 블록 앞에 둔다(SR 읽기 순서에서 위치는 반복 비용). 규격 기기(`AHG001`)가
/// 잡혔을 때만 §4 사다리(연결 확인 → 명령 3 → 청취 기록 3)가 아래에 나타난다.
struct AudioSignalProbeSection: View {
    let model: AudioSignalProbeModel
    @AccessibilityFocusState private var diagnosisButtonFocused: Bool

    var body: some View {
        Section {
            // 한 버튼 — 누르면 20초 스캔 뒤 가장 센 기기 3대에 붙어 서비스만 읽고 요약한다.
            Button(model.isRunning ? "진단 중지" : "진단 시작(시험)") { model.toggleDiagnosis() }
                .accessibilityFocused($diagnosisButtonFocused)
            if !model.bluetoothUsageDeclared {
                Text("이 빌드에는 블루투스 권한 문구가 없어 스캔할 수 없습니다. 실험판(Experimental)으로 설치하세요.")
            }
            Text(model.statusLine)
            distanceText(model.seedLine)
            Text(model.lastEventLine)

            // 사다리는 진단이 끝난 뒤에만 — 진행 중엔 자동 확인 루프가 컨트롤러를 단독 소유한다
            // (같이 노출하면 수동 연결이 다음 후보 연결에 끊긴다, 리뷰 검출).
            if !model.isRunning, !model.signalDevices.isEmpty {
                Text("명령을 보내면 주변 신호기 여러 대가 함께 울릴 수 있습니다.")
                ForEach(model.signalDevices) { device in
                    Text(deviceText(device))
                }
                Text(model.connectionLine)
                if let reply = model.replyLine { Text(reply) }

                // 2단 — 연결 확인(소리 안 남). 가장 센 신호 1대에 붙어 12초 생존을 본다.
                // 라벨은 고정 — 대상 MAC은 통지·마지막 이벤트 줄로(포커스 요소 라벨 변경은 재낭독).
                Button("연결 확인(시험): 가장 가까운 1대") { model.connectStrongest() }

                // 3단 — 명령(소리 남). 순서 고정: 위치 설명(0x03) → 위치 안내(0x01) → 신호 안내(0x02).
                // `.disabled` 금지(포커스가 떨어진다) — 준비 전엔 핸들러 가드가 통지로 답한다.
                Button("위치 설명 보내기(시험)") { model.send(.describe) }
                Button("위치 안내 보내기(시험)") { model.send(.locate) }
                Button("신호 안내 보내기(시험)") { model.send(.signal) }
            }
            if model.lastCommand != nil {
                // 청취 기록 — 앱이 못 남기는 관측을 로그에 박는다(직전 명령과 묶임). 라벨은
                // 동작 서술(상태 줄과 같은 어형이면 상태로 들린다).
                Button("소리 났음 기록") { model.recordHeard(.yes) }
                Button("소리 안 났음 기록") { model.recordHeard(.no) }
                Button("여러 대 울렸음 기록") { model.recordHeard(.multiple) }
            }
        } header: {
            Text("음향신호기 BLE 진단(시험)").accessibilityAddTraits(.isHeader)
        }
        // 권한 알럿이 닫히면 커서가 body로 떨어진다(헌장 §5) — 진단 버튼으로 명시 복원.
        .onChange(of: model.permissionResolvedTick) { _, _ in diagnosisButtonFocused = true }
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
