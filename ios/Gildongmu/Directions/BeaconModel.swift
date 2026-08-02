import CoreLocation
import Foundation
import GildongmuKit
import Observation
import SwiftUI

/// 거리 추적 오케스트레이터. **판정은 전부 Kit이 하고 여기는 배선만 한다.**
///
/// 이 계층에 로직을 두면 검증이 불가능하다(앱 타깃 테스트 번들이 없다). 그래서
/// 리듀서는 `beaconStep`, 톤·통지 판정은 `beaconGateStep`, fix 수용 판정은
/// `isUsableFix`가 맡고, 이 클래스는 권한·타임아웃·I/O만 담당한다.
///
/// 전경 전용 계약: 화면을 켜 두고(`isIdleTimerDisabled`) 앱이 앞에 있는 동안만
/// 추적한다. 백그라운드 위치는 도입하지 않는다(위원장 결정, spec §8.1).
@Observable @MainActor
final class BeaconModel {
    enum Status: Equatable {
        case idle
        case tracking
        /// 권한 거부·제한.
        case denied
        /// 위치 서비스 꺼짐·취득 실패. `denied`와 문구가 달라야 한다. 사용자가 취할
        /// 행동이 다르다(설정에서 권한 허용 vs 하늘이 트인 곳으로 이동).
        case unavailable
    }

    private(set) var status: Status = .idle
    /// 추적 중인 목적지 이름. 추적 화면이 이 값을 읽는다.
    ///
    /// 뷰가 파생하지 않고 모델이 드는 이유는 경합이다. 뷰의 `trackedDestination`은
    /// 도착지가 "현재 위치"로 바뀌는 순간 nil이 되는데, 같은 변화가 추적도 멈춘다.
    /// 두 반응이 같은 프레임에 걸리면 시트가 닫히기 직전 **내용 없는 화면**이 한 프레임
    /// 스친다(스크린 리더에겐 빈 화면이 스쳐 지나가는 것이라 시각보다 혼란이 크다).
    /// 시작 시점의 이름을 모델이 붙들면 그 질문 자체가 없어진다.
    ///
    /// ⚠ `stop()`에서 비우지 않는다. 시트 dismiss 애니메이션 동안 내용부가 다시
    /// 평가되므로, 비우면 같은 빈 화면이 닫히는 길에 재현된다. 추적 중이 아닐 때 이
    /// 값을 읽는 곳은 없다.
    private(set) var destinationLabel = ""
    /// 화면에 보이는 상태 1줄. 웹에는 눈에 보이는 live region이 있는데 그게 없으면
    /// VoiceOver를 끈 사람에게 아무 변화도 안 보인다(2.1(a) 반려 전력과 동형).
    private(set) var statusText = ""

    /// 검색 시트가 떠 있는 동안 **톤과 통지를 모두** 죽인다. 시트에 받아쓰기가 있고,
    /// 헌장 §6의 홀드 계약 불변식은 "녹음 중 SR 발화 0"이다. polite 통지는 VoiceOver가
    /// 실제로 말하는 음성이라 톤보다 전사 오염 위험이 오히려 크다(스피커→마이크 경로는
    /// 이 저장소에서 세 번 실측됐다). 추적과 상태 텍스트는 유지한다.
    var outputSuppressed = false {
        // 톤 재생기에도 전파한다. 재생 경로만 막으면 인터럽션·구성변경 옵서버가
        // 여전히 세션 카테고리를 되돌려 받아쓰기 세션을 깬다(리뷰 I-8).
        didSet { tones.isSuppressed = outputSuppressed }
    }

    private var beaconState = BeaconState.initial
    private var gateState = BeaconGateState.initial
    private var dest: BeaconDest?
    private let tones = BeaconTonePlayer()
    private var startTask: Task<Void, Never>?
    private var watchdog: Task<Void, Never>?
    private var lastFixAt: Double?
    private var startedAt: Double?
    private var lastStaleNoticeAt: Double?
    /// 시작 재진입 가드. 클로저 가드만으론 await를 넘는 더블탭을 못 막는다(repo 관례).
    private var starting = false
    /// 백그라운드 복귀 리셋 직후의 첫 안내를 삼킨다. 앵커를 버리면 다음 fix가 first-fix
    /// 경로를 타서 절대거리가 재발화되는데, 사용자가 유발한 사건이 아니다.
    private var suppressNextNotice = false
    /// `.background`를 실제로 거쳤는가. `.inactive`(제어센터·알림센터 같은 짧은
    /// 인터럽션)만으로 앵커를 버리면 추세가 계속 초기화된다(`GildongmuApp`의
    /// `backgroundedAt` 패턴과 같은 판정).
    private var wasBackgrounded = false

    private let noFixTimeout = 15.0
    private let staleRenotifyInterval = 30.0

    var isTracking: Bool { status == .tracking }

