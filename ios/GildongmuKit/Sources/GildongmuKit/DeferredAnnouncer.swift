import Foundation

/// 지연 발화 슬롯(spec 2026-08-14 §4) — 안내 효과음이 끝난 뒤에 음성 통지를
/// 게시하는 비동기 수명 계약의 소유자. 판정은 `speechDeferStep`(순수 함수)이 하고
/// 여기는 단일 슬롯 latest-wins·세대 토큰·게시 직전 재평가·onDropped만 담는다.
///
/// `BeaconModel`에 인라인하지 않는 이유: 이 설계에서 가장 위험한 부분이 순수 함수가
/// 아니라 이 수명 계약이고(설계 리뷰 MAJOR 2), 시계·sleeper를 주입해야 테스트가
/// 열린다. 앱 타깃에는 테스트 타깃이 없어 Kit에 둔다(`NearbyLoadCore` 선례).
@MainActor
public final class DeferredAnnouncer {
    /// 단조 시각(초) — 앱은 `ProcessInfo.processInfo.systemUptime`.
    private let clock: () -> Double
    private let sleeper: (Double) async -> Void
    /// 지금 재생 중인 톤이 끝나는 단조 시각. 미재생·재생 실패면 nil.
    private let toneEndsAt: () -> Double?
    /// 실제 게시 시도 `(text, highPriority, bypassSuppression) -> 게시했는가`
    /// (억제 가드 → 전경 가드 → 게시). 지연은 타이밍만 바꾸고 실패 처리 계약은
    /// 바꾸지 않는다(§4-4) — 대기가 끝난 게시 시도는 "그 시점에 announce를 부른
    /// 것"과 완전히 같은 경로를 지난다. bypassSuppression은 `announceNow` 전용.
    private let post: (String, Bool, Bool) -> Bool

    /// 세션 세대(§4-2). `advanceGeneration()`(세션 시작·stop·teardown)마다 증가하고,
    /// 게시 직전에 예약 시점 세대와 일치할 때만 발화한다.
    private var generation = 0
    private var nextToken = 0
    /// 단일 슬롯(§4-1) — 큐를 만들지 않는다. 안내는 최신이 참이다(늦게 말한 임박
    /// 명령은 이미 돈 모퉁이를 돌라는 명령이 된다). onDropped를 함께 보관하는 이유는
    /// 아래 `invalidatePending()` 참조.
    private var slot: (token: Int, task: Task<Void, Never>, onDropped: (() -> Void)?)?

    public init(
        clock: @escaping () -> Double,
        sleeper: @escaping (Double) async -> Void = { seconds in
            try? await Task.sleep(nanoseconds: UInt64(seconds * 1_000_000_000))
        },
        toneEndsAt: @escaping () -> Double?,
        post: @escaping (String, Bool, Bool) -> Bool
    ) {
        self.clock = clock
        self.sleeper = sleeper
        self.toneEndsAt = toneEndsAt
        self.post = post
    }

    /// 세션 경계(시작·stop·teardown) — 세대를 올리고 보류 문장을 **onDropped 없이**
    /// 버린다(§4-2). 취소하지 않으면 일반 정지 뒤 끝난 경로의 명령이 뒤늦게 발화하고,
    /// 그사이 새 세션을 시작했으면 이전 목적지의 명령이 새 세션 안에서 나온다(리뷰
    /// BLOCKER 1). ⚠ 여기서 onDropped를 부르면 안 된다 — `stop()`은 상환 장부
    /// (계단 경고 등)를 먼저 비우고 이 함수를 부르므로, 복원이 그 소거 **뒤에**
    /// 실행되어 끝난 세션의 경고가 부활한다.
    public func advanceGeneration() {
        generation += 1
        slot?.task.cancel()
        slot = nil
    }

