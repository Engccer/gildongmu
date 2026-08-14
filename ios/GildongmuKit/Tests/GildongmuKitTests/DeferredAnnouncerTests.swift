import Testing

@testable import GildongmuKit

/// `DeferredAnnouncer` 수명 계약 테스트(spec 2026-08-14 §4·§8).
///
/// 순수 함수(`speechDeferStep`)만 검사하면 §8의 변이 6종이 전부 통과한다 — 이
/// 스위트의 존재 이유는 비동기 수명 계약(단일 슬롯 latest-wins·세대 토큰·토큰 확인·
/// 재평가 상한·onDropped)을 주입 시계·sleeper로 결정론 검증하는 것이다.
///
/// 테스트 sleeper는 시계를 동기 전진시키고 즉시 반환한다 — 실제 `Task.sleep`의
/// "취소되면 즉시 반환" 의미론과 동형이라, 취소 뒤에도 본문이 계속 실행되는 경로
/// (§4-3이 막는 결함)를 그대로 재현한다.
@MainActor
struct DeferredAnnouncerTests {
    @MainActor
    final class Harness {
        var now: Double = 0
        private(set) var sleeps: [Double] = []
        private(set) var posts: [(text: String, highPriority: Bool, bypass: Bool)] = []
        /// post의 반환값(게시 성공 여부). 억제·백그라운드 실패를 흉내 낸다.
        var postResult = true
        /// toneEndsAt 스크립트 — 호출마다 하나씩 소비, 소진되면 마지막 값 반복.
        /// 재대입 시 소비 위치도 처음으로 되돌린다(테스트 중간 국면 전환용).
        var toneScript: [Double?] = [nil] {
            didSet { toneCallIndex = 0 }
        }
        /// 스크립트 대신 동적 판정이 필요할 때(상한 테스트 — 항상 잔여 2초).
        var toneDynamic: (() -> Double?)?

        private var toneCallIndex = 0
        func nextToneEndsAt() -> Double? {
            if let dynamic = toneDynamic { return dynamic() }
            let value = toneScript[min(toneCallIndex, toneScript.count - 1)]
            toneCallIndex += 1
            return value
        }

        lazy var announcer = DeferredAnnouncer(
            clock: { [weak self] in self?.now ?? 0 },
            sleeper: { [weak self] seconds in
                self?.sleeps.append(seconds)
                self?.now += seconds
            },
            toneEndsAt: { [weak self] in self?.nextToneEndsAt() },
            post: { [weak self] text, high, bypass in
                self?.posts.append((text, high, bypass))
                return self?.postResult ?? true
            }
        )
    }

    /// 예약된 Task들이 소진되도록 메인 액터를 양보한다.
    private func drain() async {
        for _ in 0..<10 { await Task.yield() }
    }

    @Test func immediateWhenNoTone() async {
        let h = Harness()
        h.toneScript = [nil]
        h.announcer.announce("지금")
        #expect(h.posts.map(\.text) == ["지금"])  // 동기 게시(Task 경유 아님)
        #expect(h.sleeps.isEmpty)
    }

    @Test func longToneDefersUntilToneEnds() async {
        let h = Harness()
        h.toneScript = [2.246, 2.246]  // 예약 시 + 재평가 시
        h.announcer.announce("도착했습니다")
        #expect(h.posts.isEmpty)  // 예약만 — 아직 발화 없음
        await drain()
        #expect(h.posts.map(\.text) == ["도착했습니다"])
        #expect(h.sleeps == [2.246 + SpeechDeferConstants.speechDeferGapSeconds])
    }

    // §4-3: sleep은 취소되면 즉시 반환한다 — 토큰·세대 확인 없이는 취소한 문장이
    // 그 자리에서 발화된다(변이 1이 이 테스트로 잡혀야 한다).
    @Test func invalidatedPendingNeverPosts() async {
        let h = Harness()
        h.toneScript = [2.246]
        h.announcer.announce("버릴 문장")
        h.announcer.invalidatePending()
        await drain()
        #expect(h.posts.isEmpty)
    }

    // §4-2: 세대 증가(stop·teardown·세션 시작)가 보류 문장을 버린다(변이 3).
    @Test func generationAdvanceDropsPending() async {
        let h = Harness()
        h.toneScript = [2.246]
        h.announcer.announce("끝난 경로의 명령")
        h.announcer.advanceGeneration()
        await drain()
        #expect(h.posts.isEmpty)
    }

    // §4-1: 단일 슬롯 latest-wins — 새 통지가 옛 보류 문장을 버린다(변이 2 계열).
    @Test func latestWinsReplacesPending() async {
        let h = Harness()
        h.toneScript = [2.246, 2.246, 2.246]
        h.announcer.announce("옛 문장")
        h.announcer.announce("새 문장")
        await drain()
        #expect(h.posts.map(\.text) == ["새 문장"])
    }

