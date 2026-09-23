package space.dodoplanet.gildongmu.guide

import space.dodoplanet.gildongmu.kit.BeaconDest
import space.dodoplanet.gildongmu.kit.WalkRouteVariant
import space.dodoplanet.gildongmu.kit.models.WalkLineKind

/** 경유지(N4). 좌표와 라벨 한 벌. */
data class GuideWaypoint(val dest: BeaconDest, val label: String)

/**
 * 세션 시작 인자 **한 벌**(iOS `BeaconModel.StartRequest` 미러). 재시작(`restart`)이 이것을 그대로 다시 쓴다.
 * ⚠ 어느 필드에도 기본값을 두지 않는다 — A4·A13은 생략 가능한 안전 인자가 만든 결함이었다(계단 회피를 켠 사용자가
 * 계단으로, 최단으로 시작한 세션이 재시작 뒤 추천으로, 경유지 있는 조회의 시작 버튼이 경유지 없는 안내를 조용히).
 */
data class WalkStartRequest(
    val dest: BeaconDest,
    val label: String,
    val accessible: Boolean,
    val variant: WalkRouteVariant?,
    /**
     * 조회 화면에서 고른 줄(E42). `variant`·`accessible`은 이 종류의 투영이어야 하고 호출부가 셋을 함께 적는다. 시작 실패 행이
     * 이 줄의 버튼 아래 그려진다. iOS의 `alternate`(안내 중 수동 전환 대상)는 안드로이드에 전환 기능이 없어 두지 않는다.
     */
    val line: WalkLineKind?,
    val waypoint: GuideWaypoint?,
)
