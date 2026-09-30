import Foundation
import Testing

@testable import GildongmuKit

/// 웹 정본과 같은 공유 fixture(`src/lib/__tests__/fixtures/tone-layer-scenarios.json`)를
/// 읽어 **같은 입력 열이 같은 톤 열을 내는지** 강제한다(route-guide-scenarios 선례).
private struct ToneScenarioFile: Decodable {
    let scenarios: [ToneScenario]
}

private struct ToneScenario: Decodable {
    let name: String
    let initial: Initial
    let steps: [Step]

    struct Initial: Decodable {
        let anchorDistance: Double
        let trend: String
    }

    struct TrendJSON: Decodable {
        let distance: Double
        let deadBand: Double
        let motion: String
        let closerIntervalSeconds: Double
    }

    struct Step: Decodable {
        let now: Double
        let unreliable: Bool?
        let priorityTone: String?
        let eventOwned: Bool?
        let trend: TrendJSON?
        let arrived: Bool?
        let rebaseTrend: Bool?
        let expect: String?
    }
}

private func loadToneScenarios() throws -> [ToneScenario] {
    var url = URL(fileURLWithPath: #filePath)
    for _ in 0..<5 { url.deleteLastPathComponent() }  // GildongmuKitTests→Tests→GildongmuKit→ios→repo
    url.appendPathComponent("src/lib/__tests__/fixtures/tone-layer-scenarios.json")
    let data = try Data(contentsOf: url)
    return try JSONDecoder().decode(ToneScenarioFile.self, from: data).scenarios
}

private func beaconTrend(_ raw: String) -> BeaconTrend {
    switch raw {
    case "closer": .closer
    case "farther": .farther
    default: .none
    }
}

private func motionState(_ raw: String) -> MotionState {
    switch raw {
    case "stopped": .stopped
    case "speedUnknown": .speedUnknown
    default: .moving
    }
}

@Suite("톤 계층 공유 fixture")
struct GuideToneLayerFixtureTests {
    @Test("웹 정본 시나리오와 톤 열이 일치한다")
    func matchesWebFixtures() throws {
        for scenario in try loadToneScenarios() {
            var state = ToneLayerState.initial
            state.anchorDistance = scenario.initial.anchorDistance
            state.trend = beaconTrend(scenario.initial.trend)

            for (index, step) in scenario.steps.enumerated() {
                let input = ToneLayerInput(
                    unreliable: step.unreliable ?? false,
                    priorityTone: step.priorityTone.flatMap { BeaconTone(rawValue: $0) },
                    eventOwned: step.eventOwned ?? false,
                    trend: step.trend.map {
                        TrendInput(
                            distance: $0.distance, deadBand: $0.deadBand,
                            motion: motionState($0.motion),
                            closerIntervalSeconds: $0.closerIntervalSeconds
                        )
                    },
                    arrived: step.arrived ?? false,
                    rebaseTrend: step.rebaseTrend ?? false
                )
                let out = toneLayerStep(state: state, input: input, now: step.now)
                state = out.state
                #expect(
                    out.tone?.rawValue == step.expect,
                    "\(scenario.name) step \(index) (now=\(step.now))"
                )
            }
        }
    }
}

@Suite("배타적 톤 계층")
struct GuideToneLayerTests {
    private func trend(
        _ distance: Double, motion: MotionState = .moving, deadBand: Double = 15,
        closer: Double = ToneLayerConstants.walkCloserIntervalSeconds
    ) -> TrendInput {
        TrendInput(
            distance: distance, deadBand: deadBand, motion: motion, closerIntervalSeconds: closer
        )
    }

    private func anchored(_ distance: Double, trend: BeaconTrend = .none) -> ToneLayerState {
        var state = ToneLayerState.initial
        state.anchorDistance = distance
        state.trend = trend
        // 실제 코드에서는 앵커가 처음 설정되는 fix가 이 시각을 잡는다.
        state.anchorSetAt = 0
        return state
    }

    /// 목적지와 평행하게 걷는 상황 — 이동 중인데 거리가 거의 안 변한다.
    private func flat(_ distance: Double) -> TrendInput {
        TrendInput(
            distance: distance, deadBand: 15, deadBandFloor: 5, motion: .moving,
            closerIntervalSeconds: ToneLayerConstants.walkCloserIntervalSeconds
        )
    }

