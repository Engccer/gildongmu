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
        #expect(state.isActive)
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
    @Test("세션 밖 인터럽션·route 변경·카테고리 탈취는 공유 세션을 건드리지 않는다")
    func outsideSessionLeavesSharedSessionAlone() {
        #expect(guideAudioStep(state: .initial, event: .interrupted).action == .none)
        #expect(guideAudioStep(state: .initial, event: .routeChanged).action == .none)
        #expect(guideAudioStep(state: .initial, event: .categoryTakenOver).action == .none)
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

    @Test("종료가 억제 중에 도착하면 원복 자격을 유지한다(해제 재조정이 원복하며 반납)")
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

    // === PORTS ① 활성화 축 (2026-09-11) ===

    /// ⚠ "이미 `.playback`이면 할 일 없음" 단락 분기 도입 방지 가드. 인터럽션은 활성만 뺏고
    /// 카테고리는 남기므로, 그 분기가 생기면 통화 뒤 죽은 세션 위에서 조용한 무음이 된다.
    @Test("이미 .playback인 세션의 인터럽션 종료도 재적용을 낸다")
    func interruptedWhilePlaybackReapplies() {
        var state = GuideAudioSessionState.initial
        state = guideAudioStep(state: state, event: .sessionStarted).state
        let (next, action) = guideAudioStep(state: state, event: .interrupted)
        #expect(action == .apply(.playback))
        #expect(next.isActive)
    }

    @Test("인터럽션 시작은 활성만 내리고, 다음 세션 확보가 재적용한다(.ended 유실 대비)")
    func interruptionBeganThenEnsureActive() {
        var state = GuideAudioSessionState.initial
        state = guideAudioStep(state: state, event: .sessionStarted).state
        let began = guideAudioStep(state: state, event: .interruptionBegan)
        #expect(began.action == .none)
        #expect(!began.state.isActive)
        // 카테고리·자격은 그대로다 — 세션만 죽었다.
        #expect(began.state.didPromote)
        #expect(began.state.desired == .playback)
        let (next, action) = guideAudioStep(state: began.state, event: .ensureActive)
        #expect(action == .apply(.playback))
        #expect(next.isActive)
    }

    // === PORTS ② 원복 자격 불변식 — 전수 열 (2026-09-11) ===

    /// `didPromote == (마지막으로 낸 적용 동작의 카테고리 == .playback)`을 이벤트 9종의
    /// 길이 ≤5 전수 열(9⁵ = 59,049)에서 단언한다. dodo는 자격을 `applied`에서 유도해 이
    /// 어긋남을 표현 불가능하게 만들었고, gildongmu는 저장 필드지만 이 전수 검사가 등가를 준다.
    /// `.ownershipTransferred`는 "다음 소유자가 적용했다"라 이 알파벳 밖이다(아래 별도 테스트).
    @Test("원복 자격은 언제나 마지막 적용 카테고리에서 유도된다(전수 열)")
    func promotionEqualsLastAppliedExhaustively() {
        let alphabet: [GuideAudioEvent] = [
            .sessionStarted, .sessionEnded, .suppressionChanged(true), .suppressionChanged(false),
            .interruptionBegan, .interrupted, .routeChanged, .categoryTakenOver, .ensureActive,
        ]
        var checked = 0
        func walk(_ state: GuideAudioSessionState, _ lastApplied: GuideAudioCategory?, _ depth: Int) {
            for event in alphabet {
                let out = guideAudioStep(state: state, event: event)
                var applied = lastApplied
                switch out.action {
                case let .apply(c), let .rebuild(c): applied = c
                case .none: break
                }
                #expect(
                    out.state.didPromote == (applied == .playback),
                    "\(event) after depth \(depth): didPromote=\(out.state.didPromote) applied=\(String(describing: applied))")
                checked += 1
                if depth < 5 { walk(out.state, applied, depth + 1) }
            }
        }
        walk(.initial, nil, 1)
        #expect(checked == 9 + 81 + 729 + 6561 + 59049)
    }

    /// 두 재생기 인스턴스(도보·대중교통)의 인계: 먼저 끝난 쪽의 미뤄진 원복이 새 소유자 위에
    /// 떨어지지 않게, 자격만 내려놓고 세션은 건드리지 않는다. 그 뒤 이 인스턴스의 옵서버는
    /// 세션 밖 취급이다.
    @Test("소유권 이전은 자격만 반납하고 세션을 건드리지 않으며, 그 뒤 옵서버는 세션 밖이다")
    func ownershipTransferRelinquishesWithoutTouchingSession() {
        var state = GuideAudioSessionState.initial
        state = guideAudioStep(state: state, event: .sessionStarted).state
        let transferred = guideAudioStep(state: state, event: .ownershipTransferred)
        #expect(transferred.action == .none)
        #expect(!transferred.state.didPromote)
        #expect(transferred.state.desired == .ambient)
        state = transferred.state
        #expect(guideAudioStep(state: state, event: .interrupted).action == .none)
        #expect(guideAudioStep(state: state, event: .routeChanged).action == .none)
        #expect(guideAudioStep(state: state, event: .categoryTakenOver).action == .none)
        #expect(guideAudioStep(state: state, event: .sessionEnded).action == .none)
        // 다시 시작하면 새로 승격한다.
        #expect(guideAudioStep(state: state, event: .sessionStarted).action == .apply(.playback))
    }

    // === PORTS ③ 메아리 식별 (2026-09-11) ===

    @Test("route 변경 사유 매핑: 자기 메아리는 nil, 남의 카테고리 변경은 탈취, 그 밖은 route 변경")
    func routeChangeReasonMapping() {
        #expect(guideAudioRouteChangeEvent(reason: .categoryChange, matchesApplied: true) == nil)
        #expect(guideAudioRouteChangeEvent(reason: .categoryChange, matchesApplied: false) == .categoryTakenOver)
        #expect(guideAudioRouteChangeEvent(reason: .other, matchesApplied: true) == .routeChanged)
        #expect(guideAudioRouteChangeEvent(reason: .other, matchesApplied: false) == .routeChanged)
    }

    @Test("카테고리 탈취는 소유 중에만 재적용하고 플레이어는 재생성하지 않는다")
    func categoryTakenOverReappliesWithoutRebuild() {
        var state = GuideAudioSessionState.initial
        state = guideAudioStep(state: state, event: .sessionStarted).state
        let (_, action) = guideAudioStep(state: state, event: .categoryTakenOver)
        #expect(action == .apply(.playback))
        state = guideAudioStep(state: state, event: .suppressionChanged(true)).state
        #expect(guideAudioStep(state: state, event: .categoryTakenOver).action == .none)
    }
}