    // MARK: - 시작·중지

    func toggle(dest: BeaconDest, label: String) {
        if isTracking {
            stop(playStopTone: true)
        } else {
            guard !starting else { return }
            starting = true
            startTask = Task { [weak self] in
                await self?.start(dest: dest, label: label)
                self?.starting = false
            }
        }
    }

    private func start(dest: BeaconDest, label: String) async {
        guard !isTracking else { return }

        // 권한 게이트는 `authorizationSnapshot`을 직접 본다. `currentCoordinate()`는
        // 캐시 우선이라 권한을 보지 않고 반환하는 경로가 있고, 그러면 권한 회수 후에도
        // "성공"해서 시작 톤만 나고 fix는 영영 오지 않는다(무한 침묵).
        guard LocationService.shared.isLocationServiceEnabled else {
            fail(with: .unavailable, key: "beacon.weak")
            return
        }
        switch LocationService.shared.authorizationSnapshot {
        case .denied, .restricted:
            fail(with: .denied, key: "beacon.denied")
            return
        case .notDetermined:
            // 팝업 자체가 신호다. 허용 여부는 아래에서 다시 확인한다.
            await LocationService.shared.primeAuthorization()
            guard !Task.isCancelled else { return }
            switch LocationService.shared.authorizationSnapshot {
            case .authorizedWhenInUse, .authorizedAlways: break
            default:
                fail(with: .denied, key: "beacon.denied")
                return
            }
        default:
            break
        }

        // 정밀 위치가 꺼져 있으면 좌표가 1~20km 오차라 "가까워지는 중/멀어지는 중"이
        // 전부 잡음이 된다. 데드밴드(max(15, accuracy))도 그 규모에서는 의미를 잃는다.
        // 걸으면서 소리만 듣는 기능이라 틀린 안내가 화면으로 반증되지도 않는다.
        guard LocationService.shared.accuracySnapshot != .reducedAccuracy else {
            fail(with: .unavailable, key: "beacon.reduced")
            return
        }

        // await를 넘어온 뒤 화면을 떠났을 수 있다. 여기서 안 막으면 다른 탭에서 톤이
        // 계속 나는 좀비 추적이 되고, 그 화면의 onDisappear는 이미 지나갔다.
        guard !Task.isCancelled else { return }

        self.dest = dest
        destinationLabel = label
        beaconState = .initial
        gateState = .initial
        lastFixAt = nil
        lastStaleNoticeAt = nil
        suppressNextNotice = false
        startedAt = ProcessInfo.processInfo.systemUptime
        status = .tracking
        statusText = ""
        UIApplication.shared.isIdleTimerDisabled = true
        playTone(.start)

        LocationService.shared.startBeaconUpdates(
            onFix: { [weak self] fix in self?.handle(fix: fix) },
            onError: { [weak self] code in self?.handle(locationError: code) },
            onAuthChange: { [weak self] status in self?.handle(authorization: status) },
            onAccuracyChange: { [weak self] accuracy in self?.handle(accuracy: accuracy) }
        )
        startWatchdog()
    }

    private func fail(with status: Status, key: String) {
        self.status = status
        statusText = appLocalized(key)
        announce(statusText)
    }

    /// 중지. 어느 경로로 불려도 idle timer가 반드시 풀리도록 먼저 해제한다
    /// (전역 가변 상태라 누수되면 화면이 영영 안 꺼진다).
    ///
    /// ⚠ 톤 엔진은 여기서 정리하지 않는다. 정지 톤을 예약한 직후 엔진을 멈추면
    /// 하강 3음이 한 프레임도 나지 않는다. 정리는 `teardown()` 몫이다.
    func stop(playStopTone: Bool = false) {
        startTask?.cancel()
        startTask = nil
        starting = false
        UIApplication.shared.isIdleTimerDisabled = false
        watchdog?.cancel()
        watchdog = nil
        LocationService.shared.stopBeaconUpdates()
        if playStopTone && status == .tracking { playTone(.stop) }
        if status == .tracking { status = .idle }
        statusText = ""
        beaconState = .initial
        gateState = .initial
        dest = nil
    }

    /// 화면 이탈 정리. 중지에 더해 오디오 자원까지 반납한다.
    func teardown() {
        stop()
        tones.shutdown()
    }

    /// 목적지가 바뀌면 옛 목적지를 추적하는 창이 생기므로 즉시 멈춘다.
    /// 사용자가 비콘 컨트롤을 조작한 게 아니라 라벨 변화만으로는 신호가 안 되어 통지한다.
    func stopBecauseDestinationChanged() {
        guard isTracking else { return }
        stop()
        announce(appLocalized("ios.beacon.stopped"))
    }

    // MARK: - 앱 생명주기 (전경 전용 계약)

