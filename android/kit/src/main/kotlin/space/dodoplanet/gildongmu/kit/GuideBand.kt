package space.dodoplanet.gildongmu.kit

/**
 * 띠바(N1) 대중교통 요약 — 최소화된 안내를 탭 바 위 한 줄로 대표하는 상태. Kit `GuideBand.swift` 미러.
 * 문장은 앱이 붙이고 여기서는 **어느 상태인지만** 고른다(순수·테스트 대상).
 */
sealed class GuideBandSummary {
    /** 승차 정류소에서 차량을 기다리는 중(waiting·boarding 공통 — 사용자 관점은 같다). */
    data class Waiting(val stop: String, val line: String) : GuideBandSummary()

    /** 탑승 중. 잔여 정거장 수는 없을 수 있다(3-state — 없으면 말하지 않는다). */
    data class Riding(val line: String, val remaining: Int?) : GuideBandSummary()

    /** 세션이 끝나고 도보 핸드오프 제안이 남은 상태, 또는 도착·완료 국면. */
    data object Arrived : GuideBandSummary()

    /** 장소 상세에서 목적지 변경을 준비해 후보 선택을 기다리는 중(시트를 자동으로 올리지 않으므로 띠바가 유일한 진행 표시다). */
    data class DestChangePending(val label: String) : GuideBandSummary()

    /** 목적지 변경 조회가 실패·0건으로 끝났다(3-state: "대기"와 "실패"를 뭉개면 띠바만 보는 사용자가 조회 중으로 오인한다). */
    data class DestChangeFailed(val label: String) : GuideBandSummary()
}

/**
 * 우선순위: 목적지 변경 대기 > 핸드오프 제안(도착) > 국면 > null(화면 없음). 도착 뒤 `state == null`이라 국면만으로는
 * arrived를 알 수 없어 제안 유무가 입력이다(설계 리뷰 C7).
 */
fun guideBandSummary(
    phase: TransitPhase?,
    boardStop: String?,
    line: String?,
    remaining: Int?,
    hasWalkHandoff: Boolean,
    destChangeLabel: String?,
    destChangeFailed: Boolean = false,
): GuideBandSummary? {
    if (destChangeLabel != null) {
        return if (destChangeFailed) GuideBandSummary.DestChangeFailed(destChangeLabel) else GuideBandSummary.DestChangePending(destChangeLabel)
    }
    if (hasWalkHandoff) return GuideBandSummary.Arrived
    return when (phase ?: return null) {
        TransitPhase.waiting, TransitPhase.boarding -> GuideBandSummary.Waiting(boardStop ?: "", line ?: "")
        TransitPhase.riding -> GuideBandSummary.Riding(line ?: "", remaining)
        TransitPhase.arrived, TransitPhase.done -> GuideBandSummary.Arrived
    }
}
