import SwiftUI

/// 내 주변 공통 새로고침 인터페이스: 내비 바 명시 버튼 + 당겨서 새로고침을 한 modifier로 묶는다.
/// VoiceOver에서 pull-to-refresh는 발견 경로가 사실상 없어 명시 버튼이 정본이고,
/// 제스처는 시각 사용자 보조 경로다. 재진입은 각 모델의 in-flight 가드가 차단하므로
/// 버튼을 비활성화하지 않는다(disabled는 포커스를 떨어뜨림 — 접근성 헌장).
extension View {
    func nearbyRefreshable(_ action: @escaping () async -> Void) -> some View {
        toolbar {
            // 시맨틱 placement(iOS 내비 바 트레일링) — ChatView .cancellationAction과 같은 관례
            ToolbarItem(placement: .primaryAction) {
                Button {
                    Task { await action() }
                } label: {
                    Label(String(localized: "ios.common.refresh"), systemImage: "arrow.clockwise")
                }
            }
        }
        .refreshable { await action() }
    }

    /// 상태 오버레이(실패·0건·권한 거부) 전용 래퍼. 오버레이가 터치를 삼키면 정확히
    /// "첫 시도 실패" 상황에서 당겨서 새로고침이 죽는다 — hit testing만 끄고
    /// VoiceOver 노출은 유지한다(allowsHitTesting은 접근성 트리에 영향 없음).
    func nearbyStateOverlay<Overlay: View>(@ViewBuilder _ overlay: () -> Overlay) -> some View {
        self.overlay { overlay().allowsHitTesting(false) }
    }
}
