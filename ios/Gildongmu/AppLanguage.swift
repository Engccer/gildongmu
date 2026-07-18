import Foundation

/// 앱이 실제 해석한 UI 언어(카탈로그 5개 중 하나). Bundle 해석 결과를 쓰므로
/// AppleLanguages 오버라이드·시스템 언어·폴백이 모두 반영된 단일 정본.
/// 데이터 계약(검색 lang·채팅 locale·STT)과 Kit lang 인자가 전부 여기서 나온다.
enum AppLanguage {
    static let supported = ["ko", "en", "es", "fr", "it"]

    /// UI 언어 코드(예: "ko"). 미지원 해석 결과는 ko 폴백.
    static var current: String {
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
        default: "ko-KR"
        }
    }
}
