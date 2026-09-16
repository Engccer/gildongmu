package space.dodoplanet.gildongmu.nearby

import space.dodoplanet.gildongmu.kit.formatDistance
import space.dodoplanet.gildongmu.kit.joinText
import space.dodoplanet.gildongmu.kit.models.AudioSignalSite
import space.dodoplanet.gildongmu.kit.models.OsmWalkData
import space.dodoplanet.gildongmu.kit.models.WalkFeature
import space.dodoplanet.gildongmu.kit.models.WalkInfrastructure
import space.dodoplanet.gildongmu.kit.models.WalkSourceStatus

// 보행 인프라 문장(iOS `WalkInfraNearbyView.swift` 파일 함수 이식, spec §12-1). 소스별 3-state(ok ≠ unsupported ≠ error)를 문장이 말한다.

/** 완료 통지 낱말(화면이 리소스에서 채운다). */
class WalkSummaryWords(
    val audioSummary: (Int) -> String,
    val audioNone: String,
    val audioUnsupported: String,
    val audioError: String,
    val osmSummary: (Int) -> String,
    val osmEmpty: String,
    val osmUnsupported: String,
    val osmError: String,
)

/** 완료 통지 — 소스별 요약을 결합한다. "0기"를 합성하지 않고 각 소스가 자기 상태를 말한다. */
fun walkInfraLiveSummary(walk: WalkInfrastructure, w: WalkSummaryWords): String {
    val audio = when (val s = walk.audioSignals) {
        is WalkSourceStatus.Ok -> if (s.data.deviceCount > 0) w.audioSummary(s.data.deviceCount) else w.audioNone
        is WalkSourceStatus.Unsupported -> w.audioUnsupported
        is WalkSourceStatus.Error -> w.audioError
    }
    val osm = when (val s = walk.osm) {
        is WalkSourceStatus.Ok -> if (s.data.listedCount > 0) w.osmSummary(s.data.listedCount) else w.osmEmpty
        is WalkSourceStatus.Unsupported -> w.osmUnsupported
        is WalkSourceStatus.Error -> w.osmError
    }
    return joinText(audio, osm)
}

/** 그룹 헤딩 — "N곳 중 가까운 M곳"은 cap 전 실개수 기반(절단 침묵 금지). total 0·비-ok는 평문 헤딩. */
fun walkGroupHeader(
    status: WalkSourceStatus<OsmWalkData>,
    total: (OsmWalkData) -> Int,
    listed: (OsmWalkData) -> Int,
    plain: String,
    count: (String) -> String,
    truncated: (total: String, listed: String) -> String,
): String {
    val data = (status as? WalkSourceStatus.Ok)?.data ?: return plain
    val t = total(data)
    if (t <= 0) return plain
    val l = listed(data)
    return if (t > l) truncated(t.toString(), l.toString()) else count(t.toString())
}

/** 음향신호기 항목. 미지 방위(계약상 희박)는 빈 방위로 포맷한 뒤 잔여 구분자를 걷는다. */
fun walkAudioSiteText(site: AudioSignalSite, direction: (String) -> String?, format: (direction: String, distance: String, count: Int) -> String): String {
    val d = formatDistance(site.distanceMeters)
    val dir = direction(site.bearing) ?: return format("", d, site.deviceCount).trim(' ', ',')
    return format(dir, d, site.deviceCount)
}

/** 횡단보도·점자블록 위치 조각. 미지 방위는 거리만. */
fun walkItemLocationText(feature: WalkFeature, direction: (String) -> String?, format: (direction: String, distance: String) -> String): String {
    val d = formatDistance(feature.distanceMeters)
    return direction(feature.bearing)?.let { format(it, d) } ?: d
}
