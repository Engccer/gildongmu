import Foundation

// 길찾기 탭 순수 도메인(웹 DirectionsView 상태 머신의 Kit 판, React/SwiftUI 비의존).
// 뷰가 소유하는 것은 조회 오케스트레이션뿐이고, 필드 원자 상태·수단 3-state 분류·
// 표시 순서·성공 집계는 전부 여기서 결정한다(Kit 테스트 대상).

/// 길찾기 필드 원자 상태. 웹은 자유 편집 텍스트 필드라 `{text, resolved}` 쌍으로
/// "라벨 편집 즉시 coord 무효"를 지키지만, iOS 필드는 탭→검색 시트 선택이라
/// 부분 갱신 경로 자체가 없다(선택이 라벨+좌표를 항상 한 번에 확정한다).
public enum DirectionsEndpoint: Sendable, Hashable {
    /// 현재 위치. 좌표는 조회 실행 시점에 측위한다(권한 요청도 그 시점, 직렬화 금지 계약과 동형).
    case current
    case place(label: String, lat: Double, lng: Double)
}

/// 수단 식별. displayOrder가 결과 표시 고정 순서(대중교통→도보→자동차, 웹 activeModes 동형).
public enum DirectionsMode: String, CaseIterable, Sendable, Hashable {
    case transit, walk, car

    public static let displayOrder: [DirectionsMode] = [.transit, .walk, .car]
}

/// 수단 하나의 조회 결과. 웹 ModeOutcome 3-state에 gated를 더한 4-state:
/// 성공 ≠ 경로 없음(empty) ≠ 조회 실패(error) ≠ 서버 게이트(gated, 섹션 자체 미노출).
/// 웹은 서버가 게이트 플래그를 주입해 미노출을 선결정하지만, iOS는 호출 후 상태 코드로 안다
/// (게이트 코드는 수단마다 다르다, classifyFailure 참고).
public enum DirectionsModeOutcome: Sendable {
    case transit(TransitRouteResult)
    case walk(WalkRouteBriefing)
    case car(CarRouteBriefing)
    case empty
    case error
    case gated

    public var isSuccess: Bool {
        switch self {
        case .transit, .walk, .car: true
        case .empty, .error, .gated: false
        }
    }

    public var isGated: Bool {
        if case .gated = self { return true }
        return false
    }
}

/// 수단별 조회 결과 → 4-state 분류. 404·503은 키 미등록 게이트(웹 canShow* false 동형)라
/// 실패가 아니라 미노출이다(3-state 불변식: 게이트를 오류로 낭독하면 거짓 실패).
public enum DirectionsOutcomeClassifier {
    /// transit도 walk와 동형으로 envelope result가 optional: nil = "경로 없음"(empty,
    /// 조회 실패 아님, 웹 ODsay `{result:null}` graceful 계약. src/app/api/route/transit/route.ts).
    public static func classify(transit result: Result<TransitRouteResult?, any Error>) -> DirectionsModeOutcome {
        switch result {
        case .success(let value?): .transit(value)
        case .success(nil): .empty
        case .failure(let error): classifyFailure(error)
        }
    }

    /// walk만 envelope result가 optional: nil = "경로 없음"(empty, 조회 실패 아님).
    public static func classify(walk result: Result<WalkRouteBriefing?, any Error>) -> DirectionsModeOutcome {
        switch result {
        case .success(let value?): .walk(value)
        case .success(nil): .empty
        case .failure(let error): classifyFailure(error)
        }
    }

    /// car는 브리핑 직접 응답이라 "경로 없음" 상태가 없다(empty 미생성, 웹 동형).
    public static func classify(car result: Result<CarRouteBriefing, any Error>) -> DirectionsModeOutcome {
        switch result {
        case .success(let value): .car(value)
        case .failure(let error): classifyFailure(error)
        }
    }

    /// 게이트 상태 코드는 서버 실계약마다 다르다: walk는 키 없음 → 404
    /// (src/app/api/route/walk/route.ts), transit·car는 키 없음 → 503
    /// (hasOdsayKey/hasKakaoKey 미충족 시 명시 503, src/app/api/route/transit/route.ts,
    /// src/app/api/route/car/route.ts). 502(모든 라우트 공통 upstream 장애)는 조회 실패로 유지.
    private static func classifyFailure(_ error: any Error) -> DirectionsModeOutcome {
        if case APIError.badStatus(let code, _) = error, code == 404 || code == 503 { return .gated }
        return .error
    }
}

/// 한 조회의 최종 산출. 표시·포커스·통지 문장이 전부 여기서 파생된다.
public struct DirectionsResults: Sendable {
    public let outcomes: [DirectionsMode: DirectionsModeOutcome]

    public init(outcomes: [DirectionsMode: DirectionsModeOutcome]) {
        self.outcomes = outcomes
    }

    /// 화면에 노출할 수단(고정 순서). 미조회 수단·게이트(404)는 섹션 자체 미노출.
    public var displayedModes: [DirectionsMode] {
        DirectionsMode.displayOrder.filter { mode in
            guard let outcome = outcomes[mode] else { return false }
            return !outcome.isGated
        }
    }

    /// 성공 수단(고정 순서). 첫 항목이 완료 시 포커스 목적지(성공 0건이면 이동 없음).
    public var successModes: [DirectionsMode] {
        DirectionsMode.displayOrder.filter { outcomes[$0]?.isSuccess == true }
    }

    public var firstSuccess: DirectionsMode? { successModes.first }

    /// 완료 통지 합산 1문장의 수(readySummary {count}).
    public var successCount: Int { successModes.count }
}
