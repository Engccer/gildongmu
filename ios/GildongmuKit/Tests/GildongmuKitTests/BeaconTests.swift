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

    @Test func fartherKeepsFiftyMeterMilestone() {
        let s0 = beaconStep(state: .initial, fix: fixAt(300), dest: dest).state
        let r1 = beaconStep(state: s0, fix: fixAt(330), dest: dest)
        #expect(r1.announce.kind == .farther)
        #expect(!r1.announce.speak)  // 30m < 50 — 경고 축은 촘촘한 간격 유지
        let r2 = beaconStep(state: r1.state, fix: fixAt(355), dest: dest)
        #expect(r2.announce.speak)  // 누적 55m ≥ 50
    }

    @Test func closerUsesAdaptiveMilestoneNearRange() {
        // 300m 이내는 100m 간격 — 종전 50m 정책이면 245m에서 발화했다(웹 미러).
        let s0 = beaconStep(state: .initial, fix: fixAt(300), dest: dest).state
        let r1 = beaconStep(state: s0, fix: fixAt(280), dest: dest)
        #expect(r1.announce.kind == .closer)
        #expect(!r1.announce.speak)
        let r2 = beaconStep(state: r1.state, fix: fixAt(245), dest: dest)
        #expect(!r2.announce.speak)  // 누적 55m < 100
        let r3 = beaconStep(state: r2.state, fix: fixAt(195), dest: dest)
        #expect(r3.announce.speak)  // 누적 105m ≥ 100
    }

    @Test func closerUsesAdaptiveMilestoneLongRange() {
        // 1km 초과는 500m 간격(차량 이동 스팸 억제 사다리).
        let s0 = beaconStep(state: .initial, fix: fixAt(2000), dest: dest).state
        let r1 = beaconStep(state: s0, fix: fixAt(1700), dest: dest)
        #expect(r1.announce.kind == .closer)
        #expect(!r1.announce.speak)  // 누적 300m < 500
        let r2 = beaconStep(state: r1.state, fix: fixAt(1450), dest: dest)
        #expect(r2.announce.speak)  // 누적 550m ≥ 500
    }

    @Test func closerUsesAdaptiveMilestoneVeryLongRange() {
        // 5km 초과는 1km 간격(웹 테스트 동형 — 사다리 최상단도 구속한다).
        let s0 = beaconStep(state: .initial, fix: fixAt(8000), dest: dest).state
        let r1 = beaconStep(state: s0, fix: fixAt(7200), dest: dest)
        #expect(r1.announce.kind == .closer)
        #expect(!r1.announce.speak)  // 누적 800m < 1000
        let r2 = beaconStep(state: r1.state, fix: fixAt(6900), dest: dest)
        #expect(r2.announce.speak)  // 누적 1,100m ≥ 1000
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

    /// 도착 임계값도 accuracy로 스케일한다. 정확도가 나쁘면 더 멀리서 "도착"이다.
    /// (리뷰 변이 생존 M2: 기존 케이스가 accuracy 10~12만 써서 이 축이 비어 있었다.)
    @Test func arrivalThresholdScalesWithAccuracy() {
        let s = beaconStep(state: .initial, fix: fixAt(300), dest: dest).state
        // accuracy 60이면 threshold도 60이라 40m는 도착 존 안이다.
        let r = beaconStep(state: s, fix: fixAt(40, accuracy: 60), dest: dest)
        #expect(r.announce.kind == .nearby)
        // 같은 40m라도 정확도가 좋으면 도착이 아니다(threshold 20).
        let precise = beaconStep(state: s, fix: fixAt(40, accuracy: 5), dest: dest)
        #expect(precise.announce.kind == .closer)
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

@Suite struct FixFreshnessTests {
    /// 이 게이트가 없으면 캐시 첫 fix가 앵커를 잡아 성과 지표 자체가 오염된다.
    @Test func freshAccurateFixIsUsable() {
        #expect(isUsableFix(accuracy: 10, ageSeconds: 0))
        #expect(isUsableFix(accuracy: 65, ageSeconds: 4.9))
    }

    @Test func staleFixIsRejected() {
        #expect(!isUsableFix(accuracy: 10, ageSeconds: 5.1))
        #expect(!isUsableFix(accuracy: 10, ageSeconds: 120))
    }

    /// 기기 시계 보정으로 timestamp가 미래로 튀는 fix도 신뢰할 근거가 없다.
    @Test func futureTimestampIsRejected() {
        #expect(!isUsableFix(accuracy: 10, ageSeconds: -30))
    }

    /// CoreLocation의 좌표 무효 신호. 리듀서도 거르지만 앵커 앞단에서 먼저 막는다.
    @Test func invalidAccuracyIsRejected() {
        #expect(!isUsableFix(accuracy: -1, ageSeconds: 0))
        #expect(!isUsableFix(accuracy: 0, ageSeconds: 0))
    }

    @Test func windowIsConfigurable() {
        #expect(isUsableFix(accuracy: 10, ageSeconds: 20, maxAge: 30))
    }
}

/// 두 모드가 공유하는 유일한 축. 리듀서 전체 재사용이 폐기된 근거는 `Beacon.swift`
/// 주석에 있다(도착 판정·정확도 게이트·음성 마일스톤이 상세와 충돌한다).
@Suite("추세 판정 추출")
struct TrendStepTests {
    @Test("앵커가 없으면 현재 거리를 앵커로 잡고 hold")
    func firstCall() {
        let r = trendStep(anchor: nil, trend: .none, distance: 100, deadBand: 15)
        #expect(r.kind == .hold)
        #expect(r.anchor == 100)
        #expect(r.trend == .none)
    }

    @Test("데드밴드를 넘어 줄면 closer이고 앵커가 전진한다")
    func closerAdvancesAnchor() {
        let r = trendStep(anchor: 100, trend: .none, distance: 84, deadBand: 15)
        #expect(r.kind == .closer)
        #expect(r.anchor == 84)
        #expect(r.trend == .closer)
    }

    @Test("데드밴드를 넘어 늘면 farther")
    func farther() {
        let r = trendStep(anchor: 100, trend: .closer, distance: 116, deadBand: 15)
        #expect(r.kind == .farther)
        #expect(r.trend == .farther)
    }

    @Test("데드밴드 안이면 hold이고 앵커·추세가 불변이다")
    func holdKeepsAnchor() {
        let r = trendStep(anchor: 100, trend: .closer, distance: 90, deadBand: 15)
        #expect(r.kind == .hold)
        #expect(r.anchor == 100)
        #expect(r.trend == .closer)
    }

    @Test("경계값은 포함이다")
    func boundaryInclusive() {
        #expect(trendStep(anchor: 100, trend: .none, distance: 85, deadBand: 15).kind == .closer)
        #expect(trendStep(anchor: 100, trend: .none, distance: 115, deadBand: 15).kind == .farther)
    }
}

/// 축 전환(handoff·수동 전환) 재기준화. 앵커만 재설정하면 전환 직후 거짓 음성이 난다.
@Suite("축 전환 재기준화")
struct RebaseBeaconStateTests {
    @Test("방향만 승계하고 앵커·발화 기준을 둘 다 새 축 값으로 재설정한다")
    func rebasesBothAxes() {
        var state = BeaconState.initial
        state.anchorDistance = 500
        state.trend = .closer
        state.lastSpokenDistance = 500
        let out = rebaseBeaconState(state, distance: 120)
        #expect(out.anchorDistance == 120)
        #expect(out.lastSpokenDistance == 120)
        #expect(out.trend == .closer)
        #expect(!out.nearby)
    }

    @Test("새 축 값을 모르면 nil로 두어 다음 fix가 first 경로를 탄다")
    func nilFallback() {
        var state = BeaconState.initial
        state.anchorDistance = 500
        state.trend = .farther
        state.lastSpokenDistance = 500
        state.nearby = true
        let out = rebaseBeaconState(state, distance: nil)
        #expect(out.anchorDistance == nil)
        #expect(out.lastSpokenDistance == nil)
        #expect(out.trend == .farther)
        #expect(!out.nearby)
    }
}
