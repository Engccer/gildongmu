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
    /// `labelRoman`은 지정 시점에 손에 있는 라틴 표기(장소=서버 `Place.nameRoman`, 주소=juso `engAddr`,
    /// E28 후속). 수동 위치 지정이 스토어까지 옮겨 비-ko 표시줄이 1순위로 낭독한다 — 표시 때 다시
    /// 조회하면 왕복마다 값이 달라지므로 그때 저장한다(웹 `ManualLocation.labelRoman` 동형). 부재는 nil.
    case place(label: String, lat: Double, lng: Double, labelRoman: String? = nil)
}

/// 수단 식별. displayOrder는 각 군(성공·비성공) 안의 고정 순서다(웹 activeModes 동형) —
/// E11부터 화면 순서 자체는 DirectionsResults.orderedModes(조회 결과 파생 스냅샷)가 정한다.
public enum DirectionsMode: String, CaseIterable, Sendable, Hashable {
    case transit, walk, car

    public static let displayOrder: [DirectionsMode] = [.transit, .car, .walk]
}

/// 도보 상세 접기 경계(웹 src/lib/walk-collapse.ts 미러 — E11이 승격 판정에 재사용).
/// ⚠ 판정과 표시가 같은 분 값을 써야 한다(웹 정본 주석 동일) — 초 단위로 가르면
///   "약 30분"으로 표시되는 경로가 접혀 사용자가 경계를 설명할 수 없다.
public enum WalkCollapse {
    public static let minutes = 30
    public static func shouldCollapse(durationSeconds: Int) -> Bool {
        Int((Double(durationSeconds) / 60).rounded()) > minutes
    }
}

/// E11 섹션 표시 순서(웹 src/lib/directions-order.ts 미러 — 공유 fixture
/// directions-order-scenarios.json이 동조 강제).
/// 1. 성공 수단 앞, 비성공(경로 없음·조회 실패) 뒤 — 각 군 안은 입력 순서 유지.
/// 2. 도보 성공이고 30분 이하(도보 상세 접기와 같은 경계)면 성공군 맨 앞.
public enum DirectionsOrder {
    public static func orderModes(
        modes: [DirectionsMode],
        isSuccess: (DirectionsMode) -> Bool,
        walkDurationSeconds: Int?
    ) -> [DirectionsMode] {
        let successes = modes.filter(isSuccess)
        let failures = modes.filter { !isSuccess($0) }
        let promoteWalk: Bool
        if let walkDurationSeconds, successes.contains(.walk) {
            promoteWalk = !WalkCollapse.shouldCollapse(durationSeconds: walkDurationSeconds)
        } else {
            promoteWalk = false
        }
        let orderedSuccesses = promoteWalk
            ? [.walk] + successes.filter { $0 != .walk }
            : successes
        return orderedSuccesses + failures
    }
}

/// 수단 하나의 조회 결과. 웹 ModeOutcome 3-state에 gated·outOfCoverage·unsupportedWaypoint를
/// 더한 6-state: 성공 ≠ 경로 없음(empty) ≠ 조회 실패(error) ≠ 서버 게이트(gated, 섹션 자체
/// 미노출) ≠ 서비스 지역 밖(outOfCoverage, 화면 전체를 전환하는 신호) ≠ 경유지 미지원
/// (unsupportedWaypoint — 대중교통에 경유지가 있을 때, upstream 미호출. 섹션은 남아 사유를
/// 말한다. `result:null`로 뭉개면 "경로 없음"으로 낭독돼 거짓, 서버 spec 2026-08-22 §2.1).
/// 웹은 서버가 게이트 플래그를 주입해 미노출을 선결정하지만, iOS는 호출 후 상태 코드로 안다
/// (게이트 코드는 수단마다 다르다, classifyFailure 참고).
public enum DirectionsModeOutcome: Sendable {
    case transit(TransitRouteResult)
    case walk(WalkRouteBriefing)
    case car(CarRouteBriefing)
    case empty
    case error
    case gated
    case outOfCoverage
    case unsupportedWaypoint

