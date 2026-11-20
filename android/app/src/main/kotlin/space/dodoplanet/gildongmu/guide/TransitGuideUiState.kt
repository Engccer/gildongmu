package space.dodoplanet.gildongmu.guide

import space.dodoplanet.gildongmu.kit.BeaconDest
import space.dodoplanet.gildongmu.kit.TransitBusStopMark
import space.dodoplanet.gildongmu.kit.TransitGuideRoute
import space.dodoplanet.gildongmu.kit.TransitGuideState
import space.dodoplanet.gildongmu.kit.TransitLabel
import space.dodoplanet.gildongmu.kit.TransitRidingPosition
import space.dodoplanet.gildongmu.kit.TransitTrackItem
import space.dodoplanet.gildongmu.kit.TransitWaitingEmptyReason
import space.dodoplanet.gildongmu.kit.models.TransitRouteResult

/** 대기 목록에서 사라진(떠난 것으로 본) 항목과 마지막 관측으로부터 지난 분(iOS `waitingDeparted` 튜플, A74). */
data class TransitDepartedItem(val item: TransitTrackItem, val minutes: Int)

/** "이미 탔어요" 흐름의 두 단계(iOS `AboardStep`): 지나는 역 묻기 → 그 역에 있는 열차 고르기. */
enum class TransitAboardStep { pickStation, pickVehicle }

/**
 * 목적지 전환 준비 상태(iOS `PendingDestChange`, 스펙 2026-08-12 §4). null = 진행 중인 전환 없음. 확정 전에는 세션·폼 어느 것도 변하지 않는다(2단 확정 단위).
 * `fetchedAt`은 벽시계 ms(iOS `Date`).
 */
data class PendingDestChange(
    val dest: BeaconDest,
    val label: String,
    val labelRoman: String?,
    val phase: DestChangePhase,
    val fetchedAt: Double?,
)

sealed class DestChangePhase {
    object Loading : DestChangePhase()
    data class Loaded(val result: TransitRouteResult) : DestChangePhase()
    /** 3-state: 경로 없음 ≠ 조회 실패. */
    object Empty : DestChangePhase()
    object Failed : DestChangePhase()
}

/**
 * 조망 「다른 경로」(iOS `PendingAltRoutes`, E15-1 spec §5) — 목적지 전환과 **별도 슬롯**(한 슬롯을 나눠 쓰면 한쪽의 지연된 dismiss가 다른 쪽의 새 요청을 취소한다).
 */
data class PendingAltRoutes(
    val token: Int,
    /** 조회 시작 시점의 국면 세대·구간 — 커밋 시 현재와 다르면 재조회. */
    val phaseGen: Int,
    val legIndex: Int,
    val origin: AltOriginEvidence?,
    val phase: AltRoutesPhase,
    val fetchedAt: Double?,
)

/** 출발점의 근거 — 커밋 가드가 이 값의 변화를 본다(§5.4 「시간이 아니라 근거」). */
sealed class AltOriginEvidence {
    object Gps : AltOriginEvidence()
    /** 신선한 추적 관측의 현재역(조망 here == station). */
    data class Station(val stopIndex: Int) : AltOriginEvidence()
    /** 사용자가 「{승차역} 기준으로 조회」를 눌러 선언했다(앱이 추정하지 않는다). */
    object BoardStopDeclared : AltOriginEvidence()
}

enum class AltFailReason { noLocation, fetch }

sealed class AltRoutesPhase {
    object Loading : AltRoutesPhase()
    data class Loaded(val result: TransitRouteResult) : AltRoutesPhase()
    object Empty : AltRoutesPhase()
    data class Failed(val reason: AltFailReason) : AltRoutesPhase()
}

enum class AltRouteCommit { committed, refetching, invalidCandidate, sessionEnded }

/**
 * 진행 중인 잘못 내림 복구(iOS `PendingRecovery`, E78 §3·§5·§8) — 이 슬롯이 있는 동안 옛 세션은 조용하다(폴·버스 하차 위치 통지 정지). `pendingAltRoutes`·
 * `pendingDestChange`와 공유하지 않는다.
 */
data class PendingRecovery(
    val token: Int,
    /** 누른 시점의 경로 세대(커밋 가드 ③) — 그 사이 목적지 바꾸기·다른 경로 전환이 커밋되면 다르다. */
    val routeGen: Int,
    val phase: Phase,
) {
    /** 역 고르기(지하철 — 목록·검색 포함) → 조회 중. 버스는 곧장 조회 중이다. */
    enum class Phase { pickStation, loading }
}

/** 슬롯이 끝난 뒤 버튼 아래에 남는 결과 한 줄(§3.3 3-state). 채택이면 null — 착지는 국면 전이가 맡는다. */
enum class RecoveryOutcome { noLocation, fetchFailed, noRoute, noGuidable }

/**
 * 화면이 읽는 대중교통 안내 상태(iOS `TransitGuideModel`이 `@Observable`로 뷰에 내보내는 값 — 도보 `WalkGuideUiState` 동형). 폴 작업·장부·세대·
 * 캐시 같은 `@ObservationIgnored` 값은 모델의 비공개 필드다.
 *
 * 단계 2-1 범위: 수명·폴·유휴·통지에 쓰는 값과, 이 범위 코드가 읽는 사용자 동작 묶음(2-2) 필드. 단계 3-1이 승차 중 현재역(`ridingPosition`·`positionClock`)과
 * 버스 정류장 표식(`busStopMark`)을 더했다. 단계 3-2가 잘못 내림 복구(E78)·목적지 전환·다른 경로 슬롯을 더했다.
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
    /** 진행 중인 잘못 내림 복구(E78) — 이 슬롯이 있는 동안 옛 세션은 조용하다. */
    val pendingRecovery: PendingRecovery? = null,
    /** 시한이 역 질문을 거둔 순번 — 시트가 이 변화로 열린 역 검색 시트를 닫고 상태 문장으로 착지한다. */
    val recoveryWithdrawnSeq: Int = 0,
    val recoveryOutcome: RecoveryOutcome? = null,
    val pendingDestChange: PendingDestChange? = null,
    val pendingAltRoutes: PendingAltRoutes? = null,
) {
    val isTracking: Boolean get() = state != null
}
