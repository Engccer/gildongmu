import Testing

@testable import GildongmuKit

/// 백그라운드 음성 안내(E53, spec 2026-09-30) — 채널 술어·분류·토글 실효값·원복 유예.
struct GuideSpeechChannelTests {
    /// 종전(E53 전) 도보·대중교통 `post`: 전경이면 VoiceOver 게시, 백그라운드면 버림(분류·VoiceOver 무관).
    private func legacyBeaconChannel(foreground: Bool) -> GuideSpeechChannel {
        foreground ? .voiceOver : .drop
    }

    /// 종전 나들이 `post`: 전경 ∧ VoiceOver면 VoiceOver, 그 밖은 기기 음성.
    private func legacyOutingChannel(foreground: Bool, voiceOver: Bool) -> GuideSpeechChannel {
        foreground && voiceOver ? .voiceOver : .device
    }

    /// 술어 입력 전 조합(전경·VoiceOver·토글·가청 2^4 × 분류 3).
    private struct Inputs {
        let foreground: Bool, voiceOver: Bool, cls: GuideSpeechClass, enabled: Bool, audible: Bool
    }

    private var allInputs: [Inputs] {
        let flags = [true, false]
        return flags.flatMap { fg in flags.flatMap { vo in GuideSpeechClass.allCases.flatMap { cls in
            flags.flatMap { on in flags.map { au in
                Inputs(foreground: fg, voiceOver: vo, cls: cls, enabled: on, audible: au)
            } }
        } } }
    }

    /// 백그라운드에서 말하는 분류 — 구현식(`!= .deferrable`)을 되풀이하지 않는 명시 집합(검증 리뷰 N6).
    private static let spokenInBackground: Set<GuideSpeechClass> = [.actionable, .urgent]

    private func channel(_ i: Inputs, outing: Bool) -> GuideSpeechChannel {
        guideSpeechChannel(
            foreground: i.foreground, voiceOverRunning: i.voiceOver, speechClass: i.cls,
            backgroundSpeechEnabled: i.enabled, backgroundAudible: i.audible, foregroundDeviceSpeech: outing)
    }

    // spec §1 정식판 불변: 토글 실효값이 거짓이면(정식판은 상수 거짓) 도보·자동차·대중교통의 결과가 종전과
    // 입력 전 조합에서 같다.
    @Test func releaseEquivalenceForBeaconAndTransit() {
        for i in allInputs where !i.enabled {
            #expect(channel(i, outing: false) == legacyBeaconChannel(foreground: i.foreground), "\(i)")
        }
    }

    // 토글이 켜지면 백그라운드의 행동 문장만, 그것도 백그라운드에서 들릴 때만(설계 리뷰 B1) 기기 음성으로 바뀌고 나머지
    // 조합은 종전 그대로다 — 들리지 않는 문장을 "전달"로 치면 1회성 경고 latch와 복귀 상환이 거기서 소비된다.
    @Test func enabledChangesOnlyAudibleBackgroundActionable() {
        for i in allInputs where i.enabled {
            let expected: GuideSpeechChannel = !i.foreground && i.audible && Self.spokenInBackground.contains(i.cls)
                ? .device : legacyBeaconChannel(foreground: i.foreground)
            #expect(channel(i, outing: false) == expected, "\(i)")
        }
    }

    // 나들이: 전경은 토글과 무관하게 종전 그대로(VoiceOver 꺼짐이면 기기 음성). 백그라운드는 토글 켬 ∧ 가청 ∧ 행동
    // 문장만 기기 음성이고, 토글 끔이면 전부 버린다(판정 ② — 효과음만).
    @Test func outingFollowsToggleOnlyInBackground() {
        for i in allInputs {
            let expected: GuideSpeechChannel = i.foreground
                ? legacyOutingChannel(foreground: true, voiceOver: i.voiceOver)
                : (i.enabled && i.audible && Self.spokenInBackground.contains(i.cls) ? .device : .drop)
            #expect(channel(i, outing: true) == expected, "\(i)")
        }
    }

    @Test func toggleEffectiveValue() {
        #expect(BackgroundSpeech.defaultEnabled == true)
        #expect(BackgroundSpeech.isEnabled(stored: nil, available: true) == true)   // 기본값 켬
        #expect(BackgroundSpeech.isEnabled(stored: false, available: true) == false)
        #expect(BackgroundSpeech.isEnabled(stored: true, available: true) == true)
        // 정식판: 저장값과 무관하게 거짓(실험판에서 켠 값이 같은 기기 정식판으로 새지 않는다 — 번들 ID도 다르다).
        for stored in [nil, true, false] as [Bool?] {
            #expect(BackgroundSpeech.isEnabled(stored: stored, available: false) == false)
        }
    }

