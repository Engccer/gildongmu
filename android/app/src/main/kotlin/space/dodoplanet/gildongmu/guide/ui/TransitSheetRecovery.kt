package space.dodoplanet.gildongmu.guide.ui

import space.dodoplanet.gildongmu.a11y.HapticKind
import space.dodoplanet.gildongmu.guide.PendingRecovery
import space.dodoplanet.gildongmu.guide.RecoveryOutcome
import space.dodoplanet.gildongmu.guide.ResultHapticKind
import space.dodoplanet.gildongmu.guide.TransitGuideUiState
import space.dodoplanet.gildongmu.kit.StationLayoutKind
import space.dodoplanet.gildongmu.kit.TransitSurroundingsAnchor

/**
 * 5-D 순수 판정(JVM 테스트가 읽는다) — 잘못 내림 복구 버튼 집합·주변 확인 헤더·복구 역 검색의 지하철역 판정·진동 종류 변환.
 * 렌더 조건의 정본은 [transitControlExists]와 이 파일이고, 컴포저블은 여기서 고른 것만 그린다.
 */

/**
 * 복구 컨트롤 집합(iOS `recoveryControls`). `picking`: 역 질문이 버튼 자리를 대신한다(지하철). `start`: 「여기서 다시 길찾기」. `retry`: 조회 실패·위치 없음의
 * 「다시 시도」. `walk`: 경로 없음·안내 불가의 「목적지까지 걸어가기」(iOS `onWalkHandoff != nil` ↔ 목적지가 있을 때).
 */
data class TransitRecoveryControls(val picking: Boolean, val start: Boolean, val retry: Boolean, val walk: Boolean)

/** `recoveryOffered`가 아니면 null(복구 영역 자체가 없다). 기본값 없음. */
fun transitRecoveryControls(ui: TransitGuideUiState, recoveryOffered: Boolean, walkAvailable: Boolean): TransitRecoveryControls? {
    if (!recoveryOffered) return null
    val picking = ui.pendingRecovery?.phase == PendingRecovery.Phase.pickStation
    return TransitRecoveryControls(
        picking = picking,
        start = !picking,
        retry = ui.recoveryOutcome == RecoveryOutcome.noLocation || ui.recoveryOutcome == RecoveryOutcome.fetchFailed,
        walk = walkAvailable && (ui.recoveryOutcome == RecoveryOutcome.noRoute || ui.recoveryOutcome == RecoveryOutcome.noGuidable),
    )
}

/** 주변 확인 섹션 헤더의 (문자열 키, 역 이름) — iOS `surroundingsHeading`. 문장은 `strings.get(key, name)`. */
fun transitSurroundingsHeading(anchor: TransitSurroundingsAnchor): Pair<String, String> = when (anchor) {
    is TransitSurroundingsAnchor.CurrentStation -> "transitGuide.surroundingsAnchorCurrent" to anchor.stop.name
    is TransitSurroundingsAnchor.AlightStop -> "transitGuide.surroundingsAnchorAlight" to anchor.stop.name
}

/**
 * 앵커가 같은가 — 바뀌면 지난 역 장면을 버린다(iOS `onChange(of: anchorKey)`). 세션의 `sceneLookup`이 좌표로 같은 조회를 재사용하고 다르면 새로 만든다.
 */
fun transitSurroundingsAnchorKey(anchor: TransitSurroundingsAnchor): String = "${anchor.stop.lat},${anchor.stop.lng}"

/** 복구 역 검색은 지하철역만 받는다(iOS `selectAboardStation`의 `stationLayoutKind == .subway`). 최근 기록·주소처럼 종류를 모르는 선택은 받지 않는다(null). */
fun transitRecoverySearchAccepts(kind: StationLayoutKind?): Boolean = kind == StationLayoutKind.subway

/** 결과 진동 종류 변환(앱 통지 쪽 → 안내 모델 쪽). */
fun HapticKind.toGuideHaptic(): ResultHapticKind = when (this) {
    HapticKind.success -> ResultHapticKind.success
    HapticKind.attention -> ResultHapticKind.attention
    HapticKind.failure -> ResultHapticKind.failure
}