    // MARK: 계층 배타성 — 상위와 추세가 **동시에 참인** fixture로만 관측 가능하다

    @Test("1단계: unreliable이 이긴다 — 추세가 동시에 참이어도 앵커가 갱신되지 않는다")
    func unreliableWins() {
        let state = anchored(100, trend: .closer)
        let (next, tone) = toneLayerStep(
            state: state, input: ToneLayerInput(unreliable: true, trend: trend(50)), now: 10
        )
        #expect(tone == .unreliable)
        #expect(next.anchorDistance == 100)  // trendStep 미호출
        #expect(next.trend == .closer)
        #expect(next.lastTrendToneAt == nil)
    }

    @Test("2단계: 우선 톤이 있으면 추세 판정을 하지 않는다")
    func priorityWins() {
        let state = anchored(100)
        let (next, tone) = toneLayerStep(
            state: state, input: ToneLayerInput(priorityTone: .ahead, trend: trend(50)), now: 10
        )
        #expect(tone == .ahead)
        #expect(next.anchorDistance == 100)
        #expect(next.lastTrendToneAt == nil)
    }

    /// ⚠ **이 순서가 `ahead`·`warning`의 존재 조건이다.** `guideStep`은 `.ahead`를 항상
    /// `announceSteps`와, `.warning`을 항상 `offRoute`와 **함께** 내므로 우선 톤을 실은
    /// fix는 예외 없이 `eventOwned == true`다. 두 값을 서로 다른 스텝에 나눠 두면
    /// 3단계를 2단계 앞으로 옮기는 변이가 전량 green을 통과한다(코드 리뷰 실측 2026-08-08 —
    /// 그 변이는 결정 지점 예고와 이탈 경고를 통째로 없앤다).
    @Test("이벤트를 동반해도 우선 톤이 이긴다(실제로는 항상 동반한다)")
    func priorityWinsOverEvent() {
        for tone in [BeaconTone.ahead, .warning] {
            let (_, out) = toneLayerStep(
                state: anchored(100),
                input: ToneLayerInput(priorityTone: tone, eventOwned: true, trend: trend(50)),
                now: 10
            )
            #expect(out == tone)
        }
    }

    @Test("3단계: 이벤트가 톤 자리를 소유하면 침묵하고 앵커도 불변이다")
    func eventOwns() {
        let state = anchored(100)
        let (next, tone) = toneLayerStep(
            state: state, input: ToneLayerInput(eventOwned: true, trend: trend(50)), now: 10
        )
        #expect(tone == nil)
        #expect(next.anchorDistance == 100)
    }

    @Test("4단계: 상위가 전부 비면 추세 톤이 난다")
    func trendReached() {
        let state = anchored(100)
        let (next, tone) = toneLayerStep(
            state: state, input: ToneLayerInput(trend: trend(80)), now: 10
        )
        #expect(tone == .closer)
        #expect(next.anchorDistance == 80)
    }

    // MARK: 추세 축 내부

    @Test("정지 fix는 침묵하고 추세 축을 건드리지 않는다(E55)")
    func stoppedIsTransparent() {
        let state = anchored(100, trend: .closer)
        let (next, tone) = toneLayerStep(
            state: state, input: ToneLayerInput(trend: trend(60, motion: .stopped)), now: 10
        )
        #expect(tone == nil)
        #expect(next == state)  // 앵커·추세·타이머 불변
    }

    @Test("speedUnknown은 정지가 아니다 — 데드밴드 미달이면 침묵")
    func speedUnknownNoTick() {
        let (_, tone) = toneLayerStep(
            state: anchored(100), input: ToneLayerInput(trend: trend(99, motion: .speedUnknown)),
            now: 10
        )
        #expect(tone == nil)
    }

    @Test("speedUnknown이어도 데드밴드를 넘으면 추세 톤은 난다")
    func speedUnknownStillTrends() {
        let (_, tone) = toneLayerStep(
            state: anchored(100), input: ToneLayerInput(trend: trend(80, motion: .speedUnknown)),
            now: 10
        )
        #expect(tone == .closer)
    }

