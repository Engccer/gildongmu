import Foundation

/// 대중교통 안내 톤이 어디서 왔는가 — 백그라운드 허용 판정의 입력(E79, spec 2026-11-07-e79-transit-background-tones-design.md §2).
public enum TransitBackgroundToneSource: Sendable, Equatable {
    /// 리듀서 이벤트의 톤(`transitEventProfile`).
    case event(TransitGuideEvent)
    /// 추세 층의 톤(`transitToneStep` — closer·farther·unreliable).
    case trend(BeaconTone)
    /// 기기 위치가 하차 정류장 도착을 관측(A69 「{하차 정류장} 도착. 내리세요.」)한 도착 톤.
    case alightReached
}

/// 백그라운드(화면 잠금·다른 앱)에서도 낼 톤인가(E79 위원장 판정 2026-11-07, E36 「첫 관측 하나」 뒤집기).
///
/// 허용 = **승차 중** 진행음(추세 closer·farther, 사다리 3·2·1과 하차 정류소 임박)과 도착음, 그리고 E36의 첫 관측.
/// 신호를 잃었을 때의 60초 반복음(unreliable)과 경고음(warning)은 내지 않는다(지하 구간에서 잦아 다른 앱·통화를 방해한다).
/// 승차 전(boarding 접근 사다리·「곧 도착」·「지금 타세요」)과 구간 시작음은 이번 판 밖이다(spec §2.1).
/// 백그라운드 음성 토글과 무관하다 — 소리는 항상, 음성만 토글(판정 ③).
public func transitToneAllowedInBackground(_ source: TransitBackgroundToneSource) -> Bool {
    switch source {
    case let .trend(tone):
        return tone == .closer || tone == .farther
    case .alightReached:
        return true
    case let .event(event):
        switch event {
        case .trackingStarted, .countdown, .arrivingAtAlightStop, .arrived:
            return true
        case let .legAdvanced(_, final):
            return final
        default:
            return false
        }
    }
}
