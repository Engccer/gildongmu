import SwiftUI

/// AI 채팅 인라인 동의 화면(스펙 §1, App Review 5.1.2(i)). 미동의 상태에서
/// 채팅 탭·장소 채팅 sheet가 대화 UI 대신 이 화면을 보여준다. 시트·팝업이 아니라
/// 인라인이라 VoiceOver 포커스가 예측 가능하고 받아쓰기 홀드 계약과 충돌하지 않는다.
struct ChatConsentView: View {
    /// 동의 버튼 탭 시 호출 — 호출부가 AppStorage를 갱신해 채팅 UI로 전환한다.
    let onConsent: () -> Void

    private var privacyURL: URL {
        AppConfig.apiBaseURL.appending(path: "\(AppLanguage.current)/privacy")
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                Text(appLocalized("ios.chat.consentTitle"))
                    .font(.title3.bold())
                    .accessibilityAddTraits(.isHeader)
                Text(appLocalized("ios.chat.consentData"))
                Text(appLocalized("ios.chat.consentAiNotice"))
                Text(appLocalized("ios.chat.consentAlt"))
                Link(appLocalized("ios.common.privacyPolicy"), destination: privacyURL)
                    .frame(minHeight: 44)
                Button {
                    onConsent()
                } label: {
                    Text(appLocalized("ios.chat.consentAgree"))
                        .frame(maxWidth: .infinity, minHeight: 44)
                }
                .buttonStyle(.borderedProminent)
            }
            .padding()
        }
    }
}
