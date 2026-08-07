import Testing
@testable import GildongmuKit

/// 통지 게이트 계약. 이 기능의 실제 결함 이력은 100% 이 계층이었는데
/// (웹 2026-07-04 감사 2건) 앱 타깃 테스트 번들이 없어서, 판정을 Kit으로 내려야만
/// 검증할 수 있다.
///
/// ⚠ 톤 창(추세 2초·tick 3초) 계약은 2026-08-08에 `GuideToneLayerTests`로 이관됐다.
/// 여기 남은 톤 축은 **도착 톤 소유 판정** 하나뿐이다.
private func announce(
    _ kind: AnnounceKind, distance: Double = 100, accuracy: Double = 10, speak: Bool = false
) -> BeaconAnnounce {
    BeaconAnnounce(kind: kind, distance: distance, accuracy: accuracy, speak: speak)
}

@Suite struct BeaconGateNearbyToneTests {
    /// 초안 설계의 치명적 오판. 리듀서 래치는 음성만 막고 톤은 매 fix 흐른다.
    /// 도착해 서 있는 동안 가장 밝은 톤이 GPS 주기로 무한 반복되면 안 된다.
    @Test func nearbyTonePlaysOncePerZoneEntry() {
        var s = BeaconGateState.initial
        let first = beaconGateStep(state: s, announce: announce(.nearby, speak: true))
        #expect(first.nearbyTone)
        s = first.state

        for _ in 0..<4 {
            let r = beaconGateStep(state: s, announce: announce(.nearby))
            #expect(!r.nearbyTone)
            s = r.state
        }
    }

    /// 존 경계에서 흔들리는 것(hold)은 재진입이 아니다. 다시 울리면 시끄럽다.
    @Test func hysteresisHoldDoesNotRearmNearbyTone() {
        var s = beaconGateStep(state: .initial, announce: announce(.nearby)).state
        s = beaconGateStep(state: s, announce: announce(.hold)).state
        #expect(!beaconGateStep(state: s, announce: announce(.nearby)).nearbyTone)
    }

    /// 진짜로 존을 벗어나 추세가 재개되면 다음 도착은 다시 알린다.
    @Test func nearbyToneReplaysAfterTrendResumes() {
        var s = beaconGateStep(state: .initial, announce: announce(.nearby)).state
        s = beaconGateStep(state: s, announce: announce(.farther)).state
        #expect(beaconGateStep(state: s, announce: announce(.nearby)).nearbyTone)
    }

    @Test func nonNearbyKindsNeverOwnTheTone() {
        for kind in [AnnounceKind.first, .weak, .hold, .closer, .farther] {
            #expect(!beaconGateStep(state: .initial, announce: announce(kind)).nearbyTone)
        }
    }
}

@Suite struct BeaconGateNoticeTests {
    @Test func speakingAnnouncesCarryRoundedDistance() {
        let r = beaconGateStep(
            state: .initial, announce: announce(.closer, distance: 123.4, speak: true)
        )
        #expect(r.notice == .closer(meters: 123))
    }

    /// 문구가 "목적지 근처 (약 ±N m)"로 **오차 반경**을 말한다. distance를 넣으면
    /// 의미가 뒤집힌다.
    @Test func nearbyNoticeCarriesAccuracyNotDistance() {
        let r = beaconGateStep(
            state: .initial,
            announce: announce(.nearby, distance: 7, accuracy: 12.4, speak: true)
        )
        #expect(r.notice == .nearby(accuracyMeters: 12))
    }

    @Test func nonSpeakingTrendMakesNoNotice() {
        let r = beaconGateStep(state: .initial, announce: announce(.closer, speak: false))
        #expect(r.notice == nil)
    }

    /// weak은 리듀서에서 항상 speak=false다. speak만 보고 통지를 내면 신호 약함이
    /// 영영 통지되지 않는다(초안 설계의 오류).
    @Test func weakNoticeOnTransitionOnly() {
        var s = BeaconGateState.initial
        s = beaconGateStep(state: s, announce: announce(.closer, speak: true)).state

        let enter = beaconGateStep(state: s, announce: announce(.weak))
        #expect(enter.notice == .weak)
        s = enter.state

        // 연속 weak은 침묵(polite 통지 스팸 방지)
        for _ in 0..<3 {
            let r = beaconGateStep(state: s, announce: announce(.weak))
            #expect(r.notice == nil)
            s = r.state
        }

        // 회복 후 다시 나빠지면 재통지
        s = beaconGateStep(state: s, announce: announce(.closer, speak: true)).state
        #expect(beaconGateStep(state: s, announce: announce(.weak)).notice == .weak)
    }

    /// 첫 안내가 통째로 사라지는 회귀를 잡는다(리뷰 변이 생존 M12).
    @Test func firstAnnounceCarriesNotice() {
        let r = beaconGateStep(
            state: .initial, announce: announce(.first, distance: 302.6, speak: true)
        )
        #expect(r.notice == .first(meters: 303))
    }

    /// weak 억제는 "직전이 weak인가"로만 판정해야 한다. hold를 거치면 재통지가 맞다
    /// (리뷰 변이 생존 M14 + previousKind 미갱신 변이).
    @Test func weakRenotifiesAfterAnyOtherKind() {
        var s = BeaconGateState.initial
        s = beaconGateStep(state: s, announce: announce(.weak)).state
        s = beaconGateStep(state: s, announce: announce(.hold)).state
        #expect(beaconGateStep(state: s, announce: announce(.weak)).notice == .weak)
    }

    @Test func holdMakesNoNotice() {
        #expect(beaconGateStep(state: .initial, announce: announce(.hold)).notice == nil)
    }
}
