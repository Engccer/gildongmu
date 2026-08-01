import Testing
@testable import GildongmuKit

/// 톤·통지 게이트 계약. 이 기능의 실제 결함 이력은 100% 이 계층이었는데
/// (웹 2026-07-04 감사 2건) 앱 타깃 테스트 번들이 없어서, 판정을 Kit으로 내려야만
/// 검증할 수 있다. 시각을 주입하므로 실시간 대기가 없다.
private func announce(
    _ kind: AnnounceKind, distance: Double = 100, accuracy: Double = 10, speak: Bool = false
) -> BeaconAnnounce {
    BeaconAnnounce(kind: kind, distance: distance, accuracy: accuracy, speak: speak)
}

@Suite struct BeaconGateToneTests {
    /// 웹에서 실제로 났던 회귀. 창을 공유하면 데드밴드 안 미세 흔들림이 잦을 때
    /// tick이 예산을 잠식해 정작 핵심인 추세 톤이 소실된다.
    @Test func trendToneAndTickUseIndependentWindows() {
        var s = BeaconGateState.initial
        let r1 = beaconGateStep(state: s, announce: announce(.hold), now: 0)
        #expect(r1.tone == .tick)
        s = r1.state

        // tick 창(3초) 한복판이지만 추세 창은 별개라 closer 톤이 나와야 한다.
        let r2 = beaconGateStep(state: s, announce: announce(.closer), now: 0.5)
        #expect(r2.tone == .closer)
    }

    @Test func trendToneRespectsItsOwnWindow() {
        var s = BeaconGateState.initial
        s = beaconGateStep(state: s, announce: announce(.closer), now: 0).state
        // 2초 창 안 재요청은 무음
        #expect(beaconGateStep(state: s, announce: announce(.closer), now: 1.9).tone == nil)
        // 창을 넘기면 재생
        #expect(beaconGateStep(state: s, announce: announce(.closer), now: 2.1).tone == .closer)
    }

    @Test func tickRespectsItsOwnWindow() {
        var s = BeaconGateState.initial
        s = beaconGateStep(state: s, announce: announce(.hold), now: 0).state
        #expect(beaconGateStep(state: s, announce: announce(.hold), now: 2.9).tone == nil)
        #expect(beaconGateStep(state: s, announce: announce(.hold), now: 3.1).tone == .tick)
    }

    /// 초안 설계의 치명적 오판. 리듀서 래치는 음성만 막고 톤은 매 fix 흐른다.
    /// 도착해 서 있는 동안 가장 밝은 톤이 GPS 주기로 무한 반복되면 안 된다.
    @Test func nearbyTonePlaysOncePerZoneEntry() {
        var s = BeaconGateState.initial
        let first = beaconGateStep(state: s, announce: announce(.nearby, speak: true), now: 0)
        #expect(first.tone == .nearby)
        s = first.state

        for t in [1.0, 5.0, 30.0, 120.0] {
            let r = beaconGateStep(state: s, announce: announce(.nearby), now: t)
            #expect(r.tone == nil)
            s = r.state
        }
    }

    /// 존 경계에서 흔들리는 것(hold)은 재진입이 아니다. 다시 울리면 시끄럽다.
    @Test func hysteresisHoldDoesNotRearmNearbyTone() {
        var s = beaconGateStep(state: .initial, announce: announce(.nearby), now: 0).state
        s = beaconGateStep(state: s, announce: announce(.hold), now: 4).state
        #expect(beaconGateStep(state: s, announce: announce(.nearby), now: 8).tone == nil)
    }

    /// 진짜로 존을 벗어나 추세가 재개되면 다음 도착은 다시 알린다.
    @Test func nearbyToneReplaysAfterTrendResumes() {
        var s = beaconGateStep(state: .initial, announce: announce(.nearby), now: 0).state
        s = beaconGateStep(state: s, announce: announce(.farther), now: 10).state
        #expect(beaconGateStep(state: s, announce: announce(.nearby), now: 20).tone == .nearby)
    }

    @Test func firstAndWeakHaveNoTone() {
        #expect(beaconGateStep(state: .initial, announce: announce(.first, speak: true), now: 0).tone == nil)
        #expect(beaconGateStep(state: .initial, announce: announce(.weak), now: 0).tone == nil)
    }
}

@Suite struct BeaconGateNoticeTests {
    @Test func speakingAnnouncesCarryRoundedDistance() {
        let r = beaconGateStep(
            state: .initial, announce: announce(.closer, distance: 123.4, speak: true), now: 0
        )
        #expect(r.notice == .closer(meters: 123))
    }

    /// 문구가 "목적지 근처 (약 ±N m)"로 **오차 반경**을 말한다. distance를 넣으면
    /// 의미가 뒤집힌다.
    @Test func nearbyNoticeCarriesAccuracyNotDistance() {
        let r = beaconGateStep(
            state: .initial,
            announce: announce(.nearby, distance: 7, accuracy: 12.4, speak: true),
            now: 0
        )
        #expect(r.notice == .nearby(accuracyMeters: 12))
    }

    @Test func nonSpeakingTrendMakesNoNotice() {
        let r = beaconGateStep(state: .initial, announce: announce(.closer, speak: false), now: 0)
        #expect(r.notice == nil)
    }

    /// weak은 리듀서에서 항상 speak=false다. speak만 보고 통지를 내면 신호 약함이
    /// 영영 통지되지 않는다(초안 설계의 오류).
    @Test func weakNoticeOnTransitionOnly() {
        var s = BeaconGateState.initial
        s = beaconGateStep(state: s, announce: announce(.closer, speak: true), now: 0).state

        let enter = beaconGateStep(state: s, announce: announce(.weak), now: 1)
        #expect(enter.notice == .weak)
        s = enter.state

        // 연속 weak은 침묵(polite 통지 스팸 방지)
        for t in [2.0, 3.0, 4.0] {
            let r = beaconGateStep(state: s, announce: announce(.weak), now: t)
            #expect(r.notice == nil)
            s = r.state
        }

        // 회복 후 다시 나빠지면 재통지
        s = beaconGateStep(state: s, announce: announce(.closer, speak: true), now: 5).state
        #expect(beaconGateStep(state: s, announce: announce(.weak), now: 6).notice == .weak)
    }

    /// 첫 안내가 통째로 사라지는 회귀를 잡는다(리뷰 변이 생존 M12).
    @Test func firstAnnounceCarriesNotice() {
        let r = beaconGateStep(
            state: .initial, announce: announce(.first, distance: 302.6, speak: true), now: 0
        )
        #expect(r.notice == .first(meters: 303))
    }

    /// weak 억제는 "직전이 weak인가"로만 판정해야 한다. hold를 거치면 재통지가 맞다
    /// (리뷰 변이 생존 M14 + previousKind 미갱신 변이).
    @Test func weakRenotifiesAfterAnyOtherKind() {
        var s = BeaconGateState.initial
        s = beaconGateStep(state: s, announce: announce(.weak), now: 0).state
        s = beaconGateStep(state: s, announce: announce(.hold), now: 1).state
        #expect(beaconGateStep(state: s, announce: announce(.weak), now: 2).notice == .weak)
    }

    @Test func holdMakesNoNotice() {
        #expect(beaconGateStep(state: .initial, announce: announce(.hold), now: 0).notice == nil)
    }
}
