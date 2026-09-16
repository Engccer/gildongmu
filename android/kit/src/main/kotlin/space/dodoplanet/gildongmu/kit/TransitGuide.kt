package space.dodoplanet.gildongmu.kit

import kotlinx.serialization.Serializable
import space.dodoplanet.gildongmu.kit.models.QuickExit
import space.dodoplanet.gildongmu.kit.models.TransitLegStop
import space.dodoplanet.gildongmu.kit.models.TransitRoute

/**
 * 대중교통 실시간 길 안내 상태 머신 — 웹 `src/lib/transit-guide.ts` ↔ Kit `TransitGuide.swift` 1:1 미러(B2 스펙 §4.2).
 * 공유 fixture(`transit-guide-scenarios.json`)가 동조를 강제한다.
 *
 * 입력은 GPS fix가 아니라 폴링 응답·사용자 액션·시각이다(RouteGuide 리듀서와 별개). 판정은 전부 여기서 하고 앱은
 * 폴링 I/O·통지만 한다.
 *
 * 핵심 계약: leg 전환은 사용자 확인(advance), 신호 상태는 배타 enum(데이터 없음 ≠ 조회 실패), 잠금은 복합 키(식별자
 * 원문 무변형), phaseGen·seq 커밋(늦은 응답 폐기), 이벤트는 입력당 최대 1개(원자 전이). 상세는 `docs/INTEGRATIONS.md`
 * §근사 잠금은 두 갈래다·§확정 도착·비관측 riding은 폴 주기 0·§riding 미관측 상한은 조회 횟수.
 */
@Serializable
enum class TransitTrackMode {
    seoulBus, tagoBus, subway;

    val rawValue: String get() = name
}

/**
 * boarding(2026-08-22 N3): 차량을 골랐고 그 차량의 **승차 정류소 도착**을 기다린다. 폴링 대상은 waiting과 같다(승차
 * 정류소). riding 승격은 도착 관측 또는 사용자 선언(confirmBoarded·restoreBoarding) 두 길뿐 — 미등장을 탑승으로
 * 추론하지 않는다.
 */
enum class TransitPhase {
    waiting, boarding, riding, arrived, done;

    val rawValue: String get() = name
}

/**
 * riding 진입 경위 — observed=승차 정류소 도착 관측(지하철 진입 0·도착 1), declared=사용자 선언·근사 잠금,
 * departed=서울버스 "곧 도착"(잔여 0) 뒤 소실 관측(A41 — 그 차량이 서고 떠났다. 정차 자체는 API에 없다).
 */
enum class TransitBoardedCause {
    observed, declared, departed;

    val rawValue: String get() = name
}

enum class TransitSignal {
    tracking,
    notYetVisible,

    /**
     * 잠금 이후 한 번도 관측되지 않은 채 상한 경과(A16 L2). signalLost(관측되다 소실)와 원인도 사용자 행동도 다르다 —
     * 합치지 말 것.
     */
    neverSeen,
    signalLost,
    upstreamFailed,
    untrackable;

    val rawValue: String get() = name
}

/** 잠금·매칭 복합 키(§4.2). vehicleId "" = 근사 잠금(차량 식별자 부재, §13.2). */
@Serializable
data class TransitLock(
    val mode: TransitTrackMode,
    val routeId: String,
    val direction: String,
    val vehicleId: String,
    /** 근사 잠금의 급행 선언(spec 2026-09-02 §6). 식별자 잠금엔 null. */
    val express: Boolean? = null,
)

/**
 * 근사 잠금 판별(§13.2): tagoBus(식별자 자체가 없다)와 "이미 탔습니다"(seoulBus·subway에서 식별자 없이 선언)가 같은
 * 소비 한계를 상속한다 — arrived 전이 금지·advance 상시·기준 차량 교체 통지·근사 주석.
 */
fun isApproxTransitLock(lock: TransitLock): Boolean = lock.vehicleId.isEmpty()

/**
 * 비관측 잠금(A34 2026-09-11, spec `2026-09-11-transit-reboard-and-handoff-design.md` §4.2): 근사 잠금 중 지방버스가
 * 아닌 것 — 지하철·서울버스의 "열차 정보 없이 계속" 폴백. 어느 열차인지 모르므로 하차역 도착 목록을 매칭하지 않고
 * 폴도 하지 않는다. 지방버스 근사는 설계상 유일한 추적이라 종전 그대로.
 */
fun transitLockIsUnobserved(lock: TransitLock): Boolean = isApproxTransitLock(lock) && lock.mode != TransitTrackMode.tagoBus

/**
 * boarding 국면에서 **도착 관측이 끝났는가**(N3 ① 2026-09-10 판정). 참일 때만 수동 진행 수단([도착 정보 없이 탑승
 * 진행])을 세운다 — 그 밖에는 승차 정류소 도착 관측이 riding 승격을 자동으로 한다. `signalLost`는 연속 미등장·
 * `vehiclePassed`와 심야·미제공이 모이는 자리이고, `upstreamFailed`는 조회 실패다. `neverSeen`은 riding 전용 축이라
 * 이 국면에 없다. 웹 `boardingObservationLost` 미러.
 */
fun transitBoardingObservationLost(signal: TransitSignal): Boolean =
    signal == TransitSignal.signalLost || signal == TransitSignal.upstreamFailed

/**
 * "이미 탔습니다" 흐름의 후보 필터(A34 ②): 사용자가 "지금 지나는 역"이라 답한 역의 도착 목록에서 **그 역에 있는
 * 열차**(진입 0·도착 1·출발 2·전역 출발/진입/도착 3·4·5)만 남긴다. `99`(두 정거장 이상 밖)는 사용자가 타고 있을 수
 * 없다. 이 필터가 선언 식별 잠금(`boardAboard`)이 확정 도착 권한을 갖는 근거다. 웹 `aboardCandidates` 미러.
 */
fun transitAboardCandidates(items: List<TransitTrackItem>): List<TransitTrackItem> =
    items.filter { it.arrivalCode in ABOARD_ARRIVAL_CODES }

private val ABOARD_ARRIVAL_CODES = setOf("0", "1", "2", "3", "4", "5")

/** 안내 대상으로 조립된 탑승 leg(§4.1). 도보 leg는 대기 문맥으로 흡수된다. */
@Serializable
data class TransitGuideLeg(
    /** "bus" | "subway" */
    val mode: String,
    val lineName: String,
    /** null = 추적 불가(비수도권 지하철·정보 결손) — 수동 전진만 가능. */
    val trackMode: TransitTrackMode?,
    val boardName: String,
    val alightName: String,
    val boardStop: TransitLegStop?,
    val alightStop: TransitLegStop?,
    /** 경유 전체(양 끝 포함, includeStops 미보유 시 빈 목록) — 종착 검사(§5.1) 축. */
    val viaStops: List<TransitLegStop>,
    val stationCount: Int?,
    val routeId: String?,
    val wayCode: Int?,
    val walkBeforeMinutes: Int?,
    /** 하차역 빠른하차 문 위치(E5). 판정 불가·미커버는 null. */
    val quickExit: QuickExit? = null,
    /**
     * 영문 표시 조각(E27 잔여 ①, `lang=en` 조회에만). ⚠ 위 한국어 필드는 en 세션에서도 한국어다 — 조인(매핑표·조회
     * 쿼리·종착 검사)이 그 값으로 돌기 때문이고, 여기 영문을 넣으면 오류가 아니라 "실시간 정보가 영영 안 뜬다"가 된다.
     */
    val lineNameEn: String? = null,
    val boardNameEn: String? = null,
    val alightNameEn: String? = null,
    /** 급행 정차역 이름 집합(A16 L1, 단일 패턴 노선에만 — 부재 = 판정 불가). */
    val expressStops: List<String>? = null,
    /** `expressStops`와 같은 순서의 ODsay `stationID` — 있으면 ID 판정이 정본. */
    val expressStopIds: List<String>? = null,
    /** 하차 출구 번호(E25, 서버 문맥 게이트 + 소비자 형식 게이트 통과값). */
    val exitAlight: String? = null,
    /** 구간 소요 분(ODsay `TransitLeg.minutes`) — 유휴 폴 정지 한계의 근거(E36 §4.2.6). 표시엔 쓰지 않는다. */
    val minutes: Int? = null,
)

/**
 * 출구 번호 소비자 형식 게이트(spec 2026-09-02 §5.1, 웹 `validExitNo` 미러): 양끝 공백만 제거한 뒤 `^[0-9]+(-[0-9]+)?$`.
 * 가운데 공백을 지우면 `"1 2"`가 12번 출구로 둔갑하므로 trim만 한다. 약칭 숫자 클래스 대신 `[0-9]`: 안드로이드 기기의
 * ICU 정규식에서 약칭 클래스는 전각 숫자도 통과해 JS(ASCII)와 갈린다 — `:kit`은 명시 클래스만 쓴다.
 */
fun transitValidExitNo(raw: String?): String? {
    if (raw == null) return null
    val t = raw.trim()
    return if (VALID_EXIT_NO.matches(t)) t else null
}

/** 테스트가 안드로이드 ICU 의미(유니코드 문자 클래스)로 다시 컴파일해 약칭 클래스 회귀를 잡는다 — JVM 기본은 ASCII라 못 잡는다. */
internal val VALID_EXIT_NO = Regex("^[0-9]+(-[0-9]+)?$")

