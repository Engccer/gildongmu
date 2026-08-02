import GildongmuKit
import SwiftUI

/// 실시간 길 안내 중 화면. **시작이 곧 이 시트의 표시이고, 중지가 곧 닫힘이다(1:1).**
///
/// 인라인 섹션에서 분리한 이유는 걷는 중의 탐색 비용이다. 길찾기 결과 화면에는 수단
/// 섹션이 이어지고 도보는 인라인 전개라 수백 행이 될 수 있어(천호역 실측), 추적을
/// 멈추려면 그 목록 안에서 버튼을 찾아야 했다. 시트는 VoiceOver 스코프를 이 화면으로
/// 가두므로 스와이프 몇 번이면 상태와 중지 버튼에 닿는다(위원장 실보행 피드백 2026-08-02).
///
/// 컨트롤은 스펙 §4.2의 집합이 전부다: 중지·반복·진행 상황·전환(경로 보유 시)·
/// 재조회(이탈 시). "다음으로 건너뛰기"는 두지 않는다(선례 부재 + 사용자가 진행을
/// 주장하게 만드는 실패 모드, 조사 §5.4).
///
/// 스와이프·VoiceOver escape로 닫아도 추적이 멈춘다(`interactiveDismissDisabled` 미사용).
/// 걷는 중 오조작으로 꺼지는 위험보다, 시각장애 사용자가 닫을 수 없는 화면에 갇히는 쪽이
/// 나쁘다. 실수로 닫히면 다시 시작하면 된다.
struct BeaconTrackingSheet: View {
    let model: BeaconModel
    let onStop: () -> Void

    @AccessibilityFocusState private var stopFocused: Bool

    var body: some View {
        List {
            Section {
                Button(appLocalized("beacon.stop"), action: onStop)
                    .accessibilityFocused($stopFocused)
                // 반복: 마지막 실행 안내 재낭독(소음·딴생각 대비, NavCog 최고 호평 컨트롤).
                Button(appLocalized("guide.repeatButton")) { model.repeatLastGuidance() }
                // 진행 상황: 자동 통지를 기다리지 않는 임의 시점 조회(Soundscape Where Am I).
                Button(appLocalized("guide.progressButton")) { model.announceProgress() }
                // 전환: 추적을 멈추지 않고 안내 방식만 바꾼다. 라벨이 곧 상태 신호.
                // 경로 미보유 세션(비-ko·조회 실패·타 수단)에선 미노출(죽은 컨트롤 금지).
                if model.canOfferDetail {
                    Button(appLocalized(
                        model.mode == .detail ? "guide.toBriefButton" : "guide.toDetailButton"
                    )) { model.toggleMode() }
                }
                // 재조회: 이탈 확정 시에만 노출. 자동 재조회 금지(스펙 §5.6)의 수동 출구.
                if model.offRoute {
                    Button(appLocalized("guide.rerouteButton")) { model.requestReroute() }
                }
                // 가시 상태 1줄. 통지는 모델의 단일 Announcement가 담당하므로 여기서
                // 다시 알리지 않는다(보이는 콘텐츠의 live region 복제 금지).
                if !model.statusText.isEmpty {
                    distanceText(model.statusText).foregroundStyle(.secondary)
                }
                Text(appLocalized("beacon.screenHint"))
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            } header: {
                // 무엇을 추적 중인지가 화면에 있어야 한다. 시트로 분리되면서 주변 맥락이
                // 통째로 사라졌으므로 여기서만 알 수 있다.
                Text(joinText(appLocalized("beacon.heading"), model.destinationLabel))
                    .accessibilityAddTraits(.isHeader)
            }
        }
        .task { await landStopFocus() }
    }

    /// 열릴 때 포커스를 **중지 버튼**에 둔다. 걷는 중 필요한 유일한 행동이고, 시트
    /// 수명 내내 존재해 헌장 §5의 "포커스를 쥔 요소가 사라지는 전이"가 생기지 않는다.
    /// (실기기에서는 시스템이 섹션 헤딩에 착지시키는 것을 위원장이 수용 — 재조정 금지.)
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
