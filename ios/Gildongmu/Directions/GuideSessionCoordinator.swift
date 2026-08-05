import Foundation

/// 실시간 길 안내 세션 단일성 코디네이터(B2 §3.2) — 웹 `guide-session-store` 동형.
///
/// 도보·자동차(`BeaconModel`)와 대중교통(`TransitGuideModel`)이 서로 다른 모델
/// 인스턴스라, 앱 수준 싱글턴이 상호 배제를 든다. 플랫폼당 활성 안내 세션은
/// 최대 1개다: watch·Wake Lock·통지 채널이 2벌 돌면 통지가 겹치고 위치 구독이
/// 이중 과금된다. **claim은 기존 세션의 동기 stop 완료 후에만 성립**하고, 통지
/// 커밋은 각 모델이 세션 토큰(세대)으로 검증한다(늦은 통지 혼입 차단).
@MainActor
final class GuideSessionCoordinator {
    static let shared = GuideSessionCoordinator()

    private var currentStop: (() -> Void)?
    private var currentToken = 0

    /// 활성 안내 세션 존재 여부 — 유휴 복귀 리셋(IdleReset)의 예외 판정용(피드백
    /// 라운드1 11-가: 안내 중 10분 백그라운드 복귀가 TabView 재생성으로 세션을 죽였다).
    var isActive: Bool { currentStop != nil }

    /// 세션 시작 직전 호출 — 다른 소유자가 있으면 그 세션을 먼저 동기 중지한다.
    /// 반환 토큰은 release 검증 키(늦은 release가 새 소유자를 지우지 않게).
    @discardableResult
    func claim(stop: @escaping () -> Void) -> Int {
        if let previous = currentStop {
            currentStop = nil // 재진입 가드: previous() 안의 release가 no-op이 되게
            previous()
        }
        currentToken += 1
        currentStop = stop
        return currentToken
    }

    /// 세션 종료 시 호출 — 자기 토큰일 때만 비운다.
    func release(_ token: Int) {
        guard token == currentToken else { return }
        currentStop = nil
    }
}
