package space.dodoplanet.gildongmu.guide

import space.dodoplanet.gildongmu.kit.BeaconDest
import space.dodoplanet.gildongmu.kit.TransitBusStopMark
import space.dodoplanet.gildongmu.kit.TransitGuideRoute
import space.dodoplanet.gildongmu.kit.TransitGuideState
import space.dodoplanet.gildongmu.kit.TransitLabel
import space.dodoplanet.gildongmu.kit.TransitRidingPosition
import space.dodoplanet.gildongmu.kit.TransitTrackItem
import space.dodoplanet.gildongmu.kit.TransitWaitingEmptyReason

/** 대기 목록에서 사라진(떠난 것으로 본) 항목과 마지막 관측으로부터 지난 분(iOS `waitingDeparted` 튜플, A74). */
data class TransitDepartedItem(val item: TransitTrackItem, val minutes: Int)

/** "이미 탔어요" 흐름의 두 단계(iOS `AboardStep`): 지나는 역 묻기 → 그 역에 있는 열차 고르기. */
enum class TransitAboardStep { pickStation, pickVehicle }

/**
 * 화면이 읽는 대중교통 안내 상태(iOS `TransitGuideModel`이 `@Observable`로 뷰에 내보내는 값 — 도보 `WalkGuideUiState` 동형). 폴 작업·장부·세대·
 * 캐시 같은 `@ObservationIgnored` 값은 모델의 비공개 필드다.
 *
 * 단계 2-1 범위: 수명·폴·유휴·통지에 쓰는 값과, 이 범위 코드가 읽는 사용자 동작 묶음(2-2) 필드. 단계 3-1이 승차 중 현재역(`ridingPosition`·`positionClock`)과
 * 버스 정류장 표식(`busStopMark`)을 더했다. 단계 3 나머지(`pendingRecovery`·`pendingDestChange`·`pendingAltRoutes`)는 그 묶음이 더한다.
 */
data class TransitGuideUiState(
    val state: TransitGuideState? = null,
    /** 사용자 입력 유래 국면 전이의 순번(A47) — 폴 응답은 올리지 않는다. 시트가 이 순번의 변화로 착지를 가른다. */
    val userTransitionSeq: Int = 0,
    val route: TransitGuideRoute? = null,
    val destinationLabel: String = "",
    /** 목적지 좌표(N1) — `stop()`이 비우지 않는다(하차 인계가 세션 뒤에 읽는다). */
    val dest: BeaconDest? = null,
    /** 세션 시작 시점의 계단 회피 여부 — 도보 인계가 승계한다. */
    val accessible: Boolean = false,
    /** 대기 목록 스냅숏(§5.1): 현재 폴 항목 + 소실 항목(3분 유지, 관측 경과 분). */
    val waitingLive: List<TransitTrackItem> = emptyList(),
    val waitingDeparted: List<TransitDepartedItem> = emptyList(),
    /** 마지막 대기 폴의 0건 사유(§13.3) — 항목이 있으면 null. */
    val waitingReason: TransitWaitingEmptyReason? = null,
    /** 완료 뒤 말미 도보 인계 신호(한 턴 수명 — 같은 턴에 `GuideSession.acceptWalkHandoff()`가 소비한다). */
    val pendingWalkHandoff: TransitWalkHandoff? = null,
    /** 유휴 폴 정지 중(잊힌 세션 안전망 — 세션은 유지, 폴·keep-alive만 멈춘다). */
    val idlePaused: Boolean = false,
    /** 선택 차량 설명(ko·en 쌍 — 선택 시점에 렌더 문자열을 얼리지 않는다). */
    val selectedDescription: TransitLabel? = null,
    val boardingManualAvailable: Boolean = false,
    /** 탑승 변경의 조회 기준 역 인덱스(A16 L3, 이름이 아니라 인덱스). */
    val boardOverrideIndex: Int? = null,
    val reboardPickerActive: Boolean = false,
    val aboardStep: TransitAboardStep? = null,
    /** E71 R14: 지금 탄 열차에서 시작한 세션이 고른 방향(`updnLine` 원문). */
    val aboardDirection: String? = null,
    /** E71 R9: 시트 첫 착지가 질문 라벨이어야 하는 일회성 표식(`consumeAboardStartLanding`이 읽고 푼다). */
    val aboardStartLandingPending: Boolean = false,
    val expressBlockedNote: String? = null,
    /** 승차 중 현재역(E35 spec §4) — 상태 머신 **밖**의 표시 상태. 리듀서는 이 값을 모르고 판정에 쓰지 않는다. */
    val ridingPosition: TransitRidingPosition? = null,
    /** 보존 창 판정의 「지금」(벽시계 ms) — 조회 시점에 굳힌다(뷰가 렌더마다 시계를 읽지 않게). */
    val positionClock: Double = 0.0,
    /** 버스 승차 중 현재 정류장(E48) — keep-alive fix로 채우는 표시 전용 상태. 시각이 빠진 표식이고 바뀔 때만 쓴다. */
    val busStopMark: TransitBusStopMark? = null,
) {
    val isTracking: Boolean get() = state != null
}