@Serializable
data class TransitGuideRoute(
    val legs: List<TransitGuideLeg>,
    /** 마지막 하차 뒤 목적지까지 도보(분) — 완료 문구 분기(§4.1). */
    val walkAfterMinutes: Int?,
)

/**
 * 폴링 항목(`/api/transit/track` 판별 union의 투영, §7). `message`는 **upstream 완성 문장 원문**이다 — 서버는 어느
 * 국면에서도 다듬지 않는다(E39). 문장 조립은 `transitArrivalStatusLine`이 한 자리에서 한다.
 */
@Serializable
data class TransitTrackItem(
    val vehicleId: String?,
    val direction: String,
    val message: String,
    /** 잔여 정거장 수(§6.2 서버 추출). 실패는 null(사다리만 비활성). */
    val remainingStops: Int?,
    val destinationName: String?,
    val express: Boolean,
    val arrivalCode: String?,
    /** 현재 위치 역명(지하철 arvlMsg3, §12.2) — 미제공 수단은 null. */
    val currentLocation: String? = null,
    /** 데이터 수신 시각 원문(recptnDt, §12.1 스냅숏 정체성) — 미제공은 null. */
    val dataStamp: String? = null,
    /** 데이터 나이(초, 서버 계산·클램프). null = 미제공·동결 판정 불가(§12.1 ⓑ). */
    val dataAgeSeconds: Int? = null,
    /**
     * 영문 조각(E27 잔여 ①, `lang=en` 요청에만). ⚠ 위 한국어 필드는 en 응답에서도 한국어다 — 실시간 매핑·종착 검사·
     * 현재역 인덱스가 전부 그 값으로 조인한다. ⚠ **`messageEn`만 빈 문자열이 유효한 값이다**(TAGO는 ko도 완성
     * 문장이 없어 `""`). 나머지 셋의 `""`는 정보 소실이라 서버가 부재로 정규화해 보낸다.
     */
    val messageEn: String? = null,
    val directionEn: String? = null,
    val destinationNameEn: String? = null,
    val currentLocationEn: String? = null,
)

sealed class TransitTrackPoll {
    data class Ok(val items: List<TransitTrackItem>) : TransitTrackPoll()
    data object Empty : TransitTrackPoll()
    data object Unsupported : TransitTrackPoll()
    data object Failed : TransitTrackPoll()
}

/** 대기 목록 0건 사유(§13.3): 진짜 0건 / 필터 전멸(rawCount>0) / 조회 실패·미지원. */
enum class TransitWaitingEmptyReason {
    none, filtered, unavailable;

    val rawValue: String get() = name
}

/** 대기 폴 결과 → 0건 사유 판정(§13.3) — 웹 `waitingEmptyReason` 미러. */
fun transitWaitingEmptyReason(poll: TransitTrackPoll, rawCount: Int?): TransitWaitingEmptyReason? = when (poll) {
    is TransitTrackPoll.Ok, TransitTrackPoll.Empty ->
        if (poll is TransitTrackPoll.Ok && poll.items.isNotEmpty()) {
            null
        } else if ((rawCount ?: 0) > 0) {
            TransitWaitingEmptyReason.filtered
        } else {
            TransitWaitingEmptyReason.none
        }
    TransitTrackPoll.Unsupported, TransitTrackPoll.Failed -> TransitWaitingEmptyReason.unavailable
}

sealed class TransitGuideInput {
    data class Poll(val seq: Int, val phaseGen: Int, val poll: TransitTrackPoll) : TransitGuideInput()
    data class Board(val lock: TransitLock) : TransitGuideInput()

    /**
     * boarding → riding 사용자 선언. 입력 자체는 불변이고 UI가 이 입력을 낼 수 있는 때만 좁혔다(N3 ① — 관측이 끝난
     * 국면의 [도착 정보 없이 탑승 진행]).
     */
    data object ConfirmBoarded : TransitGuideInput()

    /** "탑승 변경 취소" — previousLock으로 previousPhase 복귀. */
    data object RestoreBoarding : TransitGuideInput()
    data object ChangeBoarding : TransitGuideInput()
    data object Advance : TransitGuideInput()

    /** 하차역 선언(A37 ②): 역 선택에서 하차역을 고르면 그 leg를 확정 도착으로 끝낸다. waiting·riding에서만. */
    data object DeclareArrived : TransitGuideInput()

    /**
     * "이미 탔습니다" 흐름의 식별 잠금(A34 ②): 사용자가 지나는 역의 목록에서 고른 열차로 waiting → riding(declared)
     * 직행. boarding(승차 정류소 도착 대기)을 지나지 않는다 — 이미 탔다.
     */
    data class BoardAboard(val lock: TransitLock) : TransitGuideInput()
}

/** 구조화 안내 이벤트 — 문구 조립은 앱 몫(GuideText), 완성 문장은 원문 병치(§6.1). */
sealed class TransitGuideEvent {
    data class Boarded(val legIndex: Int, val cause: TransitBoardedCause) : TransitGuideEvent()

    /** 차량 선택(boarding 진입) — 활성화 응답은 앱이 높은 우선순위로 낭독. */
    data class VehicleSelected(val legIndex: Int) : TransitGuideEvent()

    /** boarding: 선택 차량의 승차 정류소 접근(첫 관측 + 사다리 3·2·1). */
    data class Approaching(val remaining: Int?, val message: String, val messageEn: String?) : TransitGuideEvent()

    /** boarding: 잔여 1에서 소실(잔여 0 미관측) — 지나갔을 수 있다. 국면 유지, 사용자 선택 요청. */
    data object VehiclePassed : TransitGuideEvent()

    /**
     * boarding 서울버스: 잔여 0("곧 도착" = 직전 정류소 출발, A41) 첫 관측. 승격이 아니라 임박이다. payload 없음 —
     * "곧 도착" 원문은 `lastMessage`로 이미 흐른다.
     */
    data object ArrivingAtBoardStop : TransitGuideEvent()

    /** riding 서울버스: 하차 정류소 기준 잔여 0 첫 관측 — 차내 "이번 정류장" 방송과 같은 시점(A41). */
    data object ArrivingAtAlightStop : TransitGuideEvent()
    data class TrackingStarted(val message: String, val messageEn: String?, val remaining: Int?, val arrivalCode: String?) :
        TransitGuideEvent()
    data class Countdown(
        val remaining: Int,
        val message: String,
        val messageEn: String?,
        val currentLocation: String?,
        val currentLocationEn: String?,
        val arrivalCode: String?,
    ) : TransitGuideEvent()
    data class MessageChanged(val message: String, val messageEn: String?, val arrivalCode: String?) : TransitGuideEvent()
    data class Arrived(val certain: Boolean) : TransitGuideEvent()
    data class BackOnTrack(val message: String, val messageEn: String?, val arrivalCode: String?) : TransitGuideEvent()
    data class ApproxVehicleChanged(val message: String, val messageEn: String?) : TransitGuideEvent()
    data object SignalLost : TransitGuideEvent()
    data object NeverSeen : TransitGuideEvent()
    data object UpstreamFailed : TransitGuideEvent()
    data object SignalRecovered : TransitGuideEvent()
    data class LegAdvanced(val legIndex: Int, val final: Boolean) : TransitGuideEvent()
    data object BoardingReset : TransitGuideEvent()
    data object CapSlowed : TransitGuideEvent()
}

data class TransitGuideState(
    val legIndex: Int,
    val phase: TransitPhase,
    val phaseGen: Int,
    val lastSeq: Int,
    val signal: TransitSignal,
    val lock: TransitLock?,
    /** 탑승 변경으로 해제한 직전 잠금(§13.1) — "탑승 변경 취소"의 복귀 대상. */
    val previousLock: TransitLock?,
    /** previousLock이 해제되기 전의 국면(boarding·riding) — restoreBoarding의 복귀 목적지. */
    val previousPhase: TransitPhase?,
    val remaining: Int?,
    val lastMessage: String?,
    /** `lastMessage`의 영문(E27 잔여 ①) — 상시 표시 상태줄이 읽는다. 결측이면 그 줄은 ko. */
    val lastMessageEn: String?,
    /** 잠금 항목의 도착 코드(지하철 arvlCd, A27) — 승차 국면 상태줄이 탑승자 시점 문장을 고르는 축. */
    val lastArrivalCode: String?,
    val lastUpdatedAt: Double?,
    /** 잠금 항목의 현재 위치 역명(arvlMsg3, §12.2) — countdown 병치·탑승 위치 축. */
    val currentLocation: String?,
    /** 잠금 항목의 recptnDt 원문(§12.1 스냅숏 정체성 — 동일 스냅숏 무정보 폴 판정). */
    val dataStamp: String?,
    /** 데이터 나이(초, 서버 계산). null = 미제공·동결 판정 불가(§12.1) — 표기 생략. */
    val dataAgeSeconds: Int?,
    val arrivedCertain: Boolean,
    val ladderAnnounced: Int?,
    val trackingAnnounced: Boolean,
    /**
     * 이번 riding 진입 이후 하차역 목록 조회가 **결과(ok·empty)를 돌려준 횟수**(A36 ①). 한 번도 관측되지 않은 채
     * `transitNeverSeenPolls`에 닿으면 neverSeen. ⚠ 시간이 아니라 횟수인 이유: 벽시계는 주머니에 넣어 둔 시간·조회가
     * 실패한 구간·앱이 재워진 구간을 "차량 확인 안 됨"의 근거로 세어 멀쩡히 달리는 열차를 놓친 것으로 선언했다
     * (09-05 실사고). 실패(failed·unsupported)는 관측이 아니므로 세지 않는다. riding 밖에서는 오르지 않는다.
     */
    val ridingPolls: Int,
    val missCount: Int,
    val failCount: Int,
    val failSince: Double?,
    val pollCount: Int,
    val capAnnounced: Boolean,
)

