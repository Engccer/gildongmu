package space.dodoplanet.gildongmu.guide

import space.dodoplanet.gildongmu.kit.BeaconDest
import space.dodoplanet.gildongmu.kit.WalkHealthSummary
import space.dodoplanet.gildongmu.kit.WalkRouteVariant

/** iOS `BeaconModel.Status`. `denied`·`unavailable`은 사용자가 할 조치가 남은 상태 — 시작 실패 행이 문장·해결 버튼을 든다. */
enum class GuideStatus {
    idle, tracking, denied, unavailable;

    val isFailure: Boolean get() = this == denied || this == unavailable
}

/** 현재 실패의 해결 수단(iOS `FailResolution`). 권한 거부 → 설정, 대략 위치 → 정확한 위치 재요청. */
enum class FailResolution { none, settings, precise }

/** 안내 방식 = 거리의 기준: 간략=직선(비콘), 상세=경로 추종. */
enum class GuideMode { brief, detail }

/** 종료 화면의 종류(3-state 정직성 — 확정·추정·중지를 뭉개지 않는다). */
enum class SessionEndKind { arrived, presumed, stopped }

/**
 * 화면이 읽는 상태(spec §2). 리듀서 내부 상태는 모델의 `private var`이고, 커밋 지점마다 이 값을 `update`한다.
 * `hasScreen`·`isActive`도 이 값에서 유도한다(동반 변경에 기대지 않는다).
 */
data class WalkGuideUiState(
    val status: GuideStatus = GuideStatus.idle,
    /** 시작 Task 진행 중(권한 대기 등) — 거부 게이트가 본다. */
    val starting: Boolean = false,
    val destinationLabel: String = "",
    /** 상태 1줄 — **항상 발화 원문**(전경 복귀 상환이 그대로 발화한다). */
    val statusText: String = "",
    /** 상태 행이 주기 예고인가 — 화면이 "다음 안내," 라벨을 붙이는 근거. */
    val statusIsNextPreview: Boolean = false,
    val mode: GuideMode = GuideMode.brief,
    val offRoute: Boolean = false,
    /** 직전 `offRoute` 해제가 경로 커밋(자동 채택·재조회)이었는가 — 시트의 제목 착지 판정. */
    val offRouteEndedByReroute: Boolean = false,
    val isRerouting: Boolean = false,
    /** 경로 기준 잔여 거리·시간 1줄(상세 전용). */
    val remainingText: String? = null,
    /** 하단 2행(상세 전용). */
    val liveTopText: String? = null,
    val liveNextText: String? = null,
    /** 미디어 볼륨 0 — 안내 소리가 나지 않는다(iOS `soundDegraded`의 안드로이드 축). */
    val soundDegraded: Boolean = false,
    /** 오디오 포커스 거절 지속. */
    val focusDenied: Boolean = false,
    val ttsUnavailable: Boolean = false,
    /** 재생 수단 죽음. */
    val isSilenced: Boolean = false,
    /** 띠바 거리(10m 양자화). */
    val bandDistanceMeters: Int? = null,
    /** 종료 화면(도착·추정·중지) — null이면 화면 없음. `stop()`은 건드리지 않고 닫기·새 세션만 지운다. */
    val arrivalDest: BeaconDest? = null,
    val endKind: SessionEndKind = SessionEndKind.arrived,
    /** `.stopped` 종료 화면의 첫 문장(중지 사유). */
    val endText: String = "",
    /** 걸음·칼로리 요약(3-state: 표본 ∧ 72걸음 이상 → 값 / 그 밖 null — 행 부재). */
    val arrivalHealth: WalkHealthSummary? = null,
    /** 조망 목록(상세 전용). */
    val routeStepDescriptions: List<String>? = null,
    /** 조망의 "지금 이 구간" 표식. 이탈·불확실·최종 접근에선 null(근거 없는 표식은 거짓 정밀). */
    val currentStepIndex: Int? = null,
    /** 조망의 경유지 구획 행(stepIndex, 문장). */
    val routeWaypointRow: Pair<Int, String>? = null,
    val failResolution: FailResolution = FailResolution.none,
    /** 시작 실패 행을 어느 시작 버튼 아래 그릴지(추천 null / 최단). */
    val lastStartVariant: WalkRouteVariant? = null,
) {
    val isTracking: Boolean get() = status == GuideStatus.tracking

    /** 안내 화면이 존재해야 하는가 — 추적 중이거나 세션 뒤에 남은 종료 화면이 있을 때. */
    val hasScreen: Boolean get() = isTracking || arrivalDest != null
}
