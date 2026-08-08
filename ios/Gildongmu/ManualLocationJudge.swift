import Foundation
import GildongmuKit

/// 수동 위치 이동 판정과 유효 좌표 해석. 웹 `src/lib/effective-location.ts` 미러.
@MainActor
enum ManualLocationJudge {
    /// 자동 해제 통지 채널. 앱 계층이 `AccessibilityNotification.Announcement`를 문다.
    ///
    /// ⚠ 자동 해제는 반드시 통지한다. 포커스 밖 텍스트 변경을 VoiceOver는 읽지
    /// 않으므로 "표시줄이 말한다"는 사용자가 그 줄로 돌아갈 때만 성립하고,
    /// 표시줄이 없는 화면에서 복귀하면 아예 만나지 못한다.
    nonisolated(unsafe) static var announcer: (@MainActor () -> Void)?

    /// 판정 1회. 트리거 3종(scenePhase 복귀 · force 조회 · 앱 시작)이 호출한다.
    static func run() async {
        guard let manual = ManualLocationStore.shared.current else { return }
        // origin이 없으면 어떤 fix로도 판정할 수 없다 — 측위 비용을 치르지 않는다.
        guard manual.origin != nil else { return }
        // 권한이 없으면 팝업을 띄우지 않고 유지한다(증거 부재).
        let auth = LocationService.shared.authorizationSnapshot
        guard auth == .authorizedWhenInUse || auth == .authorizedAlways else { return }

        let captured = manual.revision
        let fix = try? await LocationService.shared.currentFix(force: true)
        let verdict = judgeManualLocation(manual: manual, fix: fix, now: Date().timeIntervalSince1970)
        guard verdict == .drop else { return }

        // CAS: 판정 왕복 중 재지정됐으면 늦게 온 옛 판정을 폐기한다.
        guard ManualLocationStore.shared.current?.revision == captured else { return }

        ManualLocationStore.shared.clear()
        announcer?()
    }

    /// 조회용 유효 좌표. "내 주변"·검색 거리·채팅 앵커·길찾기 출발지가 쓴다.
    ///
    /// `force:true`는 "지금 어디 있는가"를 다시 묻는 행동이므로 수동 위치라도
    /// 판정을 동반한다. 이것이 없으면 앱을 켠 채 걸어가는 동안 복귀 트리거가
    /// 영영 발화하지 않아 옛 자리로 계속 조회한다.
    static func effectiveCoordinate(force: Bool) async throws(LocationService.LocationError) -> NearbyCoord {
        if force { await run() }
        if let manual = ManualLocationStore.shared.current {
            return (lat: manual.lat, lng: manual.lng)
        }
        return try await LocationService.shared.currentCoordinate(force: force)
    }
}
