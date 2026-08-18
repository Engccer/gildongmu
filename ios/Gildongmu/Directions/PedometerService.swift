import CoreMotion
import Foundation

/// 만보계 조회 결과. `.unavailable`은 이번 세션에 재시도가 무의미한 상태(권한 거부·미지원),
/// `.failed`는 재시도 가치가 있는 상태(일시 오류·권한 미확정·창 역전). 화면은 둘 다
/// 행 부재로 같지만 전경 복귀 재조회는 `.failed`만 다시 본다(spec 2026-08-17 §3).
enum PedometerResult: Equatable {
    case sample(steps: Int, distanceMeters: Double?)
    case unavailable
    case failed
}

protocol PedometerQuerying: Sendable {
    /// 권한 미확정이면 짧은 조회로 시스템 팝업을 유도한다. 결과는 버린다.
    /// 사용자가 전경에서 안내 시작 버튼을 눌렀을 때만 부른다(도착 시 팝업 금지).
    func requestAuthorizationIfNeeded()
    /// `[start, end]` 구간의 걸음·거리. 24시간 초과 창은 `.failed`.
    func summary(from start: Date, to end: Date) async -> PedometerResult
    /// `start` 이후 누적 걸음·거리를 갱신될 때마다 메인 액터로 전달한다(2026-08-19). 종료
    /// 순간에 "요약을 보여 줄 만큼 걸었는가"를 **동기**로 판정하기 위한 값이다 — 사후 질의만
    /// 있으면 그 판정이 비동기가 되어 종료 화면을 띄운 뒤에야 지울 수 있다(깜빡임).
    /// 권한 거부·미지원이면 아무 갱신도 오지 않는다(호출부는 값 부재를 "요약 없음"으로 본다).
    func startLiveUpdates(from start: Date, onUpdate: @escaping @MainActor @Sendable (Int, Double?) -> Void)
    func stopLiveUpdates()
}

/// `CMPedometer` 래퍼. 시스템이 걸음을 항상 기록하므로 라이브 구독 없이 도착 시점에
/// 구간을 사후 질의한다(앱이 백그라운드였던 구간도 포함, 이력 상한 7일).
final class PedometerService: PedometerQuerying, @unchecked Sendable {  // CMPedometer는 스레드 안전 API
    private let pedometer = CMPedometer()

    func requestAuthorizationIfNeeded() {
        guard CMPedometer.isStepCountingAvailable(),
              CMPedometer.authorizationStatus() == .notDetermined
        else { return }
        let now = Date()
        pedometer.queryPedometerData(from: now.addingTimeInterval(-1), to: now) { _, _ in }
    }

    func startLiveUpdates(
        from start: Date, onUpdate: @escaping @MainActor @Sendable (Int, Double?) -> Void
    ) {
        guard CMPedometer.isStepCountingAvailable() else { return }
        pedometer.startUpdates(from: start) { data, error in
            guard error == nil, let data else { return }
            let steps = data.numberOfSteps.intValue
            let distance = data.distance?.doubleValue
            Task { @MainActor in onUpdate(steps, distance) }
        }
    }

    func stopLiveUpdates() {
        pedometer.stopUpdates()
    }

    func summary(from start: Date, to end: Date) async -> PedometerResult {
        guard CMPedometer.isStepCountingAvailable() else { return .unavailable }
        switch CMPedometer.authorizationStatus() {
        case .denied, .restricted: return .unavailable
        case .notDetermined: return .failed
        case .authorized: break
        @unknown default: return .failed
        }
        let span = end.timeIntervalSince(start)
        guard span > 0, span <= 24 * 3600 else { return .failed }
        return await withCheckedContinuation { cont in
            pedometer.queryPedometerData(from: start, to: end) { data, error in
                guard error == nil, let data else { return cont.resume(returning: .failed) }
                cont.resume(returning: .sample(
                    steps: data.numberOfSteps.intValue,
                    distanceMeters: data.distance?.doubleValue
                ))
            }
        }
    }
}
