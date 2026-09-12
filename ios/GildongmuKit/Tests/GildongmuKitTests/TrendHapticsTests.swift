import Testing

@testable import GildongmuKit

/// 진행 상태 진동(E30 실험판) — 스위치 대상 톤은 **정확히** 가까워짐·정지·신뢰 불가 셋이다.
/// 나머지 10종은 스위치와 무관하게 지금처럼 진동한다("꺼짐 = 현재 동작", 위원장 2026-09-13).
@Suite("진행 상태 진동 옵트인 집합")
struct TrendHapticsTests {
    @Test("옵트인 톤은 closer·tick·unreliable 셋뿐이다")
    func optInSetIsExactlyThree() {
        let optIn = Set(BeaconTone.allCases.filter(\.hapticIsOptIn))
        #expect(optIn == [.closer, .tick, .unreliable])
    }

    @Test("우선 톤·이벤트 톤·세션 경계 톤은 옵트인이 아니다")
    func criticalTonesStayAlwaysOn() {
        for tone in [BeaconTone.warning, .nearby, .farther, .ahead, .crosswalk, .left, .right, .back, .start, .stop] {
            #expect(!tone.hapticIsOptIn, "\(tone)")
        }
    }
}
