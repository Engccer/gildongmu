import Foundation

/// 앱 UI 언어 정본. 데이터 계약(검색 lang·채팅 locale·STT)과 Kit lang 인자,
/// `appLocalized` 조회가 전부 여기서 나온다.
enum AppLanguage {
    static let supported = ["ko", "en", "es", "fr", "it", "ja"]

    /// 사용자 선택 영속 키(앱 자체 소유). `AppleLanguages`를 정본으로 쓰지 않는 이유:
    /// 그 키는 오버라이드가 없어도 시스템이 채워 두고, 무엇보다 실행 중 변경이
    /// `Bundle` 언어 협상에 반영되지 않아(프로세스 시작 시 1회 캐싱, 실측 확정)
    /// 즉시 전환의 근거로 삼을 수 없다.
    static let selectionKey = "appLanguage"

    /// UI 언어 코드(예: "ko"). 사용자가 고른 값이 1순위, 없으면 시스템 해석 폴백.
    /// 미지원 값은 ko로 수렴한다.
    static var current: String {
        if let stored = UserDefaults.standard.string(forKey: selectionKey),
           supported.contains(stored) {
            return stored
        }
        let resolved = Bundle.main.preferredLocalizations.first ?? "ko"
        let base = String(resolved.prefix(2))
        return supported.contains(base) ? base : "ko"
    }

    /// 웹 data-locale.ts 동형: 외부 데이터는 ko 외 전부 en.
    static var dataLocale: String { current == "ko" ? "ko" : "en" }

    /// STT SpeechTranscriber locale 매핑(자동 감지 금지 계약 유지).
    /// 기기 미지원 locale은 SpeechService의 localeUnsupported 오류 경로가 받는다.
    static var speechLocaleIdentifier: String {
        switch current {
        case "en": "en-US"
        case "es": "es-ES"
        case "fr": "fr-FR"
        case "it": "it-IT"
        case "ja": "ja-JP"
        default: "ko-KR"
        }
    }

    /// 언어 선택 반영. 자체 키가 즉시 전환의 정본이고, `AppleLanguages`는 앱이
    /// 직접 못 그리는 영역(권한 다이얼로그·단축어/Siri 문구·다음 실행의 Bundle 해석)을
    /// 맞추기 위해 함께 기록한다.
    static func select(_ code: String) {
        guard supported.contains(code) else { return }
        UserDefaults.standard.set(code, forKey: selectionKey)
        UserDefaults.standard.set([code], forKey: "AppleLanguages")
    }
}
