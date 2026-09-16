package space.dodoplanet.gildongmu.kit

/**
 * 비콘 판정 결과를 **통지로 라우팅하는 순수 게이트** — Kit `BeaconGate.swift` 미러.
 *
 * `beaconStep`이 "무엇이 일어났는가"를 정하면 여기서 "그래서 말을 할까"를 정한다. 앱 계층에 두지 않는 이유는
 * (1) 이 기능의 실제 결함 이력이 100% 이 계층이었고 (2) 앱 계층은 구조적으로 검증이 어렵기 때문이다.
 *
 * ⚠ **톤은 여기서 내지 않는다**(2026-08-08 분리). 톤 선택은 `toneLayerStep`이 단독 소유한다 — 두 곳이 톤을
 * 내면 어느 쪽이 정본인지 알 수 없고, 간략·상세가 같은 계층을 공유한다는 통일 계약이 깨진다. 여기가 답하는
 * 것은 "이번 fix가 **도착 톤을 소유**하는가"뿐이고, 그 값은 톤 계층의 `priorityTone` 입력이 된다.
 */

/** 통지 내용. :kit은 로컬라이즈하지 않고 **무엇을 알릴지**만 정한다(앱이 문자열 매핑). */
sealed class BeaconNotice {
    data class First(val meters: Int) : BeaconNotice()
    data class Closer(val meters: Int) : BeaconNotice()
    data class Farther(val meters: Int) : BeaconNotice()

    /** ⚠ 미터는 거리가 아니라 **오차 반경**이다(문구가 "약 ±N m"). */
    data class Nearby(val accuracyMeters: Int) : BeaconNotice()
    data object Weak : BeaconNotice()
}

data class BeaconGateState(
    /** 도착 톤 소유 래치. 존을 벗어나 추세가 재개될 때만 재무장한다. */
    val nearbyToneDone: Boolean,
    val previousKind: AnnounceKind?,
) {
    companion object {
        val initial = BeaconGateState(nearbyToneDone = false, previousKind = null)
    }
}

/** `beaconGateStep` 결과(Swift 튜플 `(state, nearbyTone, notice)` 대응). */
data class BeaconGateStepResult(val state: BeaconGateState, val nearbyTone: Boolean, val notice: BeaconNotice?)

fun beaconGateStep(state: BeaconGateState, announce: BeaconAnnounce): BeaconGateStepResult {
    var nearbyToneDone = state.nearbyToneDone
    var nearbyTone = false

    when (announce.kind) {
        AnnounceKind.nearby -> {
            // 존에 머무는 동안 매 fix가 nearby를 내지만 톤 소유는 진입 1회뿐이다.
            // 리듀서의 래치는 speak(음성)만 억제하므로 이 래치가 따로 필요하다.
            if (!state.nearbyToneDone) {
                nearbyTone = true
                nearbyToneDone = true
            }
        }
        // 추세가 재개됐다 = 존을 진짜로 벗어났다. 다음 도착은 다시 알린다.
        // (존 경계에서 흔들리는 hold는 재무장하지 않는다. 그건 재진입이 아니다.)
        AnnounceKind.closer, AnnounceKind.farther -> nearbyToneDone = false
        AnnounceKind.first, AnnounceKind.hold, AnnounceKind.weak -> Unit
    }

    // 통지. weak은 리듀서에서 항상 speak=false이므로 speak만 보면 영영 통지되지 않는다.
    // 비-weak → weak 전이에서만 1회 내고 연속 weak은 침묵한다(polite 스팸 방지).
    val notice: BeaconNotice? = if (announce.kind == AnnounceKind.weak) {
        if (state.previousKind == AnnounceKind.weak) null else BeaconNotice.Weak
    } else if (announce.speak) {
        val raw = if (announce.kind == AnnounceKind.nearby) announce.accuracy else announce.distance
        val meters = raw.roundedAwayFromZero().toInt()
        when (announce.kind) {
            AnnounceKind.first -> BeaconNotice.First(meters)
            AnnounceKind.closer -> BeaconNotice.Closer(meters)
            AnnounceKind.farther -> BeaconNotice.Farther(meters)
            AnnounceKind.nearby -> BeaconNotice.Nearby(meters)
            AnnounceKind.hold, AnnounceKind.weak -> null
        }
    } else {
        null
    }

    return BeaconGateStepResult(BeaconGateState(nearbyToneDone, announce.kind), nearbyTone, notice)
}
