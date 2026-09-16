package space.dodoplanet.gildongmu.nearby

import androidx.compose.runtime.Composable
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import space.dodoplanet.gildongmu.R
import space.dodoplanet.gildongmu.a11y.BodyLine
import space.dodoplanet.gildongmu.a11y.HeadingLine
import space.dodoplanet.gildongmu.i18n.appLocalized
import space.dodoplanet.gildongmu.kit.joinText
import space.dodoplanet.gildongmu.kit.models.OsmWalkData
import space.dodoplanet.gildongmu.kit.models.WalkFeature
import space.dodoplanet.gildongmu.kit.models.WalkSourceStatus
import space.dodoplanet.gildongmu.kit.spokenDistanceUnits

/** 거리가 든 줄 — 낭독은 단위 풀어쓰기(시각과 같으면 덮지 않는다). */
@Composable
private fun distanceRow(text: String, key: String, meters: String) = BodyLine(text, key, spokenDistanceUnits(text, meters).takeIf { it != text })

/**
 * 주변 보행 인프라 본문(iOS `WalkInfraNearbyView` 이식, spec §12-1): 조회 시각 헤딩(착지) → 그룹 3(음향신호기·횡단보도·점자블록,
 * 상태와 무관하게 **항상** 헤딩) → 각주(성공한 소스만 인용). 거리가 든 줄은 낭독에 단위 풀어쓰기.
 */
@Composable
fun WalkInfraBody(payload: WalkInfraPayload, requesterFor: (String) -> FocusRequester) {
    val res = LocalContext.current.resources
    val meters = stringResource(R.string.android_unit_spokenMeters)
    val direction: (String) -> String? = { bearingResId(it)?.let { id -> res.getString(id) } }
    val walk = payload.walk


    HeadingLine(appLocalized(res, R.string.walkInfra_asOf, payload.asOf), "walkinfra-top", focus = requesterFor("walkinfra-top"))

    // 음향신호기
    HeadingLine(stringResource(R.string.walkInfra_groupAudio), "audio")
    when (val s = walk.audioSignals) {
        is WalkSourceStatus.Ok -> if (s.data.deviceCount > 0) {
            // deviceCount는 sites(최대 5) 절단 전 총수 — 요약이 절단을 정직 표기
            distanceRow(appLocalized(res, R.string.walkInfra_audioSummary, s.data.deviceCount), "audio-summary", meters)
            s.data.sites.forEachIndexed { i, site ->
                distanceRow(walkAudioSiteText(site, direction) { d, dist, n -> appLocalized(res, R.string.walkInfra_audioSite, d, dist, n) }, "audio-$i", meters)
            }
        } else distanceRow(stringResource(R.string.walkInfra_audioNone), "audio-none", meters) // "반경 300m"가 든다
        is WalkSourceStatus.Unsupported -> BodyLine(stringResource(R.string.walkInfra_audioUnsupported), "audio-status")
        is WalkSourceStatus.Error -> BodyLine(stringResource(R.string.walkInfra_audioError), "audio-status")
    }

    // 횡단보도
    val location = { f: WalkFeature -> walkItemLocationText(f, direction) { d, dist -> appLocalized(res, R.string.walkInfra_itemLocation, d, dist) } }
    HeadingLine(
        walkGroupHeader(walk.osm, OsmWalkData::crossingTotal, { it.crossings.size }, stringResource(R.string.walkInfra_groupCrossing), { appLocalized(res, R.string.walkInfra_groupCrossingCount, it) }) { t, l -> appLocalized(res, R.string.walkInfra_groupCrossingTruncated, t, l) },
        "crossing",
    )
    val hasSignal = stringResource(R.string.walkInfra_hasSignal)
    val hasTactile = stringResource(R.string.walkInfra_hasTactile)
    when (val s = walk.osm) {
        is WalkSourceStatus.Ok -> if (s.data.crossings.isEmpty()) BodyLine(stringResource(R.string.walkInfra_crossingEmpty), "crossing-empty")
        else s.data.crossings.forEach { f ->
            distanceRow(joinText(location(f), if (f.crossingSignal == "yes") hasSignal else null, if (f.tactilePaving) hasTactile else null), "crossing-${f.osmId}", meters)
        }
        is WalkSourceStatus.Unsupported -> BodyLine(stringResource(R.string.walkInfra_crossingUnsupported), "crossing-status")
        is WalkSourceStatus.Error -> BodyLine(stringResource(R.string.walkInfra_crossingError), "crossing-status")
    }

    // 점자블록
    HeadingLine(
        walkGroupHeader(walk.osm, OsmWalkData::tactileTotal, { it.tactiles.size }, stringResource(R.string.walkInfra_groupTactile), { appLocalized(res, R.string.walkInfra_groupTactileCount, it) }) { t, l -> appLocalized(res, R.string.walkInfra_groupTactileTruncated, t, l) },
        "tactile",
    )
    val hostBusStop = stringResource(R.string.walkInfra_hostBusStop)
    val hostSubwayEntrance = stringResource(R.string.walkInfra_hostSubwayEntrance)
    when (val s = walk.osm) {
        is WalkSourceStatus.Ok -> if (s.data.tactiles.isEmpty()) BodyLine(stringResource(R.string.walkInfra_tactileEmpty), "tactile-empty")
        else s.data.tactiles.forEach { f ->
            distanceRow(joinText(location(f), if (f.hostFeature == "busStop") hostBusStop else null, if (f.hostFeature == "subwayEntrance") hostSubwayEntrance else null), "tactile-${f.osmId}", meters)
        }
        is WalkSourceStatus.Unsupported -> BodyLine(stringResource(R.string.walkInfra_tactileUnsupported), "tactile-status")
        is WalkSourceStatus.Error -> BodyLine(stringResource(R.string.walkInfra_tactileError), "tactile-status")
    }

    // 각주 — 실제로 데이터를 보여준 소스만 인용
    val audioOk = (walk.audioSignals as? WalkSourceStatus.Ok)?.data
    val osmOk = walk.osm is WalkSourceStatus.Ok
    if (audioOk != null || osmOk) {
        BodyLine(stringResource(R.string.walkInfra_footnote), "footnote")
        BodyLine(joinText(if (osmOk) stringResource(R.string.walkInfra_sourceOsm) else null, audioOk?.let { appLocalized(res, R.string.walkInfra_sourceAudio, it.baseDate) }), "footnote-source")
    }
}
