import SwiftUI

/// 도보 안내 정식 출시 1회성 공지의 저장 키(spec 2026-08-15 §5). `AIChatConsent` 동형 —
/// 뷰는 상태로, 표시 판정은 `confirmed`로 같은 키를 읽는다. 키의 V1은 공지 버전이다:
/// 자동차·대중교통을 추가할 때 V2 키로 새 공지를 낸다.
enum WalkGuideNotice {
    static let key = "walkGuideNoticeV1"
    static var confirmed: Bool { UserDefaults.standard.bool(forKey: key) }
}

/// 길찾기 탭 진입 시 1회 공지 시트(spec §5). 계약은 "한 번 뜨면 다시 안 뜬다"가 아니라
/// **"확인을 누르면 다시 뜨지 않는다"**다 — 드래그·VoiceOver 탈출은 막지 않되
/// (`interactiveDismissDisabled` 금지: 탈출 제스처는 이 앱 1급 사용자가 모달에서
/// 빠져나오는 표준 수단이라, 막으면 대화상자에 가두는 것이 된다) 저장하지 않아 다음 탭
/// 진입에 다시 뜬다. 안전 고지의 목적(읽게 하는 것)은 지켜지고 탈출구는 남는다.
/// 저장은 호출부의 onConfirm이 한다.
///
/// 접근성(§5.3): 제목·소제목 2개는 별도 `Text` + `.isHeader`(레벨 구분은 두지 않는다 —
/// 이 repo는 `.isHeader`만 쓰고 문단 대여섯 개짜리 모달에서 2단 계층은 정보를 늘리지
/// 않는다). ⚠ 소제목을 본문 문자열 안에 마크다운으로 넣지 말 것: `appLocalized`는
/// `String`을 반환하고 `Text(String)` 오버로드는 마크다운을 파싱하지 않아 `### `가
/// 화면과 낭독에 그대로 나온다. 본문은 문단마다 별도 `Text`(블록별 접근성 객체,
/// 헌장 §6). 모달 등장 자체가 발화되므로 별도 통지를 게시하지 않는다.
struct WalkGuideNoticeSheet: View {
    /// 확인 버튼 탭 시 호출 — 호출부가 UserDefaults를 갱신하고 시트를 닫는다.
    let onConfirm: () -> Void

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                Text(appLocalized("ios.directions.walkNotice.title"))
                    .font(.title3.bold())
                    .accessibilityAddTraits(.isHeader)
                Text(appLocalized("ios.directions.walkNotice.intro"))
                Text(appLocalized("ios.directions.walkNotice.head1"))
                    .font(.headline)
                    .accessibilityAddTraits(.isHeader)
                Text(appLocalized("ios.directions.walkNotice.body1"))
                Text(appLocalized("ios.directions.walkNotice.head2"))
                    .font(.headline)
                    .accessibilityAddTraits(.isHeader)
                Text(appLocalized("ios.directions.walkNotice.body2"))
                Text(appLocalized("ios.directions.walkNotice.body3"))
                Text(appLocalized("ios.directions.walkNotice.body4"))
                Button {
                    onConfirm()
                } label: {
                    Text(appLocalized("ios.directions.walkNotice.confirm"))
                        .frame(maxWidth: .infinity, minHeight: 44)
                }
                .buttonStyle(.borderedProminent)
            }
            .padding()
        }
    }
}
