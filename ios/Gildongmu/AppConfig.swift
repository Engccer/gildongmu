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

    /// 아직 정식 출시하지 않은 안내 수단(자동차·대중교통·간략 단독 진입점)의 봉인.
    /// 도보 상세 안내는 정식 출시(2026-08-15, spec 2026-08-15-walk-guidance-ship-design.md)로
    /// 졸업해 이 플래그를 보지 않는다 — 이탈 판정 방위 축도 켠 채로 나간다(위원장 판정:
    /// 실험판과 정식판의 안내 동작을 같게 유지해 앞으로의 실보행 판정이 정식판에 그대로
    /// 적용되게 한다. 축을 끄면 갈림길 오진 원증상(A6)이 남는데 그쪽이 헛경고보다 위험하다).
    ///
    /// **값을 손으로 고치지 않는다. 빌드 구성이 정한다**(2026-08-04 전환). 봉인의 판정
    /// 축은 플래그 참조 목록이 아니라 **세션을 시작시키는 호출 전수**다(spec §3.2 표) —
    /// 신규 진입점을 만들면 그 표와 `guidance-gate-drift.test.ts`를 함께 갱신하는 것이
    /// 계약이다. 남은 셋을 하나로 묶는 이유: 셋의 운명이 같다(실주행·실승차 판정 대기).
    /// 자동차가 먼저 졸업하는 상황이 실제로 오면 그때 쪼갠다.
    ///
    /// ⚠ 수단이 실주행·실승차 판정을 통과해 정식 출시할 때는 여기서 그 수단의 검사를
    /// 삭제한다(플래그 졸업). 플래그가 쌓이지 않게 하는 것이 이 방식의 유일한 관리 포인트다.
    #if EXPERIMENTAL
    static let experimentalGuidanceEnabled = true
    #else
    static let experimentalGuidanceEnabled = false
    #endif

    /// 웹 개인정보 처리방침 URL(현재 앱 언어 로케일). 동의 화면·설정이 공유한다.
    static var privacyPolicyURL: URL {
        apiBaseURL.appending(path: "\(AppLanguage.current)/privacy")
    }
}
