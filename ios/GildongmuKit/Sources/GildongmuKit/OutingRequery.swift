import Foundation

// ── 나들이 주변 재조회 트리거(spec 2026-09-26 §6.2) ──
// 둘러보기 500m 반경을 걷는 동안 새로 받는 시점. 마지막 조회 좌표에서 직선 50m를 벗어나면
// 다시 조회한다. 조회 실패 계수(3회 연속이면 "주변 정보 없음")도 여기서 판정한다.

/// ⚠ 잠정값(spec §10). 주변 재조회 이동 거리(m). 카카오는 분류마다 가까운 15곳만 주는데 상점 밀집 거리에서는
/// 그 15곳(음식점·병원)이 조회점 50~130m 안에 다 들어서, 100m 간격이면 그 사이 길가 가게를 지나친 뒤에야 받는다
/// (E58 재생 측정, 18종 기준 간격 100m·상한 50 → 50m·100: 천호대로·강남대로 합성 경로 길가 40m 후보 확보율 0.51 → 0.82).
public let outingRequeryDistanceMeters = 50.0
/// 연속 실패가 이 횟수에 닿으면 주변 정보가 "없음"이 된다(§6.2, 3-state의 실패 칸).
public let outingRequeryFailureLimit = 3
/// 실패한 조회의 재시도 간격(초). 거리만으로 재시도하면 제자리에서 첫 조회가 실패한 사용자가
/// "주변 확인 중"에 영영 갇힌다(구현 리뷰) — 기다리는 것이 없는데 기다린다고 말하게 된다.
public let outingRequeryRetrySeconds = 20.0

/// 이 fix에서 주변을 다시 조회해야 하는가. 마지막 조회 좌표가 없으면(세션 첫 조회) 참, 50m를 벗어나면 참,
/// 직전 조회가 실패했고 재시도 간격이 지났으면 참.
public func outingRequeryStep(
    lastQuery: RoutePoint?, fix: RoutePoint, lastFailureAt: Double?, now: Double
) -> Bool {
    guard let lastQuery else { return true }
    if let failedAt = lastFailureAt, now - failedAt >= outingRequeryRetrySeconds { return true }
    let moved = haversineMeters(lat1: lastQuery.lat, lng1: lastQuery.lng, lat2: fix.lat, lng2: fix.lng)
    guard moved.isFinite else { return false }
    return moved >= outingRequeryDistanceMeters
}

/// 주변 정보의 상태(3-state + 서비스 지역 밖). 화면·낭독이 같은 값을 읽는다.
public enum OutingSurroundingsStatus: Sendable, Equatable {
    /// 아직 한 번도 받지 못했다(세션 초반).
    case loading
    /// 받은 목록이 있다(0건 포함 — 0건은 "이정표 없음"으로 말한다).
    case ready
    /// 연속 실패가 상한에 닿았다 — 새 목록을 받지 못하고 있다. 받아 둔 장소는 움직이지 않으므로 지나침
    /// 판정에는 계속 쓰지만, "앞에 이정표 없음" 같은 부재 주장은 하지 않는다(방향 행이 "주변 정보 없음").
    case failed
    /// 한국 밖(서버 `outOfCoverage`).
    case outOfCoverage
}

/// 조회 결과 하나를 반영한 다음 상태와 연속 실패 수. 성공·서비스 밖은 실패 수를 0으로 되돌리고,
/// 실패는 상한 전까지 직전 상태를 유지한다(직전 결과 유지 — 세션을 끊지 않는다).
public func outingSurroundingsStep(
    status: OutingSurroundingsStatus, failures: Int, result: OutingQueryOutcome
) -> (status: OutingSurroundingsStatus, failures: Int) {
    switch result {
    case .success: return (.ready, 0)
    case .outOfCoverage: return (.outOfCoverage, 0)
    case .failure:
        let next = failures + 1
        return (next >= outingRequeryFailureLimit ? .failed : status, next)
    }
}

public enum OutingQueryOutcome: Sendable, Equatable {
    case success, failure, outOfCoverage
}

// MARK: - 나들이 주변 조회

/// 나들이 한 번 조회의 장소 상한. ⚠ 서버 미러: `OUTING_CAP`(100) — 넘기면 400이다. 조정은 서버 값과 함께.
public let outingSurroundingsLimit = 100

extension NearbyService {
    /// 나들이 전용 둘러보기(E58 ②): 카카오 분류 18종 전부(`groups=all`), 가까운 순 100곳.
    /// 내 주변 둘러보기(`surroundings`)는 "갈 곳 고르기"라 10종·50곳 그대로다 — 이 옵트인은 그 응답을 바꾸지 않는다.
    /// ⚠ 서버 `groups=all`이 배포된 뒤에만 동작한다(옛 서버는 `limit=100`에 400) — 웹 배포가 앱 설치보다 먼저다.
    /// `NearbyService.swift`가 아니라 여기 두는 이유: 안드로이드 `:kit`에 이식 완료로 등재된 그 파일과 달리 나들이 파일은
    /// 이식 대기(`pending`)라, 나들이 이식 때 함께 옮겨진다.
    public func outingSurroundings(lat: Double, lng: Double) async throws -> [SurroundingPlace] {
        let response: AroundNearbyResponse = try await client.get(
            "/api/places/around",
            query: coordQuery(lat: lat, lng: lng) + [
                URLQueryItem(name: "groups", value: "all"),
                URLQueryItem(name: "limit", value: String(outingSurroundingsLimit)),
            ])
        return response.places
    }
}
