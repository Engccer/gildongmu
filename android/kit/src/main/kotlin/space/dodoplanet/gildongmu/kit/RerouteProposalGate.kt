package space.dodoplanet.gildongmu.kit

/**
 * 이탈 확정 시 자동 조회해 보관한 제안 경로(E10ⓑ, spec 2026-08-12 §6). Kit `RerouteProposalGate.swift` 미러.
 * 취득 좌표·취득 시각(단조 시계 초)이 신선도 판정의 기준값이다.
 */
data class RerouteProposal(
    val originLat: Double,
    val originLng: Double,
    /**
     * 취득 시각 — 단조 시계 초(벽시계 점프 무관). iOS는 `ProcessInfo.systemUptime`(깊은 잠자기 중 정지)을 쓴다.
     * 안드로이드 시계(`uptimeMillis` 대 `elapsedRealtime`)는 [3] `:app`이 정하되 `nowUptime`과 같은 시계여야 한다.
     */
    val acquiredAt: Double,
)

/**
 * 자동 재조회의 순수 판정(신선도·세션당 조회 상한). 모델 계층은 이 판정만 소비한다 — 걷는 중 낡은 출발점의
 * 경로를 채택하면 도로 중앙 안내가 되므로, `isFresh`는 **채택 시점 1회 안전망**이다(2026-09-02 자동 채택
 * 개정 — 종전 수락제의 만료 능동 전이는 폐기됐고, `isFreshInTime`은 프로덕션 호출부 없이 테스트 전용 공개 API로 남았다).
 */
object RerouteProposalGate {
    /** 신선도 한계(잠정값 — 실보행 판정 대상, spec §6). */
    const val maxDriftMeters: Double = 30.0
    const val maxAgeSeconds: Double = 120.0

    /**
     * 세션당 자동 조회 상한(잠정값). GPS 진동으로 확정 회차가 반복 생성될 때 쿼터·통지 폭주를 막는
     * 마지막 방어선(spec §6 리뷰 #8).
     */
    const val maxFetchesPerSession = 5

    /**
     * 시간 축 단독 판정 — 현재 좌표를 단정할 수 없을 때(fix 끊김·최종 접근 중)의 만료 검사용. 시간 축을
     * fix 도착에만 걸면 실내·권한 철회에서 만료가 영구히 발동하지 못한다(fix 경로에만 걸면 영구 침묵).
     */
    fun isFreshInTime(proposal: RerouteProposal, nowUptime: Double): Boolean =
        nowUptime - proposal.acquiredAt <= maxAgeSeconds

    /** 취득 위치에서 30m 초과 이동 또는 120초 경과면 만료. */
    fun isFresh(proposal: RerouteProposal, nowUptime: Double, currentLat: Double, currentLng: Double): Boolean {
        if (!isFreshInTime(proposal, nowUptime)) return false
        val drift = haversineMeters(proposal.originLat, proposal.originLng, currentLat, currentLng)
        return drift <= maxDriftMeters
    }

    /** 세션당 자동 조회 허용 여부(확정 회차당 1회는 호출부 계약). */
    fun mayFetch(episodeFetchCount: Int): Boolean = episodeFetchCount < maxFetchesPerSession
}