    public var isSuccess: Bool {
        switch self {
        case .transit, .walk, .car: true
        case .empty, .error, .gated, .outOfCoverage, .unsupportedWaypoint: false
        }
    }

    public var isGated: Bool {
        if case .gated = self { return true }
        return false
    }

    public var isOutOfCoverage: Bool {
        if case .outOfCoverage = self { return true }
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
    /// outOfCoverage는 좌표(주로 origin=현재 위치)가 서비스 지역 밖일 때의 서버 마커 —
    /// 게이트·오류와 별개로 화면 전체를 outOfCoverage로 전환하는 신호(DirectionsModel 참고).
    private static func classifyFailure(_ error: any Error) -> DirectionsModeOutcome {
        if case APIError.outOfCoverage = error { return .outOfCoverage }
        if case APIError.badStatus(let code, _) = error, code == 404 || code == 503 { return .gated }
        return .error
    }
}

/// 한 조회의 최종 산출. 표시·포커스·통지 문장이 전부 여기서 파생된다.
public struct DirectionsResults: Sendable {
    public let outcomes: [DirectionsMode: DirectionsModeOutcome]
    /// 표시 순서 스냅샷(E11 spec §2) — 조회 settled의 init에서 1회 확정한다.
    /// ⚠ computed로 바꾸지 말 것: 부분 재조회가 암묵 재계산을 일으켜 사용자가
    ///   조작 중인 섹션이 이동한다. 부분 교체는 replacingWalk가 순서를 보존한다.
    public let orderedModes: [DirectionsMode]

    public init(outcomes: [DirectionsMode: DirectionsModeOutcome]) {
        self.outcomes = outcomes
        let walkDuration: Int?
        if case .walk(let brief)? = outcomes[.walk] {
            walkDuration = brief.durationSeconds
        } else {
            walkDuration = nil
        }
        self.orderedModes = DirectionsOrder.orderModes(
            modes: DirectionsMode.displayOrder.filter { outcomes[$0] != nil },
            isSuccess: { outcomes[$0]?.isSuccess == true },
            walkDurationSeconds: walkDuration
        )
    }

    private init(outcomes: [DirectionsMode: DirectionsModeOutcome], orderedModes: [DirectionsMode]) {
        self.outcomes = outcomes
        self.orderedModes = orderedModes
    }

    /// 계단 회피 재조회: 도보 outcome만 교체하고 순서는 보존한다(웹 toggleStepFree 동형,
    /// spec §2 규칙 3 — 사용자가 조작 중인 섹션이 발밑에서 이동하지 않는다).
    public func replacingWalk(_ outcome: DirectionsModeOutcome) -> DirectionsResults {
        var next = outcomes
        next[.walk] = outcome
        return DirectionsResults(outcomes: next, orderedModes: orderedModes)
    }

    /// 화면에 노출할 수단(동적 순서). 미조회 수단·게이트(404)·서비스 지역 밖은 섹션 자체 미노출
    /// (outOfCoverage는 정상적으로 DirectionsModel이 화면 전체를 전환해 여기 도달하지 않지만,
    /// 방어적으로 개별 수단 렌더에서도 제외한다).
    public var displayedModes: [DirectionsMode] {
        orderedModes.filter { mode in
            guard let outcome = outcomes[mode] else { return false }
            return !outcome.isGated && !outcome.isOutOfCoverage
        }
    }

    /// 성공 수단(동적 순서). 첫 항목이 완료 시 포커스 목적지(성공 0건이면 이동 없음).
    public var successModes: [DirectionsMode] {
        orderedModes.filter { outcomes[$0]?.isSuccess == true }
    }

    public var firstSuccess: DirectionsMode? { successModes.first }

    /// 완료 통지 합산 1문장의 수(readySummary {count}).
    public var successCount: Int { successModes.count }
}
