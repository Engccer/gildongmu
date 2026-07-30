import Foundation
import Observation

/// 좌표 튜플 — 앱 LocationService.currentCoordinate 반환형과 동일 shape.
public typealias NearbyCoord = (lat: Double, lng: Double)

/// 내 주변 정규 상태 8종. 앱의 구 NearbyLoadState를 정규화(failed를 위치/서버로 분해,
/// empty 추가 — WhereAmI data:null 전용, "부재 ≠ 0건 ≠ 실패" 3-state의 타입 표현).
public enum NearbyLoadPhase<Payload: Sendable> {
    case idle
    case loading
    case loaded(Payload)
    case empty
    case denied
    case outOfCoverage
    case failedLocation
    case failedServer
}

/// 좌표 어댑터 오류(앱 LocationService.LocationError의 Kit 번역).
/// 어댑터 계약: 취소는 원본 그대로 rethrow — 절대 unavailable로 뭉개지 않는다(스펙 §4).
public enum NearbyLocationError: Error {
    case denied
    case unavailable
}

/// 좌표 소스: current = 위치 어댑터 주입, none = 파라미터형(좌표 단계 생략, coord=nil).
public enum NearbyCoordinateSource {
    case current(@MainActor (_ force: Bool) async throws -> NearbyCoord)
    case none
}

/// korea = isInKorea 선분기(웹 coverage 미러, upstream 미호출 쿼터 보호). none = 무제한.
public enum NearbyCoverage {
    case korea
    case none
}

/// 통지 이벤트 — Kit은 발화하지 않는다(앱 매퍼가 VO Announcement로 변환, 스펙 §4).
public enum NearbyLoadEvent<Payload: Sendable> {
    case loaded(Payload)
    case emptyResult
    case refreshFailed
    case permissionLost
    case wentOutOfCoverage
}

/// 내 주변 화면 공통 load() 상태 머신 정본. 전이표는 스펙
/// docs/superpowers/specs/2026-07-31-ios-nearby-skeleton-design.md §5(동결 계약).
/// 취소 2겹 방어(#17): 오류형(CancellationError·URLError.cancelled) + 커밋 게이트
/// (각 await 복귀 직후·커밋 직전 Task.isCancelled) — 협력적 취소가 성공값을 반환해도
/// 떠난 화면에 커밋·통지하지 않는다.
@Observable @MainActor
public final class NearbyLoadCore<Payload: Sendable> {
    public private(set) var phase: NearbyLoadPhase<Payload> = .idle

    private let coordinate: NearbyCoordinateSource
    private let coverage: NearbyCoverage
    private let fetch: @MainActor (_ coord: NearbyCoord?, _ previous: Payload?) async throws -> Payload?
    private let willCommit: @MainActor (Payload) -> Void
    private let onEvent: @MainActor (NearbyLoadEvent<Payload>) -> Void
    /// 재진입 가드(구 모델 isLoadingInFlight 계승): 진행 중 재호출은 즉시 무시(#1)
    private var isLoadingInFlight = false

    public init(
        coordinate: NearbyCoordinateSource,
        coverage: NearbyCoverage,
        fetch: @escaping @MainActor (_ coord: NearbyCoord?, _ previous: Payload?) async throws -> Payload?,
        willCommit: @escaping @MainActor (Payload) -> Void = { _ in },
        onEvent: @escaping @MainActor (NearbyLoadEvent<Payload>) -> Void
    ) {
        self.coordinate = coordinate
        self.coverage = coverage
        self.fetch = fetch
        self.willCommit = willCommit
        self.onEvent = onEvent
    }

    public func load(force: Bool = false) async {
        if isLoadingInFlight { return }
        isLoadingInFlight = true
        defer { isLoadingInFlight = false }   // 불변식 ④ — 취소 포함 전 경로 해제

        let entry = phase
        let previous: Payload? = if case .loaded(let p) = entry { p } else { nil }
        // 직전 성공 데이터가 있으면 유지한 채 재조회, 그 외는 로딩 표시(#2·#3)
        if case .loaded = entry {} else { phase = .loading }

        // #17: 취소 복원 — loaded는 유지(대체된 적 없음), 그 외는 entry로(.loading 고착 금지)
        func restoreOnCancellation() {
            if case .loaded = entry { return }
            phase = entry
        }

        do {
            var coord: NearbyCoord?
            if case .current(let getCoordinate) = coordinate {
                let got = try await getCoordinate(force)
                guard !Task.isCancelled else { return restoreOnCancellation() }
                // 위치 취득 직후 선분기(네트워크 생략) — 서버 마커 catch와 이중 방어(#8·#9)
                if case .korea = coverage, !isInKorea(lat: got.lat, lng: got.lng) {
                    phase = .outOfCoverage
                    if case .loaded = entry { onEvent(.wentOutOfCoverage) }
                    return
                }
                coord = got
            }
            let result = try await fetch(coord, previous)
            guard !Task.isCancelled else { return restoreOnCancellation() }
            if let payload = result {
                willCommit(payload)              // 부가 상태(리빌 창 리셋)와 원자 커밋
                phase = .loaded(payload)         // #10 — 커밋 후 이벤트(불변식 ⑤)
                onEvent(.loaded(payload))
            } else if case .loaded = entry {
                onEvent(.refreshFailed)          // #11 — 데이터 유지(재조회이지 포기 아님)
            } else {
                phase = .empty                   // #12
                onEvent(.emptyResult)
            }
        } catch {
            // 커밋 게이트: 어떤 오류든 취소된 태스크면 오판·통지 없이 복원(#17)
            guard !Task.isCancelled else { return restoreOnCancellation() }
            switch error {
            case is CancellationError:
                restoreOnCancellation()
            case let urlError as URLError where urlError.code == .cancelled:
                restoreOnCancellation()
            case NearbyLocationError.denied:     // #4·#5 — 권한 전락은 무신호 화면 전환 방지 통지
                phase = .denied
                if case .loaded = entry { onEvent(.permissionLost) }
            case NearbyLocationError.unavailable: // #6·#7
                if case .loaded = entry { onEvent(.refreshFailed) } else { phase = .failedLocation }
            case APIError.outOfCoverage:         // #13·#14 — 서버 마커 이중 방어
                phase = .outOfCoverage
                if case .loaded = entry { onEvent(.wentOutOfCoverage) }
            default:                             // #15·#16
                if case .loaded = entry { onEvent(.refreshFailed) } else { phase = .failedServer }
            }
        }
    }
}
