import SwiftUI
import GildongmuKit

/// 여정(E70) 단계 사이의 시트 — 다음 세션 준비 중이거나 실패해 사용자의 결정을 기다리는 동안(spec §6.3·§6.4).
/// 상태 문장 한 줄 + (실패면) 해결 수단·[경로 다시 조회]·단계 버튼 + [안내 종료]. 착지는 상태 문장이다.
/// 단계 세션이 서면 루트 `.sheet(item:)`이 그 세션의 시트로 바꾼다(시트를 더하지 않는다, N1).
struct JourneySheet: View {
    let session: GuideSession
    let onMinimize: () -> Void

    @AccessibilityFocusState private var statusFocused: Bool

    var body: some View {
        NavigationStack {
            List {
                // 한 줄 = 한 객체. 통지는 하지 않는다 — 실패 문장은 그 모델이 이미 냈고, 준비 중은 곧 다음 세션의 시작 통지가 온다.
                Text(journeyStatusText(session))
                    .accessibilityFocused($statusFocused)
                if case .failed(let stage)? = session.journey?.phase {
                    failedControls(stage)
                }
            }
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) { GuideMinimizeButton(action: onMinimize) }
            }
            .safeAreaInset(edge: .bottom) {
                GuideStopButton { session.journeyAction(.userEnded) }
            }
        }
        .task { await landStatus() }
        // 준비 중 → 실패로 바뀌면 커서를 상태 문장에 다시 앉힌다(버튼이 새로 생기는 전이라 착지가 안내다).
        .onChange(of: failedStage) { _, stage in
            guard stage != nil else { return }
            Task { await landStatus() }
        }
    }

    private var failedStage: JourneyStage? {
        if case .failed(let stage)? = session.journey?.phase { stage } else { nil }
    }

    @ViewBuilder private func failedControls(_ stage: JourneyStage) -> some View {
        // 해결 수단(권한 철회·정밀 위치 꺼짐으로 끊긴 경우, §6.1) — 길찾기 탭의 같은 자리와 같은 버튼.
        switch session.journeyFailure?.resolution {
        case .settings?:
            Button(appLocalized("ios.common.openSettings")) { openAppSettings() }
        case .precise?:
            Button(appLocalized("ios.common.allowPrecise")) {
                Task { @MainActor in
                    if await LocationService.shared.requestTemporaryPreciseAccuracy() == .granted {
                        session.journeyAction(.retry)
                    }
                }
            }
        default:
            EmptyView()
        }
        // 출구 도보 시작 실패는 「택시에 탔어요」가 곧 다음 단계라 재시도를 두지 않는다(§6.4 표) — 끊긴 경우는 둔다.
        if stage != .egress || session.journeyFailure != nil {
            Button(appLocalized("guide.rerouteButton")) { session.journeyAction(.retry) }
        }
        if stage == .taxiIn {
            Button(appLocalized("ios.journey.taxiDropped")) { session.journeyAction(.taxiDropped) }
        }
        if stage == .egress {
            Button(appLocalized("ios.journey.taxiBoarded")) { session.journeyAction(.taxiBoarded) }
        }
    }

    /// 시트 표시 애니메이션이 끝난 뒤 대입하고, 먹지 않았으면 한 번만 다시(`landBeaconStartFocus` 동형).
    private func landStatus() async {
        try? await Task.sleep(for: .milliseconds(400))
        statusFocused = true
        try? await Task.sleep(for: .milliseconds(600))
        if !statusFocused { statusFocused = true }
    }
}

/// 여정 시트의 상태 문장 — 띠바 요약도 같은 문장을 쓴다(둘로 적으면 드리프트한다).
@MainActor
func journeyStatusText(_ session: GuideSession) -> String {
    guard case .failed(let stage)? = session.journey?.phase else {
        return appLocalized("directions.loading")
    }
    if let failure = session.journeyFailure { return appLocalized(failure.key) }
    return stage == .egress
        ? appLocalized("ios.journey.egressStartFailed")
        : appLocalized("ios.journey.taxiOutFailed")
}