    // ⚠ 정지 fix가 추세 판정을 돌리면 감쇠(하한 5m)가 서 있는 동안의 흔들림을 결국 톤으로 만든다.
    @Test("오래 서 있으면 거리가 흔들려도 톤이 0이다(신호 대기 2분, E55)")
    func longStopIsSilent() {
        var state = anchored(100, trend: .closer)
        var tones: [String] = []
        for i in 1...120 {
            let jitter: Double = i % 2 == 0 ? 8 : -8
            let input = ToneLayerInput(trend: TrendInput(
                distance: 100 + jitter, deadBand: 15, deadBandFloor: 5, motion: .stopped,
                closerIntervalSeconds: ToneLayerConstants.walkCloserIntervalSeconds
            ))
            let out = toneLayerStep(state: state, input: input, now: Double(i))
            state = out.state
            if let tone = out.tone { tones.append("\(i):\(tone)") }
        }
        #expect(tones.isEmpty)
    }

    // MARK: 정지 중 신뢰 불가(E55)

    /// 워치독은 타이머 구동이라 추세 입력 없이 1단계로 들어온다(`BeaconModel.tickWatchdog`).
    @Test("정지 중 fix 두절은 워치독 입력으로 즉시 unreliable이고 간격마다 반복된다")
    func watchdogWhileStopped() {
        var state = anchored(100, trend: .closer)
        state = toneLayerStep(
            state: state, input: ToneLayerInput(trend: trend(99, motion: .stopped)), now: 0
        ).state
        var out = toneLayerStep(state: state, input: ToneLayerInput(unreliable: true), now: 8)
        #expect(out.tone == .unreliable)
        out = toneLayerStep(state: out.state, input: ToneLayerInput(unreliable: true), now: 10)
        #expect(out.tone == nil)
        out = toneLayerStep(state: out.state, input: ToneLayerInput(unreliable: true), now: 18)
        #expect(out.tone == .unreliable)
    }

    @Test("정지 중 정확도 불량은 정지 추세 입력을 함께 실어도 unreliable이다")
    func weakWhileStopped() {
        let (_, tone) = toneLayerStep(
            state: anchored(100, trend: .closer),
            input: ToneLayerInput(unreliable: true, trend: trend(99, motion: .stopped)),
            now: 5
        )
        #expect(tone == .unreliable)
    }

    // MARK: 빈도 — 수단별 비대칭

    @Test("closer 간격은 수단별이다 — 차량 10초 창에서는 억제된다")
    func carCloserInterval() {
        var state = anchored(1000)
        let car = ToneLayerConstants.carCloserIntervalSeconds
        var out = toneLayerStep(
            state: state, input: ToneLayerInput(trend: trend(900, closer: car)), now: 10
        )
        #expect(out.tone == .closer)
        state = out.state
        out = toneLayerStep(
            state: state, input: ToneLayerInput(trend: trend(800, closer: car)), now: 14
        )
        #expect(out.tone == nil)  // 4초 뒤 — 10초 창 안
        state = out.state
        out = toneLayerStep(
            state: state, input: ToneLayerInput(trend: trend(700, closer: car)), now: 21
        )
        #expect(out.tone == .closer)
    }

    @Test("farther는 수단을 가리지 않는다(경고 축)")
    func fartherAlwaysTwoSeconds() {
        var state = anchored(1000)
        let car = ToneLayerConstants.carCloserIntervalSeconds
        var out = toneLayerStep(
            state: state, input: ToneLayerInput(trend: trend(1100, closer: car)), now: 10
        )
        #expect(out.tone == .farther)
        state = out.state
        out = toneLayerStep(
            state: state, input: ToneLayerInput(trend: trend(1200, closer: car)), now: 12.5
        )
        #expect(out.tone == .farther)  // 2.5초 뒤 — farther 창(2초)은 지났다
    }

    // MARK: 정숙 구간

    @Test("행동 안내 후 3초는 추세 톤을 억제하고 그 사이 앵커도 불변이다")
    func quietAfterAction() {
        var state = anchored(100)
        var out = toneLayerStep(state: state, input: ToneLayerInput(priorityTone: .ahead), now: 10)
        state = out.state
        out = toneLayerStep(state: state, input: ToneLayerInput(trend: trend(80)), now: 11)
        #expect(out.tone == nil)
        #expect(out.state.anchorDistance == 100)  // 억제 중에도 trendStep 미호출
        state = out.state
        out = toneLayerStep(state: state, input: ToneLayerInput(trend: trend(80)), now: 13.5)
        #expect(out.tone == .closer)
    }

