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

    /// 실시간 길 안내(거리 추적 + 수단별 경로 추종)를 화면에 노출할지.
    ///
    /// **1.3 릴리스 봉인(2026-08-04, 위원장 판정)**: 수단별 경로 안내가 실주행·실승차
    /// 판정 대기이고, 거리 추적은 그 마일스톤의 중간 계단이라 단독 출시가 성립하지
    /// 않는다. 그래서 두 층을 함께 내린다.
    ///
    /// 봉인은 `DirectionsTabView`의 게이트 4종(수단별 3 + 간략 폴백)만 끄면 완결된다.
    /// 진입이 없으면 세션이 시작될 수 없어 추적 시트·상세 전환·경로 조회가 전부
    /// 도달 불가가 되기 때문이다. 코드·문자열은 그대로 두고 이 값만 되돌린다.
    ///
    /// ⚠ 되살릴 때 **위치 권한 목적 문자열도 함께** 되돌린다. 안내를 봉인하면서
    /// "목적지까지 남은 거리를 소리로 안내하기 위해" 절을 뺐다(없는 기능을 설명하지
    /// 않는다, 심사 5.1.1). 웹은 push=배포라 이 봉인 대상이 아니다(이미 운영 중).
    static let realtimeGuidanceEnabled = false

    /// 웹 개인정보 처리방침 URL(현재 앱 언어 로케일). 동의 화면·설정이 공유한다.
    static var privacyPolicyURL: URL {
        apiBaseURL.appending(path: "\(AppLanguage.current)/privacy")
    }
}
