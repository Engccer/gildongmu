import Testing
@testable import GildongmuKit

/// 웹 `src/lib/__tests__/beacon.test.ts`의 케이스 이식 + iOS 고유 가드.
/// 두 플랫폼이 같은 입력에 같은 판정을 내는지가 이 스위트의 계약이다.
///
/// 목적지는 서울시청 부근. 같은 경도선에서 위도차로 거리를 만든다(웹과 동일 방식).
private let dest = BeaconDest(lat: 37.5665, lng: 126.978)

private func fixAt(_ metersNorth: Double, accuracy: Double = 10) -> BeaconFix {
    BeaconFix(lat: dest.lat + metersNorth / 111_320, lng: dest.lng, accuracy: accuracy)
}

@Suite struct BeaconStepTests {
    @Test func firstFixAnchorsAndSpeaks() {
        let r = beaconStep(state: .initial, fix: fixAt(300), dest: dest)
        #expect(r.announce.kind == .first)
        #expect(r.announce.speak)
        #expect(r.announce.distance > 250)
        #expect(r.state.anchorDistance != nil)
    }

    @Test func deadBandSuppressesFlapping() {
        var s = beaconStep(state: .initial, fix: fixAt(300), dest: dest).state
        for d in [305.0, 295, 308, 293] {
            let r = beaconStep(state: s, fix: fixAt(d), dest: dest)
            #expect(r.announce.kind == .hold)
            s = r.state
        }
    }

    @Test func closerAndFartherBeyondDeadBand() {
        let s = beaconStep(state: .initial, fix: fixAt(300), dest: dest).state
        #expect(beaconStep(state: s, fix: fixAt(250), dest: dest).announce.kind == .closer)
        #expect(beaconStep(state: s, fix: fixAt(350), dest: dest).announce.kind == .farther)
    }

    @Test func accuracyOverLimitIsWeakAndKeepsAnchor() {
        let s = beaconStep(state: .initial, fix: fixAt(300), dest: dest).state
        let r = beaconStep(state: s, fix: fixAt(200, accuracy: 150), dest: dest)
        #expect(r.announce.kind == .weak)
        #expect(r.state.anchorDistance == s.anchorDistance)
    }

    /// iOS 고유. `CLLocation.horizontalAccuracy < 0`은 좌표 무효 신호이고,
    /// 통과시키면 deadBand가 15로 잡혀 쓰레기 좌표가 앵커가 된다(spec §3.2).
    @Test func negativeAccuracyIsWeakAndDoesNotAnchor() {
        let r = beaconStep(state: .initial, fix: fixAt(300, accuracy: -1), dest: dest)
        #expect(r.announce.kind == .weak)
        #expect(r.state.anchorDistance == nil)
    }

    @Test func zeroAccuracyIsWeak() {
        let r = beaconStep(state: .initial, fix: fixAt(300, accuracy: 0), dest: dest)
        #expect(r.announce.kind == .weak)
    }

    /// 이 기능의 핵심. 정확도가 나쁘면 데드밴드가 커져 같은 변화가 추세가 아니게 된다.
    @Test func deadBandScalesWithAccuracy() {
        let s = beaconStep(state: .initial, fix: fixAt(300, accuracy: 60), dest: dest).state
        let r = beaconStep(state: s, fix: fixAt(260, accuracy: 60), dest: dest)
        #expect(r.announce.kind == .hold)  // 40m 감소 < deadBand 60
    }

    @Test func trendFlipSpeaksEvenBelowMilestone() {
        var s = beaconStep(state: .initial, fix: fixAt(300), dest: dest).state
        s = beaconStep(state: s, fix: fixAt(280), dest: dest).state
        let r = beaconStep(state: s, fix: fixAt(300), dest: dest)
        #expect(r.announce.kind == .farther)
        #expect(r.announce.speak)
    }

    @Test func sameTrendSpeaksOnlyAtMilestone() {
        let s0 = beaconStep(state: .initial, fix: fixAt(300), dest: dest).state
        let r1 = beaconStep(state: s0, fix: fixAt(280), dest: dest)
        #expect(r1.announce.kind == .closer)
        #expect(!r1.announce.speak)
        let r2 = beaconStep(state: r1.state, fix: fixAt(245), dest: dest)
        #expect(r2.announce.speak)  // 누적 55m > 50
    }

    @Test func arrivalLatchSpeaksOnceOnEntry() {
        let s = beaconStep(state: .initial, fix: fixAt(300), dest: dest).state
        let r = beaconStep(state: s, fix: fixAt(15, accuracy: 12), dest: dest)
        #expect(r.announce.kind == .nearby)
        #expect(r.announce.speak)
        #expect(r.state.nearby)
        let r2 = beaconStep(state: r.state, fix: fixAt(14, accuracy: 12), dest: dest)
        #expect(r2.announce.kind == .nearby)
        #expect(!r2.announce.speak)
    }

    @Test func arrivalLatchReleasesOnlyBeyondHysteresis() {
        let s0 = beaconStep(state: .initial, fix: fixAt(300), dest: dest).state
        let near = beaconStep(state: s0, fix: fixAt(15, accuracy: 10), dest: dest).state
        // threshold(20) + deadBand(15) 이내는 아직 래치 유지 + hold 침묵
        let held = beaconStep(state: near, fix: fixAt(30, accuracy: 10), dest: dest)
        #expect(held.announce.kind == .hold)
        #expect(held.state.nearby)
        // 그 너머는 이탈하고 추세 재개
        let out = beaconStep(state: near, fix: fixAt(120, accuracy: 10), dest: dest)
        #expect(!out.state.nearby)
        #expect(out.announce.kind == .farther)
    }

    @Test func holdNeverSpeaks() {
        let s = beaconStep(state: .initial, fix: fixAt(300), dest: dest).state
        let r = beaconStep(state: s, fix: fixAt(305), dest: dest)
        #expect(r.announce.kind == .hold)
        #expect(!r.announce.speak)
    }

    @Test func nonFiniteCoordinateIsWeak() {
        let s = beaconStep(state: .initial, fix: fixAt(300), dest: dest).state
        let r = beaconStep(
            state: s, fix: BeaconFix(lat: .nan, lng: .nan, accuracy: 10), dest: dest
        )
        #expect(r.announce.kind == .weak)
        #expect(r.state.anchorDistance == s.anchorDistance)
    }
}

@Suite struct HaversineTests {
    /// 기준값은 **웹 `haversineMeters`를 실제로 실행해 뽑은 출력**이다(추측한 근사값이
    /// 아니다). 이 스위트의 계약은 "대략 맞다"가 아니라 "웹과 같은 값"이므로 허용 오차를
    /// 1mm로 둔다. 공식이나 지구 반지름이 갈리면 경계값 케이스가 조용히 어긋난다.
    @Test func matchesWebOutputExactly() {
        #expect(haversineMeters(lat1: 37.5, lng1: 127.0, lat2: 37.5, lng2: 127.0) == 0)

        let oneMilliDegree = haversineMeters(lat1: 37.5, lng1: 127.0, lat2: 37.501, lng2: 127.0)
        #expect(abs(oneMilliDegree - 111.19492664429958) < 0.001)

        let seoulToGangnam = haversineMeters(
            lat1: 37.5665, lng1: 126.978, lat2: 37.4979, lng2: 127.0276
        )
        #expect(abs(seoulToGangnam - 8792.890880750394) < 0.001)
    }
}
