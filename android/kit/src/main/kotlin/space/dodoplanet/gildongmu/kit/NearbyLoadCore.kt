package space.dodoplanet.gildongmu.kit

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.TimeoutCancellationException
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.isActive

/** 좌표 한 쌍(Swift `(lat:, lng:)` 튜플 typealias) — 위치 어댑터 반환형과 같은 모양. */
data class NearbyCoord(val lat: Double, val lng: Double)

/**
 * 내 주변 정규 상태. Kit `NearbyLoadCore.swift` 미러 — 구 상태를 정규화(failed를 위치/서버로 분해, empty 추가 —
 * WhereAmI data:null 전용, "부재 ≠ 0건 ≠ 실패" 3-state의 타입 표현).
 */
sealed class NearbyLoadPhase<out Payload> {
    data object Idle : NearbyLoadPhase<Nothing>()
    data object Loading : NearbyLoadPhase<Nothing>()
    data class Loaded<Payload>(val payload: Payload) : NearbyLoadPhase<Payload>()
    data object Empty : NearbyLoadPhase<Nothing>()
    data object Denied : NearbyLoadPhase<Nothing>()

    /**
     * 권한은 있으나 "정확한 위치"가 꺼져 좌표가 1~20km 오차인 상태. `Denied`·`FailedLocation`과 뭉개지 않는다:
     * 원인도 해결책도 다르고, 그대로 조회하면 **있지도 않은 주변 정보**를 안내하게 된다.
     */
    data object ReducedAccuracy : NearbyLoadPhase<Nothing>()
    data object OutOfCoverage : NearbyLoadPhase<Nothing>()

    /** 한국 안이지만 그 도메인이 이 지역을 다루지 않음(서울 전용 데이터). */
    data class UnavailableHere(val reason: UnavailableHereReason) : NearbyLoadPhase<Nothing>()
    data object FailedLocation : NearbyLoadPhase<Nothing>()
    data object FailedServer : NearbyLoadPhase<Nothing>()
}

/**
 * 좌표 어댑터 오류(:app 위치 서비스 오류의 :kit 번역). 어댑터 계약: 취소는 원본 그대로 다시 던진다 — 절대
 * `Unavailable`로 뭉개지 않는다(스펙 §4). 단 어댑터 자신의 측위 시간 초과(`withTimeout` 만료)는 취소가 아니라
 * `Unavailable`로 번역한다 — 그대로 올리면 코어가 조회 실패(`FailedServer`)로 분류해 원인이 다른 안내가 된다.
 */
sealed class NearbyLocationError(message: String) : Exception(message) {
    object Denied : NearbyLocationError("denied")

    /** "정확한 위치" 꺼짐. 권한 거부와 별개 축이라 별개 상태로 옮긴다. */
    object ReducedAccuracy : NearbyLocationError("reducedAccuracy")
    object Unavailable : NearbyLocationError("unavailable")
}

/**
 * 좌표 소스 3종.
 * - Current: 위치 어댑터 주입(측위 단계 있음 → Denied·FailedLocation 전이 가능)
 * - Fixed: 앵커 좌표 고정(장소 상세 "이 장소 주변" — 측위 없음, 커버리지 선분기는 동일 적용)
 * - None: 파라미터형(좌표 자체가 없는 조회, coord=null)
 */
sealed class NearbyCoordinateSource {
    class Current(val getCoordinate: suspend (force: Boolean) -> NearbyCoord) : NearbyCoordinateSource()
    data class Fixed(val coord: NearbyCoord) : NearbyCoordinateSource()
    data object None : NearbyCoordinateSource()
}

/** korea = isInKorea 선분기(웹 coverage 미러, upstream 미호출 쿼터 보호). none = 무제한. */
enum class NearbyCoverage { korea, none }

/** 통지 이벤트 — :kit은 발화하지 않는다(:app 매퍼가 스크린 리더 통지로 변환, 스펙 §4). */
sealed class NearbyLoadEvent<out Payload> {
    data class Loaded<Payload>(val payload: Payload) : NearbyLoadEvent<Payload>()
    data object EmptyResult : NearbyLoadEvent<Nothing>()
    data object RefreshFailed : NearbyLoadEvent<Nothing>()
    data object PermissionLost : NearbyLoadEvent<Nothing>()

