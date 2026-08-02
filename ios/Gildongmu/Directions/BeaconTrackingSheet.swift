import GildongmuKit
import SwiftUI

/// 거리 추적 중 화면. **시작이 곧 이 시트의 표시이고, 중지가 곧 닫힘이다(1:1).**
///
/// 인라인 섹션에서 분리한 이유는 걷는 중의 탐색 비용이다. 길찾기 결과 화면에는 수단
/// 섹션이 이어지고 도보는 인라인 전개라 수백 행이 될 수 있어(천호역 실측), 추적을
/// 멈추려면 그 목록 안에서 버튼을 찾아야 했다. 시트는 VoiceOver 스코프를 이 화면으로
/// 가두므로 스와이프 몇 번이면 상태와 중지 버튼에 닿는다(위원장 실보행 피드백 2026-08-02).
///
/// 부수 효과로 리뷰 이력의 C-1(추적 중 결과가 바뀌면 중지 버튼이 화면에서 사라지던 결함)이
/// 구조적으로 재발할 수 없다. 시트가 떠 있는 한 중지 버튼은 항상 여기 있다.
///
/// 스와이프·VoiceOver escape로 닫아도 추적이 멈춘다(`interactiveDismissDisabled` 미사용).
/// 걷는 중 오조작으로 꺼지는 위험보다, 시각장애 사용자가 닫을 수 없는 화면에 갇히는 쪽이
/// 나쁘다. 실수로 닫히면 다시 시작하면 된다.
struct BeaconTrackingSheet: View {
    let destinationLabel: String
    let statusText: String
    let onStop: () -> Void

    @AccessibilityFocusState private var stopFocused: Bool

    var body: some View {
        List {
            Section {
                Button(appLocalized("beacon.stop"), action: onStop)
                    .accessibilityFocused($stopFocused)
                // 가시 상태 1줄. 통지는 모델의 단일 Announcement가 담당하므로 여기서
                // 다시 알리지 않는다(보이는 콘텐츠의 live region 복제 금지).
                if !statusText.isEmpty {
                    distanceText(statusText).foregroundStyle(.secondary)
                }
                Text(appLocalized("beacon.screenHint"))
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            } header: {
                // 무엇을 추적 중인지가 화면에 있어야 한다. 시트로 분리되면서 주변 맥락이
                // 통째로 사라졌으므로 여기서만 알 수 있다.
                Text(joinText(appLocalized("beacon.heading"), destinationLabel))
                    .accessibilityAddTraits(.isHeader)
            }
        }
        .task { await landStopFocus() }
    }

    /// 열릴 때 포커스를 **중지 버튼**에 둔다. 걷는 중 필요한 유일한 행동이고, 시트
    /// 수명 내내 존재해 헌장 §5의 "포커스를 쥔 요소가 사라지는 전이"가 생기지 않는다.
    /// 상태 변화는 이미 polite 통지가 전달하므로 커서가 상태 텍스트에 있을 이유가 없다.
    ///
    /// 지연·검증·1회 재시도는 이 저장소의 검증된 착지 패턴을 따른다(`ChatConversationView`·
    /// `landFocusAfterResolve`). 시트 표시 애니메이션이 끝나며 시스템이 포커스를 옮기므로
    /// 그보다 늦게 대입해야 이긴다.
    private func landStopFocus() async {
        try? await Task.sleep(for: .milliseconds(400))
        stopFocused = true
        try? await Task.sleep(for: .milliseconds(600))
        // 먹지 않았을 때만 1회 재시도(무한 재대입은 커서를 붙잡아 되레 방해가 된다).
        guard !stopFocused else { return }
        stopFocused = true
    }
}
