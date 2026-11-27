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
    /// 안내 시트 제목 행 밀기 동작(E74)은 2026-10-27(E75)에, 나들이(E51)·상단 줄 새로고침 자리(E82 판정 8)·채팅 답의
    /// 수단별 안내 시작(E83)은 2026-11-27(3.0, spec 2026-11-27-e92-release-3.0-design.md §4)에 졸업했다.

    /// 탭 순서 설정(E66, 위원장 판정 2026-10-05)의 봉인. 켜지면 설정 일반 묶음에 "탭 순서" 줄이 서고
    /// `AppTab.order(stored:)`가 사용자가 정한 순서(저장값)를 쓴다. 꺼지면 줄이 없고 순서는 `AppTab.defaultOrder`로 고정이다.
    /// 소비자는 그 둘뿐이다(`SettingsView` 한 줄, `AppTab.order(stored:)`). 실험판 실사용 판정을 통과하면
    /// 이 검사를 삭제한다(플래그 졸업 — 항상 참인 상수를 남기지 않는다).
    #if EXPERIMENTAL
    static let experimentalTabOrderEnabled = true
    #else
    static let experimentalTabOrderEnabled = false
    #endif

    /// 채팅 답변 모델 선택지 확장(E89, 위원장 판정 2026-11-23). 「채팅 답변 모델」 줄 자체는 3.0에서 정식판으로 졸업했고
    /// (정식판 선택지는 Terra·Gemini 둘, E92 A3), 이 플래그는 실험판 선택지 여섯(Luna·Claude 셋 추가)과 그 전송 범위 설명만 켠다.
    /// 소비자는 `ChatAnswerModel.choices`·`requestValue`의 `extended` 인자(`SettingsView`·`ChatModel`)와 `SettingsView`의 설명 한 줄이다.
    #if EXPERIMENTAL
    static let experimentalChatModelEnabled = true
    #else
    static let experimentalChatModelEnabled = false
    #endif

    /// 웹 개인정보 처리방침 URL(현재 앱 언어 로케일). 동의 화면·설정이 공유한다.
    static var privacyPolicyURL: URL {
        apiBaseURL.appending(path: "\(AppLanguage.current)/privacy")
    }
}