    // MARK: 신뢰 불가 진입·지속·회복

    @Test("진입은 즉시 1회, 지속은 간격 반복")
    func unreliableEntryAndInterval() {
        var state = ToneLayerState.initial
        var out = toneLayerStep(state: state, input: ToneLayerInput(unreliable: true), now: 0)
        #expect(out.tone == .unreliable)
        state = out.state
        out = toneLayerStep(state: state, input: ToneLayerInput(unreliable: true), now: 5)
        #expect(out.tone == nil)
        state = out.state
        out = toneLayerStep(state: state, input: ToneLayerInput(unreliable: true), now: 10.1)
        #expect(out.tone == .unreliable)
    }

    /// ⚠ **첫 진입만으로는 "즉시 1회" 계약이 관측되지 않는다.** `lastUnreliableAt`이
    /// nil이면 간격 조건도 참이라 두 판정이 겹친다. 회복 후 재진입이 둘을 가른다
    /// (변이 주입 M5 미검출로 발견 — 간격만 남기면 여기서 침묵한다).
    @Test("회복 후 재진입도 즉시 1회다(간격 창 안이어도)")
    func unreliableReentryIsImmediate() {
        var state = anchored(500, trend: .closer)
        state = toneLayerStep(state: state, input: ToneLayerInput(unreliable: true), now: 0).state
        // 회복
        state = toneLayerStep(
            state: state, input: ToneLayerInput(trend: trend(120)), now: 3
        ).state
        // 재진입 — 직전 unreliable(now=0)로부터 5초뿐이라 간격 창(10초) 안이다.
        let (_, tone) = toneLayerStep(
            state: state, input: ToneLayerInput(unreliable: true), now: 5
        )
        #expect(tone == .unreliable)
    }

    @Test("회복은 앵커 재기준화 후 현재 상태 톤 1회")
    func recoveryImmediateTone() {
        var state = anchored(500, trend: .closer)
        state = toneLayerStep(state: state, input: ToneLayerInput(unreliable: true), now: 0).state
        let (next, tone) = toneLayerStep(
            state: state, input: ToneLayerInput(trend: trend(120)), now: 3
        )
        #expect(tone == .closer)  // 데드밴드 미달이어도 즉시 1회
        #expect(next.anchorDistance == 120)  // 재기준화
        #expect(!next.needsRebase)
    }

    @Test("회복 fix에서 상위 톤이 나도 재기준화 기회를 잃지 않는다")
    func rebaseSurvivesPriorityTone() {
        var state = anchored(500, trend: .closer)
        state = toneLayerStep(state: state, input: ToneLayerInput(unreliable: true), now: 0).state
        // 복귀하는 fix에서 이탈 경고가 났다 — 그 fix는 추세 축에 닿지 못한다.
        state = toneLayerStep(
            state: state, input: ToneLayerInput(priorityTone: .warning), now: 3
        ).state
        #expect(state.needsRebase)
        // 정숙 구간이 끝난 다음 추세 fix가 재기준화를 소비한다.
        let (next, tone) = toneLayerStep(
            state: state, input: ToneLayerInput(trend: trend(120)), now: 7
        )
        #expect(next.anchorDistance == 120)
        #expect(tone == .closer)
    }

    @Test("호출부가 요청한 축 전환도 재기준화한다(handoff)")
    func explicitRebase() {
        let state = anchored(500, trend: .closer)
        let (next, tone) = toneLayerStep(
            state: state, input: ToneLayerInput(trend: trend(120), rebaseTrend: true), now: 10
        )
        #expect(next.anchorDistance == 120)
        #expect(tone == .closer)
    }

    @Test("추세가 none인 상태에서 회복하면 앵커만 잡고 침묵한다")
    func recoveryWithoutTrend() {
        var state = ToneLayerState.initial
        state = toneLayerStep(state: state, input: ToneLayerInput(unreliable: true), now: 0).state
        let (next, tone) = toneLayerStep(
            state: state, input: ToneLayerInput(trend: trend(120)), now: 3
        )
        #expect(tone == nil)
        #expect(next.anchorDistance == 120)
    }