// === 상수 (§4.2·§7) — 웹 동일값 ===

const val transitLadderMax = 3
const val transitFailNotifyCount = 3
const val transitFailNotifyMs: Double = 90_000.0
const val transitMissLostCount = 3
const val transitMissArriveCount = 2

/**
 * 첫 관측 전 미등장 상한(A16 L2) — riding 조회 **횟수**(A36 ①, 2026-09-11). 관측된 뒤의 소실은 `transitMissLostCount`가
 * 맡고 이 축은 "한 번도 못 본" 상태 전용이라 두 축이 같은 결함을 잡지 않는다.
 *
 * ⚠ 조회하지 않은 시간을 "못 봤다"의 근거로 세면 안 된다 — 벽시계 백스톱을 되살리지 말 것(위원장 판정).
 * 10회 = 미등장 riding 주기 60초 × 10 = 종전 10분과 등가. ⚠ 잠정값 — 실승차 판정 대상(BACKLOG §2 A36 행).
 */
const val transitNeverSeenPolls = 10

/** 감속 문턱이지 상한이 아니다 — 세션 수명 상한은 유휴 폴 정지 `transitIdlePollLimitMs`. */
const val transitSessionPollCap = 240

/**
 * boarding 도착 관측의 신선도 상한(초) — 서버 STALE_FROZEN_SECONDS와 같은 값. 종착 코드(1·2)가 동결된 레코드는 선택
 * 직후 폴에 "새 도착"으로 둔갑한다(설계 리뷰 C3).
 */
const val transitBoardStopFreshSeconds = 120

/**
 * A41(설계 리뷰 M1): 서울버스에서 잔여 0("곧 도착")을 본 뒤의 추정 도착 — 소실 지속은 새 정보가 아니라 예상된 후속이다.
 * 이 상태에선 `signalLost`를 내지 않고 폴을 60초로 늦춘다(0이 아닌 이유: 재관측 `backOnTrack`이 가역성의 유일한 문).
 * 지하철 추정은 종전대로 경고. 웹 `seoulBusArrivedAfterSoon` 미러.
 */
private fun transitSeoulBusArrivedAfterSoon(state: TransitGuideState): Boolean =
    state.phase == TransitPhase.arrived && !state.arrivedCertain &&
        state.lock?.mode == TransitTrackMode.seoulBus && state.ladderAnnounced == 0

/** 폴링 주기(ms, §7 적응형). 0 = 폴링 없음(done·untrackable·확정 도착·비관측 riding). 즉폴도 이 0을 따른다. */
fun transitPollIntervalMs(state: TransitGuideState): Int {
    if (state.phase == TransitPhase.done || state.signal == TransitSignal.untrackable) return 0
    // 확정 도착(관측·선언) 뒤의 폴은 상태를 바꿀 수 없다(backOnTrack은 추정 도착만) — 예산만 쓴다(A37 ②).
    if (state.phase == TransitPhase.arrived && state.arrivedCertain) return 0
    // 비관측 잠금의 riding(A34 ①): 매칭하지 않기로 한 목록을 읽지 않는다.
    val lock = state.lock
    if (state.phase == TransitPhase.riding && lock != null && transitLockIsUnobserved(lock)) return 0
    if (state.capAnnounced) return 60_000
    // boarding은 waiting과 같은 엔드포인트(승차 정류소)라 같은 주기.
    if (state.phase == TransitPhase.waiting || state.phase == TransitPhase.boarding) return 20_000
    // A41(설계 리뷰 M2): riding 첫 조회 한 번만 15초 — 서울버스 승격이 "곧 도착 뒤 소실"로 밀려 첫 하차 정류소 폴이
    // 60초 뒤면 짧은 구간의 하차 신호를 통째로 놓친다. 즉폴이 아닌 이유는 승격 문장의 지연 슬롯을 침범하지 않기 위해서.
    if (state.phase == TransitPhase.riding && !state.trackingAnnounced && state.ridingPolls == 0) return 15_000
    if (transitSeoulBusArrivedAfterSoon(state)) return 60_000
    // riding·arrived(재관측 감시): 미등장 60s / 추적 중 15s(§12 — 원거리 30s 폐지).
    return if (state.trackingAnnounced) 15_000 else 60_000
}

enum class TransitGuideTone {
    start, ladder, imminent, arrive, weak;

    val rawValue: String get() = name
}

/** `transitEventProfile` 결과(Swift 튜플 `(interrupt, tone)` 대응). */
data class TransitEventProfile(val interrupt: Boolean, val tone: TransitGuideTone?)

/** 이벤트 → 통지 채널·톤 매핑(§6.1). 잔여 1·도착만 interrupting. */
fun transitEventProfile(event: TransitGuideEvent): TransitEventProfile = when (event) {
    is TransitGuideEvent.Countdown ->
        if (event.remaining <= 1) TransitEventProfile(true, TransitGuideTone.imminent) else TransitEventProfile(false, TransitGuideTone.ladder)
    // 내 정류소에 거의 왔다 — 지금 움직여야 하는 신호(riding 사다리와 같은 축).
    is TransitGuideEvent.Approaching ->
        if ((event.remaining ?: Int.MAX_VALUE) <= 1) TransitEventProfile(true, TransitGuideTone.imminent) else TransitEventProfile(false, TransitGuideTone.ladder)
    // 곧 온다/곧 내린다 — 잔여 ≤1 사다리와 같은 축(A41).
    TransitGuideEvent.ArrivingAtBoardStop, TransitGuideEvent.ArrivingAtAlightStop -> TransitEventProfile(true, TransitGuideTone.imminent)
    is TransitGuideEvent.Arrived -> TransitEventProfile(true, TransitGuideTone.arrive)
    // 도착 관측은 "지금 타라"라 interrupting, 선언·출발 관측(departed)은 사용자가 이미 행동한 뒤라 기본.
    is TransitGuideEvent.Boarded -> TransitEventProfile(event.cause == TransitBoardedCause.observed, TransitGuideTone.start)
    // 마지막 구간 완료는 여정 종료라 도착 종(도보 도착 동형). 중간 구간은 다음 구간 시작.
    is TransitGuideEvent.LegAdvanced -> TransitEventProfile(false, if (event.final) TransitGuideTone.arrive else TransitGuideTone.start)
    TransitGuideEvent.VehiclePassed -> TransitEventProfile(false, TransitGuideTone.weak)
    is TransitGuideEvent.TrackingStarted -> TransitEventProfile(false, TransitGuideTone.ladder)
    TransitGuideEvent.SignalLost, TransitGuideEvent.NeverSeen, TransitGuideEvent.UpstreamFailed ->
        TransitEventProfile(false, TransitGuideTone.weak)
    else -> TransitEventProfile(false, null)
}

// === 노선 매핑표 (§5.1) — 웹 ODSAY_SUBWAY_LINES 미러 ===

private val odsaySubwayLines: Map<String, String> = mapOf(
    "1호선" to "1001", "2호선" to "1002", "3호선" to "1003", "4호선" to "1004",
    "5호선" to "1005", "6호선" to "1006", "7호선" to "1007", "8호선" to "1008",
    "9호선" to "1009", "GTX-A" to "1032", "중앙선" to "1061", "경의중앙선" to "1063",
    "공항철도" to "1065", "경춘선" to "1067", "수인분당선" to "1075", "신분당선" to "1077",
    "경강선" to "1081", "우이신설선" to "1092", "서해선" to "1093", "신림선" to "1094",
)

private val EXPRESS_SUFFIX = Regex("""\(급행\)[ \t\n\r]*$""")
private val LINE_SEPARATORS = Regex("""[.· \t\n\r]""")

private fun subwayLineCore(name: String): String {
    var s = name
    if (s.startsWith("수도권")) s = s.substring("수도권".length)
    // ODsay 급행 lane은 이름 끝에 "(급행)"을 붙인다(웹 subwayLineCore 미러 — 근거 주석은 그쪽 정본). 괄호 일반이 아니라
    // 이 한 토큰만 벗긴다.
    s = EXPRESS_SUFFIX.replace(s, "")
    return LINE_SEPARATORS.replace(s, "").trim()
}

/** ODsay 지하철 노선명 → 서울 실시간 subwayId(미수록 = 실시간 미커버 = null). */
fun subwayIdForOdsayLine(lineName: String): String? = odsaySubwayLines[subwayLineCore(lineName)]

// === 경로 조립 (§4.1) — Kit TransitRoute(API 디코딩)에서 안내 경로로 ===

/** 탑승 leg의 추적 수단 분류(§5.1 매핑표·§5.2 판별자). 웹 classifyTrackMode 미러. */
fun classifyTransitTrackMode(
    mode: String,
    lineName: String,
    serviceRouteId: String?,
    boardStop: TransitLegStop?,
    alightStop: TransitLegStop?,
): TransitTrackMode? {
    if (mode == "subway") return if (subwayIdForOdsayLine(lineName) != null) TransitTrackMode.subway else null
    val topis = serviceRouteId != null &&
        boardStop?.cityCode == "1000" && alightStop?.cityCode == "1000" &&
        boardStop.arsId?.isEmpty() == false &&
        boardStop.localId?.isEmpty() == false &&
        alightStop.localId?.isEmpty() == false
    if (topis) return TransitTrackMode.seoulBus
    if (alightStop != null && lineName.isNotEmpty()) return TransitTrackMode.tagoBus
    return null
}

