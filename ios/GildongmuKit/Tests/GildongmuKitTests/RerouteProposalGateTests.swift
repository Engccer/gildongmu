import Testing
@testable import GildongmuKit

/// 이탈 시 제안(E10ⓑ) 순수 게이트 — 신선도(이동 상한은 수단별 튜닝, 120초)·세션당 조회 상한(5회).
/// 웹 `reroute-proposal-gate.test.ts` 미러. 상수는 잠정값(spec §6, 실보행 판정 대상)이라 경계 양쪽을 못 박는다.
@Suite struct RerouteProposalGateTests {
    /// 위도 1도 ≈ 111,320m — 테스트 이동량은 위도 오프셋으로 만든다.
    private func moved(_ p: RerouteProposal, meters: Double) -> (lat: Double, lng: Double) {
        (lat: p.originLat + meters / 111_320.0, lng: p.originLng)
    }

    private let base = RerouteProposal(originLat: 37.5386, originLng: 127.1230, acquiredAt: 1_000)

    private func fresh(_ meters: Double, nowUptime: Double = 1_001, maxDrift: Double) -> Bool {
        let cur = moved(base, meters: meters)
        return RerouteProposalGate.isFresh(
            base, nowUptime: nowUptime, currentLat: cur.lat, currentLng: cur.lng, maxDriftMeters: maxDrift)
    }

    @Test func 도보는_30m_자동차는_150m까지_fresh() {
        #expect(GuideTuning.walk.rerouteMaxDriftM == 30)
        #expect(GuideTuning.car.rerouteMaxDriftM == 150)
        #expect(GuideTuning.carDriver.rerouteMaxDriftM == 150)
        #expect(fresh(29, maxDrift: GuideTuning.walk.rerouteMaxDriftM))
        #expect(!fresh(31, maxDrift: GuideTuning.walk.rerouteMaxDriftM))
        #expect(fresh(140, maxDrift: GuideTuning.car.rerouteMaxDriftM))
        #expect(!fresh(160, maxDrift: GuideTuning.car.rerouteMaxDriftM))
    }

    @Test func 경과_120초까지_fresh_121초는_제자리여도_만료() {
        #expect(fresh(0, nowUptime: 1_120, maxDrift: 30))
        #expect(!fresh(0, nowUptime: 1_121, maxDrift: 30))
    }

    @Test func 상한_5회째까지_허용_6회째_거부() {
        #expect(RerouteProposalGate.mayFetch(episodeFetchCount: 0))
        #expect(RerouteProposalGate.mayFetch(episodeFetchCount: 4))
        #expect(!RerouteProposalGate.mayFetch(episodeFetchCount: 5))
    }

    @Test func 시간축_단독_판정은_좌표_없이_만료를_가른다() {
        // fix 끊김(실내·권한 철회)에서 워치독이 쓰는 축 — 119초 fresh, 121초 만료.
        #expect(RerouteProposalGate.isFreshInTime(base, nowUptime: 1_119))
        #expect(!RerouteProposalGate.isFreshInTime(base, nowUptime: 1_121))
    }
}
