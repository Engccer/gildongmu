import Testing

@testable import GildongmuKit

/// 나들이 전경 기기 음성(E82 판정 7, 위원장 판정 2026-11-16) — 스위치 실효값, 문장 자리별 대상 판정, 채널 술어에서 바뀌는 칸,
/// 지연 슬롯이 그 판정을 게시까지 나르는가.
@MainActor
struct OutingForegroundSpeechTests {
    @Test func switchEffectiveValue() {
        #expect(OutingForegroundSpeech.defaultEnabled == true)  // 기본 켬
        #expect(OutingForegroundSpeech.isEnabled(stored: nil) == true)
        #expect(OutingForegroundSpeech.isEnabled(stored: false) == false)
        #expect(OutingForegroundSpeech.isEnabled(stored: true) == true)
        // 백그라운드 음성 안내와 다른 저장 키다(한 스위치가 다른 스위치를 끄지 않는다).
        #expect(OutingForegroundSpeech.storageKey != BackgroundSpeech.storageKey)
    }

    // 대상은 자동 안내뿐이다. 시작·종료(화면 전이)와 조작의 직접 응답은 스위치와 무관하게 VoiceOver에 남는다. 명시 표로 잠근다.
    @Test func onlyAutomaticFollowsTheSwitch() {
        let expected: [OutingSpeechOrigin: Bool] = [.automatic: true, .transition: false, .response: false, .status: false]
        #expect(Set(expected.keys) == Set(OutingSpeechOrigin.allCases))
        for origin in OutingSpeechOrigin.allCases {
            #expect(outingDeviceOverVoiceOver(switchEnabled: true, origin: origin) == expected[origin], "\(origin)")
            #expect(outingDeviceOverVoiceOver(switchEnabled: false, origin: origin) == false, "\(origin)")
        }
    }

    private struct Inputs {
        let foreground: Bool, voiceOver: Bool, cls: GuideSpeechClass, enabled: Bool, audible: Bool,
            outing: Bool, ask: Bool
    }

    private var allInputs: [Inputs] {
        let flags = [true, false]
        return flags.flatMap { fg in flags.flatMap { vo in GuideSpeechClass.allCases.flatMap { cls in
            flags.flatMap { on in flags.flatMap { au in flags.flatMap { outing in flags.map { ask in
                Inputs(foreground: fg, voiceOver: vo, cls: cls, enabled: on, audible: au, outing: outing, ask: ask)
            } } } }
        } } }
    }

    private func channel(_ i: Inputs, deviceOverVoiceOver: Bool) -> GuideSpeechChannel {
        guideSpeechChannel(
            foreground: i.foreground, voiceOverRunning: i.voiceOver, speechClass: i.cls,
            backgroundSpeechEnabled: i.enabled, backgroundAudible: i.audible, foregroundDeviceSpeech: i.outing,
            askWindowActive: i.ask, deviceOverVoiceOver: deviceOverVoiceOver)
    }

    // 참이 바꾸는 칸은 「전경 ∧ VoiceOver ∧ 묻고 답하는 구간 밖 ∧ 들림」 하나이고 거기서 VoiceOver → 기기 음성이다. 그 밖의 모든
    // 조합(VoiceOver 꺼진 전경·백그라운드·구간 안)은 거짓일 때와 같다 — 스위치를 꺼도(= 거짓) 현행과 글자 그대로라는 것은
    // `GuideSpeechChannelTests`의 종전 조합 세 시험이 거짓으로 잠근다.
    @Test func trueChangesOnlyAudibleForegroundVoiceOverOutsideAskWindow() {
        for i in allInputs {
            let off = channel(i, deviceOverVoiceOver: false)
            let on = channel(i, deviceOverVoiceOver: true)
            if i.foreground && i.voiceOver && !i.ask && i.audible {
                #expect(off == .voiceOver, "\(i)")
                #expect(on == .device, "\(i)")
            } else {
                #expect(on == off, "\(i)")
            }
        }
    }

    // 세션 승격이 실패해 들리지 않으면(`.ambient`는 무음 스위치에 소리가 죽는다) 기기 음성으로 넘기지 않고 VoiceOver에 남긴다 —
    // 합성기는 끝까지 말했다고 알리므로 들리지 않은 횡단보도 경고가 「말했다」로 소비된다.
    @Test func inaudibleStaysOnVoiceOver() {
        for cls in GuideSpeechClass.allCases {
            let ch = guideSpeechChannel(
                foreground: true, voiceOverRunning: true, speechClass: cls, backgroundSpeechEnabled: true,
                backgroundAudible: false, foregroundDeviceSpeech: true, askWindowActive: false,
                deviceOverVoiceOver: true)
            #expect(ch == .voiceOver, "\(cls)")
        }
    }

    // MARK: 지연 슬롯이 대상 판정을 게시까지 나른다

    @MainActor
    final class Harness {
        var now: Double = 0
        var toneEndsAt: Double?
        var claimed: [Bool] = []
        lazy var announcer: DeferredAnnouncer = DeferredAnnouncer(
            clock: { [weak self] in self?.now ?? 0 },
            sleeper: { [weak self] seconds in self?.now += seconds },
            toneEndsAt: { [weak self] in self?.toneEndsAt },
            post: { [weak self] _, _, _, _, _ in
                guard let self else { return false }
                self.claimed.append(self.announcer.claimDeviceOverVoiceOver())
                return true
            })
    }

    private func drain() async {
        for _ in 0..<10 { await Task.yield() }
    }

    @Test func announcerCarriesDeviceOverVoiceOverToPost() async {
        let h = Harness()
        h.announcer.announce("가게", speechClass: .ambient, deviceOverVoiceOver: true)
        h.announcer.announce("종료", highPriority: true, speechClass: .actionable, deviceOverVoiceOver: false)
        h.announcer.announce("도보 문장", speechClass: .actionable)  // 넘기지 않으면 종전 채널(도보·대중교통)
        #expect(h.claimed == [true, false, false])
        #expect(h.announcer.claimDeviceOverVoiceOver() == false)  // `post` 밖에서는 가져갈 것이 없다

        // 톤 뒤로 미룬 문장도 예약 때의 값을 게시 때 가져간다.
        h.toneEndsAt = 2
        h.announcer.announce("톤 뒤 갈림길", speechClass: .actionable, deviceOverVoiceOver: true)
        #expect(h.claimed.count == 3)
        h.toneEndsAt = nil
        await drain()
        #expect(h.claimed == [true, false, false, true])

        // 사용자 활성화의 직접 응답(시작 거절)은 종전 채널이다.
        h.announcer.announceNow("거절", highPriority: true)
        #expect(h.claimed.last == false)
    }
}