    /**
     * 정밀 위치 상실. `PermissionLost`와 나누는 이유는 문구다 — 같은 순간 화면은 "정확한 위치가 꺼져 있습니다"를
     * 보여주는데 낭독이 "권한이 꺼져 있어"라고 하면 화면과 소리가 서로 다른 원인을 말한다.
     */
    data object AccuracyLost : NearbyLoadEvent<Nothing>()
    data object WentOutOfCoverage : NearbyLoadEvent<Nothing>()
}

/**
 * 내 주변 화면 공통 load() 상태 머신 정본. 전이표는 스펙 docs/superpowers/specs/2026-07-31-ios-nearby-skeleton-design.md
 * §5(동결 계약). 취소 2겹 방어(#17): 오류형(`CancellationException`) + 커밋 게이트(각 suspend 복귀 직후·커밋 직전
 * `isActive`) — 협력적 취소가 성공값을 반환해도 떠난 화면에 커밋·통지하지 않는다.
 *
 * Swift `@Observable @MainActor` 대응: 상태는 `StateFlow`로 노출하고(:app이 수집), 동기화 없는 클래스라 메인 스레드에서만
 * 부른다. ⚠ `StateFlow`는 같은 값의 재대입을 합친다(Swift 관찰은 대입마다 발화) — 조회마다 생기는 부수 효과(포커스 이동
 * 등)는 phase 수집이 아니라 이벤트로 받는다. 전송 계층 취소(Swift `URLError.cancelled`)에 대응하는 플랫폼 표준 오류형은
 * 없다 — 코루틴 취소는 `CancellationException`으로 오고 `APIClient`가 그대로 통과시킨다.
 *
 * 취소된 코루틴에서 `load()`는 phase를 복원한 뒤 취소를 다시 던진다(Swift는 정상 반환) — 호출자의 뒤 코드가 떠난
 * 화면에서 돌지 않게 하는 코루틴 관례다. 코루틴이 살아 있는데 취소 예외만 올라온 경우는 복원하고 정상 반환한다.
 */
