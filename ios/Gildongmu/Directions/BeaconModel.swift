import CoreLocation
import Foundation
import GildongmuKit
import Observation
import SwiftUI

/// 거리 추적 오케스트레이터. **판정은 전부 Kit이 하고 여기는 배선만 한다.**
///
/// 이 계층에 로직을 두면 검증이 불가능하다(앱 타깃 테스트 번들이 없다). 그래서
/// 리듀서는 `beaconStep`, 톤·통지 판정은 `beaconGateStep`이 맡고, 이 클래스는
/// 권한·타임아웃·신선도 게이트·I/O만 담당한다.
///
/// 전경 전용 계약: 화면을 켜 두고(`isIdleTimerDisabled`) 앱이 앞에 있는 동안만
/// 추적한다. 백그라운드 위치는 도입하지 않는다(위원장 결정, spec §8.1).
@Observable @MainActor
final class BeaconModel {
    enum Status: Equatable {
        case idle
        case tracking
        /// 권한 거부·제한. 3-state에서 "정보 없음"과 구분되는 실패다.
        case denied
        /// 위치를 얻을 수 없음(서비스 꺼짐·연속 실패).
        case unavailable
    }

    private(set) var status: Status = .idle
    /// 화면에 보이는 상태 1줄. 웹에는 눈에 보이는 live region이 있는데 그게 없으면
    /// VoiceOver를 끈 사람에게 아무 변화도 안 보인다(2.1(a) 반려 전력과 동형).
    private(set) var statusText = ""

    /// 검색 시트가 떠 있는 동안 톤을 죽인다. 시트에 받아쓰기가 있고, 스피커로 나간
    /// 톤이 마이크로 돌아와 전사를 오염시킨 이력이 이 repo에 세 번 있다.
    /// `SpeechService`는 뷰별 `@State`라 여기서 관찰할 수 없으므로, 뷰가 시트 표시
    /// 여부를 알려 주는 더 굵은 규칙을 쓴다(받아쓰기 직전까지 함께 덮여 더 안전하다).
    var tonesSuppressed = false

    private var beaconState = BeaconState.initial
    private var gateState = BeaconGateState.initial
    private var dest: BeaconDest?
    private let tones = BeaconTonePlayer()
    private var watchdog: Task<Void, Never>?
    private var lastFixAt: Double?
    private var startedAt: Double?
    private var lastStaleNoticeAt: Double?

    /// 첫 fix는 흔히 캐시라 앵커가 수백 m 어긋난다. 이 값보다 오래된 fix는 버린다.
    private let freshnessWindow = 5.0
    /// 이 시간 동안 fix가 없으면 "신호 약함"을 알린다(`startUpdatingLocation`엔
    /// 웹 `watchPosition`의 timeout에 해당하는 개념이 없다).
    private let noFixTimeout = 15.0
    private let staleRenotifyInterval = 30.0

    var isTracking: Bool { status == .tracking }

    // MARK: - 시작·중지

    func toggle(dest: BeaconDest) {
        if isTracking {
            stop(playTone: true)
        } else {
            Task { await start(dest: dest) }
        }
    }

    private func start(dest: BeaconDest) async {
        guard !isTracking else { return }

        // 권한 게이트. 목적지·출발지가 둘 다 장소면 조회가 측위를 하지 않으므로,
        // 위치 권한을 한 번도 준 적 없는 사용자가 이 버튼에 도달할 수 있다.
        // currentCoordinate()가 notDetermined일 때 시스템 팝업을 띄운다(팝업이 곧 신호).
        do {
            _ = try await LocationService.shared.currentCoordinate()
        } catch {
            status = .denied
            statusText = appLocalized("beacon.denied")
            announce(statusText)
            return
        }

        self.dest = dest
        beaconState = .initial
        gateState = .initial
        lastFixAt = nil
        lastStaleNoticeAt = nil
        startedAt = ProcessInfo.processInfo.systemUptime
        status = .tracking
        statusText = ""
        UIApplication.shared.isIdleTimerDisabled = true
        playTone(.start)

        LocationService.shared.startBeaconUpdates(
            onFix: { [weak self] fix in self?.handle(fix: fix) },
            onError: { [weak self] in self?.handleLocationError() },
            onAuthChange: { [weak self] status in self?.handle(authorization: status) }
        )
        startWatchdog()
    }

    /// 중지. 어느 경로로 불려도 idle timer가 반드시 풀리도록 먼저 해제한다
    /// (전역 가변 상태라 누수되면 화면이 영영 안 꺼진다).
    func stop(playTone shouldPlayTone: Bool = false) {
        UIApplication.shared.isIdleTimerDisabled = false
        watchdog?.cancel()
        watchdog = nil
        LocationService.shared.stopBeaconUpdates()
        if shouldPlayTone && status == .tracking { playTone(.stop) }
        if status == .tracking { status = .idle }
        statusText = ""
        beaconState = .initial
        gateState = .initial
        dest = nil
        tones.shutdown()
    }