    /// 선점(latest-wins) 폐기 — 새 통지·즉시 창구(`announceNow`) 진입 즉시 부른다
    /// (§4-1은 창구와 무관한 성질이다. 리뷰 BLOCKER 2). 선점으로 버려지는 문장의
    /// `onDropped`는 **이 시점에 호출한다**(구현 리뷰 2건 독립 수렴 2026-08-14):
    /// 상환이 필요한 문장(계단 회피 경고·owed 합본)은 지연 창(최대 3초) 안에서 다른
    /// 안내에 선점되면 게시도 상환도 없이 영구 소실되기 때문이다 — 게시 실패(§4-4)와
    /// 같은 "전달하지 못했다"이므로 장부 보존도 같아야 한다. 세션 경계 폐기
    /// (`advanceGeneration`)와 달리 여기서는 장부가 아직 유효하다.
    public func invalidatePending() {
        guard let slot else { return }
        slot.task.cancel()
        self.slot = nil
        slot.onDropped?()
    }

    /// 사용자 활성화의 **직접 응답** 전용 즉시 창구(§4-6 — 목적지 전환 확인).
    /// 즉시성이 문장의 본질이라 톤과 겹치더라도 미루지 않는다. 단 보류 슬롯은 진입
    /// 즉시 버린다 — 즉시 문장이 나간 **뒤에** 이전 목적지의 명령이 발화하는 역전
    /// 차단(리뷰 BLOCKER 2).
    public func announceNow(
        _ text: String, highPriority: Bool = false, bypassSuppression: Bool = false
    ) {
        invalidatePending()
        _ = post(text, highPriority, bypassSuppression)
    }

    /// 자동 통지 창구. 톤 잔여만큼 미루고, 게시하지 못하면(억제·백그라운드) 그
    /// 시점에 `onDropped`를 부른다 — 상환이 필요한 문장(계단 회피 경고 등)은 여기에
    /// "갚기"를 담는다(§4-6. 반환값이 없는 것이 강제 수단이다 — 새 호출부가
    /// "게시했는가"를 물어볼 방법 자체가 없다).
    public func announce(
        _ text: String, highPriority: Bool = false, onDropped: (() -> Void)? = nil
    ) {
        invalidatePending()  // §4-1: 새 통지가 옛 보류 문장을 버린다(latest-wins)
        let wait = speechDeferStep(now: clock(), toneEndsAt: toneEndsAt())
        guard wait > 0 else {
            if !post(text, highPriority, false) { onDropped?() }
            return
        }
        nextToken += 1
        let token = nextToken
        let gen = generation
        let scheduledAt = clock()
        let task = Task { [weak self] in
            var pending = wait
            while true {
                await self?.sleeper(pending)
                guard let self, !Task.isCancelled else { return }
                // §4-3: Task 취소만으로는 부족하다 — sleep은 취소되면 즉시 반환하므로
                // 토큰·세대 일치 확인이 정본이다. 확인 없이 게시하면 취소한 문장이
                // 그 자리에서 발화된다.
                guard self.slot?.token == token, self.generation == gen else { return }
                // §4-5: 게시 직전 톤 상태 재평가 — 예약 후 새 톤(발화 없는 tick·
                // unreliable)이 시작됐으면 더 기다리되, 예약 시각부터의 총 대기가
                // 상한을 넘으면 그대로 게시한다(상한이 무한 연기를 구조적으로 막는다).
                let elapsed = self.clock() - scheduledAt
                let more = speechDeferStep(now: self.clock(), toneEndsAt: self.toneEndsAt())
                if more > 0, elapsed < SpeechDeferConstants.speechDeferMaxSeconds {
                    pending = min(more, SpeechDeferConstants.speechDeferMaxSeconds - elapsed)
                    continue
                }
                // §4-3 ABA: 슬롯 해제는 **자기 토큰일 때만**. 무조건 지우면 옛 Task의
                // 종료 코드가 새 슬롯 참조를 지워 teardown이 아무것도 취소하지 못한다.
                if self.slot?.token == token { self.slot = nil }
                if !self.post(text, highPriority, false) { onDropped?() }
                return
            }
        }
        slot = (token, task, onDropped)
    }
}
