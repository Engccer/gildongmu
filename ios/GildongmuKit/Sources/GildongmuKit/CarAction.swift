import Foundation

/// Tmap 자동차 `turnType` → 결정 지점 행동(웹 `car-action.ts` 미러, 공유 fixture
/// `car-action-cases.json`이 코드 표를 동조한다). K2 spec `2026-08-23-car-guidance-completion-design.md` §2.
///
/// 서버가 기하 모드 응답의 `guides[i].action`에 싣고 앱은 디코딩만 한다 — 앱이 `turnType`을
/// 직접 받지 않으므로 이 함수는 Kit 안에서 미러 검증(`CarActionTests`)과 폴백 없는 문서 역할이다.
/// **표에 없는 코드는 nil** — 미분류의 결과는 오안내가 아니라 침묵.
public enum CarAction: String, Codable, Sendable, Equatable, CaseIterable {
    case left, right, back, keepLeft, keepRight

    /// 리듀서·표시 계층이 쓰는 수단 중립 행동.
    public var guideAction: WalkAction {
        switch self {
        case .left: .left
        case .right: .right
        case .back: .back
        case .keepLeft: .keepLeft
        case .keepRight: .keepRight
        }
    }
}

public func carActionFromTurnType(_ turnType: Int) -> CarAction? {
    switch turnType {
    case 12, 16, 17: return .left        // 좌회전·8시/10시 방향 좌회전(공식 표 어휘가 "좌회전")
    case 13, 18, 19: return .right       // 우회전·2시/4시 방향 우회전
    case 14, 136: return .back           // U턴·6시 방향
    case 118, 102, 105, 112, 115: return .keepLeft   // 왼쪽 방향·왼쪽 (도시)고속도로 입구/출구
    case 117, 101, 104, 111, 114: return .keepRight  // 오른쪽 방향·오른쪽 (도시)고속도로 입구/출구
    case 131...135: return .keepRight    // 1~5시 방향
    case 137...141: return .keepLeft     // 7~11시 방향
    default: return nil                  // 직진·시설·톨게이트·경유지·출발/도착·182/183(도착안내 방향)
    }
}
