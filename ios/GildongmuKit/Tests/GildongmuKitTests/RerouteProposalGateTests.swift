import Testing
@testable import GildongmuKit

/// 이탈 시 제안(E10ⓑ) 순수 게이트 — 신선도(30m/120초)·세션당 조회 상한(5회).
/// 상수는 잠정값(spec §6, 실보행 판정 대상)이라 경계 ±1을 못 박는다.
@Suite struct RerouteProposalGateTests {
    /// 위도 1도 ≈ 111,320m — 테스트 이동량은 위도 오프셋으로 만든다.
    private func moved(_ p: RerouteProposal, meters: Double) -> (lat: Double, lng: Double) {
        (lat: p.originLat + meters / 111_320.0, lng: p.originLng)
    }

    private let base = RerouteProposal(originLat: 37.5386, originLng: 127.1230, acquiredAt: 1_000)

    @Test func 이동_29m_경과_119초는_fresh() {
        let cur = moved(base, meters: 29)
        #expect(RerouteProposalGate.isFresh(
            base, nowUptime: 1_119, currentLat: cur.lat, currentLng: cur.lng))
    }

    @Test func 이동_31m는_만료() {
        let cur = moved(base, meters: 31)
        #expect(!RerouteProposalGate.isFresh(
            base, nowUptime: 1_001, currentLat: cur.lat, currentLng: cur.lng))
    }

    @Test func 경과_121초는_만료() {
        #expect(!RerouteProposalGate.isFresh(
            base, nowUptime: 1_121, currentLat: base.originLat, currentLng: base.originLng))
    }

    @Test func 상한_5회째까지_허용_6회째_거부() {
        #expect(RerouteProposalGate.mayFetch(episodeFetchCount: 0))
        #expect(RerouteProposalGate.mayFetch(episodeFetchCount: 4))
        #expect(!RerouteProposalGate.mayFetch(episodeFetchCount: 5))
    }
}
