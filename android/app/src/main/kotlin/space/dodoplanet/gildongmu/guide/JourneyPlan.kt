package space.dodoplanet.gildongmu.guide

import space.dodoplanet.gildongmu.directions.Strings
import space.dodoplanet.gildongmu.kit.BeaconDest
import space.dodoplanet.gildongmu.kit.models.EgressKind
import space.dodoplanet.gildongmu.kit.JourneyPhase
import space.dodoplanet.gildongmu.kit.JourneyShape
import space.dodoplanet.gildongmu.kit.JourneyStage
import space.dodoplanet.gildongmu.kit.models.EgressOption
import space.dodoplanet.gildongmu.kit.models.JourneyVariant

/**
 * 여정 안내의 계획(M5 §7-3, iOS `JourneyPlan`) — 길찾기 여정 결과에서 고른 변형·출구와 도착지. 모양은 여기서 유도한다. 기본값 없음.
 * iOS의 `destRoman`은 두지 않는다(대중교통·도보 요청에 라틴 표기 축이 없고 여정은 ko 전용, §2-2).
 */
data class JourneyPlan(
    val variant: JourneyVariant,
    /** 고른 출구·승강장(역 B 미지정이면 null). `kind == none`이면 출구 도보 없이 곧장 택시. */
    val egress: EgressOption?,
    val destLabel: String,
    val dest: BeaconDest,
    /** 지금 탄 열차에서 시작하면 고른 방향(E71). null이면 종전 대기 시작. ⚠ 기본값 없음(안전 인자). */
    val aboard: TransitAboardStart?,
) {
    val shape: JourneyShape
        get() = JourneyShape(
            startsWithTaxi = variant.taxiIn != null,
            alightDesignated = variant.egress != null,
            hasEgressWalk = egress?.let { it.kind != EgressKind.none } ?: false,
        )
}

/** 지금 탄 열차에서 시작(E71, iOS `TransitAboardStart`) — `direction`은 서울 도착 피드 `updnLine` 원문(고른 방면). */
data class TransitAboardStart(val direction: String)

/** 여정 실패의 원인(iOS `journeyFailure` 튜플) — 그 모델이 이미 낸 실패 문장 키와 해결 수단. 실패 시트의 상태 줄이 쓴다. */
data class JourneyFailure(val key: String, val resolution: FailResolution)

/** 여정 시트·띠바·알림이 관찰하는 값(iOS `@Observable` 몫). `GuideSession.journeyUi`가 null이면 여정 없음. */
data class JourneyUiState(val phase: JourneyPhase, val failure: JourneyFailure?)

/**
 * 여정 상태 문장(iOS `journeyStatusText`) — 여정 시트의 상태 줄·띠바·여정 보유자 알림 본문이 같은 문장을 쓴다. 실패가 아니면 「불러오는 중」, 실패면 그 모델이
 * 낸 원인 문장(다른 원인을 말하지 않는다), 없으면 단계별 문장.
 */
fun journeyStatusText(state: JourneyUiState?, strings: Strings): String {
    val phase = state?.phase as? JourneyPhase.Failed ?: return strings.get("directions.loading")
    state.failure?.let { return strings.get(it.key) }
    return when (phase.at) {
        JourneyStage.egress -> strings.get("android.journey.egressStartFailed")
        JourneyStage.taxiIn, JourneyStage.taxiOut -> strings.get("android.journey.taxiOutFailed")
        // 대중교통 단계 준비가 복귀 시 30초를 넘긴 경우 — 택시 문장이 아니다.
        JourneyStage.transit, JourneyStage.access -> strings.get("route.transit.error")
    }
}
