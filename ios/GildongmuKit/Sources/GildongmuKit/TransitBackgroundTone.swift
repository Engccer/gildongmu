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
/// 허용 = **승차 중** 진행음(추세 closer·farther, 사다리 3·2·1과 하차 정류소 임박)과 도착음, E36의 첫 관측, 그리고
/// **고른 차량을 기다리는 동안**(boarding)의 다가옴 소리와 승차 전이 시작음(접근 사다리·「곧 도착」·관측 승차 —
/// 위원장 판정 2026-11-07 두 번째, spec §2.1). 관측 승차는 도착 관측(`observed`, 지하철)과 출발 관측(`departed`,
/// 서울버스 — 정차 신호가 API에 없어 승차 전이가 출발 관측뿐이다) 둘 다다. 신호를 잃었을 때의 60초 반복음(unreliable)과
/// 경고음(warning)은 내지 않는다(지하 구간에서 잦아 다른 앱·통화를 방해한다). 사용자 조작 응답(선언 탑승·중간 구간
/// 시작)은 전경만이다.
/// 백그라운드 음성 토글과 무관하다 — 소리는 항상, 음성만 토글(판정 ③).
public func transitToneAllowedInBackground(_ source: TransitBackgroundToneSource) -> Bool {
    switch source {
    case let .trend(tone):
        return tone == .closer || tone == .farther
    case .alightReached:
        return true
    case let .event(event):
        switch event {
        case .trackingStarted, .countdown, .arrivingAtAlightStop, .arrived,
             .approaching, .arrivingAtBoardStop:
            return true
        case let .boarded(_, cause):
            return cause != .declared
        case let .legAdvanced(_, final):
            return final
        default:
            return false
        }
    }
}
