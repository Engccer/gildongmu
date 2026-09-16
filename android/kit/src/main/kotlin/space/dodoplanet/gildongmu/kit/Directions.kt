package space.dodoplanet.gildongmu.kit

import space.dodoplanet.gildongmu.kit.models.CarRouteBriefing
import space.dodoplanet.gildongmu.kit.models.TransitRouteResult
import space.dodoplanet.gildongmu.kit.models.WalkRouteBriefing
import kotlinx.coroutines.CancellationException
import kotlin.math.roundToInt

// 길찾기 탭 순수 도메인(웹 DirectionsView 상태 머신의 Kit 판 ↔ Kit `Directions.swift` 미러, 화면 비의존).
// 화면이 소유하는 것은 조회 오케스트레이션뿐이고, 필드 원자 상태·수단 분류·표시 순서·성공 집계는 전부 여기서
// 결정한다.

/**
 * 길찾기 필드 원자 상태. 웹은 자유 편집 텍스트 필드라 `{text, resolved}` 쌍으로 "라벨 편집 즉시 coord 무효"를
 * 지키지만, 앱 필드는 탭→검색 시트 선택이라 부분 갱신 경로 자체가 없다(선택이 라벨+좌표를 항상 한 번에 확정한다).
 */
sealed class DirectionsEndpoint {
    /** 현재 위치. 좌표는 조회 실행 시점에 측위한다(권한 요청도 그 시점). */
    data object Current : DirectionsEndpoint()

    /**
     * `labelRoman`은 지정 시점에 손에 있는 라틴 표기(장소=서버 `Place.nameRoman`, 주소=juso `engAddr`, E28 후속).
     * 수동 위치 지정이 스토어까지 옮겨 비-ko 표시줄이 1순위로 낭독한다 — 표시 때 다시 조회하면 왕복마다 값이
     * 달라지므로 그때 저장한다(웹 `ManualLocation.labelRoman` 동형). 부재는 null.
     */
    data class Place(val label: String, val lat: Double, val lng: Double, val labelRoman: String? = null) : DirectionsEndpoint()
}

/**
 * 수단 식별. `displayOrder`는 각 군(성공·비성공) 안의 고정 순서다(웹 activeModes 동형) — E11부터 화면 순서 자체는
 * `DirectionsResults.orderedModes`(조회 결과 파생 스냅샷)가 정한다.
 */
enum class DirectionsMode {
    transit, walk, car;

    val rawValue: String get() = name

    companion object {
        val displayOrder: List<DirectionsMode> = listOf(transit, car, walk)

        fun fromRawValue(raw: String): DirectionsMode? = entries.firstOrNull { it.name == raw }
    }
}

/**
 * 도보 상세 접기 경계(웹 src/lib/walk-collapse.ts 미러 — E11이 승격 판정에 재사용).
 * ⚠ 판정과 표시가 같은 분 값을 써야 한다 — 초 단위로 가르면 "약 30분"으로 표시되는 경로가 접혀 사용자가 경계를
 *   설명할 수 없다. 반올림은 Swift `rounded()`와 같은 half-up(시간은 음수가 아니다).
 */
object WalkCollapse {
    const val minutes = 30

    fun shouldCollapse(durationSeconds: Int): Boolean = (durationSeconds / 60.0).roundToInt() > minutes
}

/**
 * E11 섹션 표시 순서(웹 src/lib/directions-order.ts 미러 — 공유 fixture directions-order-scenarios.json이 동조 강제).
 * 1. 성공 수단 앞, 비성공(경로 없음·조회 실패) 뒤 — 각 군 안은 입력 순서 유지.
 * 2. 도보 성공이고 30분 이하(도보 상세 접기와 같은 경계)면 성공군 맨 앞.
 */