    func handleScenePhaseChange(to phase: ScenePhase) {
        switch phase {
        case .background:
            wasBackgrounded = true
            UIApplication.shared.isIdleTimerDisabled = false
        case .active:
            guard isTracking else { return }
            UIApplication.shared.isIdleTimerDisabled = true
            // `.background`를 거친 복귀에서만 앵커를 버린다. 제어센터를 잠깐 여는
            // `.inactive` 왕복까지 리셋하면 추세가 계속 초기화되고 절대거리가 재발화된다.
            guard wasBackgrounded else { return }
            wasBackgrounded = false
            beaconState = .initial
            gateState = .initial
            lastFixAt = nil
            startedAt = ProcessInfo.processInfo.systemUptime
            suppressNextNotice = true
        default:
            break
        }
    }

    // MARK: - fix 처리

    private func handle(fix: LocationService.BeaconFixPayload) {
        guard isTracking, let dest else { return }

        // 캐시 위치와 무효 좌표를 앵커에서 배제한다(판정은 Kit 순수 함수).
        let age = Date().timeIntervalSince(fix.timestamp)
        guard isUsableFix(accuracy: fix.accuracy, ageSeconds: age) else { return }

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
            if suppressNextNotice {
                suppressNextNotice = false  // 복귀 직후 1회만 삼킨다
            } else {
                announce(text)
            }
        }
    }

    /// 오류 코드를 뭉개면 "위치 서비스 꺼짐"과 "일시적 취득 실패"가 한 문구가 된다.
    private func handle(locationError code: CLError.Code) {
        guard isTracking else { return }
        switch code {
        case .denied:
            stop()
            fail(with: .unavailable, key: "beacon.weak")
        case .locationUnknown:
            // Apple이 무시를 권하는 일시 오류. 진짜 끊김은 워치독이 잡는다.
            break
        default:
            noticeStaleIfNeeded(force: true)
        }
    }

    private func handle(authorization status: CLAuthorizationStatus) {
        guard isTracking else { return }
        switch status {
        case .denied, .restricted:
            stop()
            fail(with: .denied, key: "beacon.denied")
        default:
            break
        }
    }

    /// 세션 중 "정확한 위치"가 꺼지면 즉시 멈춘다.
    ///
    /// 시작 게이트만으로는 부족하다: 걷는 도중 설정에서 꺼도 추적이 계속되고,
    /// 1~20km 오차 좌표로 "가까워지는 중"을 소리로 안내하게 된다. 사용자가 비콘
    /// 컨트롤을 조작한 게 아니므로 라벨 변화가 신호가 되지 못해 통지가 필요하다.
    private func handle(accuracy: CLAccuracyAuthorization) {
        guard isTracking, accuracy == .reducedAccuracy else { return }
        stop()
        fail(with: .unavailable, key: "beacon.reduced")
    }

    // MARK: - 무-fix 감시

    /// `startUpdatingLocation()`에는 타임아웃 개념이 없다. 감시가 없으면 "추적 중인데
    /// 안 움직이는 것"과 "죽은 것"이 구분되지 않는다(시각장애 사용자에겐 치명적).
    private func startWatchdog() {
        watchdog?.cancel()
        watchdog = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(5))
                // self가 사라졌으면 루프도 끝내야 한다(무한 웨이크업 방지).
                guard let self else { return }
                guard self.isTracking else { continue }
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
        guard !outputSuppressed else { return }
        tones.play(tone)
        // 톤이 죽으면 hold·tick엔 통지가 없어 사용자가 침묵의 원인을 모른다.
        // GPS 약신호와 **다른 문구**여야 한다. 취해야 할 행동이 다르다.
        if tones.isSilenced {
            let text = appLocalized("ios.beacon.soundUnavailable")
            guard statusText != text else { return }
            statusText = text
            announce(text)
        }
    }

    /// ⚠ 거리 3종은 `formatDistance`(Kit 정본)를 태우고 `nearby`만 원시 미터를 쓴다.
    /// nearby의 값은 거리가 아니라 **오차 반경**이라(문구가 "약 ±N m") 거리 포맷에
    /// 태우면 다음 사람이 두 축을 같은 것으로 읽는다. `maxUsableAccuracy`가 100이라
    /// 결과 문자열은 어차피 같다.
    private func text(for notice: BeaconNotice) -> String {
        switch notice {
        case .first(let meters): appLocalized("beacon.first", formatDistance(meters))
        case .closer(let meters): appLocalized("beacon.closer", formatDistance(meters))
        case .farther(let meters): appLocalized("beacon.farther", formatDistance(meters))
        case .nearby(let accuracyMeters): appLocalized("beacon.nearby", String(accuracyMeters))
        case .weak: appLocalized("beacon.weak")
        }
    }

    private func announce(_ message: String) {
        guard !outputSuppressed else { return }
        AccessibilityNotification.Announcement(message).post()
    }
}
