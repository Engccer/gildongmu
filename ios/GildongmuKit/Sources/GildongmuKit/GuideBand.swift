import Foundation

/// 띠바(N1) 대중교통 요약 — 최소화된 안내를 탭 바 위 한 줄로 대표하는 상태.
/// 문장은 앱이 붙이고 여기서는 **어느 상태인지만** 고른다(순수·테스트 대상).
public enum GuideBandSummary: Equatable, Sendable {
    /// 승차 정류소에서 차량을 기다리는 중(waiting·boarding 공통 — 사용자 관점은 같다).
    case waiting(stop: String, line: String)
    /// 탑승 중. 잔여 정거장 수는 없을 수 있다(3-state — 없으면 말하지 않는다).
    case riding(line: String, remaining: Int?)
    /// 세션이 끝나고 도보 핸드오프 제안이 남은 상태, 또는 도착·완료 국면.
    case arrived
    /// 장소 상세에서 목적지 변경을 준비해 후보 선택을 기다리는 중(설계 리뷰 M3 —
    /// 시트를 자동으로 올리지 않으므로 띠바가 유일한 진행 표시다).
    case destChangePending(label: String)
}

/// 우선순위: 목적지 변경 대기 > 핸드오프 제안(도착) > 국면 > nil(화면 없음).
/// 도착 뒤 `state == nil`이라 국면만으로는 arrived를 알 수 없어 제안 유무가 입력이다
/// (설계 리뷰 C7).
public func guideBandSummary(
    phase: TransitPhase?, boardStop: String?, line: String?, remaining: Int?,
    hasWalkHandoff: Bool, destChangeLabel: String?
) -> GuideBandSummary? {
    if let destChangeLabel { return .destChangePending(label: destChangeLabel) }
    if hasWalkHandoff { return .arrived }
    guard let phase else { return nil }
    switch phase {
    case .waiting, .boarding:
        return .waiting(stop: boardStop ?? "", line: line ?? "")
    case .riding:
        return .riding(line: line ?? "", remaining: remaining)
    case .arrived, .done:
        return .arrived
    }
}