object DirectionsOrder {
    fun orderModes(
        modes: List<DirectionsMode>,
        isSuccess: (DirectionsMode) -> Boolean,
        walkDurationSeconds: Int?,
    ): List<DirectionsMode> {
        val successes = modes.filter(isSuccess)
        val failures = modes.filter { !isSuccess(it) }
        val promoteWalk = walkDurationSeconds != null && DirectionsMode.walk in successes &&
            !WalkCollapse.shouldCollapse(walkDurationSeconds)
        val orderedSuccesses = if (promoteWalk) listOf(DirectionsMode.walk) + successes.filter { it != DirectionsMode.walk } else successes
        return orderedSuccesses + failures
    }
}

/**
 * 수단 하나의 조회 결과. 웹 ModeOutcome 3-state에 gated·outOfCoverage·unsupportedWaypoint를 더한 상태: 성공 ≠ 경로 없음
 * (Empty) ≠ 조회 실패(Error) ≠ 서버 게이트(Gated, 섹션 자체 미노출) ≠ 서비스 지역 밖(OutOfCoverage, 화면 전체를 전환하는
 * 신호) ≠ 경유지 미지원(UnsupportedWaypoint — 대중교통에 경유지가 있을 때, upstream 미호출. 섹션은 남아 사유를 말한다.
 * `result:null`로 뭉개면 "경로 없음"으로 낭독돼 거짓). 웹은 서버가 게이트 플래그를 주입해 미노출을 선결정하지만,
 * 앱은 호출 후 상태 코드로 안다(게이트 코드는 수단마다 다르다, `DirectionsOutcomeClassifier` 참고).
 */
sealed class DirectionsModeOutcome {
    data class Transit(val result: TransitRouteResult) : DirectionsModeOutcome()
    data class Walk(val briefing: WalkRouteBriefing) : DirectionsModeOutcome()
    data class Car(val briefing: CarRouteBriefing) : DirectionsModeOutcome()
    data object Empty : DirectionsModeOutcome()
    data object Error : DirectionsModeOutcome()
    data object Gated : DirectionsModeOutcome()
    data object OutOfCoverage : DirectionsModeOutcome()
    data object UnsupportedWaypoint : DirectionsModeOutcome()

    val isSuccess: Boolean get() = this is Transit || this is Walk || this is Car
    val isGated: Boolean get() = this is Gated
    val isOutOfCoverage: Boolean get() = this is OutOfCoverage
}

/**
 * 수단별 조회 결과 → 상태 분류. 404·503은 키 미등록 게이트(웹 canShow* false 동형)라 실패가 아니라 미노출이다
 * (3-state 불변식: 게이트를 오류로 낭독하면 거짓 실패).
 *
 * 이름 변경: Swift `classify(transit:)`·`classify(walk:)`·`classify(car:)`는 인자 라벨 오버로드인데 Kotlin은
 * `Result<T>`의 타입 인자로 오버로드할 수 없어(JVM 시그니처 충돌) 수단별 이름으로 가른다.
 *
 * ⚠ `Result`에 담긴 취소(`CancellationException`)는 분류하지 않고 다시 던진다 — `runCatching`으로 만든 값이면 떠난 조회가
 *   "조회 실패"로 커밋된다(Swift 화면은 분류 전에 `Task.isCancelled`로 거른다).
 */
object DirectionsOutcomeClassifier {
    /** transit도 walk와 동형으로 envelope result가 nullable: null = "경로 없음"(Empty, 조회 실패 아님, 웹 ODsay `{result:null}` 계약). */
    fun classifyTransit(result: Result<TransitRouteResult?>): DirectionsModeOutcome =
        result.fold({ value -> value?.let(DirectionsModeOutcome::Transit) ?: DirectionsModeOutcome.Empty }, ::classifyFailure)

    /** walk envelope result null = "경로 없음"(Empty, 조회 실패 아님). */
    fun classifyWalk(result: Result<WalkRouteBriefing?>): DirectionsModeOutcome =
        result.fold({ value -> value?.let(DirectionsModeOutcome::Walk) ?: DirectionsModeOutcome.Empty }, ::classifyFailure)