    /// 정지 fix가 예약을 남겨 두면 서 있는 동안 속도 불명 fix 하나가 그것을 소비해 정지 전
    /// 추세를 서 있는 사람에게 들려준다(설계 리뷰 I-2). 정지 fix가 앵커만 잡고 소비한다.
    @Test("정지 중 회복은 앵커만 잡고 침묵한다 — 서 있는 동안 속도 불명 fix도 승계 톤을 내지 않는다")
    func recoveryWhileStopped() {
        var state = anchored(500, trend: .closer)
        state = toneLayerStep(state: state, input: ToneLayerInput(unreliable: true), now: 0).state
        var out = toneLayerStep(
            state: state, input: ToneLayerInput(trend: trend(120, motion: .stopped)), now: 3
        )
        #expect(out.tone == nil)
        #expect(!out.state.needsRebase)
        #expect(out.state.anchorDistance == 120)
        out = toneLayerStep(
            state: out.state, input: ToneLayerInput(trend: trend(118, motion: .speedUnknown)), now: 6
        )
        #expect(out.tone == nil)  // 데드밴드 미달 — 승계 톤 없음
        out = toneLayerStep(state: out.state, input: ToneLayerInput(trend: trend(104)), now: 20)
        #expect(out.tone == .closer)  // 다시 걸어 새 앵커에서 데드밴드를 넘으면 난다
    }