/** TransitRoute(+stops) → 안내 경로. 탑승 leg가 없으면 null(시작 게이트 축). */
fun buildTransitGuideRoute(route: TransitRoute): TransitGuideRoute? {
    val legs = ArrayList<TransitGuideLeg>()
    var pendingWalk: Int? = null
    for (leg in route.legs) {
        if (leg.mode == "walk") {
            pendingWalk = (pendingWalk ?: 0) + leg.minutes
            continue
        }
        val stops = leg.stops ?: emptyList()
        val boardStop = stops.firstOrNull()
        val alightStop = if (stops.size > 1) stops.last() else null
        legs.add(
            TransitGuideLeg(
                mode = leg.mode,
                lineName = leg.lineName ?: "",
                trackMode = classifyTransitTrackMode(leg.mode, leg.lineName ?: "", leg.serviceRouteId, boardStop, alightStop),
                boardName = leg.fromName ?: boardStop?.name ?: "",
                alightName = leg.toName ?: alightStop?.name ?: "",
                boardStop = boardStop,
                alightStop = alightStop,
                viaStops = stops,
                stationCount = leg.stationCount,
                routeId = leg.serviceRouteId,
                wayCode = leg.serviceWayCode,
                walkBeforeMinutes = pendingWalk,
                quickExit = leg.quickExit,
                // ⚠ ko/en 폴백 순서 짝(웹 주석과 같은 근거): ko가 `fromName`을 골랐으면 en도 `fromNameEn`만 본다. 원천이
                // 갈리면 같은 자리가 서로 다른 정류소를 가리킨다.
                lineNameEn = leg.lineNameEn,
                boardNameEn = if (leg.fromName != null) leg.fromNameEn else boardStop?.nameEn,
                alightNameEn = if (leg.toName != null) leg.toNameEn else alightStop?.nameEn,
                expressStops = leg.expressStops?.takeIf { it.isNotEmpty() },
                expressStopIds = leg.expressStopIds?.takeIf { it.isNotEmpty() },
                exitAlight = transitValidExitNo(leg.exit?.alight),
                minutes = leg.minutes,
            ),
        )
        pendingWalk = null
    }
    if (legs.isEmpty()) return null
    return TransitGuideRoute(legs, pendingWalk)
}

// === 승차 전 도보 핸드오프 판정 (A25, spec 2026-08-30 §3) — 순수, 웹 미러 ===

/** 첫 탑승 leg 앞 도보를 도보 실시간 안내로 돌릴 대상. null = 종전 경로(도보 없음·정보 결손). */
@Serializable
data class TransitPrewalkTarget(
    val name: String,
    /** 영문 승차역명(E27 잔여 ①) — 도보 세션 목적지 라벨·통지가 읽는다. 결측이면 그 줄은 ko. */
    val nameEn: String? = null,
    val lat: Double,
    val lng: Double,
    val minutes: Int,
)

/**
 * 하한은 `walkBeforeMinutes ≥ 1`(0분은 역 안 이동), 좌표는 유한·(0,0) 아님. 거리 축을 따로 두지 않는다(같은 정보의
 * 두 임계는 drift). 두 번째 leg 이후의 도보는 대상이 아니다.
 */
fun transitPrewalkTarget(route: TransitGuideRoute): TransitPrewalkTarget? {
    val leg = route.legs.firstOrNull() ?: return null
    val minutes = leg.walkBeforeMinutes ?: return null
    val stop = leg.boardStop ?: return null
    if (minutes < 1 || !stop.lat.isFinite() || !stop.lng.isFinite() || (stop.lat == 0.0 && stop.lng == 0.0)) return null
    return TransitPrewalkTarget(leg.boardName, leg.boardNameEn, stop.lat, stop.lng, minutes)
}

/**
 * 도보를 안내로 소비한 뒤의 경로 — legs[0].walkBeforeMinutes만 null. 값 타입 재구성(원본 불변). 대기 문맥·조망·
 * legAdvanced가 같은 필드를 읽으므로 한 곳에서 지운다(문장마다 분기 금지). Kotlin은 `copy`라 필드가 늘어도 빠뜨리지 않는다.
 */
fun withoutPrewalk(route: TransitGuideRoute): TransitGuideRoute {
    val first = route.legs.firstOrNull() ?: return route
    return route.copy(legs = listOf(first.copy(walkBeforeMinutes = null)) + route.legs.drop(1))
}

// === 열차 선택 목록 필터 (§5.1) — 순수 판정, 시트가 소비 ===

/** 급행 후보의 하차역 정차 판정(A16 L1, spec 2026-09-02 §4.2, 웹 `ExpressVerdict` 미러). */
enum class TransitExpressVerdict {
    skips, stops, unknown;

    val rawValue: String get() = name
}

/** 활성화 차단의 단일 사유(웹 `UnreachableReason` 미러) — 소비자는 `unreachable != null`로만 버튼을 만들지 않는다. */
enum class TransitUnreachableReason {
    terminatesEarly, expressSkipsAlight;

    val rawValue: String get() = name
}

/**
 * 승차 후보 한 건. 목록 정체성 키는 소비자(시트·패널) 몫 — vehId, 없으면 슬롯 위치 폴백(§13.4. 종전 완성 문장 폴백은
 * 문장 갱신마다 remount를 만들어 폐기).
 */
data class TransitBoardingCandidate(
    val item: TransitTrackItem,
    /** 결정적 미도달 사유(종착 앞 / 급행 통과). null이면 선택 가능. 겹치면 종착이 앞이다. */
    val unreachable: TransitUnreachableReason?,
    /** 급행 판정. 급행이 아니면 null. */
    val express: TransitExpressVerdict?,
    val directionMatched: Boolean,
)

/**
 * 2호선 계열 방향 표기. 내선·외선은 2호선 본선 순환과 두 지선(성수·신정)만 쓰고, **그 계열의 종착 필드는 잔여 경로
 * 판정에 쓸 수 없다**(실호출 2026-08-16 — 본선 종착은 상수 "성수", 지선 종착은 지선 라벨이거나 그 지선의 종점).
 * 웹 isLine2Direction 미러.
 */
private fun isLine2Direction(updnLine: String): Boolean = updnLine == "내선" || updnLine == "외선"

/**
 * wayCode(1 상행·2 하행) ↔ updnLine 원문 대응. **실호출로 확정한 표기만 판정**하고 나머지는 유보한다(오필터가 과노출보다
 * 나쁘다). 순환선 대응(내선=2·외선=1)은 2026-08-16 실호출로 확정했다. 웹 directionMatchesWayCode 미러.
 */
private fun directionMatchesWayCode(updnLine: String, wayCode: Int?): Boolean? {
    if (wayCode == null) return null
    return when (updnLine) {
        "상행", "외선" -> wayCode == 1
        "하행", "내선" -> wayCode == 2
        else -> null
    }
}

/** `classifyTransitBoardingCandidates` 결과(Swift 튜플 `(candidates, directionUncertain)` 대응). */
data class TransitBoardingClassification(val candidates: List<TransitBoardingCandidate>, val directionUncertain: Boolean)

/**
 * 승차 목록 후보 판정(§5.1): 방향은 보조(전멸 시 전체 유지), 종착 검사만 결정적 차단.
 *
 * `directionUncertain`은 **"방향 축이 있는데 매칭이 전멸했다"**로 좁힌다(A17). 후보 전원의 `direction`이 비어 있으면
 * (버스 — upstream이 방향 필드를 주지 않는다) 방향 축 자체가 없는 것이라 uncertain이 아니다. 웹 classifyBoardingCandidates 미러.
 */
fun classifyTransitBoardingCandidates(items: List<TransitTrackItem>, leg: TransitGuideLeg): TransitBoardingClassification {
    val decorated = items.map { item ->
        TransitBoardingCandidate(
            item = item,
            unreachable = transitUnreachableReason(item, leg),
            express = transitExpressVerdict(item, leg),
            directionMatched = directionMatchesWayCode(item.direction, leg.wayCode) == true,
        )
    }
    val anyMatched = decorated.any { it.directionMatched }
    val hasDirectionAxis = decorated.any { it.item.direction.isNotEmpty() }
    val candidates = if (anyMatched) decorated.filter { it.directionMatched } else decorated
    return TransitBoardingClassification(candidates, hasDirectionAxis && !anyMatched)
}

/**
 * 급행 판정(웹 `expressVerdict` 미러). **ID 판정이 1순위**(`expressStopIds` ∧ `alightStop.stationId`, 정규화 없음),
 * 이름 판정은 폴백이고 자격이 붙는다: ⓐ하차역 이름이 `viaStops` 표기와 조인되고 ⓑ집합이 `viaStops`와 이름을 공유해야
 * 한다 — 그 밖의 미포함은 별칭일 수 있어 `unknown`.
 */