class NearbyLoadCore<Payload : Any>(
    private val coordinate: NearbyCoordinateSource,
    private val coverage: NearbyCoverage,
    private val fetch: suspend (coord: NearbyCoord?, previous: Payload?) -> Payload?,
    private val willCommit: (Payload) -> Unit = {},
    private val onEvent: (NearbyLoadEvent<Payload>) -> Unit,
) {
    private val mutablePhase = MutableStateFlow<NearbyLoadPhase<Payload>>(NearbyLoadPhase.Idle)
    val phase: StateFlow<NearbyLoadPhase<Payload>> = mutablePhase.asStateFlow()

    /** 재진입 가드: 진행 중 재호출은 즉시 무시(#1). */
    private var isLoadingInFlight = false

    suspend fun load(force: Boolean = false) {
        if (isLoadingInFlight) return
        isLoadingInFlight = true
        try {
            loadOnce(force)
        } finally {
            isLoadingInFlight = false // 불변식 ④ — 취소 포함 전 경로 해제
        }
    }

    private suspend fun loadOnce(force: Boolean) {
        val entry = mutablePhase.value
        val previous = (entry as? NearbyLoadPhase.Loaded)?.payload
        // 직전 성공 데이터가 있으면 유지한 채 재조회, 그 외는 로딩 표시(#2·#3)
        if (entry !is NearbyLoadPhase.Loaded) mutablePhase.value = NearbyLoadPhase.Loading

        // #17: 취소 복원 — loaded는 유지(대체된 적 없음), 그 외는 entry로(loading 고착 금지)
        fun restoreOnCancellation() {
            if (entry is NearbyLoadPhase.Loaded) return
            mutablePhase.value = entry
        }

        // 커밋 게이트: 코루틴이 취소됐으면 오판·통지 없이 복원하고 취소를 전파한다.
        suspend fun abandon() {
            restoreOnCancellation()
            currentCoroutineContext().ensureActive()
        }

        try {
            val coord: NearbyCoord? = when (val source = coordinate) {
                is NearbyCoordinateSource.Current -> {
                    val got = source.getCoordinate(force)
                    if (isCancelled()) return abandon()
                    got
                }
                is NearbyCoordinateSource.Fixed -> source.coord // 측위 없음 — force는 재조회 의미만 갖는다
                NearbyCoordinateSource.None -> null
            }
            // 좌표 확보 직후 선분기(네트워크 생략) — 서버 마커 catch와 이중 방어(#8·#9). 판정 조건은 "좌표가 있는가"이지
            // "어디서 얻었는가"가 아니다 — fixed 앵커도 같은 보호를 받는다.
            if (coverage == NearbyCoverage.korea && coord != null && !isInKorea(coord.lat, coord.lng)) {
                mutablePhase.value = NearbyLoadPhase.OutOfCoverage
                if (entry is NearbyLoadPhase.Loaded) onEvent(NearbyLoadEvent.WentOutOfCoverage)
                return
            }
            val result = fetch(coord, previous)
            if (isCancelled()) return abandon()
            when {
                result != null -> {
                    willCommit(result) // 부가 상태(리빌 창 리셋)와 원자 커밋
                    mutablePhase.value = NearbyLoadPhase.Loaded(result) // #10 — 커밋 후 이벤트(불변식 ⑤)
                    onEvent(NearbyLoadEvent.Loaded(result))
                }
                entry is NearbyLoadPhase.Loaded -> onEvent(NearbyLoadEvent.RefreshFailed) // #11 — 데이터 유지
                else -> {
                    mutablePhase.value = NearbyLoadPhase.Empty // #12
                    onEvent(NearbyLoadEvent.EmptyResult)
                }
            }
        } catch (e: TimeoutCancellationException) {
            // fetch 안쪽 `withTimeout` 만료는 "화면을 떠남"이 아니라 조회 실패다 — 아래 일반 취소보다 먼저 가른다.
            // 바깥 `withTimeout`이 이 코루틴을 취소한 것이면 취소 경로다.
            if (isCancelled()) return abandon()
            fail(e, entry)
        } catch (e: CancellationException) {
            restoreOnCancellation()
            if (isCancelled()) throw e
        } catch (e: Exception) {
            // 어떤 오류든 취소된 코루틴이면 오판·통지 없이 복원(#17)
            if (isCancelled()) return abandon()
            fail(e, entry)
        }
    }

    private fun fail(error: Exception, entry: NearbyLoadPhase<Payload>) {
        val wasLoaded = entry is NearbyLoadPhase.Loaded
        when (error) {
            NearbyLocationError.Denied -> { // #4·#5 — 권한 전락은 무신호 화면 전환 방지 통지
                mutablePhase.value = NearbyLoadPhase.Denied
                if (wasLoaded) onEvent(NearbyLoadEvent.PermissionLost)
            }
            NearbyLocationError.ReducedAccuracy -> {
                // Denied와 동형 전이(원인만 다르다). loaded에서 전락하는 경로는 사용자가 설정에서 정확한 위치를 끈
                // 경우이고, 목록이 통째로 사라지므로 무신호가 되지 않게 통지한다.
                mutablePhase.value = NearbyLoadPhase.ReducedAccuracy
                if (wasLoaded) onEvent(NearbyLoadEvent.AccuracyLost)
            }
            NearbyLocationError.Unavailable -> // #6·#7
                if (wasLoaded) onEvent(NearbyLoadEvent.RefreshFailed) else mutablePhase.value = NearbyLoadPhase.FailedLocation
            APIError.OutOfCoverage -> { // #13·#14 — 서버 마커 이중 방어
                mutablePhase.value = NearbyLoadPhase.OutOfCoverage
                if (wasLoaded) onEvent(NearbyLoadEvent.WentOutOfCoverage)
            }
            is APIError.UnavailableHere -> {
                // 좌표 선분기가 없다(서울 경계 판정은 서버 정본 — 클라가 bbox를 복제하면 반경 상수와 어긋나 조용히
                // 갈린다). loaded에서 전락하는 경로는 앵커가 바뀔 때뿐이라 refreshFailed와 같은 통지를 쓴다.
                mutablePhase.value = NearbyLoadPhase.UnavailableHere(error.reason)
                if (wasLoaded) onEvent(NearbyLoadEvent.RefreshFailed)
            }
            else -> // #15·#16
                if (wasLoaded) onEvent(NearbyLoadEvent.RefreshFailed) else mutablePhase.value = NearbyLoadPhase.FailedServer
        }
    }

    private suspend fun isCancelled(): Boolean = !currentCoroutineContext().isActive
}
