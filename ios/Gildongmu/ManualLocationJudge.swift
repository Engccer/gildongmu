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
    /// ⚠ 어느 갈래로 끝나든 **결과를 스토어에 남긴다.** 결과를 버리면 라벨이
    /// `origin` 유무만 보게 되어, 지금 판정할 수 없는 상태(권한 철회·실내 측위 실패)가
    /// 검증 가능형으로 낭독된다 — 더 나쁜 상태가 더 안심시키는 라벨을 내는 역전이다
    /// (spec §4.5). 웹 `runManualLocationJudgment`와 같은 약속이다.
    static func run() async {
        guard let manual = ManualLocationStore.shared.current else { return }
        // 수명 만료는 측위보다 **앞**이다 — 판정할 수 없는 상태(origin 없음·권한 없음·측위 실패)와
        // 같은 자리에 머문 상태(`keep`)가 바로 며칠 전 지정이 남는 자리라, 뒤에 두면 닿지 않는다.
        let startedAt = Date().timeIntervalSince1970
        if isManualLocationExpired(manual, now: startedAt) {
            diag("expired age=\(Int(startedAt - manual.setAt))s origin=\(manual.origin != nil)")
            // 통지하지 않는다(위원장 판정 2026-11-24) — 화면이 현재 위치로 돌아와 있는 것으로 충분하다.
            ManualLocationStore.shared.clear()
            return
        }
        // origin이 없으면 어떤 fix로도 판정할 수 없다 — 측위 비용을 치르지 않는다.
        guard manual.origin != nil else {
            ManualLocationStore.shared.setVerdict(.undecidable)
            return
        }
        // 권한이 없으면 팝업을 띄우지 않고 유지한다(증거 부재). 유지하되 그 사실을
        // 라벨이 말한다 — 이 갈래가 리뷰가 든 시나리오(권한 철회 + 이동)의 자리다.
        let auth = LocationService.shared.authorizationSnapshot
        guard auth == .authorizedWhenInUse || auth == .authorizedAlways else {
            ManualLocationStore.shared.setVerdict(.undecidable)
            return
        }

        let captured = manual.revision
        let fix = try? await LocationService.shared.currentFix(force: true)
        let verdict = judgeManualLocation(manual: manual, fix: fix, now: Date().timeIntervalSince1970)

        // CAS: 판정 왕복 중 재지정됐으면 늦게 온 옛 판정을 폐기한다(해제도 라벨도).
        guard ManualLocationStore.shared.current?.revision == captured else { return }

        diag("verdict=\(verdict.rawValue) age=\(Int(startedAt - manual.setAt))s fix=\(fix != nil) acc=\(fix.map { String(Int($0.accuracy)) } ?? "-")")
        guard verdict == .drop else {
            ManualLocationStore.shared.setVerdict(verdict)
            return
        }

        ManualLocationStore.shared.clear()
        announcer?()
    }

    /// 판정 기록(실험판·디버그만). 2026-11-23 실사용에서 지정이 풀리지 않은 까닭을 기기 로그로
    /// 가리지 못했다 — 판정이 아무것도 남기지 않았기 때문이다. 좌표는 적지 않는다.
    private static func diag(_ line: String) {
        #if DEBUG || EXPERIMENTAL
        DiagFileLog.guide.append("[ManualLocation] [\(Date().ISO8601Format())] \(line)")
        #endif
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
