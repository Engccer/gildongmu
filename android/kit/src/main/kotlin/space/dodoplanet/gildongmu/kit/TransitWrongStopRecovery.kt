package space.dodoplanet.gildongmu.kit

import space.dodoplanet.gildongmu.kit.models.TransitRoute
import space.dodoplanet.gildongmu.kit.models.TransitRouteResult

// === 잘못 내림 복구 「여기서 다시 길찾기」 판정 (E78, spec 2026-11-07-e78-wrong-stop-recovery-design.md) — 순수, Kit 미러 ===
//
// 리듀서(`transitGuideStep`)는 이 기능을 모른다(spec §3.4). 여기 있는 것은 버튼을 세울지·출발점을 어떻게 정할지·다시 조회한
// 후보 중 무엇으로 바꿀지의 판정뿐이고, 세션 교체는 앱의 경로 교체가 한다.

/**
 * 「여기서 다시 길찾기」 버튼을 세우는 국면(spec §3.1·§5-3): 승차 중·도착 뒤, 모든 수단(지방버스 포함). 추적 불가 구간(비수도권
 * 지하철·노선 이름 없는 버스)은 리듀서가 대기 국면에 머무르므로 국면과 무관하게 세운다(위원장 판정 2026-11-07). 여정(E70) 단계
 * 안에서는 세우지 않는다 — 역 A·B를 지정한 계획이라 일반 재조회로 바꾸면 여정 상태와 어긋난다.
 * ⚠ 기본값 없음(안전 인자 — 여정 여부를 빠뜨리면 여정 단계에 버튼이 선다).
 */
fun transitRecoveryOffered(phase: TransitPhase, untrackable: Boolean, inJourney: Boolean): Boolean {
    if (inJourney || phase == TransitPhase.done) return false
    return untrackable || phase == TransitPhase.riding || phase == TransitPhase.arrived
}

/** 출발점을 정하는 방법(spec §3.2). */
enum class TransitRecoveryOrigin {
    /** 새 측위(`force: true`) — 버스 구간. 버스 안에서 잡힌 옛 좌표를 쓰지 않는다. */
    deviceFix,

    /** 「지금 어느 역에 계신가요?」로 묻는다 — 지하철 구간. 땅속 측위는 실패하거나 출입구 쪽 옛 좌표로 붙는다. */
    askStation,
}

/** 지금 구간의 수단으로 출발점 방법을 고른다. 앱은 출발점을 추정하지 않는다. */
fun transitRecoveryOrigin(leg: TransitGuideLeg): TransitRecoveryOrigin =
    if (leg.mode == "subway") TransitRecoveryOrigin.askStation else TransitRecoveryOrigin.deviceFix

/**
 * 안내 가능 술어(spec §8-2): 모든 탑승 구간이 추적 가능(`trackMode != null`)하다. `buildTransitGuideRoute` 성공은 안내 가능
 * 판정이 아니다 — 비수도권 지하철처럼 추적 불가 구간이 섞인 경로로 바꾸면 그 구간에서 다시 수동 전진뿐이다.
 */
fun transitRouteGuidable(route: TransitGuideRoute): Boolean =
    route.legs.isNotEmpty() && route.legs.all { it.trackMode != null }

/**
 * 후보 목록(추천 → 대안 순, 변환 실패는 null)에서 바꿀 경로의 순번 — 안내 가능한 첫 경로. 추천이 안내 불가면 말없이 다음 후보로
 * 넘어간다(spec §3.3). null = 경로는 있으나 안내 가능 후보 0(조회 0건과 다른 상태다, §8-2).
 */
fun transitRecoveryPickIndex(candidates: List<TransitGuideRoute?>): Int? =
    candidates.indexOfFirst { it != null && transitRouteGuidable(it) }.takeIf { it >= 0 }

/** 조회 결과에서 바꿀 경로(앱 소비 한 자리). 순서는 조회 화면의 경로 목록과 같다(추천 → 대안). */
fun transitRecoveryRoute(result: TransitRouteResult): TransitRoute? {
    val routes = listOf(result.recommended) + result.alternatives
    return transitRecoveryPickIndex(routes.map { buildTransitGuideRoute(it) })?.let { routes[it] }
}