fun transitExpressVerdict(item: TransitTrackItem, leg: TransitGuideLeg): TransitExpressVerdict? {
    if (!item.express) return null
    // `""` ID는 부재다(웹 falsy 미러) — `contains("")`가 거짓 차단이 되지 않게.
    val ids = leg.expressStopIds
    val alightId = leg.alightStop?.stationId
    if (!ids.isNullOrEmpty() && !alightId.isNullOrEmpty()) {
        return if (alightId in ids) TransitExpressVerdict.stops else TransitExpressVerdict.skips
    }
    val names = leg.expressStops
    if (names.isNullOrEmpty()) return TransitExpressVerdict.unknown
    val alight = normalizeStopName(leg.alightName)
    if (alight.isEmpty()) return TransitExpressVerdict.unknown
    val viaNames = leg.viaStops.map { normalizeStopName(it.name) }.toSet()
    val expressNames = names.map(::normalizeStopName).toSet()
    if (alight !in viaNames) return TransitExpressVerdict.unknown // ⓐ
    if (expressNames.none { it in viaNames }) return TransitExpressVerdict.unknown // ⓑ
    return if (alight in expressNames) TransitExpressVerdict.stops else TransitExpressVerdict.skips
}

/** "이미 탔습니다"에서 급행 확인을 물어야 하는 leg인가 — 급행 집합이 있는 노선만(spec §6, 웹 미러). */
fun transitNeedsExpressPrompt(leg: TransitGuideLeg): Boolean =
    !leg.expressStopIds.isNullOrEmpty() || !leg.expressStops.isNullOrEmpty()

/** 사용자가 "급행"이라 선언했을 때의 하차역 정차 판정 — 후보 항목 없이 leg만으로(§6, 웹 미러). */
fun transitDeclaredExpressVerdict(leg: TransitGuideLeg): TransitExpressVerdict? = transitExpressVerdict(
    TransitTrackItem(vehicleId = null, direction = "", message = "", remainingStops = null, destinationName = null, express = true, arrivalCode = null),
    leg,
)

/**
 * 결정적 미도달 사유(단일 술어, 웹 `unreachableReason` 미러). 2호선 계열은 종착 축에서만 제외되고 급행 축은 순환선과
 * 무관하다. 선택 진입점도 이 함수로 다시 판정한다.
 */
fun transitUnreachableReason(item: TransitTrackItem, leg: TransitGuideLeg): TransitUnreachableReason? {
    val terminates = if (isLine2Direction(item.direction)) false else transitTerminatesBeforeAlight(item.destinationName, leg)
    if (terminates) return TransitUnreachableReason.terminatesEarly
    if (transitExpressVerdict(item, leg) == TransitExpressVerdict.skips) return TransitUnreachableReason.expressSkipsAlight
    return null
}

private val STOP_NAME_PARENTHETICAL = Regex("""[ \t\n\r]*\([^)]*\)""")

/** 역명 표기 차이 흡수(부역명 괄호·"역" 접미) — 종착 검사·현재 위치 매칭 공용. */
internal fun normalizeStopName(s: String): String {
    var out = STOP_NAME_PARENTHETICAL.replace(s, "")
    if (out.endsWith("역")) out = out.dropLast(1)
    return out.trim()
}

/**
 * 경유 목록에서 현재 위치 역명(arvlMsg3, §12.2)의 인덱스(§14.1 경유역 탑승 위치). 지하철 잠금 추적에서만 값이 오고,
 * 미매칭(노선 밖 표기·버스)은 무표기가 정답이라 null. 표기 차이는 종착 검사와 같은 정규화로 흡수한다.
 */
fun viaStopCurrentIndex(leg: TransitGuideLeg, currentLocation: String?): Int? {
    if (currentLocation == null) return null
    val target = normalizeStopName(currentLocation)
    if (target.isEmpty()) return null
    return leg.viaStops.indexOfFirst { normalizeStopName(it.name) == target }.takeIf { it >= 0 }
}

/** 종착역이 경유 목록에서 하차역보다 앞이면 그 열차는 하차역에 가지 않는다(§5.1). */
fun transitTerminatesBeforeAlight(destinationName: String?, leg: TransitGuideLeg): Boolean {
    if (destinationName == null || leg.viaStops.isEmpty()) return false
    val dest = normalizeStopName(destinationName)
    val destIdx = leg.viaStops.indexOfFirst { normalizeStopName(it.name) == dest }
    val alight = normalizeStopName(leg.alightName)
    val alightIdx = leg.viaStops.indexOfFirst { normalizeStopName(it.name) == alight }
    if (destIdx < 0 || alightIdx < 0) return false
    return destIdx < alightIdx
}

// === 상태 머신 ===

/** 세션 시작 상태 — legIndex 0의 waiting. 시작 통지는 오케스트레이터 몫. */
fun initTransitGuide(route: TransitGuideRoute, @Suppress("UNUSED_PARAMETER") now: Double): TransitGuideState = TransitGuideState(
    legIndex = 0,
    phase = TransitPhase.waiting,
    phaseGen = 0,
    lastSeq = 0,
    signal = if (route.legs.firstOrNull()?.trackMode != null) TransitSignal.notYetVisible else TransitSignal.untrackable,
    lock = null,
    previousLock = null,
    previousPhase = null,
    remaining = null,
    lastMessage = null,
    lastMessageEn = null,
    lastArrivalCode = null,
    lastUpdatedAt = null,
    currentLocation = null,
    dataStamp = null,
    dataAgeSeconds = null,
    arrivedCertain = false,
    ladderAnnounced = null,
    trackingAnnounced = false,
    ridingPolls = 0,
    missCount = 0,
    failCount = 0,
    failSince = null,
    pollCount = 0,
    capAnnounced = false,
)

/** 복합 키 매칭(§4.2): 식별자 원문 동일 ∧ 방향(양측 보유 시) 동일. */
fun transitLockMatches(item: TransitTrackItem, lock: TransitLock): Boolean {
    val vid = item.vehicleId
    if (vid.isNullOrEmpty() || vid != lock.vehicleId) return false
    if (item.direction.isNotEmpty() && lock.direction.isNotEmpty() && item.direction != lock.direction) return false
    return true
}

/** `transitGuideStep` 결과(Swift 튜플 `(state, event)` 대응). */
data class TransitGuideStepResult(val state: TransitGuideState, val event: TransitGuideEvent?)

fun transitGuideStep(state: TransitGuideState, input: TransitGuideInput, route: TransitGuideRoute, now: Double): TransitGuideStepResult =
    when (input) {
        is TransitGuideInput.Board -> handleBoard(state, input.lock)
        TransitGuideInput.ConfirmBoarded -> handleConfirmBoarded(state)
        TransitGuideInput.RestoreBoarding -> handleRestoreBoarding(state)
        TransitGuideInput.ChangeBoarding -> handleChangeBoarding(state)
        TransitGuideInput.Advance -> handleAdvance(state, route)
        TransitGuideInput.DeclareArrived -> handleDeclareArrived(state)
        is TransitGuideInput.BoardAboard -> handleBoardAboard(state, input.lock)
        is TransitGuideInput.Poll -> handlePoll(state, input.seq, input.phaseGen, input.poll, now)
    }

/**
 * 하차역 선언(A37 ②) — 사용자가 "지금 하차역을 지나고 있다"고 답했다. 확정 도착: 선언은 되돌릴 대상이 아니라 `certain`이고
 * (추정이면 늦은 폴의 재관측이 `backOnTrack`으로 riding에 되돌린다 — 막다른 길의 재진입), 세대를 올려 선언 전에 나간 폴의
 * 응답을 폐기한다. `lock`은 유지(급행 선언 상시 문장의 근거). 웹 `handleDeclareArrived` 미러.
 */
private fun handleDeclareArrived(state: TransitGuideState): TransitGuideStepResult {
    if ((state.phase != TransitPhase.waiting && state.phase != TransitPhase.riding) || state.signal == TransitSignal.untrackable) {
        return TransitGuideStepResult(state, null)
    }
    val next = resetLockTracking(state).copy(
        phase = TransitPhase.arrived,
        phaseGen = state.phaseGen + 1,
        arrivedCertain = true,
        ridingPolls = 0,
        lastUpdatedAt = null,
    )
    return TransitGuideStepResult(next, TransitGuideEvent.Arrived(certain = true))
}

/**
 * "이미 탔습니다" 흐름의 식별 잠금(A34 ②) — 지나는 역의 목록에서 고른 열차로 riding 직행. 근사 잠금은 이 입력의 대상이
 * 아니다(그쪽은 `board`의 종전 경로). 웹 `handleBoardAboard` 미러.
 */
private fun handleBoardAboard(state: TransitGuideState, lock: TransitLock): TransitGuideStepResult {
    if (state.phase != TransitPhase.waiting || state.signal == TransitSignal.untrackable || isApproxTransitLock(lock)) {
        return TransitGuideStepResult(state, null)
    }
    return enterRiding(state, lock, TransitBoardedCause.declared)
}

/**
 * 잠금 추적 필드 초기화(국면 진입 공용). failCount/failSince도 함께 비운다 — 폴링 대상이 바뀌는 전이(boarding→riding)에서
 * 이전 대상의 실패 이력을 이월하면 새 대상 첫 실패가 곧장 upstreamFailed가 된다(설계 리뷰 M6).
 */
private fun resetLockTracking(state: TransitGuideState): TransitGuideState = state.copy(
    remaining = null,
    lastMessage = null,
    lastMessageEn = null,
    lastArrivalCode = null,
    lastUpdatedAt = null,
    currentLocation = null,
    dataStamp = null,
    dataAgeSeconds = null,
    arrivedCertain = false,
    ladderAnnounced = null,
    trackingAnnounced = false,
    missCount = 0,
    failCount = 0,
    failSince = null,
)

