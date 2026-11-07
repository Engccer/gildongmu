import Testing
@testable import GildongmuKit

/// E79 백그라운드 톤 허용 집합 전수(spec 2026-11-07-e79-transit-background-tones-design.md §2 표).
struct TransitBackgroundToneTests {
    private func allowed(_ event: TransitGuideEvent) -> Bool {
        transitToneAllowedInBackground(.event(event))
    }

    @Test func 승차_중_진행음과_도착음은_백그라운드에서_낸다() {
        #expect(allowed(.trackingStarted(message: "m", messageEn: nil, remaining: 3, arrivalCode: nil)))
        #expect(allowed(.countdown(
            remaining: 2, message: "m", messageEn: nil, currentLocation: nil, currentLocationEn: nil, arrivalCode: nil)))
        #expect(allowed(.countdown(
            remaining: 1, message: "m", messageEn: nil, currentLocation: nil, currentLocationEn: nil, arrivalCode: nil)))
        #expect(allowed(.arrivingAtAlightStop))
        #expect(allowed(.arrived(certain: true)))
        #expect(allowed(.arrived(certain: false)))
        #expect(allowed(.legAdvanced(legIndex: 1, final: true)))
        #expect(transitToneAllowedInBackground(.alightReached))
        #expect(transitToneAllowedInBackground(.trend(.closer)))
        #expect(transitToneAllowedInBackground(.trend(.farther)))
    }

    @Test func 신호_잃음_반복음과_경고음은_내지_않는다() {
        #expect(!transitToneAllowedInBackground(.trend(.unreliable)))
        #expect(!allowed(.signalLost))
        #expect(!allowed(.neverSeen))
        #expect(!allowed(.upstreamFailed))
        #expect(!allowed(.vehiclePassed))
    }

    @Test func 고른_차량을_기다리는_동안의_다가옴_소리도_낸다() {
        #expect(allowed(.approaching(remaining: 2, message: "m", messageEn: nil)))
        #expect(allowed(.approaching(remaining: 1, message: "m", messageEn: nil)))
        #expect(allowed(.approaching(remaining: nil, message: "m", messageEn: nil)))
        #expect(allowed(.arrivingAtBoardStop))
        #expect(allowed(.boarded(legIndex: 0, cause: .observed)))
    }

    @Test func 사용자_조작_응답과_출발_관측은_전경만이다() {
        #expect(!allowed(.boarded(legIndex: 0, cause: .declared)))
        #expect(!allowed(.boarded(legIndex: 0, cause: .departed)))
        #expect(!allowed(.legAdvanced(legIndex: 1, final: false)))
        #expect(!allowed(.vehicleSelected(legIndex: 0)))
    }

    @Test func 추세_층의_다른_소리는_허용하지_않는다() {
        for tone in BeaconTone.allCases where tone != .closer && tone != .farther {
            #expect(!transitToneAllowedInBackground(.trend(tone)))
        }
    }
}
