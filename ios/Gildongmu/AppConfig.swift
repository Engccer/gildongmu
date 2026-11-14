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

    /// 실험 기능의 봉인은 **값을 손으로 고치지 않는다. 빌드 구성이 정한다**(2026-08-04 전환).
    /// 봉인의 판정 축은 플래그 참조 목록이 아니라 **세션을 시작시키는 호출 전수**다(spec
    /// 2026-08-15 §3.2 표) — 신규 진입점을 만들면 그 표와 `guidance-gate-drift.test.ts`를 함께
    /// 갱신하는 것이 계약이다. 판정을 통과해 정식 출시할 때는 그 플래그의 검사를 **삭제**한다
    /// (플래그 졸업 — 항상 참인 상수를 남기지 않는다). 도보 안내는 2026-08-15, 자동차·대중교통
    /// 안내와 백그라운드 음성 안내는 2026-10-01(2.0, spec 2026-10-01-release-2.0-graduation-design.md)에,
    /// 안내 시트 제목 행 밀기 동작(E74)은 2026-10-27(E75)에 졸업했다.

    /// 나들이 모드(E51)의 봉인. 1차는 실험판에서만 — 다듬을 것이 많다(위원장 재판정 2026-09-27).
    /// 나들이 진입점 둘이 이 값을 읽는다(`guidance-gate-drift.test.ts`가 잠근다). 진입점 밖 소비자 하나: 설정
    /// "백그라운드 음성 안내" 설명 문장 선택(A59, `settings-topic-sections.test.ts`) — 졸업 때 Outing 키로 고정한다.
    /// 실보행 판정을 통과하면 이 검사를 삭제한다(플래그 졸업).
    #if EXPERIMENTAL
    static let experimentalOutingEnabled = true
    #else
    static let experimentalOutingEnabled = false
    #endif

    /// 탭 순서 설정(E66, 위원장 판정 2026-10-05)의 봉인. 켜지면 설정 일반 묶음에 "탭 순서" 줄이 서고
    /// `AppTab.order(stored:)`가 사용자가 정한 순서(저장값)를 쓴다. 꺼지면 줄이 없고 순서는 `AppTab.defaultOrder`로 고정이다.
    /// 소비자는 그 둘뿐이다(`SettingsView` 한 줄, `AppTab.order(stored:)`). 실험판 실사용 판정을 통과하면
    /// 이 검사를 삭제한다(플래그 졸업 — 항상 참인 상수를 남기지 않는다).
    #if EXPERIMENTAL
    static let experimentalTabOrderEnabled = true
    #else
    static let experimentalTabOrderEnabled = false
    #endif

    /// 채팅 경로 카드의 [안내 시작](E83, 위원장 판정 2026-11-14)의 봉인. 켜지면 채팅 탭이 능력 `"route-start"`를 신고하고
    /// 답 아래에 수단별 안내 시작 버튼 카드를 그린다. 소비자는 그 둘뿐이다(`ChatModel.requestBody`의 신고, 대화 화면의
    /// `showsRouteStartCard`, `guidance-gate-drift.test.ts`가 잠근다). 꺼지면 요청 본문이 종전과 같아 서버가 렌더를 보내지 않는다.
    /// 실험판 실기기 판정을 통과하면 이 검사를 삭제한다(플래그 졸업 — 항상 참인 상수를 남기지 않는다).
    #if EXPERIMENTAL
    static let experimentalChatGuideEnabled = true
    #else
    static let experimentalChatGuideEnabled = false
    #endif

    /// 웹 개인정보 처리방침 URL(현재 앱 언어 로케일). 동의 화면·설정이 공유한다.
    static var privacyPolicyURL: URL {
        apiBaseURL.appending(path: "\(AppLanguage.current)/privacy")
    }
}
