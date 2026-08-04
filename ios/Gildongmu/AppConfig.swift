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
    /// **값을 손으로 고치지 않는다. 빌드 구성이 정한다**(2026-08-04 전환). 종전에는
    /// 여기 `false`를 써넣고 릴리스가 끝나면 되돌리는 방식이었는데, 되돌릴 때 위치
    /// 권한 목적 문자열까지 함께 챙겨야 한다는 것을 **사람이 기억해야** 했다. 한 번
    /// 잊으면 앱에 없는 기능을 설명하는 문구가 심사에 나간다.
    ///
    /// 이제 `Experimental` 구성이 `EXPERIMENTAL` 컴파일 조건·번들 ID(`.dev`)·표시
    /// 이름·아이콘·권한 문구를 한꺼번에 정한다. App Store 제출은 늘 `Release`라
    /// 자동으로 빠지고, 실기기 실험판은 `Experimental`이라 자동으로 들어간다.
    ///
    /// 봉인 지점은 `DirectionsTabView`의 게이트 4종(수단별 3 + 간략 폴백)뿐이다.
    /// 진입이 없으면 세션이 시작될 수 없어 추적 시트·상세 전환·경로 조회가 전부
    /// 도달 불가가 된다.
    ///
    /// ⚠ 기능이 실주행·실승차 판정을 통과해 정식 출시할 때는 이 `#if`를 지운다
    /// (플래그 졸업). 플래그가 쌓이지 않게 하는 것이 이 방식의 유일한 관리 포인트다.
    #if EXPERIMENTAL
    static let realtimeGuidanceEnabled = true
    #else
    static let realtimeGuidanceEnabled = false
    #endif

    /// 웹 개인정보 처리방침 URL(현재 앱 언어 로케일). 동의 화면·설정이 공유한다.
    static var privacyPolicyURL: URL {
        apiBaseURL.appending(path: "\(AppLanguage.current)/privacy")
    }
}