    /// 정지 조기 반환이 `wasUnreliable` 해제보다 앞에 오면 정지 중 재진입이 간격(10초)에 묶인다(I-4).
    @Test("정지 중 회복 뒤 10초 안에 다시 끊겨도 재진입은 즉시 1회다")
    func reentryWhileStoppedIsImmediate() {
        var state = anchored(100, trend: .closer)
        state = toneLayerStep(state: state, input: ToneLayerInput(unreliable: true), now: 0).state
        state = toneLayerStep(
            state: state, input: ToneLayerInput(trend: trend(99, motion: .stopped)), now: 2
        ).state
        #expect(
            toneLayerStep(state: state, input: ToneLayerInput(unreliable: true), now: 5).tone
                == .unreliable
        )
    }

    // MARK: 도착 종단

    @Test("도착 후에는 추세·unreliable을 전부 억제한다")
    func arrivedSuppresses() {
        let state = anchored(30)
        #expect(
            toneLayerStep(
                state: state,
                input: ToneLayerInput(trend: trend(25, motion: .stopped), arrived: true),
                now: 10
            ).tone == nil
        )
        #expect(
            toneLayerStep(
                state: state, input: ToneLayerInput(unreliable: true, arrived: true), now: 10
            ).tone == nil
        )
    }

    @Test("도착 후에도 이탈 경고는 난다(억제 대상이 아니다)")
    func arrivedKeepsPriority() {
        let (_, tone) = toneLayerStep(
            state: .initial, input: ToneLayerInput(priorityTone: .warning, arrived: true), now: 10
        )
        #expect(tone == .warning)
    }

    // MARK: 최대 침묵 계약

    @Test("계약값은 데드밴드 ÷ 느린 구간 속도의 반올림이다")
    func contractValueMatchesDerivation() {
        // 15m ÷ 0.7m/s = 21.43초. 계약값 21초는 사용자에게 하는 약속이고, 이 단언은
        // 상수와 산출식이 어긋나는 것을 막는다(둘 중 하나만 바뀌면 실패한다).
        #expect(abs(ToneLayerConstants.maxNormalSilenceSeconds - 15.0 / 0.7) < 0.5)
    }

    @Test("느린 보행에서 침묵은 데드밴드 통과 시간을 넘지 않는다")
    func maxNormalSilence() {
        // 0.7m/s(느린 구간)로 1초마다 fix. 15m 데드밴드 통과에 약 21.4초가 걸리고
        // fix 주기(1초) 양자화만큼 늦어질 수 있다.
        var state = anchored(300)
        var lastToneAt = 0.0
        var maxGap = 0.0
        var distance = 300.0
        for i in 1...90 {
            let now = Double(i)
            distance -= 0.7
            let out = toneLayerStep(
                state: state, input: ToneLayerInput(trend: trend(distance)), now: now
            )
            state = out.state
            if out.tone != nil {
                maxGap = max(maxGap, now - lastToneAt)
                lastToneAt = now
            }
        }
        #expect(maxGap <= 15.0 / 0.7 + 1.0)
        #expect(lastToneAt > 0)  // 침묵만 하다 끝나지 않았다
    }

    @Test("평상 보행에서는 계약값 안에 들어온다")
    func normalWalkWithinContract() {
        var state = anchored(300)
        var lastToneAt = 0.0
        var maxGap = 0.0
        var distance = 300.0
        for i in 1...60 {
            let now = Double(i)
            distance -= 1.17
            let out = toneLayerStep(
                state: state, input: ToneLayerInput(trend: trend(distance)), now: now
            )
            state = out.state
            if out.tone != nil {
                maxGap = max(maxGap, now - lastToneAt)
                lastToneAt = now
            }
        }
        #expect(maxGap <= ToneLayerConstants.maxNormalSilenceSeconds)
    }

    // MARK: 데드밴드 시간 감쇠(평평한 거리 축)

    @Test("계약값(21초) 안에서는 데드밴드가 원값 그대로다")
    func decayWithinContract() {
        #expect(decayedDeadBand(base: 15, floor: 5, holdSeconds: 0) == 15)
        #expect(decayedDeadBand(base: 15, floor: 5, holdSeconds: 21) == 15)
    }

    @Test("유예 이후 선형으로 하한까지 줄어든다")
    func decayLinearToFloor() {
        #expect(abs(decayedDeadBand(base: 15, floor: 5, holdSeconds: 31.5) - 10) < 0.001)
        #expect(decayedDeadBand(base: 15, floor: 5, holdSeconds: 42) == 5)
        #expect(decayedDeadBand(base: 15, floor: 5, holdSeconds: 120) == 5)
    }

    @Test("하한이 원값 이상이면 감쇠가 없다(기본 계약)")
    func noDecayWithoutFloor() {
        #expect(decayedDeadBand(base: 15, floor: 15, holdSeconds: 100) == 15)
    }

    /// ⚠ 이 시나리오가 접근성 감사 H1의 재현이다. 감쇠가 없으면 톤이 영영 나지 않는다.
    @Test("거리가 8m만 변하는 평행 이동에서도 결국 톤이 난다")
    func flatAxisEventuallySounds() {
        var state = anchored(300)
        var firstToneAt: Double?
        for i in 1...90 {
            let now = Double(i)
            let out = toneLayerStep(
                state: state, input: ToneLayerInput(trend: flat(300 - now * 0.09)), now: now
            )
            state = out.state
            if out.tone != nil, firstToneAt == nil { firstToneAt = now }
        }
        #expect(firstToneAt != nil)
        // 계약값 안에서는 울리지 않는다(현행 동작 보존).
        #expect((firstToneAt ?? 0) > ToneLayerConstants.maxNormalSilenceSeconds)
    }

    @Test("정상 접근에서는 감쇠가 발동하지 않는다(회귀 없음)")
    func normalApproachUnaffected() {
        var state = anchored(300)
        var firstToneAt: Double?
        for i in 1...40 {
            let now = Double(i)
            let out = toneLayerStep(
                state: state, input: ToneLayerInput(trend: flat(300 - now * 1.17)), now: now
            )
            state = out.state
            if out.tone != nil, firstToneAt == nil { firstToneAt = now }
        }
        // 평상 보행이면 13초 안에 첫 톤 — 유예(21초)에 닿기 전이다.
        #expect((firstToneAt ?? .infinity) <= ToneLayerConstants.maxNormalSilenceSeconds)
    }

    @Test("톤이 나면 감쇠 기준이 리셋된다(앵커가 움직인 시각)")
    func anchorMoveResetsDecay() {
        var state = anchored(300)
        state = toneLayerStep(state: state, input: ToneLayerInput(trend: flat(280)), now: 1).state
        #expect(state.anchorSetAt == 1)
        let out = toneLayerStep(state: state, input: ToneLayerInput(trend: flat(272)), now: 30)
        #expect(out.tone == nil)
    }
}
