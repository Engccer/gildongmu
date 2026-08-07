import Testing

@testable import GildongmuKit

@Suite("안내 오디오 세션 소유권")
struct GuideAudioSessionTests {
    @Test("세션 시작은 .playback으로 승격한다")
    func startPromotes() {
        let (state, action) = guideAudioStep(state: .initial, event: .sessionStarted)
        #expect(action == .apply(.playback))
        #expect(state.desired == .playback)
        #expect(state.didPromote)
    }

    @Test("suppression 중 시작은 의도만 저장하고 적용하지 않는다")
    func startWhileSuppressed() {
        var state = guideAudioStep(state: .initial, event: .suppressionChanged(true)).state
        let stepped = guideAudioStep(state: state, event: .sessionStarted)
        state = stepped.state
        #expect(stepped.action == .none)
        #expect(state.desired == .playback)
        // 적용하지 않았으므로 원복 자격도 없다.
        #expect(!state.didPromote)
    }

    @Test("suppression 해제 시 저장된 의도를 재적용한다")
    func reconcileOnSuppressionEnd() {
        var state = GuideAudioSessionState.initial
        state = guideAudioStep(state: state, event: .suppressionChanged(true)).state
        state = guideAudioStep(state: state, event: .sessionStarted).state
        let (next, action) = guideAudioStep(state: state, event: .suppressionChanged(false))
        #expect(action == .apply(.playback))
        #expect(next.didPromote)
    }

    @Test("우리가 승격하지 않았으면 종료 시 원복하지 않는다")
    func noRevertWithoutPromotion() {
        var state = GuideAudioSessionState.initial
        state = guideAudioStep(state: state, event: .suppressionChanged(true)).state
        state = guideAudioStep(state: state, event: .sessionStarted).state
        let (_, action) = guideAudioStep(state: state, event: .sessionEnded)
        #expect(action == .none)
    }

    /// ⚠ **`isSuppressed` 가드와 겹치지 않는 유일한 경로다.** 억제 중 시작 후 종료는
    /// 두 가드가 같은 결과를 내서 `didPromote` 축이 관측되지 않는다(변이 주입 M7
    /// 미검출로 발견). 시작한 적 없는 종료라야 원복 자격 하나만 판정에 남는다.
    @Test("시작한 적 없는 종료는 세션을 건드리지 않는다")
    func endWithoutStart() {
        let (state, action) = guideAudioStep(state: .initial, event: .sessionEnded)
        #expect(action == .none)
        #expect(!state.didPromote)
    }

    @Test("승격했으면 종료 시 .ambient로 원복한다")
    func revertAfterPromotion() {
        var state = GuideAudioSessionState.initial
        state = guideAudioStep(state: state, event: .sessionStarted).state
        let (next, action) = guideAudioStep(state: state, event: .sessionEnded)
        #expect(action == .apply(.ambient))
        #expect(!next.didPromote)
        #expect(next.desired == .ambient)
    }

    @Test("인터럽션 종료가 suppression 중에 도착해도 해제 시 복구된다")
    func interruptionDuringSuppression() {
        var state = GuideAudioSessionState.initial
        state = guideAudioStep(state: state, event: .sessionStarted).state
        state = guideAudioStep(state: state, event: .suppressionChanged(true)).state
        let ignored = guideAudioStep(state: state, event: .interrupted)
        #expect(ignored.action == .none)
        state = ignored.state
        let (_, action) = guideAudioStep(state: state, event: .suppressionChanged(false))
        #expect(action == .apply(.playback))
    }

    @Test("route 변경은 플레이어 재생성을 요구한다")
    func routeChangeRebuilds() {
        var state = GuideAudioSessionState.initial
        state = guideAudioStep(state: state, event: .sessionStarted).state
        let (_, action) = guideAudioStep(state: state, event: .routeChanged)
        #expect(action == .rebuild(.playback))
    }

    /// ⚠ **안내가 돌지 않는 동안에는 공유 세션을 건드리지 않는다**(스펙 §3.2 규칙 3).
    /// route 변경 옵서버가 신설되면서 세션 밖에서도 이 경로가 열렸는데, 그때 `.ambient`를
    /// 강제하면 온디바이스 TTS가 낭독 중인 카테고리를 바꾼다(코드 리뷰 2026-08-08).
    @Test("세션 밖 인터럽션·route 변경은 공유 세션을 건드리지 않는다")
    func outsideSessionLeavesSharedSessionAlone() {
        #expect(guideAudioStep(state: .initial, event: .interrupted).action == .none)
        #expect(guideAudioStep(state: .initial, event: .routeChanged).action == .none)
    }

    /// 단발 재생 직전의 세션 확보만 원복 자격 없이도 적용된다(종전 `ensureSession()` 동형).
    @Test("세션 밖 단발 재생은 .ambient로 세션을 확보한다")
    func ensureActiveOutsideSession() {
        let (state, action) = guideAudioStep(state: .initial, event: .ensureActive)
        #expect(action == .apply(.ambient))
        #expect(!state.didPromote)
    }

    @Test("억제 중 route 변경은 점유자의 세션을 건드리지 않는다")
    func routeChangeWhileSuppressed() {
        var state = GuideAudioSessionState.initial
        state = guideAudioStep(state: state, event: .sessionStarted).state
        state = guideAudioStep(state: state, event: .suppressionChanged(true)).state
        let (_, action) = guideAudioStep(state: state, event: .routeChanged)
        #expect(action == .none)
    }

    @Test("종료가 억제 중에 도착하면 원복 자격만 반납한다")
    func endWhileSuppressed() {
        var state = GuideAudioSessionState.initial
        state = guideAudioStep(state: state, event: .sessionStarted).state
        state = guideAudioStep(state: state, event: .suppressionChanged(true)).state
        let ended = guideAudioStep(state: state, event: .sessionEnded)
        #expect(ended.action == .none)
        // ⚠ 자격을 아직 반납하지 않는다 — 원복을 못 했으므로 의무가 남아 있다.
        #expect(ended.state.didPromote)
        // 해제 시 재조정이 .ambient를 적용하고, 그때 자격이 반납된다.
        let (next, action) = guideAudioStep(state: ended.state, event: .suppressionChanged(false))
        #expect(action == .apply(.ambient))
        #expect(!next.didPromote)
    }
}