    /// 목적지가 바뀌면 옛 목적지를 추적하는 창이 생기므로 즉시 멈춘다.
    /// 사용자가 유발하지 않은 전이라 라벨 변화만으로는 신호가 안 되어 통지한다.
    func stopBecauseDestinationChanged() {
        guard isTracking else { return }
        stop()
        announce(appLocalized("beacon.stop"))
    }

    // MARK: - 앱 생명주기 (전경 전용 계약)

    func handleScenePhaseChange(to phase: ScenePhase) {
        guard isTracking else { return }
        switch phase {
        case .active:
            // 복귀 시 앵커를 버린다. 몇 분 전 위치 기준으로 첫 fix가 큰 점프를 만들면
            // 거짓 추세가 발화된다.
            beaconState = .initial
            gateState = .initial
            lastFixAt = nil
            startedAt = ProcessInfo.processInfo.systemUptime
            UIApplication.shared.isIdleTimerDisabled = true
        case .background, .inactive:
            UIApplication.shared.isIdleTimerDisabled = false
        @unknown default:
            break
        }
    }

    // MARK: - fix 처리

    private func handle(fix: LocationService.BeaconFixPayload) {
        guard isTracking, let dest else { return }

        // 신선도 게이트: 음수 accuracy(좌표 무효 신호)와 캐시 위치를 앵커에서 배제한다.
        let age = Date().timeIntervalSince(fix.timestamp)
        guard fix.accuracy > 0, age <= freshnessWindow else { return }

        let now = ProcessInfo.processInfo.systemUptime
        lastFixAt = now
        lastStaleNoticeAt = nil

        let stepped = beaconStep(
            state: beaconState,
            fix: BeaconFix(lat: fix.lat, lng: fix.lng, accuracy: fix.accuracy),
            dest: dest
        )
        beaconState = stepped.state

        let gated = beaconGateStep(state: gateState, announce: stepped.announce, now: now)
        gateState = gated.state

        if let tone = gated.tone { playTone(tone) }
        if let notice = gated.notice {
            let text = self.text(for: notice)
            statusText = text
            announce(text)
        }
    }

    private func handleLocationError() {
        guard isTracking else { return }
        noticeStaleIfNeeded(force: true)
    }

    private func handle(authorization status: CLAuthorizationStatus) {
        guard isTracking else { return }
        switch status {
        case .denied, .restricted:
            stop()
            self.status = .denied
            statusText = appLocalized("beacon.denied")
            announce(statusText)
        default:
            break
        }
    }

    // MARK: - 무-fix 감시

    /// `startUpdatingLocation()`에는 타임아웃 개념이 없다. 감시가 없으면 "추적 중인데
    /// 안 움직이는 것"과 "죽은 것"이 구분되지 않는다(시각장애 사용자에겐 치명적).
    private func startWatchdog() {
        watchdog?.cancel()
        watchdog = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(5))
                guard let self, self.isTracking else { continue }
                self.noticeStaleIfNeeded(force: false)
            }
        }
    }

    private func noticeStaleIfNeeded(force: Bool) {
        let now = ProcessInfo.processInfo.systemUptime
        let reference = lastFixAt ?? startedAt ?? now
        guard force || now - reference >= noFixTimeout else { return }
        if let last = lastStaleNoticeAt, now - last < staleRenotifyInterval { return }
        lastStaleNoticeAt = now
        statusText = appLocalized("beacon.weak")
        announce(statusText)
    }

    // MARK: - 출력

    private func playTone(_ tone: BeaconTone) {
        guard !tonesSuppressed else { return }
        tones.play(tone)
        // 톤이 죽었는데 조용히 넘어가면 hold·tick엔 통지가 없어 사용자가 원인을 모른다.
        if tones.isSilenced && statusText.isEmpty {
            statusText = appLocalized("beacon.weak")
        }
    }

    private func text(for notice: BeaconNotice) -> String {
        switch notice {
        case .first(let meters): appLocalized("beacon.first", String(meters))
        case .closer(let meters): appLocalized("beacon.closer", String(meters))
        case .farther(let meters): appLocalized("beacon.farther", String(meters))
        case .nearby(let accuracyMeters): appLocalized("beacon.nearby", String(accuracyMeters))
        case .weak: appLocalized("beacon.weak")
        }
    }

    private func announce(_ message: String) {
        AccessibilityNotification.Announcement(message).post()
    }
}
