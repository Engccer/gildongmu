/// "더 보기" 단계 공개 창 — 웹 useRevealMore·구 모델 revealMore의 수치 로직 공용화.
/// 초기 10·+10은 웹 NEARBY_INITIAL_VISIBLE/REVEAL_STEP과 동일 값 유지. 수만 다른 창(나들이 「지나온 곳」 20·+20)은
/// `init(initialVisible:revealStep:)`로 만든다 — 동작(첫 새 항목 반환, 통지 없음)은 같다.
public struct RevealWindow: Sendable {
    public static let initialVisible = 10
    public static let revealStep = 10
    private let initial: Int
    private let step: Int
    public private(set) var visibleCount: Int

    public init() { self.init(initialVisible: Self.initialVisible, revealStep: Self.revealStep) }

    public init(initialVisible: Int, revealStep: Int) {
        initial = initialVisible
        step = revealStep
        visibleCount = initialVisible
    }

    /// 새 로드 커밋 시 초기값 복원(NearbyLoadCore.willCommit에서 호출).
    public mutating func reset() { visibleCount = initial }

    /// 공개 수를 늘리고 첫 새 항목 인덱스를 반환(VO 포커스 이동 대상). 더 없으면 nil.
    public mutating func revealMore(totalCount: Int) -> Int? {
        guard visibleCount < totalCount else { return nil }
        let firstNewIndex = visibleCount
        visibleCount = min(visibleCount + step, totalCount)
        return firstNewIndex
    }
}