/** riding 진입 — 미관측 상한 카운터(`ridingPolls`, A16 L2·A36 ①)를 0에서 다시 센다(탑승 변경 취소 복귀 포함). */
private fun enterRiding(state: TransitGuideState, lock: TransitLock, cause: TransitBoardedCause): TransitGuideStepResult {
    val next = resetLockTracking(state).copy(
        phase = TransitPhase.riding,
        phaseGen = state.phaseGen + 1,
        signal = TransitSignal.notYetVisible,
        lock = lock,
        previousLock = null,
        previousPhase = null,
        ridingPolls = 0,
    )
    return TransitGuideStepResult(next, TransitGuideEvent.Boarded(state.legIndex, cause))
}

/** boarding 진입 — 승차 정류소 폴링은 riding 카운터에 세지 않는다(0 유지). */
private fun enterBoarding(state: TransitGuideState, lock: TransitLock): TransitGuideStepResult {
    val next = resetLockTracking(state).copy(
        phase = TransitPhase.boarding,
        phaseGen = state.phaseGen + 1,
        signal = TransitSignal.notYetVisible,
        lock = lock,
        previousLock = null,
        previousPhase = null,
        ridingPolls = 0,
    )
    return TransitGuideStepResult(next, TransitGuideEvent.VehicleSelected(state.legIndex))
}

/** "탑승" = 차량 선택(N3). 근사 잠금(tagoBus·"이미 탔습니다")만 종전대로 riding — 식별자가 없어 고를 차량도, 기다릴 도착도 없다. */
private fun handleBoard(state: TransitGuideState, lock: TransitLock): TransitGuideStepResult {
    if (state.phase != TransitPhase.waiting || state.signal == TransitSignal.untrackable) return TransitGuideStepResult(state, null)
    return if (isApproxTransitLock(lock)) enterRiding(state, lock, TransitBoardedCause.declared) else enterBoarding(state, lock)
}

private fun handleConfirmBoarded(state: TransitGuideState): TransitGuideStepResult {
    val lock = state.lock
    if (state.phase != TransitPhase.boarding || lock == null) return TransitGuideStepResult(state, null)
    return enterRiding(state, lock, TransitBoardedCause.declared)
}

/** 탑승 변경 취소 — 해제 전 국면으로 복귀(boarding이면 다시 승차 정류소 대기). */
private fun handleRestoreBoarding(state: TransitGuideState): TransitGuideStepResult {
    val lock = state.previousLock
    if (state.phase != TransitPhase.waiting || lock == null) return TransitGuideStepResult(state, null)
    if (state.previousPhase == TransitPhase.boarding) return enterBoarding(state, lock)
    return enterRiding(state, lock, TransitBoardedCause.declared)
}

private fun handleChangeBoarding(state: TransitGuideState): TransitGuideStepResult {
    if (state.phase != TransitPhase.boarding && state.phase != TransitPhase.riding && state.phase != TransitPhase.arrived) {
        return TransitGuideStepResult(state, null)
    }
    // 확정 도착(관측·선언) 뒤의 탑승 변경은 없다(A37 ② 리뷰 관찰): 허용하면 previousPhase = riding으로 복귀해 선언이 막은
    // 막다른 길이 되살아난다. UI가 arrived에서 그 버튼을 세우지 않지만 리듀서가 막는다.
    if (state.phase == TransitPhase.arrived && state.arrivedCertain) return TransitGuideStepResult(state, null)
    val next = state.copy(
        phase = TransitPhase.waiting,
        phaseGen = state.phaseGen + 1,
        lock = null,
        // 직전 잠금·국면 보존(§13.1) — "탑승 변경 취소"(restoreBoarding)의 복귀 대상.
        previousLock = state.lock,
        previousPhase = if (state.phase == TransitPhase.boarding) TransitPhase.boarding else TransitPhase.riding,
        remaining = null,
        lastMessage = null,
        lastMessageEn = null,
        lastArrivalCode = null,
        currentLocation = null,
        dataStamp = null,
        dataAgeSeconds = null,
        arrivedCertain = false,
        ladderAnnounced = null,
        trackingAnnounced = false,
        // 대기 국면엔 카운터가 없다 — 다음 riding 진입이 0에서 다시 센다.
        ridingPolls = 0,
        missCount = 0,
    )
    return TransitGuideStepResult(next, TransitGuideEvent.BoardingReset)
}

/** advance가 유효한 국면(§4.2): arrived 확인 / 추적 불가 수동 전진 / 근사 잠금 상시(§13.2). */
private fun canAdvance(state: TransitGuideState): Boolean {
    if (state.phase == TransitPhase.arrived) return true
    if (state.signal == TransitSignal.untrackable) return true
    val lock = state.lock ?: return false
    return state.phase == TransitPhase.riding && isApproxTransitLock(lock)
}

/**
 * 다음 구간 전환 — 사용자 확인(§4.2 원자 전이). 유효 국면 밖의 advance는 no-op(UI 버튼 노출 조건에만 의존하면 웹·앱
 * 가드가 드리프트한다 — 독립 리뷰).
 */
private fun handleAdvance(state: TransitGuideState, route: TransitGuideRoute): TransitGuideStepResult {
    if (state.phase == TransitPhase.done || !canAdvance(state)) return TransitGuideStepResult(state, null)
    val nextIndex = state.legIndex + 1
    val final = nextIndex >= route.legs.size
    val signal = if (final) {
        state.signal
    } else if (route.legs[nextIndex].trackMode != null) {
        TransitSignal.notYetVisible
    } else {
        TransitSignal.untrackable
    }
    val next = state.copy(
        legIndex = if (final) state.legIndex else nextIndex,
        phase = if (final) TransitPhase.done else TransitPhase.waiting,
        phaseGen = state.phaseGen + 1,
        signal = signal,
        lock = null,
        previousLock = null,
        previousPhase = null,
        remaining = null,
        lastMessage = null,
        lastMessageEn = null,
        lastArrivalCode = null,
        lastUpdatedAt = null,
        currentLocation = null,
        dataStamp = null,
        dataAgeSeconds = null,
        arrivedCertain = false,
        ladderAnnounced = null,
        trackingAnnounced = false,
        // 다음 leg는 아직 승차 전이다.
        ridingPolls = 0,
        missCount = 0,
        failCount = 0,
        failSince = null,
    )
    return TransitGuideStepResult(next, TransitGuideEvent.LegAdvanced(if (final) state.legIndex else nextIndex, final))
}

