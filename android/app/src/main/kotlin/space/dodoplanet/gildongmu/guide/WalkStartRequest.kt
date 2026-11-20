package space.dodoplanet.gildongmu.guide

import space.dodoplanet.gildongmu.kit.BeaconDest
import space.dodoplanet.gildongmu.kit.WalkRouteVariant
import space.dodoplanet.gildongmu.kit.models.WalkLineKind

/** 경유지(N4). 좌표와 라벨 한 벌. */
data class GuideWaypoint(val dest: BeaconDest, val label: String)

/** 안내 세션의 수단(iOS `BeaconModel.GuideSessionKind`). 도보·자동차가 한 모델(`WalkGuideModel`)을 쓰고 대중교통은 따로다(M5 spec §2-1). */
enum class GuideSessionKind { walk, car }

/**
 * 도보·자동차 세션 시작 인자(iOS `BeaconModel.StartRequest`). 수단별 data class 둘이 한 봉인 타입을 이룬다 — 요청 자체가 수단을 들어
 * 재시작(`restart`)이 수단을 잃지 않는다(A13 동형). 어느 필드에도 기본값 없음.
 */
sealed interface BeaconStartRequest {
    val dest: BeaconDest
    val label: String
    val waypoint: GuideWaypoint?
    val kind: GuideSessionKind
}

/** 자동차 안내 시작 인자(iOS `BeaconModel.carRequest`). 듣는 사람은 정식판 기본값(동승자) 고정이라 인자가 없다. */
data class CarStartRequest(
    override val dest: BeaconDest,
    override val label: String,
    override val waypoint: GuideWaypoint?,
) : BeaconStartRequest {
    override val kind: GuideSessionKind get() = GuideSessionKind.car
}

/**
 * 세션 시작 인자 **한 벌**(iOS `BeaconModel.StartRequest` 미러). 재시작(`restart`)이 이것을 그대로 다시 쓴다.
 * ⚠ 어느 필드에도 기본값을 두지 않는다 — A4·A13은 생략 가능한 안전 인자가 만든 결함이었다(계단 회피를 켠 사용자가
 * 계단으로, 최단으로 시작한 세션이 재시작 뒤 추천으로, 경유지 있는 조회의 시작 버튼이 경유지 없는 안내를 조용히).
 */
data class WalkStartRequest(
    override val dest: BeaconDest,
    override val label: String,
    val accessible: Boolean,
    val variant: WalkRouteVariant?,
    /**
     * 조회 화면에서 고른 줄(E42). `variant`·`accessible`은 이 종류의 투영이어야 하고 호출부가 셋을 함께 적는다. 시작 실패 행이
     * 이 줄의 버튼 아래 그려진다.
     */
    val line: WalkLineKind?,
    /**
     * 조회 화면의 다른 줄(M4b — 안내 중 대안 프리뷰·전환 대상, iOS `alternate`). null이면 조망에 "대안 경로 보기"가 없다(죽은 버튼 사전 차단).
     * 전환 커밋에서 `line`과 맞바뀐다.
     */
    val alternate: WalkLineKind?,
    override val waypoint: GuideWaypoint?,
) : BeaconStartRequest {
    override val kind: GuideSessionKind get() = GuideSessionKind.walk
}
