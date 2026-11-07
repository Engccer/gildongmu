import Foundation

// === 잘못 내림 복구 「여기서 다시 길찾기」 판정 (E78, spec 2026-11-07-e78-wrong-stop-recovery-design.md) — 순수 ===
//
// iOS 정식판 선행(위원장 판정 Q5 나). 웹·안드로이드는 BACKLOG §4 갭 — 그때 공유 fixture와 함께 미러한다. 등록부
// `android/kit/mirrors/guide.json`은 pending.
//
// 리듀서(`transitGuideStep`)는 이 기능을 모른다(spec §3.4). 여기 있는 것은 버튼을 세울지·출발점을 어떻게 정할지·
// 다시 조회한 후보 중 무엇으로 바꿀지의 판정뿐이고, 세션 교체는 앱의 경로 교체(`changeRoute`)가 한다.

/// 「여기서 다시 길찾기」 버튼을 세우는 국면(spec §3.1·§5-3): 승차 중·도착 뒤, 모든 수단(지방버스 포함).
/// 추적 불가 구간(비수도권 지하철·노선 이름 없는 버스)은 리듀서가 대기 국면에 머무르므로 국면과 무관하게 세운다 — 앱이 탔는지를
/// 몰라 타기 전에도 보이는 것은 위원장 판정으로 수용했다(2026-11-07, 안내가 가장 약한 구간에서 복구 수단을 빼지 않는다).
/// 여정(E70) 단계 안에서는 세우지 않는다 — 역 A·B를 지정한 계획이라 일반 재조회로 바꾸면 여정 상태와 어긋난다.
/// ⚠ 기본값 없음(안전 인자 — 여정 여부를 빠뜨리면 여정 단계에 버튼이 선다).
public func transitRecoveryOffered(phase: TransitPhase, untrackable: Bool, inJourney: Bool) -> Bool {
    guard !inJourney, phase != .done else { return false }
    return untrackable || phase == .riding || phase == .arrived
}

/// 출발점을 정하는 방법(spec §3.2, 위원장 판정 Q3 가).
public enum TransitRecoveryOrigin: Equatable, Sendable {
    /// 새 측위(`force: true`) — 버스 구간. 버스 안에서 잡힌 옛 좌표를 쓰지 않는다.
    case deviceFix
    /// 「지금 어느 역에 계신가요?」로 묻는다 — 지하철 구간. 땅속 측위는 실패하거나 출입구 쪽 옛 좌표로 붙는다.
    case askStation
}

/// 지금 구간의 수단으로 출발점 방법을 고른다. 앱은 출발점을 추정하지 않는다(하차역·잠금 열차의 마지막 역으로 꾸미지 않는다).
public func transitRecoveryOrigin(_ leg: TransitGuideLeg) -> TransitRecoveryOrigin {
    leg.mode == "subway" ? .askStation : .deviceFix
}

/// 안내 가능 술어(spec §8-2): 모든 탑승 구간이 추적 가능(`trackMode != nil`)하다. `buildTransitGuideRoute` 성공은 안내 가능
/// 판정이 아니다 — 비수도권 지하철처럼 추적 불가 구간이 섞인 경로로 바꾸면 그 구간에서 다시 수동 전진뿐이다.
public func transitRouteGuidable(_ route: TransitGuideRoute) -> Bool {
    !route.legs.isEmpty && route.legs.allSatisfy { $0.trackMode != nil }
}

/// 후보 목록(추천 → 대안 순, 변환 실패는 nil)에서 바꿀 경로의 순번 — 안내 가능한 첫 경로. 추천이 안내 불가면 말없이 다음 후보로
/// 넘어간다(spec §3.3). nil = 경로는 있으나 안내 가능 후보 0(조회 0건과 다른 상태다, §8-2).
public func transitRecoveryPickIndex(_ candidates: [TransitGuideRoute?]) -> Int? {
    candidates.firstIndex { $0.map(transitRouteGuidable) ?? false }
}

/// 조회 결과에서 바꿀 경로(앱 소비 한 자리). 순서는 조회 화면의 경로 목록과 같다(추천 → 대안).
public func transitRecoveryRoute(_ result: TransitRouteResult) -> TransitRoute? {
    let routes = [result.recommended] + result.alternatives
    return transitRecoveryPickIndex(routes.map(buildTransitGuideRoute)).map { routes[$0] }
}