private fun handlePoll(state: TransitGuideState, seq: Int, phaseGen: Int, poll: TransitTrackPoll, now: Double): TransitGuideStepResult {
    // 세대·순번 불일치 — 늦은 응답 폐기(§4.2).
    if (phaseGen != state.phaseGen || seq <= state.lastSeq) return TransitGuideStepResult(state, null)
    if (state.phase == TransitPhase.done || state.signal == TransitSignal.untrackable) return TransitGuideStepResult(state, null)

    var next = state.copy(lastSeq = seq, pollCount = state.pollCount + 1)
    var event: TransitGuideEvent? = null

    if (!next.capAnnounced && next.pollCount >= transitSessionPollCap) {
        next = next.copy(capAnnounced = true)
        event = TransitGuideEvent.CapSlowed
    }

    when (poll) {
        TransitTrackPoll.Failed, TransitTrackPoll.Unsupported -> {
            val failSince = next.failSince ?: now
            next = next.copy(failCount = next.failCount + 1, failSince = failSince)
            val notify = next.signal != TransitSignal.upstreamFailed &&
                (next.failCount >= transitFailNotifyCount || now - failSince >= transitFailNotifyMs)
            if (notify) return TransitGuideStepResult(next.copy(signal = TransitSignal.upstreamFailed), TransitGuideEvent.UpstreamFailed)
            return TransitGuideStepResult(next, event)
        }
        is TransitTrackPoll.Ok, TransitTrackPoll.Empty -> Unit
    }

    val recovered = next.signal == TransitSignal.upstreamFailed
    next = next.copy(failCount = 0, failSince = null)
    if (recovered) {
        next = next.copy(signal = if (state.trackingAnnounced) TransitSignal.signalLost else TransitSignal.notYetVisible)
        event = TransitGuideEvent.SignalRecovered
    }

    if (state.phase == TransitPhase.waiting) return TransitGuideStepResult(next.copy(lastUpdatedAt = now), event)

    // 비관측 잠금(A34 ①): 매칭·미등장 판정을 지나지 않는다 — trackingStarted·countdown·approxVehicleChanged·signalLost·
    // neverSeen이 구조적으로 나지 않는다(표시만 가리면 톤 계층이 잔여 앵커로 소리를 낸다). 폴 주기 0이라 정상 경로에선
    // 도달하지 않는 방어선.
    val lock = state.lock
    if (state.phase == TransitPhase.riding && lock != null && transitLockIsUnobserved(lock)) {
        return TransitGuideStepResult(next.copy(lastUpdatedAt = now), event)
    }

    // A36 ①: riding에서 결과를 받은 조회를 센다(실패 폴은 위에서 반환됐다). 국면 가드가 필수다 — 이 자리는 boarding·추정
    // arrived 폴도 지나는데, enterRiding이 0으로 리셋해 실해는 없어도 필드 이름("riding 조회 수")을 거짓으로 만든다.
    if (next.phase == TransitPhase.riding) next = next.copy(ridingPolls = next.ridingPolls + 1)
    val items = if (poll is TransitTrackPoll.Ok) poll.items else emptyList()
    val matched = lock?.let { transitFindLockedItem(items, it) }

    if (state.phase == TransitPhase.boarding) {
        if (matched != null) return commitBoardingMatched(next, state, matched, event, now)
        return boardingUnmatched(next, state, event, now)
    }

    if (matched != null) return commitMatched(next, state, matched, event, now)

    if (!next.trackingAnnounced) {
        // ⚠ neverSeen을 이 목록에서 빼면 매 폴마다 notYetVisible로 되돌아가 아래 1회성 가드가 무력화된다(반복 발화).
        // 확정된 신호는 여기서 덮지 않는다.
        if (next.signal != TransitSignal.upstreamFailed && next.signal != TransitSignal.signalLost && next.signal != TransitSignal.neverSeen) {
            next = next.copy(signal = TransitSignal.notYetVisible)
        }
        next = next.copy(lastUpdatedAt = now)
        // 그 상태를 빠져나오는 문(A16 L2). 판정하지 않는 경우 둘: 방금 조회가 살아난 폴(recovered — 최소 한 번은 실제로
        // 보고 말한다, 그리고 signalRecovered를 덮지 않는다) · 원인이 다른 신호. 축은 조회 횟수(A36 ①) — 시계가 아니다.
        // ⚠ phase == riding은 현재 **도달 불가 방어**다(위 waiting 조기 반환 + boarding 분기). 검증된 가드가 아니라는
        // 사실을 알고 남긴다(불변식의 자립적 표현).
        if (!recovered && next.signal == TransitSignal.notYetVisible && next.phase == TransitPhase.riding &&
            next.ridingPolls >= transitNeverSeenPolls
        ) {
            return TransitGuideStepResult(next.copy(signal = TransitSignal.neverSeen), TransitGuideEvent.NeverSeen)
        }
        return TransitGuideStepResult(next, event)
    }
    next = next.copy(missCount = next.missCount + 1, lastUpdatedAt = now)
    // 근사 잠금은 도착 추정 제외(§13.2 — 식별자가 없어 "소실"이 하차 신호가 아니다).
    val remaining = state.remaining
    if (state.phase == TransitPhase.riding && remaining != null && remaining <= 1 &&
        next.missCount >= transitMissArriveCount && lock != null && !isApproxTransitLock(lock)
    ) {
        return TransitGuideStepResult(next.copy(phase = TransitPhase.arrived, arrivedCertain = false), TransitGuideEvent.Arrived(certain = false))
    }
    // A41(설계 리뷰 M1): 서울버스 "0을 본 뒤의 추정 도착"에선 소실 지속이 예상된 후속이라 signalLost를 내지 않는다 — 내리는
    // 중에 "차량 신호를 찾지 못하고 있습니다"가 거짓이 된다. 웹 미러.
    if (transitSeoulBusArrivedAfterSoon(state)) return TransitGuideStepResult(next, event)
    if (next.missCount >= transitMissLostCount && next.signal != TransitSignal.signalLost) {
        return TransitGuideStepResult(next.copy(signal = TransitSignal.signalLost), TransitGuideEvent.SignalLost)
    }
    return TransitGuideStepResult(next, event)
}

/** 매칭 커밋 공통 필드(새 관측으로 추적 상태를 갱신). 동결 stamp 감지 규칙은 두 호출부가 같다. */
private fun trackedFrom(next: TransitGuideState, base: TransitGuideState, item: TransitTrackItem, now: Double): TransitGuideState =
    next.copy(
        signal = TransitSignal.tracking,
        missCount = 0,
        remaining = item.remainingStops,
        lastMessage = item.message,
        lastMessageEn = item.messageEn,
        lastArrivalCode = item.arrivalCode,
        lastUpdatedAt = now,
        currentLocation = item.currentLocation,
        dataStamp = item.dataStamp,
        // stamp 동결 감지(신분당선형): 같은 stamp인데 문장이 갱신됐다면 recptnDt 고장 — 그 나이는 거짓 정밀이라 null(§12.1).
        dataAgeSeconds = if (item.dataStamp != null && item.dataStamp == base.dataStamp) null else item.dataAgeSeconds,
        trackingAnnounced = true,
    )

/** 동일 스냅숏 무정보 폴(§12.1): recptnDt와 완성 문장이 직전 커밋과 같다. ⚠ 문장 동일 조건 필수(신분당선은 stamp 동결 + 문장 갱신). */
private fun isSameSnapshot(item: TransitTrackItem, base: TransitGuideState): Boolean =
    item.dataStamp != null && item.dataStamp == base.dataStamp && item.message == base.lastMessage

/**
 * boarding 매칭(승차 정류소 기준 도착 정보, N3 spec §3.3). riding의 commitMatched와 달리 ①동일 스냅숏도 missCount를
 * 올리고(동결 레코드가 국면을 영구 고착시키는 것을 막는다 — 이 국면엔 neverSeen 축이 없다) ②도착 관측(지하철)이 riding
 * 승격이다 — 서울버스는 잔여 0이 임박이고 승격은 그 뒤 소실(A41, boardingUnmatched). 웹 commitBoardingMatched 미러.
 */
private fun commitBoardingMatched(
    next: TransitGuideState,
    base: TransitGuideState,
    item: TransitTrackItem,
    carriedEvent: TransitGuideEvent?,
    now: Double,
): TransitGuideStepResult {
    if (isSameSnapshot(item, base)) {
        return TransitGuideStepResult(
            next.copy(missCount = base.missCount + 1, lastUpdatedAt = now, dataAgeSeconds = item.dataAgeSeconds),
            carriedEvent,
        )
    }
    val prevRemaining = base.remaining
    val wasTracking = base.trackingAnnounced
    var out = trackedFrom(next, base, item, now)

    // A41(spec 2026-09-12 §0): 서울버스 잔여 0("곧 도착")은 **직전 정류소 출발**이지 정차가 아니다(정차 신호가 API에 없다).
    // 임박 1회(`ladderAnnounced = 0` 래치)만 내고 국면을 유지한다. 승격은 그 뒤 소실(boardingUnmatched)이 맡는다. 첫
    // 관측이 곧 잔여 0이어도 이 문장이 "추적합니다"보다 먼저다(재선택 직후 실사고 2026-09-11 20:43).
    if (base.lock?.mode == TransitTrackMode.seoulBus && item.remainingStops == 0) {
        // 래치 0은 매칭 커밋에서만 서고 리셋 전이는 trackingAnnounced와 함께 지우므로 "첫 관측인데 래치 0"은 없다.
        val announced = base.ladderAnnounced == 0
        out = out.copy(ladderAnnounced = 0)
        if (!announced) return TransitGuideStepResult(out, TransitGuideEvent.ArrivingAtBoardStop)
        if (base.signal == TransitSignal.signalLost && carriedEvent == null) return TransitGuideStepResult(out, TransitGuideEvent.SignalRecovered)
        return TransitGuideStepResult(out, carriedEvent)
    }
    // 도착 관측 = riding 승격(지하철 진입 0·도착 1). 출발 2는 제외 — 이미 떠난 열차에 "탑승하세요"를 말하지 않는다. 동결
    // 레코드(나이 > transitBoardStopFreshSeconds)는 도착으로 보지 않는다(설계 리뷰 C3·M1).
    val fresh = (item.dataAgeSeconds ?: 0) <= transitBoardStopFreshSeconds
    val arrivedAtBoardStop = base.lock?.mode == TransitTrackMode.subway && (item.arrivalCode == "0" || item.arrivalCode == "1")
    val lock = base.lock
    if (lock != null && fresh && arrivedAtBoardStop) return enterRiding(out, lock, TransitBoardedCause.observed)

    // 첫 관측 — signalLost 뒤의 재발견도 이 문장이 이긴다(문장 자체가 "찾았다", 리뷰 M4).
    if (!wasTracking) {
        return TransitGuideStepResult(
            out.copy(ladderAnnounced = item.remainingStops),
            TransitGuideEvent.Approaching(item.remainingStops, item.message, item.messageEn),
        )
    }
    val remaining = item.remainingStops
    if (remaining == null) {
        val last = base.lastMessage
        if (last != null && item.message != last) {
            return TransitGuideStepResult(out, TransitGuideEvent.MessageChanged(item.message, item.messageEn, item.arrivalCode))
        }
        return TransitGuideStepResult(out, carriedEvent)
    }
    val latch = out.ladderAnnounced
    if (remaining <= transitLadderMax && remaining >= 0 && (latch == null || remaining < latch) &&
        prevRemaining != null && remaining < prevRemaining
    ) {
        return TransitGuideStepResult(
            out.copy(ladderAnnounced = remaining),
            TransitGuideEvent.Approaching(remaining, item.message, item.messageEn),
        )
    }
    if (base.signal == TransitSignal.signalLost && carriedEvent == null) return TransitGuideStepResult(out, TransitGuideEvent.SignalRecovered)
    return TransitGuideStepResult(out, carriedEvent)
}

/**
 * boarding 미등장 — 선택 시점에 목록에 있던 차량이라 첫 관측 전에도 센다. **순서가 곧 3-state다**: ①signalLost면 조기
 * 반환(장애 구간에 걸친 소실은 어떤 증거도 아니다) ②서울버스 잔여 0을 본 뒤의 연속 미등장 = 서고 떠났다 → riding
 * 승격(departed, A41) ③잔여 1(0 미관측)에서 사라지면 "지나갔을 수 있다"(vehiclePassed)이지 탑승이 아니다 ④그 밖 연속
 * 미등장은 signalLost. ③④는 signalLost 상태로 떨어져 1회만 말하고, **그 신호가 곧 수동 진행 수단의 등장 조건이다**.
 * 웹 boardingUnmatched 미러.
 */