    /** car는 브리핑 직접 응답이라 "경로 없음" 상태가 없다(Empty 미생성, 웹 동형). */
    fun classifyCar(result: Result<CarRouteBriefing>): DirectionsModeOutcome =
        result.fold(DirectionsModeOutcome::Car, ::classifyFailure)

    /**
     * 게이트 상태 코드는 서버 실계약마다 다르다: walk는 키 없음 → 404(src/app/api/route/walk/route.ts), transit·car는
     * 키 없음 → 503(명시 503). 502(모든 라우트 공통 upstream 장애)는 조회 실패로 유지. OutOfCoverage는 좌표(주로
     * origin=현재 위치)가 서비스 지역 밖일 때의 서버 마커 — 게이트·오류와 별개로 화면 전체를 전환하는 신호.
     */
    private fun classifyFailure(error: Throwable): DirectionsModeOutcome = when {
        error is CancellationException -> throw error
        error is APIError.OutOfCoverage -> DirectionsModeOutcome.OutOfCoverage
        error is APIError.BadStatus && (error.code == 404 || error.code == 503) -> DirectionsModeOutcome.Gated
        else -> DirectionsModeOutcome.Error
    }
}

/** 한 조회의 최종 산출. 표시·포커스·통지 문장이 전부 여기서 파생된다. */
class DirectionsResults private constructor(
    val outcomes: Map<DirectionsMode, DirectionsModeOutcome>,
    /**
     * 표시 순서 스냅샷(E11 spec §2) — 조회 settled의 생성 시점에 1회 확정한다.
     * ⚠ 계산 프로퍼티로 바꾸지 말 것: 부분 재조회가 암묵 재계산을 일으켜 사용자가 조작 중인 섹션이 이동한다.
     *   부분 교체는 `replacingWalk`가 순서를 보존한다.
     */
    val orderedModes: List<DirectionsMode>,
) {
    constructor(outcomes: Map<DirectionsMode, DirectionsModeOutcome>) : this(outcomes, orderOf(outcomes))

    /**
     * 계단 회피 재조회: 도보 outcome만 교체하고 순서는 보존한다(웹 toggleStepFree 동형, spec §2 규칙 3 — 사용자가
     * 조작 중인 섹션이 발밑에서 이동하지 않는다).
     */
    fun replacingWalk(outcome: DirectionsModeOutcome): DirectionsResults =
        DirectionsResults(outcomes + (DirectionsMode.walk to outcome), orderedModes)

    /**
     * 화면에 노출할 수단(동적 순서). 미조회 수단·게이트·서비스 지역 밖은 섹션 자체 미노출(OutOfCoverage는 정상적으로
     * 화면 모델이 화면 전체를 전환해 여기 도달하지 않지만, 방어적으로 개별 수단 렌더에서도 제외한다).
     */
    val displayedModes: List<DirectionsMode>
        get() = orderedModes.filter { mode ->
            val outcome = outcomes[mode] ?: return@filter false
            !outcome.isGated && !outcome.isOutOfCoverage
        }

    /** 성공 수단(동적 순서). 첫 항목이 완료 시 포커스 목적지(성공 0건이면 이동 없음). */
    val successModes: List<DirectionsMode>
        get() = orderedModes.filter { outcomes[it]?.isSuccess == true }

    val firstSuccess: DirectionsMode? get() = successModes.firstOrNull()

    /** 완료 통지 합산 1문장의 수(readySummary {count}). */
    val successCount: Int get() = successModes.size

    private companion object {
        fun orderOf(outcomes: Map<DirectionsMode, DirectionsModeOutcome>): List<DirectionsMode> {
            val walkDuration = (outcomes[DirectionsMode.walk] as? DirectionsModeOutcome.Walk)?.briefing?.durationSeconds
            return DirectionsOrder.orderModes(
                modes = DirectionsMode.displayOrder.filter { outcomes[it] != null },
                isSuccess = { outcomes[it]?.isSuccess == true },
                walkDurationSeconds = walkDuration,
            )
        }
    }
}