    // spec §3.2: 경로 이벤트 전수. 예고·임박·경유지·복귀는 행동, 이탈은 회차 시작만, 주기·상태는 미룸.
    @Test func guideEventClassification() {
        let actionable: [GuideEvent] = [
            .announceSteps([0]),
            .farNotice(indices: [2], remainingMeters: 300), .waypointReached,
            .waypointApproaching(remainingMeters: 40), .backOnRoute,
        ]
        for event in actionable {
            #expect(guideEventSpeechClass(event, offRouteEpisodeStart: false) == .actionable, "\(event)")
        }
        let deferrable: [GuideEvent] = [
            .bundleReread([0]), .periodic(stepIndex: 0, remainingMeters: 120, accuracy: 5),
            .uncertainEnter, .uncertainExit, .reacquiring, .reacquired, .speedSuggest, .finalApproachEnter,
        ]
        for event in deferrable {
            #expect(guideEventSpeechClass(event, offRouteEpisodeStart: true) == .deferrable, "\(event)")
        }
        // 임박 명령은 시간에 묶인 행동 문장 — 기기 음성에서 선점한다(접근성 감사 MAJOR 2).
        #expect(guideEventSpeechClass(.imminent(indices: [1], action: .left, stage: 0), offRouteEpisodeStart: false) == .urgent)
        #expect(guideEventSpeechClass(.imminent(indices: [1], action: .left, stage: 2), offRouteEpisodeStart: true) == .urgent)
        #expect(guideEventSpeechClass(.offRoute, offRouteEpisodeStart: true) == .actionable)
        #expect(guideEventSpeechClass(.offRoute, offRouteEpisodeStart: false) == .deferrable)
    }

    @Test func beaconNoticeClassification() {
        #expect(beaconNoticeSpeechClass(.nearby(accuracyMeters: 10)) == .actionable)
        for notice: BeaconNotice in [.first(meters: 300), .closer(meters: 200), .farther(meters: 220), .weak] {
            #expect(beaconNoticeSpeechClass(notice) == .deferrable, "\(notice)")
        }
    }

    // spec §3.3: 대중교통 이벤트 전수. 사다리는 잔여 ≤1에서만 행동이 된다(`transitEventProfile`의 interrupt 경계와 같다).
    @Test func transitEventClassification() {
        let actionable: [TransitGuideEvent] = [
            .vehicleSelected(legIndex: 0), .vehiclePassed, .arrivingAtBoardStop, .arrivingAtAlightStop,
            .boarded(legIndex: 0, cause: .observed), .boarded(legIndex: 0, cause: .departed),
            .boarded(legIndex: 0, cause: .declared), .arrived(certain: true), .arrived(certain: false),
            .legAdvanced(legIndex: 1, final: false), .legAdvanced(legIndex: 1, final: true), .neverSeen,
            .approaching(remaining: 1, message: "", messageEn: nil),
            .countdown(remaining: 1, message: "", messageEn: nil, currentLocation: nil,
                       currentLocationEn: nil, arrivalCode: nil),
        ]
        for event in actionable {
            #expect(transitEventSpeechClass(event) == .actionable, "\(event)")
        }
        let deferrable: [TransitGuideEvent] = [
            .approaching(remaining: 2, message: "", messageEn: nil),
            .approaching(remaining: nil, message: "", messageEn: nil),
            .countdown(remaining: 2, message: "", messageEn: nil, currentLocation: nil,
                       currentLocationEn: nil, arrivalCode: nil),
            .trackingStarted(message: "", messageEn: nil, remaining: 3, arrivalCode: nil),
            .messageChanged(message: "", messageEn: nil, arrivalCode: nil),
            .backOnTrack(message: "", messageEn: nil, arrivalCode: nil),
            .approxVehicleChanged(message: "", messageEn: nil),
            .signalLost, .upstreamFailed, .signalRecovered, .boardingReset, .capSlowed,
        ]
        for event in deferrable {
            #expect(transitEventSpeechClass(event) == .deferrable, "\(event)")
        }
        // 행동 문장 = interrupting 이벤트 ∪ 국면 전이·1회성 행동. interrupting인데 미룸인 이벤트는 없다.
        for event in actionable + deferrable where transitEventProfile(event).interrupt {
            #expect(transitEventSpeechClass(event) == .actionable, "\(event)")
        }
    }

    // 원복 다리는 톤 뒤 발화 간격(0.15초)과 대기 칸 확인 간격(0.3초)보다 길어야 종료 문장이 말하기 시작하기 전에
    // 원복이 떨어지지 않는다(설계 리뷰 M4 — 그 뒤는 발화 대기가 잇는다).
    @Test func endBridgeCoversSpeechStart() {
        #expect(deviceSpeechEndBridgeSeconds > SpeechDeferConstants.speechDeferGapSeconds + DeviceSpeechQueue.pollSeconds)
        #expect(deviceSpeechEndWaitMaxSeconds >= 12)  // 가장 긴 안내 문장(재획득 + 현재 구간 전문)보다 길게
    }
}