private fun boardingUnmatched(
    next: TransitGuideState,
    base: TransitGuideState,
    carriedEvent: TransitGuideEvent?,
    now: Double,
): TransitGuideStepResult {
    val out = next.copy(missCount = base.missCount + 1, lastUpdatedAt = now)
    if (out.signal == TransitSignal.signalLost) return TransitGuideStepResult(out, carriedEvent)
    // A41: 잔여 0("곧 도착")을 본 뒤의 소실 = 그 차량이 서고 떠났다 → riding 승격(departed). 놓쳤으면 [탑승 변경]이
    // boarding으로 되돌린다(restoreBoarding). 0을 못 본 소실은 "서고 떠났다"의 증거가 아니라 아래 vehiclePassed 그대로다.
    val lock = base.lock
    if (base.remaining == 0 && lock != null && lock.mode == TransitTrackMode.seoulBus && out.missCount >= transitMissArriveCount) {
        return enterRiding(out, lock, TransitBoardedCause.departed)
    }
    val remaining = base.remaining
    if (remaining != null && remaining <= 1 && out.missCount >= transitMissArriveCount) {
        return TransitGuideStepResult(out.copy(signal = TransitSignal.signalLost), TransitGuideEvent.VehiclePassed)
    }
    if (out.missCount >= transitMissLostCount) {
        return TransitGuideStepResult(out.copy(signal = TransitSignal.signalLost), TransitGuideEvent.SignalLost)
    }
    return TransitGuideStepResult(out, carriedEvent)
}

/**
 * 잠금 항목 매칭(리듀서 정본, 웹 `findLockedItem` 미러). 앱 계측이 같은 함수·같은 입력(dispatch 전 lock)으로 매칭
 * 여부를 기록한다 — 판정을 복제하면 드리프트한다(spec 2026-09-02 §3).
 */
fun transitFindLockedItem(items: List<TransitTrackItem>, lock: TransitLock): TransitTrackItem? {
    if (isApproxTransitLock(lock)) {
        // 근사(§5.2·§13.2): 방향 일치(양측 보유 시) 항목 중 최근접 접근 차량(잔여 최소). tagoBus는 방향이 ""라 무필터.
        // ⚠ 급행 선언 근사 잠금의 "급행 항목 우선" 분기는 2026-09-11 은퇴했다(A34 ①).
        val pool = items.filter { lock.direction.isEmpty() || it.direction.isEmpty() || it.direction == lock.direction }
        // Swift `min(by:)`처럼 동률이면 앞선 항목이다(`minByOrNull`도 첫 최소를 돌려준다).
        return pool.filter { it.remainingStops != null }.minByOrNull { it.remainingStops ?: Int.MAX_VALUE } ?: pool.firstOrNull()
    }
    return items.firstOrNull { transitLockMatches(it, lock) }
}

private fun commitMatched(
    next: TransitGuideState,
    base: TransitGuideState,
    item: TransitTrackItem,
    carriedEvent: TransitGuideEvent?,
    now: Double,
): TransitGuideStepResult {
    val prevRemaining = base.remaining
    val wasTracking = base.trackingAnnounced

    // 동일 스냅숏 무정보 폴(§12.1): phase·signal 불변, 이벤트 없음(동결 레코드 재등장의 재발화 차단).
    if (isSameSnapshot(item, base)) {
        // 무정보여도 매칭은 매칭 — 연속 미등장 카운터는 끊는다(독립 리뷰 MAJOR: 미리셋 시 미등장↔동결재등장 반복에서
        // signalLost·도착 추정 조기 오발화).
        return TransitGuideStepResult(next.copy(missCount = 0, lastUpdatedAt = now, dataAgeSeconds = item.dataAgeSeconds), carriedEvent)
    }

    var out = trackedFrom(next, base, item, now)

    // 도착 추정 상태에서 재관측 — riding 복귀(추정은 가역, §4.2).
    if (base.phase == TransitPhase.arrived && !base.arrivedCertain) {
        return TransitGuideStepResult(
            out.copy(phase = TransitPhase.riding),
            TransitGuideEvent.BackOnTrack(item.message, item.messageEn, item.arrivalCode),
        )
    }
    if (base.phase != TransitPhase.riding) return TransitGuideStepResult(out, carriedEvent)

    // 도착 관측(§4.2): 지하철 arvlCd "1"(도착)만 확정. 근사 잠금은 arrived 전이 없음(식별자가 없어 그 도착이 내 차량이라는
    // 확정이 불가능하다).
    val approx = base.lock?.let(::isApproxTransitLock) ?: false
    // A41: 서울버스 잔여 0("곧 도착")은 하차 정류소의 **직전 정류소 출발** — 차내 "이번 정류장" 방송 시점이지 도착이 아니다.
    // 임박 1회(`ladderAnnounced = 0` 래치)만 내고 riding 유지. 확정 도착은 없다 — 소실이 종전 도착 추정(가역)으로 간다.
    if (!approx && base.lock?.mode == TransitTrackMode.seoulBus && item.remainingStops == 0) {
        val announced = base.ladderAnnounced == 0
        out = out.copy(ladderAnnounced = 0)
        if (!announced) return TransitGuideStepResult(out, TransitGuideEvent.ArrivingAtAlightStop)
        if (base.signal == TransitSignal.signalLost && carriedEvent == null) return TransitGuideStepResult(out, TransitGuideEvent.SignalRecovered)
        return TransitGuideStepResult(out, carriedEvent)
    }
    val arrivedObserved = !approx && base.lock?.mode == TransitTrackMode.subway && item.arrivalCode == "1"
    if (arrivedObserved) {
        return TransitGuideStepResult(out.copy(phase = TransitPhase.arrived, arrivedCertain = true), TransitGuideEvent.Arrived(certain = true))
    }

    if (!wasTracking) {
        return TransitGuideStepResult(
            out.copy(ladderAnnounced = item.remainingStops),
            TransitGuideEvent.TrackingStarted(item.message, item.messageEn, item.remainingStops, item.arrivalCode),
        )
    }

    val remaining = item.remainingStops
    if (remaining == null) {
        // 잔여 추출 실패(§6.2) — 완성 문장 변화 통지로 폴백.
        val last = base.lastMessage
        if (last != null && item.message != last) {
            return TransitGuideStepResult(out, TransitGuideEvent.MessageChanged(item.message, item.messageEn, item.arrivalCode))
        }
        return TransitGuideStepResult(out, carriedEvent)
    }

    // 근사 기준 차량 교체(§5.2·§13.2): 잔여 역행 관측.
    if (approx && prevRemaining != null && remaining > prevRemaining) {
        return TransitGuideStepResult(out.copy(ladderAnnounced = null), TransitGuideEvent.ApproxVehicleChanged(item.message, item.messageEn))
    }

    // 사다리(§6.1): {3,2,1} 도달, 건너뜀은 현재 값 하나만, 증가에 래치 비가역.
    val latch = out.ladderAnnounced
    if (remaining <= transitLadderMax && remaining >= 0 && (latch == null || remaining < latch) &&
        prevRemaining != null && remaining < prevRemaining
    ) {
        return TransitGuideStepResult(
            out.copy(ladderAnnounced = remaining),
            TransitGuideEvent.Countdown(remaining, item.message, item.messageEn, item.currentLocation, item.currentLocationEn, item.arrivalCode),
        )
    }
    // 소실 후 재관측 회복(§4.2) — 상위 이벤트가 없을 때만.
    if (base.signal == TransitSignal.signalLost && carriedEvent == null) return TransitGuideStepResult(out, TransitGuideEvent.SignalRecovered)
    return TransitGuideStepResult(out, carriedEvent)
}

// === 승차 국면 지하철 상태줄 (A27) — 웹 `subwayRidingMessage` 미러 ===

/**
 * 지하철 `arvlMsg2`는 조회역(=하차역) 기준 열차 위치 서술이라 "{stop}까지 {message}" 틀에 넣으면 뜻이 뒤집힌다("충정로까지
 * 전역 도착", 위원장 실승차 2026-08-29). 승차 국면은 코드로 탑승자 시점 문장을 고른다. 99(운행중)는 잔여 수가 이미
 * 말하므로 생략, 미지·결측은 원문을 틀 없이 그대로. ⚠ 대기 국면 후보 목록·내 주변 도착 목록은 완성 문장 정본 불변 —
 * riding 상태줄뿐.
 */
sealed class SubwayRidingMessage {
    data class Key(val key: String) : SubwayRidingMessage()
    data object Omit : SubwayRidingMessage()
    data object Raw : SubwayRidingMessage()
}

fun subwayRidingMessage(arrivalCode: String?): SubwayRidingMessage = when (arrivalCode) {
    "0" -> SubwayRidingMessage.Key("subwayArriving")
    "1" -> SubwayRidingMessage.Key("subwayAtStop")
    "2" -> SubwayRidingMessage.Key("subwayDeparted")
    "3", "4", "5" -> SubwayRidingMessage.Key("subwayNextStop")
    "99" -> SubwayRidingMessage.Omit
    else -> SubwayRidingMessage.Raw
}
