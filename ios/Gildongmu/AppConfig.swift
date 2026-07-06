import Foundation

/// 앱 전역 설정. base URL은 릴리스 고정, 디버그는 스킴 환경변수로 로컬 dev 전환(spec §6).
enum AppConfig {
    static var apiBaseURL: URL {
        #if DEBUG
        if let override = ProcessInfo.processInfo.environment["GILDONGMU_API_BASE_URL"],
           let url = URL(string: override) {
            return url
        }
        #endif
        return URL(string: "https://gildongmu.vercel.app")!
    }

    /// nmap 딥링크 필수 appname(웹 NEXT_PUBLIC_APP_IDENTIFIER와 동일값)
    static let appIdentifier = "space.dodoplanet.gildongmu"
}
