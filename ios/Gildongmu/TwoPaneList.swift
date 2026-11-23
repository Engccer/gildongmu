import SwiftUI

/// 넓고 낮은 창(아이폰 가로)에서 목록을 두 칸으로 나누는 틀(E91, spec 2026-11-23 §2.2).
///
/// 세로에서는 `List { leading; trailing }` 하나라 종전 화면과 같고, 가로(`verticalSizeClass == .compact`)에서는
/// 앞 칸(입력·컨트롤)과 뒤 칸(목록)을 나란히 둔다. VoiceOver가 훑는 순서는 앞 칸 다음 뒤 칸이라
/// 세로 배치와 같다. 행 내용은 호출부가 그대로 들고 있고 이 틀은 담는 그릇만 바꾼다.
///
/// `trailingOverlay`는 뒤 칸에만 얹는다(검색 중·실패·0건 표시가 앞 칸의 컨트롤을 덮지 않게).
struct TwoPaneList<Leading: View, Trailing: View, Overlay: View>: View {
    /// 앞 칸이 차지하는 너비 비율.
    static var leadingFraction: CGFloat { 0.4 }

    @Environment(\.verticalSizeClass) private var verticalSizeClass
    private let leading: Leading
    private let trailing: Trailing
    private let trailingOverlay: Overlay

    init(
        @ViewBuilder leading: () -> Leading,
        @ViewBuilder trailing: () -> Trailing,
        @ViewBuilder trailingOverlay: () -> Overlay = { EmptyView() }
    ) {
        self.leading = leading()
        self.trailing = trailing()
        self.trailingOverlay = trailingOverlay()
    }

    var body: some View {
        if verticalSizeClass == .compact {
            HStack(spacing: 0) {
                List { leading }
                    .containerRelativeFrame(.horizontal) { width, _ in width * Self.leadingFraction }
                Divider()
                List { trailing }
                    .overlay { trailingOverlay }
            }
            // 뒤 칸이 비어 있어도(결과 전) 두 칸의 바탕이 같게 한다.
            .scrollContentBackground(.hidden)
            .background(Color(.systemGroupedBackground))
        } else {
            List {
                leading
                trailing
            }
            .overlay { trailingOverlay }
        }
    }
}
