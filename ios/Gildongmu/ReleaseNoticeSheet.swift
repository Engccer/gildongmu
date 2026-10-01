import SwiftUI

/// 2.0 공지의 저장 키(spec 2026-10-01-release-2.0-graduation-design.md §1). 도보 공지 V1(`walkGuideNoticeV1`)을
/// 대체한다 — 키의 V2가 공지 버전이다. 다음 큰 변경 때 V3 키로 새 공지를 낸다. `AIChatConsent` 동형 —
/// 뷰는 상태로, 표시 판정은 `confirmed`로 같은 키를 읽는다.
enum ReleaseNotice {
    static let key = "releaseNoticeV2"
    static var confirmed: Bool { UserDefaults.standard.bool(forKey: key) }
}

/// 앱을 열면 바로 뜨는 1회 공지 시트. 계약은 "한 번 뜨면 다시 안 뜬다"가 아니라
/// **"확인을 누르면 다시 뜨지 않는다"**다 — 드래그·VoiceOver 탈출은 막지 않되
/// (`interactiveDismissDisabled` 금지: 탈출 제스처는 이 앱 1급 사용자가 모달에서
/// 빠져나오는 표준 수단이라, 막으면 대화상자에 가두는 것이 된다) 저장하지 않아 다음
/// 실행에 다시 뜬다. 저장은 호출부의 onConfirm이 한다.
///
/// 접근성(spec 2026-08-15 §5.3): 제목·소제목 2개는 별도 `Text` + `.isHeader`(레벨 구분은 두지 않는다 —
/// 이 repo는 `.isHeader`만 쓴다). ⚠ 소제목을 본문 문자열 안에 마크다운으로 넣지 말 것: `appLocalized`는
/// `String`을 반환하고 `Text(String)` 오버로드는 마크다운을 파싱하지 않아 `### `가 화면과 낭독에 그대로
/// 나온다. 본문은 문단마다 별도 `Text`(블록별 접근성 객체, 헌장 §6). 모달 등장 자체가 발화되므로 별도
/// 통지를 게시하지 않는다.
struct ReleaseNoticeSheet: View {
    /// 확인 버튼 탭 시 호출 — 호출부가 UserDefaults를 갱신하고 시트를 닫는다.
    let onConfirm: () -> Void

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                Text(appLocalized("ios.releaseNotice.title"))
                    .font(.title3.bold())
                    .accessibilityAddTraits(.isHeader)
                Text(appLocalized("ios.releaseNotice.intro"))
                Text(appLocalized("ios.releaseNotice.head1"))
                    .font(.headline)
                    .accessibilityAddTraits(.isHeader)
                Text(appLocalized("ios.releaseNotice.body1"))
                Text(appLocalized("ios.releaseNotice.body2"))
                Text(appLocalized("ios.releaseNotice.body3"))
                Text(appLocalized("ios.releaseNotice.body4"))
                Text(appLocalized("ios.releaseNotice.head2"))
                    .font(.headline)
                    .accessibilityAddTraits(.isHeader)
                Text(appLocalized("ios.releaseNotice.body5"))
                Text(appLocalized("ios.releaseNotice.body6"))
                Button {
                    onConfirm()
                } label: {
                    Text(appLocalized("ios.releaseNotice.confirm"))
                        .frame(maxWidth: .infinity, minHeight: 44)
                }
                .buttonStyle(.borderedProminent)
            }
            .padding()
        }
    }
}