    // §4-1: 즉시 창구(announce의 무톤 경로)도 보류 슬롯을 버린다 —
    // 즉시 문장이 나간 **뒤에** 이전 문장이 발화하면 순서가 뒤집힌다(BLOCKER 2).
    @Test func immediateAnnounceDropsPendingFirst() async {
        let h = Harness()
        h.toneScript = [2.246, nil]  // 첫 통지는 지연, 둘째는 톤 없음(즉시)
        h.announcer.announce("이전 목적지 명령")
        h.announcer.announce("목적지가 변경되었습니다")
        #expect(h.posts.map(\.text) == ["목적지가 변경되었습니다"])
        await drain()
        #expect(h.posts.map(\.text) == ["목적지가 변경되었습니다"])
    }

    // §4-1·BLOCKER 2: announceNow는 톤과 무관하게 즉시 게시하되 보류 슬롯을 버린다.
    // 목적지 변경 확인이 즉시 나간 뒤 이전 목적지의 "오른쪽으로 도세요"가 발화하는
    // 역전이 이 무효화가 막는 실사고다.
    @Test func announceNowDropsPendingAndPostsImmediately() async {
        let h = Harness()
        h.toneScript = [2.246, 2.246]  // 톤이 재생 중이어도 announceNow는 미루지 않는다
        h.announcer.announce("이전 목적지 명령")
        h.announcer.announceNow("목적지가 변경되었습니다", highPriority: true,
                                bypassSuppression: true)
        #expect(h.posts.map(\.text) == ["목적지가 변경되었습니다"])
        #expect(h.posts.first?.bypass == true)
        await drain()
        #expect(h.posts.map(\.text) == ["목적지가 변경되었습니다"])
    }

    // §4-5: 게시 직전 재평가 — 대기 중 새 톤이 시작됐으면 그만큼 더 기다린다(변이 4 계열).
    @Test func reevaluatesNewToneBeforePosting() async {
        let h = Harness()
        // 예약 시 ahead(0.731) → 첫 대기 0.881 뒤 재평가 시점에 새 톤이 1.9에 끝남.
        h.toneScript = [0.731, 1.9, 1.9]
        h.announcer.announce("왼쪽으로 도세요")
        await drain()
        #expect(h.posts.map(\.text) == ["왼쪽으로 도세요"])
        #expect(h.sleeps.count == 2)  // 첫 대기 + 재평가 추가 대기
        let first = 0.731 + SpeechDeferConstants.speechDeferGapSeconds
        #expect(abs(h.sleeps[0] - first) < 1e-9)
        #expect(abs(h.sleeps[1] - (1.9 - first + SpeechDeferConstants.speechDeferGapSeconds)) < 1e-9)
    }

    // §4-5: 총 대기 상한 — 톤이 계속 이어져도 예약 시각부터 3.0초를 넘기면 그대로
    // 게시한다(무한 연기 구조 차단).
    @Test func totalWaitCappedAtMax() async {
        let h = Harness()
        h.toneDynamic = { [weak h] in (h?.now ?? 0) + 2 }  // 항상 잔여 2초
        h.announcer.announce("상한 문장")
        await drain()
        #expect(h.posts.map(\.text) == ["상한 문장"])
        #expect(abs(h.now - SpeechDeferConstants.speechDeferMaxSeconds) < 1e-9)
    }

    // §4-4·§4-6: 게시 실패는 즉시 발화와 동일 처리 — onDropped가 그 시점에 불린다(변이 6).
    @Test func onDroppedFiresWhenPostFails() async {
        let h = Harness()
        h.postResult = false
        var droppedImmediate = 0
        h.toneScript = [nil]
        h.announcer.announce("즉시 실패") { droppedImmediate += 1 }
        #expect(droppedImmediate == 1)

        var droppedDeferred = 0
        h.toneScript = [2.246, 2.246]
        h.announcer.announce("지연 실패") { droppedDeferred += 1 }
        await drain()
        #expect(droppedDeferred == 1)
    }

    @Test func onDroppedNotFiredWhenPosted() async {
        let h = Harness()
        var dropped = 0
        h.toneScript = [2.246, 2.246]
        h.announcer.announce("성공 문장") { dropped += 1 }
        await drain()
        #expect(h.posts.map(\.text) == ["성공 문장"])
        #expect(dropped == 0)
    }

    // §4-3 ABA: 옛 Task의 종료 코드가 새 슬롯 참조를 지우면 이후 invalidate가
    // 아무것도 취소하지 못한다(변이 5) — 교체 후에도 새 문장이 정상 흐름을 탄다.
    @Test func staleTaskDoesNotClearNewSlot() async {
        let h = Harness()
        h.toneScript = [2.246, 2.246, 2.246]
        h.announcer.announce("옛 문장")
        await drain()  // 옛 슬롯이 게시를 마치고 자기 토큰으로 해제
        h.toneScript = [h.now + 2.246, h.now + 2.246]
        h.announcer.announce("이후 문장")
        h.announcer.invalidatePending()  // 새 슬롯이 살아 있어야 취소가 성립
        await drain()
        #expect(h.posts.map(\.text) == ["옛 문장"])  // "이후 문장"은 취소로 미발화
    }

    @Test func highPriorityForwarded() async {
        let h = Harness()
        h.toneScript = [nil]
        h.announcer.announce("중요", highPriority: true)
        #expect(h.posts.first?.highPriority == true)
    }
}
