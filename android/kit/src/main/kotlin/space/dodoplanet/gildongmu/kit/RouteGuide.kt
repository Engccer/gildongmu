package space.dodoplanet.gildongmu.kit

/**
 * 경로 추종형 안내 순수 리듀서 — 웹 정본 `src/lib/route-guide.ts` ↔ Kit `RouteGuide.swift` 1:1 미러
 * (스펙 2026-08-03 §5). 공유 fixture(`route-guide-scenarios.json`)가 동조를 강제한다.
 *
 * 시간은 전부 주입된 단조 시각(now, 초)이다. 시계 직접 호출 금지 — 역순 fix 폐기·타이머 정지 계약이 주입
 * 시각 위에서만 성립한다. 판정 계층 상세 계약은 `docs/INTEGRATIONS.md` §실시간 길 안내·§이탈 판정 방위 축.
 */

/** 다음 안내 전문을 낭독하는 잔여 거리 — 결정 지점 앞에서 들려야 한다(낭독 선행 원칙). */
const val announceAheadMeters = 40.0

/**
 * 표시 계층의 투영 지연 추정(m) — 웹 `PROJECTION_LAG_M` 미러. 실보행 2회 실측(~15m)으로 15에서 시작했으나
 * 위원장 실보행 재판정(2026-08-12)으로 10으로 하향. ⚠ **이 값의 갱신은 `imminentAheadMeters`를 함께 움직이는
 * 의도적 행동 변경이다** — 실보행 재판정 없이 바꾸지 말 것. 표시 계층에 10·20을 직접 쓰면 drift다(불변식 B:
 * lag 상수와 effectiveD 유도는 route-guide.ts ↔ 이 파일 한 쌍에만 존재한다).
 */
const val projectionLagMeters = 10.0

/**
 * 결정 지점 **임박** 큐의 잔여 거리(m). 40m 전문 낭독이 *무엇을* 할지 알린다면 이 큐는 *지금이다*를 알린다
 * (위원장 실보행 피드백 2026-08-09).
 *
 * ⚠ **40m 낭독을 대체하지 않는다.** 짧은 명령형 전용이라 전문을 옮기면 들으면서 이미 모퉁이를 지난다.
 *
 * 유도식 10 + projectionLagMeters(2026-08-11 재정의): "실위치 여유 10m + 관측 지연 보정"이라는 구조를 상수
 * 관계로 박아, lag 재판정이 임박 시점을 자동으로 함께 움직인다. 초기값 10m가 지연에 잡아먹혀 회전을 지난 뒤
 * 발화한 위험 실사고(2026-08-10)가 이 구조의 근거다. 상수는 계속 실보행 판정 대상.
 */
const val imminentAheadMeters = 10.0 + projectionLagMeters // = 20

/**
 * 임박 큐의 **반복 단계**(m, 투영 좌표) — 웹 `IMMINENT_REPEAT_M` 미러. 위원장 실사용 피드백 2026-08-26: "10m 전만이
 * 아니라 5m 전과 0m 지점에서도 같은 소리를 — 세 번". 같은 유도식이라 0m 단계도 투영 좌표에서는 경계 10m 앞이다.
 * 강한 내림차순이고 마지막이 `projectionLagMeters` 이상. 소리·햅틱은 매 단계, 문장은 첫 단계만(소비자 계약).
 */
val imminentRepeatMeters: List<Double> = listOf(5.0 + projectionLagMeters, 0.0 + projectionLagMeters) // = [15, 10]

/**
 * 표시 좌표계 유효 진행거리(spec 2026-08-11 §3) — 웹 `displayEffectiveD` 미러. 표시 계층(GuideLiveRows)의 구간
 * 선택·국면·잔여가 전부 이 좌표를 쓴다. **음성·톤·햅틱 계층은 원시 d 유지.** 램프인: 기준점(세션·재조회 시작
 * 시점의 d) 직후에는 걸은 거리만큼만 차오른다(출발·재조회 직후 과소 표시 방지).
 */
fun displayEffectiveD(d: Double, baselineD: Double): Double = d + minOf(projectionLagMeters, maxOf(0.0, d - baselineD))

const val advanceMarginBaseMeters = 15.0

/**
 * **기하를 모르는 세션의** 최종 접근 진입 거리(m). 기하를 아는 세션은 경로 종점까지 따라간다(아래
 * `arrivalToleranceMinMeters`) — 이 50m는 "경로 종점 = 목적지"를 전제한 판단이었고, 실측에서 종점→목적지
 * 오프셋 16~89m가 확인돼 무효화됐다(spec 2026-08-08 §1.2·§3.2).
 */
const val handoffDistMeters = 50.0
const val handoffRearmMeters = handoffDistMeters + 20

/**
 * 경로 종점 도달 판정의 하한(m). 실제 임계는 `max(이 값, fix.accuracy)`다 — 경로 잔여 5m를 정확도 30m fix로
 * 판정하는 것은 거짓 정밀도이고, 정확도가 나쁘면 종점 도달을 일찍 인정하는 것이 정직하다.
 * ⚠ 실보행 판정 전까지 동결(spec §6-1).
 */
const val arrivalToleranceMinMeters = 10.0
const val uncertainAccuracyMeters = 50.0
const val offRouteBaseMeters = 30.0
const val offRouteHoldSeconds = 20.0
const val offRouteRenotifySeconds = 60.0
const val reacquireGapSeconds = 10.0
const val windowBackMeters = 20.0
const val windowAheadMinMeters = 50.0
const val edgeHitsMax = 3
const val speedEnterMps = 3.0
const val speedClearMps = 2.0
const val speedWindowSeconds = 10.0

/**
 * 속도 표본 수집의 정확도 상한. uncertain 게이트(50m)보다 좁다 — 계단·실내 진입의 30~50m fix가 진행거리 점프를
 * 만들어 "속도 빠름" 오판을 낳는다(피드백 라운드1 #7).
 */
const val speedSampleMaxAccuracyMeters = 20.0
const val bundleRereadSeconds = 15.0

/** 수단별 튜닝 프로파일(B1 스펙 §4.3) — 웹 `GuideTuning` 미러. walk는 현행 상수의 동결이다. */
data class GuideTuning(
    /** 임박(선행) 낭독: 잔여 ≤ max(announceAheadM, v×announceAheadSpeedS) */
    val announceAheadM: Double,
    val announceAheadSpeedS: Double,
    /**
     * 결정 지점 임박 큐의 **거리 바닥**(m). null=큐 미사용. 실제 임계는 `max(imminentAheadM, v×imminentAheadS)`
     * (웹 `imminentAheadMeters` 미러, K2 spec §3.2). walk 20·시간 계수 0 = 종전. car 15 바닥 + 6초(5 + fix 지연 1).
     */
    val imminentAheadM: Double?,
    /** 임박 큐의 시간 축(초). walk 0. */
    val imminentAheadS: Double,
    /** 속도 표본 2개 미만일 때의 임계(m). walk 20(=바닥), car 60(설계 리뷰 B4). */
    val imminentUnknownSpeedM: Double,
    /** 첫 임박 큐 뒤 같은 경계를 향해 되풀이하는 단계(m). 빈 목록 = 1회(car). 웹 `imminentRepeatM` 미러. */
    val imminentRepeatM: List<Double>,
    /**
     * 임박 큐가 전문 선행(`imminentUpTo < announcedUpTo`)을 요구하는가. walk true, car false(명령이 자기 완결 —
     * 재획득 직후 한 fix를 기다리면 20m/s에서 경계를 지난다, B3).
     */
    val imminentNeedsAnnounce: Boolean,
    /**
     * 공백 뒤 따라잡기 안전(K2 spec §3.4, car 전용): 점프 fix 무발화·표본 제외, uncertain 복귀 공백은 재획득,
     * 지난 유닛 래치 전진, 묶음 안 끝난 스텝 제외. 웹 `silentCatchUp` 미러. **세 항이 한 묶음이다.**
     */
    val silentCatchUp: Boolean,
    /** 속도 표본 정확도 상한(m). walk 20, car 50(=uncertain 게이트). */
    val speedSampleMaxAccM: Double,
    /** 원거리 예고 경계(m). null=미사용(walk) */
    val farNoticeM: Double?,
    val windowAheadMinM: Double,
    val windowAheadSpeedS: Double,
    val offRouteBaseM: Double,
    val offRouteHoldS: Double,
    /** 이탈 확정에 "수직거리 비감소 추세" 요구(복귀 중 오확정 차단) */
    val offRouteTrend: Boolean,
    val offRouteRenotifyS: Double,
    /** 이탈 재통지의 warning 톤 여부(첫 확정은 항상 warning) */
    val offRouteRenotifyWarns: Boolean,
    val handoffDistM: Double,
    val handoffRearmM: Double,
    /** 재획득 전방 연속성 타이브레이크(재획득 경로 한정) */
    val reacquireTieBreak: Boolean,
    /** 보행 속도 가드. false면 가드 기계 전체 비활성(차량 상시 활성 → 이탈 재통지 잠식 차단). */
    val speedSuggest: Boolean,
    /**
     * 이탈 판정 방위 축(spec 2026-08-09). **보행 전용이다.**
     *
     * ⚠ 이 축의 상수는 전부 보행 궤적으로 쟀다(속도 1.2m/s, 앞뒤 10m 접선 표본). "모퉁이 헛경고를 ±10m 표본이
     * 막는다"는 핵심 논거가 차량 속도에서 성립하지 않는다. 차량에서의 헛경고율은 **측정된 적이 없다.**
     */
    val courseAxisEnabled: Boolean,
    /**
     * 도착 추정 자동 종료의 임계 프로파일(spec 2026-08-13, 수단별 분리는 2026-08-31 §3). null = 끔. 자동차는 도보
     * 상수를 공유하지 않는다 — 전역으로 되돌리면 도보 재판정이 자동차를 끌고 간다.
     */
    val presumedArrival: PresumedArrivalThresholds?,
    /**
     * `finalApproach` 기하가 없어도 경로 종점 150m에서 최종 접근 국면에 들어가는가(spec 2026-08-31 §2). 자동차 라우트는
     * 기하를 싣지 않으므로 true — 아니면 `carArrivalStep`이 도달 불가다(K2-a 실사고). 도보는 false.
     */
    val entersFinalApproachWithoutGeometry: Boolean,
    /**
     * 국면 무관 세션 안전망(`SessionIdle.kt`)의 무이동 축을 켜는가. 자동차는 false — 정체·휴게소 정차와 구분할 수
     * 없다. 두절 축(600초)은 두 수단 공통(spec 2026-08-31 §4). ⚠ 소비자가 수단 switch로 다시 쓰지 말 것.
     */
    val sessionIdleStationaryAxis: Boolean,
    /**
     * 수단별 물리 속도 상한(m/s) — 투영 점프 판정의 기준(웹 `maxSpeedMps` 미러). 직전 fix 대비 진행거리 증가가
     * `maxSpeedMps × dt × 1.5`를 넘으면 투영이 튄 것이다.
     *
     * ⚠ **이 판정은 리듀서 소유다(A10, 2026-08-11).** 종전에는 오케스트레이터가 별도 기준값으로 판정해
     * `finalApproachEnter`를 상태 커밋 **뒤에** 거부했는데, 거부된 세션이 0a 가드 국면에 갇혀 영구 정지했다
     * (하교 실보행 실사고). 리듀서 안에서는 진입 확정 **전에** 같은 판정이 성립하고 진입 이벤트와 phase 전이가
     * 원자적이 된다.
     */
    val maxSpeedMps: Double,
) {
    companion object {
        val walk = GuideTuning(
            announceAheadM = announceAheadMeters, announceAheadSpeedS = 0.0,
            imminentAheadM = imminentAheadMeters, imminentAheadS = 0.0,
            imminentUnknownSpeedM = imminentAheadMeters,
            imminentRepeatM = imminentRepeatMeters,
            // 결정 지점 행동은 수단 불문 **서버 투영**(`step.action`)만 본다(E16 축3). 클라이언트 문자열 폴백을
            // 두면 구조화의 "의도된 행동 없음"과 미투영을 구별하지 못하고, car는 갈래·시설 문장이 회전이 된다.
            imminentNeedsAnnounce = true,
            silentCatchUp = false, speedSampleMaxAccM = speedSampleMaxAccuracyMeters,
            farNoticeM = null,
            windowAheadMinM = windowAheadMinMeters, windowAheadSpeedS = 0.0,
            offRouteBaseM = offRouteBaseMeters, offRouteHoldS = offRouteHoldSeconds,
            offRouteTrend = false,
            offRouteRenotifyS = offRouteRenotifySeconds, offRouteRenotifyWarns = true,
            handoffDistM = handoffDistMeters, handoffRearmM = handoffRearmMeters,
            reacquireTieBreak = false, speedSuggest = true,
            courseAxisEnabled = true,
            presumedArrival = PresumedArrivalThresholds.walk,
            entersFinalApproachWithoutGeometry = false,
            sessionIdleStationaryAxis = true,
            maxSpeedMps = MotionConstants.maxWalkSpeedMps,
        )

        /** 자동차(동승자) 초기값(스펙 §4.3 표 + K2 §3.2) — 실주행 판정까지 잠정. */
        val car = GuideTuning(
            announceAheadM = 120.0, announceAheadSpeedS = 15.0,
            imminentAheadM = carImminentFloorMeters, imminentAheadS = carImminentAheadSeconds,
            imminentUnknownSpeedM = carImminentUnknownSpeedMeters,
            imminentRepeatM = emptyList(),
            imminentNeedsAnnounce = false,
            silentCatchUp = true, speedSampleMaxAccM = uncertainAccuracyMeters,
            farNoticeM = 1500.0,
            windowAheadMinM = 150.0, windowAheadSpeedS = 5.0,
            offRouteBaseM = 50.0, offRouteHoldS = 10.0,
            offRouteTrend = true,
            offRouteRenotifyS = 180.0, offRouteRenotifyWarns = false,
            handoffDistM = 150.0, handoffRearmM = 200.0,
            reacquireTieBreak = true, speedSuggest = false,
            // ⚠ 차량 궤적으로 측정된 적이 없다. 켜려면 먼저 재라(위 필드 주석).
            courseAxisEnabled = false,
            presumedArrival = PresumedArrivalThresholds.car,
            entersFinalApproachWithoutGeometry = true,
            sessionIdleStationaryAxis = false,
            maxSpeedMps = MotionConstants.maxCarSpeedMps,
        )

        /**
         * 운전자 모드(K2 §3.3): 리듀서에서는 임박 시간 축 하나만 다르다. "낮은 빈도"는 오케스트레이터가 이벤트를
         * 거른다(웹 `CAR_DRIVER_TUNING` 미러).
         */
        val carDriver = car.copy(imminentAheadS = carDriverImminentAheadSeconds)
    }
}

/** 자동차 임박 큐 상수(웹 `CAR_IMMINENT_*` 미러, K2 spec §3.2 — B1 실주행 판정 대상). */
const val carImminentFloorMeters = 15.0
const val carFixLagSeconds = 1.0
const val carImminentAheadSeconds = 5.0 + carFixLagSeconds
const val carDriverImminentAheadSeconds = 8.0 + carFixLagSeconds
const val carImminentUnknownSpeedMeters = 60.0

/**
 * 이 상태의 임박 임계(m) — 6a와 같은 식. 표시 계층(`guideLiveRows`의 `turnApproachM`)이 같은 시점에 전환하도록 한
 * 함수에서 낸다(웹 `imminentAheadMeters` 미러). 같은 이름의 상수(walk 20)와는 호출 형태로 갈린다.
 */
fun imminentAheadMeters(speedSamples: List<GuideSpeedSample>, tuning: GuideTuning): Double {
    val floor = tuning.imminentAheadM ?: return 0.0
    if (speedSamples.size < 2) return tuning.imminentUnknownSpeedM
    return maxOf(floor, estimateSpeedMps(speedSamples) * tuning.imminentAheadS)
}

/** 표시 좌표계의 회전 접근 전환 잔여(m) = 임박 임계 − 표시 lag(하한 0). walk 10. */
fun turnApproachMeters(speedSamples: List<GuideSpeedSample>, tuning: GuideTuning): Double =
    maxOf(0.0, imminentAheadMeters(speedSamples, tuning) - projectionLagMeters)

/**
 * 속도 추정 v(§4.3): max(직전 구간 속도, 중앙값). 표본은 직전 fix까지의 창 — 구속 창 크기는 현재 fix 수용 전에
 * 정해져야 하므로(인과) 현재 fix 미포함.
 */
private fun estimateSpeedMps(samples: List<GuideSpeedSample>): Double {
    if (samples.size < 2) return 0.0
    val speeds = segmentSpeeds(samples)
    val lastSeg = speeds.lastOrNull() ?: return 0.0
    val sorted = speeds.sorted()
    return maxOf(lastSeg, sorted[sorted.size / 2])
}

/** 연속 표본 사이 구간 속도(같은 시각 쌍은 건너뛴다). */
private fun segmentSpeeds(samples: List<GuideSpeedSample>): List<Double> {
    val speeds = ArrayList<Double>()
    for (i in 1 until samples.size) {
        if (samples[i].at > samples[i - 1].at) {
            speeds.add((samples[i].d - samples[i - 1].d) / (samples[i].at - samples[i - 1].at))
        }
    }
    return speeds
}

/**
 * `finalApproach`는 **경로 종점 이후 오프셋 구간을 직선으로 추적**하는 국면이다(spec 2026-08-08 §3.0).
 * 단방향 래치라 리듀서가 스스로 다른 국면으로 돌아가지 않는다.
 */
enum class GuidePhase {
    following, bundle, uncertain, reacquiring, offRoute, finalApproach;

    val rawValue: String get() = name
}

data class GuideFix(val lat: Double, val lng: Double, val accuracy: Double) {
    internal val point: RoutePoint get() = RoutePoint(lat, lng)
}

data class GuideSpeedSample(val at: Double, val d: Double)

data class GuideState(
    val phase: GuidePhase,
    /** uncertain·reacquiring·offRoute에서 복귀할 기본 국면(following 또는 bundle). */
    val resumePhase: GuidePhase,
    val d: Double,
    val stepIndex: Int,
    /** 낭독 완료된 마지막 스텝 index(선행 낭독 포함). */
    val announcedUpTo: Int,
    /**
     * 임박 큐를 마친 마지막 스텝 index. walk는 항상 `imminentUpTo <= announcedUpTo`다.
     *
     * ⚠ **스텝 단위로 전진한다 — `announcedUpTo`처럼 유닛 끝으로 뛰지 않는다.** 전문 낭독은 짧은 스텝들을 한
     * 문장으로 묶어 읽지만 결정 지점은 그 묶음 **안에도** 있다. 유닛 끝으로 뛰면 묶음의 첫 스텝만 분류되고 나머지
     * 회전·횡단보도는 큐를 받을 기회가 구조적으로 사라진다(6a 주석의 실측 두 건).
     *
     * ⚠ 행동이 없는 경계(단순 직진 연결)에서도 **전진한다**. 전진하지 않으면 그 경계에 영원히 걸려 다음 회전의 큐가
     * 영영 나가지 않는다.
     */
    val imminentUpTo: Int,
    /**
     * 후보 경계(`imminentUpTo+1`)를 향해 이미 낸 임박 큐 수(0=아직 없음) — 웹 `imminentStage` 미러. 경계를 넘기거나
     * 마지막 단계를 내면 0. 건너뛴 단계는 소급하지 않는다(fix당 이벤트 1개).
     */
    val imminentStage: Int,
    /** 어떤 발화든 갱신 — 주기 통지의 기준. */
    val lastAnnouncedAt: Double,
    val lastFixAt: Double?,
    val windowEdgeHits: Int,
    val offRouteSince: Double?,
    val lastOffRouteNoticeAt: Double?,
    val speedSamples: List<GuideSpeedSample>,
    val speedGuardActive: Boolean,
    val speedWarned: Boolean,
    /** 자동 인계 무장 여부. 수동 상세 복귀 후엔 재무장선(70m) 밖으로 나가야 true. */
    val autoHandoffArmed: Boolean,
    /**
     * 이 세션이 종점 오프셋 기하(`WalkRouteBriefing.finalApproach`)를 아는가.
     * - `true`  → 최종 접근 진입 조건은 **경로 종점 도달**(`max(arrivalToleranceMinMeters, accuracy)`).
     * - `false` → 구버전 응답이다. **현행 50m 인계를 그대로 쓴다**.
     *
     * ⚠ **fix 인자가 아니라 상태에 둔다.** 세션(경로 응답)의 성질이라 매 fix마다 다시 넘길 값이 아니다.
     */
    val hasFinalApproachGeometry: Boolean,
    /** 원거리 예고를 마친 마지막 스텝 index(임박 발화 시 함께 전진). walk에선 불변. */
    val farNoticedUpTo: Int,
    /** 이탈 누적 중 관측 최대 수직거리 — offRouteTrend 프로파일의 복귀 유예 기준. */
    val offRoutePeakPerp: Double?,
    /** 재획득 타이브레이크 기준: reacquiring 진입 직전 진행거리·속도·진입 시각. */
    val reacquirePrevD: Double?,
    val reacquireV: Double,
    val reacquireSince: Double?,
    /**
     * reacquiring 진입 직전 국면이 offRoute였는가. 없으면 이탈 확정이 GPS 공백을 경유하며 무통지로 소실된다(복귀가
     * backOnRoute 대신 reacquired로 나감 — 리뷰 HIGH).
     */
    val reacquiringFromOffRoute: Boolean,
    /**
     * 축별 이탈 latch. 확정은 OR, 복귀는 평가 가능한 활성 축 전체 해제다.
     * ⚠ 단일 "원인"으로 접지 않는다 — 거리로 이탈한 뒤 역주행해도 방위 상태가 기록되지 않아 방향이 어긋난 채
     * 복귀가 선언된다.
     */
    val offRouteAxes: OffRouteAxes,
    /** 방위 표결 창. 상태 재구성 시 비워진다(경로 identity 바인딩). */
    val courseVotes: List<CourseVoteSample>,
    /**
     * 방위 관측 유도기 버퍼(fix 이력). ⚠ 표결 창과 수명이 다르다 — 궤적은 경로의 함수가 아니므로 경로 교체·재구성
     * (§2.8)에서 비우지 않고(age 30s로 자체 소멸), 새 세션에서만 초기화한다(spec §2.9).
     */
    val courseDerivation: CourseDerivationState,
    /**
     * 경유지 도착선 통과 확정 래치(N4). 신뢰 가능한 fix(`!isOff && !jumped`)가 경로 위 투영으로 도착선을 넘었을 때
     * 한 번 선다. 같은 경로 세대 안에서는 `restateAt`이 승계한다(지우면 복귀 직후 같은 경유지를 다시 알리고, d로
     * 재계산하면 통지 없이 사건을 소비한다).
     */
    val waypointReached: Boolean,
    /**
     * 확정됐으나 아직 발화하지 못한 도착(같은 fix의 임박 큐에 밀렸다). 다음 fix에서 새 임박보다 먼저 나간다 —
     * 조밀한 결정 지점에서 도착이 무한히 밀리지 않는다.
     */
    val waypointPending: Boolean,
    /**
     * uncertain 진입 시점의 **마지막 신뢰 fix 시각**(silentCatchUp ②, 웹 `uncertainSince` 미러). 불량 fix마다
     * 갱신되는 `lastFixAt`으로 복귀 공백을 재면 촘촘한 불량 fix에서 절대 걸리지 않는다.
     */
    val uncertainSince: Double?,
)

data class OffRouteAxes(val distance: Boolean = false, val course: Boolean = false)

sealed class GuideEvent {
    data class AnnounceSteps(val indices: List<Int>) : GuideEvent()

    /**
     * 결정 지점 임박(20m) 앞. `action`은 낭독 문구를 고르는 키이고 `indices`는 **그 행동을 담은 스텝 하나**다
     * (유닛이 아니다 — 결정 지점은 유닛 안에도 있다). `stage`는 0부터의 단계 index(walk 20·15·10m) — 소비자는
     * 소리·햅틱은 매 단계, 문장은 0만.
     */
    data class Imminent(val indices: List<Int>, val action: WalkAction, val stage: Int) : GuideEvent()
    data class FarNotice(val indices: List<Int>, val remainingMeters: Int) : GuideEvent()
    data class Periodic(val stepIndex: Int, val remainingMeters: Int, val accuracy: Double) : GuideEvent()
    data class BundleReread(val indices: List<Int>) : GuideEvent()

    /** 경유지 도착(N4). 톤 없음 — 도착 종은 오케스트레이터가 `nearby`로 낸다. */
    data object WaypointReached : GuideEvent()
    data object FinalApproachEnter : GuideEvent()
    data object OffRoute : GuideEvent()
    data object BackOnRoute : GuideEvent()
    data object UncertainEnter : GuideEvent()
    data object UncertainExit : GuideEvent()
    data object Reacquiring : GuideEvent()
    data object Reacquired : GuideEvent()
    data object SpeedSuggest : GuideEvent()
}

/**
 * 리듀서가 fix마다 내는 우선 톤. 행동 톤 5종(`imminentTone`)과 이탈 경고.
 * ⚠ `BeaconTone`(재생 파일)과는 다른 층이다 — 변환은 `BeaconTone.fromGuide` 한 곳.
 */
enum class GuideTone {
    ahead, crosswalk, left, right, back, warning;

    val rawValue: String get() = name
}

/**
 * 결정 지점 임박 큐의 **소리**. 행동별로 가른다(N2, 2026-08-22 위원장 판정: 횡단보도·왼쪽·오른쪽·뒤로 돌기·그 외).
 * 백그라운드·잠금에서는 문장이 나가지 않으므로 이 소리가 다음 행동을 알리는 유일한 채널이다. `underpass`는
 * "그 외"다 — 횡단보도 비프는 음향신호기의 인용이라 지하보도에 붙이면 거짓 인용이 된다.
 * 웹 `imminentTone` ↔ Kit `WalkAction.swift` 미러(소리 열거형이 여기 있어 Kotlin은 이 파일에 둔다).
 * 소리 정본은 `scripts/build-guide-tones.py`.
 */
fun imminentTone(action: WalkAction): GuideTone = when (action) {
    WalkAction.crosswalk -> GuideTone.crosswalk
    WalkAction.left -> GuideTone.left
    WalkAction.right -> GuideTone.right
    WalkAction.back -> GuideTone.back
    WalkAction.underpass -> GuideTone.ahead
    // 갈래 선택은 회전과 같은 소리(소리 5종 유지 — N2 판정).
    WalkAction.keepLeft -> GuideTone.left
    WalkAction.keepRight -> GuideTone.right
}

data class GuideOutput(
    val state: GuideState,
    val event: GuideEvent?,
    val tone: GuideTone?,
    /**
     * 진단 계측용(spec §7 1단계). **판정에 쓰이지 않는다.** 판정 전 국면에서 조기 반환하면 계산된 적이 없으므로
     * `null`이고, 그것이 정직한 값이다(0으로 접지 않는다).
     */
    val perpMeters: Double? = null,
    /** 이 fix가 실제로 창에 넣은 표. 이탈 중에는 `entryProjection` 기준이다. 관측이 없어 표를 내지 않았으면 `null`. */
    val courseVote: CourseVote? = null,
    /** 이 fix에서 유도된 방위 관측(진단용). 프로파일 게이트 통과 후 값 — 없으면 null. */
    val derivedCourse: DerivedCourse? = null,
    /**
     * 이 fix의 진행거리 전진이 물리적으로 불가능했는가(투영 점프). 오케스트레이터의 추세 톤 게이트가 소비한다 —
     * 튄 잔여 거리를 추세로 읽으면 거짓 closer가 난다. 투영에 도달하지 못한 조기 반환 경로에서는 `null`(판정 없음).
     */
    val projectionJumped: Boolean? = null,
)

/** 스텝 index가 속한 유닛(긴 스텝=자기 하나, 짧은 스텝=연속 묶음 전체)의 index 목록. */
fun unitAt(route: GuideRoute, index: Int): List<Int> {
    if (index < 0 || index >= route.steps.size) return emptyList()
    if (route.steps[index].isLong) return listOf(index)
    var a = index
    var b = index
    while (a > 0 && !route.steps[a - 1].isLong) a -= 1
    while (b < route.steps.size - 1 && !route.steps[b + 1].isLong) b += 1
    return route.steps.subList(a, b + 1).map { it.index }
}

private fun stepAt(route: GuideRoute, d: Double): GuideStepSpan =
    route.steps.firstOrNull { d < it.endD } ?: route.steps[route.steps.size - 1]

/**
 * 임의 진행거리에서의 초기 상태(전환·재획득·재조회 리셋 공용).
 *
 * ⚠ **`courseDerivation`은 같은 세션의 재구성(재조회·brief↔detail 전환)이라면 반드시 직전 상태의 버퍼를 넘긴다**
 * (spec §2.9 — 궤적은 경로의 함수가 아니라서 경로 교체는 버퍼를 비울 사유가 아니다. 비우면 갈림 직후 재조회에서 축이
 * ~10m 냉시동된다). 기본값(빈 버퍼)은 **새 세션(안내 시작)에서만** 정당하다.
 */
fun guideStateAt(
    route: GuideRoute,
    d: Double,
    now: Double,
    autoHandoffArmed: Boolean = true,
    hasFinalApproachGeometry: Boolean = false,
    courseDerivation: CourseDerivationState = initialDerivationState,
    waypointReached: Boolean = false,
    waypointPending: Boolean = false,
): GuideState {
    val step = stepAt(route, d)
    val unit = unitAt(route, step.index)
    val phase = if (step.isLong) GuidePhase.following else GuidePhase.bundle
    return GuideState(
        phase = phase,
        resumePhase = phase,
        d = d,
        stepIndex = step.index,
        announcedUpTo = unit[unit.size - 1],
        // ⚠ **유닛 끝이 아니라 지금 서 있는 스텝이다.** 지나온 것은 이 스텝의 시작 결정뿐이고, 같은 유닛의 뒤쪽
        // 스텝들은 아직 앞에 있다 — 유닛 끝으로 두면 묶음 안의 회전이 통째로 사라진다.
        imminentUpTo = step.index,
        imminentStage = 0,
        lastAnnouncedAt = now,
        lastFixAt = null,
        windowEdgeHits = 0,
        offRouteSince = null,
        lastOffRouteNoticeAt = null,
        speedSamples = emptyList(),
        speedGuardActive = false,
        speedWarned = false,
        autoHandoffArmed = autoHandoffArmed,
        // 기본은 false(옛 50m 인계) — 기하를 안다고 주장하려면 명시해야 한다.
        hasFinalApproachGeometry = hasFinalApproachGeometry,
        // 재진입 유닛은 원거리 예고 소비 처리 — 경계 안 시작은 크로싱 불성립(§4.3).
        farNoticedUpTo = unit[unit.size - 1],
        offRoutePeakPerp = null,
        reacquirePrevD = null,
        reacquireV = 0.0,
        reacquireSince = null,
        reacquiringFromOffRoute = false,
        offRouteAxes = OffRouteAxes(),
        courseVotes = emptyList(),
        courseDerivation = courseDerivation,
        waypointReached = waypointReached,
        waypointPending = waypointPending,
        uncertainSince = null,
    )
}

/** `initialGuideState` 결과(Swift 튜플 `(state, firstIndices)` 대응). */
data class InitialGuideState(val state: GuideState, val firstIndices: List<Int>)

/** 시작 상태 + 원자 시작 발화(스펙 §5.3)에 넣을 첫 유닛. 문장 조립은 오케스트레이터 몫. */
fun initialGuideState(
    route: GuideRoute,
    now: Double,
    hasFinalApproachGeometry: Boolean = false,
    courseDerivation: CourseDerivationState = initialDerivationState,
): InitialGuideState = InitialGuideState(
    // 재조회(같은 세션의 새 경로)는 직전 버퍼를 넘긴다 — guideStateAt ⚠ 참조.
    guideStateAt(route, 0.0, now, hasFinalApproachGeometry = hasFinalApproachGeometry, courseDerivation = courseDerivation),
    unitAt(route, 0),
)

/**
 * 같은 세션 안에서 진행거리만 바꿔 상태를 다시 만든다(재획득·복귀 공용).
 *
 * ⚠ **세션 성질의 승계 목록은 여기 한 곳에만 둔다.** 호출 지점마다 나열하면 새 필드를 더할 때 하나를 빠뜨리고, 그
 * 결과는 조용하다 — 웹에서 실제로 `hasFinalApproachGeometry`가 재획득 경로에서만 떨어져 진입선이 옛 50m로 되돌아간
 * 적이 있다.
 */
internal fun restateAt(route: GuideRoute, d: Double, now: Double, prev: GuideState): GuideState =
    // 유도기 버퍼는 궤적의 사실이라 재구성에서도 잇는다(비우는 것은 표결 창이지 버퍼가 아니다).
    guideStateAt(
        route, d, now,
        autoHandoffArmed = prev.autoHandoffArmed,
        hasFinalApproachGeometry = prev.hasFinalApproachGeometry,
        courseDerivation = prev.courseDerivation,
        waypointReached = prev.waypointReached,
        waypointPending = prev.waypointPending,
    )

/** 최종 접근 진입선(경로 잔여 m). 기하를 알면 경로 종점까지 가고, 모르면 옛 50m다. 웹 `finalApproachEntryM` 미러. */
fun finalApproachEntryMeters(state: GuideState, accuracy: Double, tuning: GuideTuning): Double {
    if (!state.hasFinalApproachGeometry) return tuning.handoffDistM
    return maxOf(arrivalToleranceMinMeters, accuracy)
}

sealed class GuideEntryProjection {
    data class Ok(val d: Double) : GuideEntryProjection()
    data object Ambiguous : GuideEntryProjection()
    data object None : GuideEntryProjection()
}

/**
 * 간략→상세 전환·재조회 후 초기 투영(스펙 §6). 후보가 복수면 확정하지 않는다 — 잘못 고른 후보도 폴리라인 위라
 * 수직거리 이탈 판정이 영영 못 잡는다.
 */
fun entryProjection(route: GuideRoute, fix: GuideFix, tuning: GuideTuning = GuideTuning.walk): GuideEntryProjection {
    val maxPerp = maxOf(tuning.offRouteBaseM, 2 * fix.accuracy)
    val cands = globalCandidates(route.polyline, fix.point, maxPerp)
    if (cands.isEmpty()) return GuideEntryProjection.None
    if (cands.size > 1) return GuideEntryProjection.Ambiguous
    return GuideEntryProjection.Ok(cands[0].d)
}

private fun periodicIntervalSeconds(remaining: Double): Double {
    if (remaining > 500) return 60.0
    if (remaining >= 150) return 30.0
    return 15.0
}

/**
 * 방위 관측은 인자가 아니라 **리듀서가 fix 이력에서 직접 유도한다**(spec §2.9 재설계). 플랫폼이 관측을 만들어 넘길
 * 수 없는 구조가 1선 방어다 — 플랫폼별 유도 drift를 시그니처가 차단한다.
 */
fun guideStep(state: GuideState, fix: GuideFix, route: GuideRoute, now: Double, tuning: GuideTuning): GuideOutput {
    // 0) 역순 시각 방어: now가 과거로 가면 fix 폐기(상태 불변).
    val last = state.lastFixAt
    if (last != null && now < last) return GuideOutput(state, null, null)

    // 유도기 갱신은 국면과 무관하게 매 fix 1회 — 버퍼는 궤적의 사실이다(spec §2.9).
    // finalApproach·uncertain 조기 반환보다 앞이라 어느 국면에서도 버퍼가 이어진다.
    val dv = deriveCourse(state.courseDerivation, fix.lat, fix.lng, now)
    val base = state.copy(courseDerivation = dv.state)
    // 프로파일 게이트는 여기 한 곳뿐이다 — 조건을 하위 분기마다 흩으면 하나를 빠뜨리고, 그 하나가 조용히 축을 살린다.
    val derived: DerivedCourse? = if (tuning.courseAxisEnabled) dv.obs else null

    // 관측이 없으면 표를 내지 않는다(spec §2.10 — 창에 안 쌓임). 대신 창은 시간으로 낡는다: 정지가 길어지면 표가
    // 말라 verdict가 unknown으로 돌아간다.
    fun pruneVotes(samples: List<CourseVoteSample>): List<CourseVoteSample> =
        samples.filter { it.at > now - courseAxisWindowSeconds }

    // 0a) 최종 접근 중에는 리듀서가 아무 판정도 하지 않는다(spec §4 전이표). 발화 소유권이 최종 접근 층으로 넘어갔고,
    //     이 국면은 **경로를 이미 벗어난** 구간을 다루므로 낡은 폴리라인으로 이탈·재획득을 주장하면 거짓이다.
    //     ⚠ **이 가드는 반드시 uncertain 게이트보다 앞에 온다.** 뒤에 두면 정확도가 나빠질 때 uncertain을 경유했다가
    //     resumePhase(following)로 복귀하면서 단방향 래치가 조용히 풀린다.
    if (base.phase == GuidePhase.finalApproach) {
        // 낡은 폴리라인 기준 표는 이 국면에서 근거가 아니다(경로를 이미 벗어난 구간).
        return GuideOutput(base.copy(lastFixAt = now, courseVotes = emptyList()), null, null)
    }

    // 1) uncertain 게이트(정확도 무효 포함): 자동 낭독·타이머 전부 정지.
    val accBad = !(fix.accuracy > 0) || fix.accuracy > uncertainAccuracyMeters
    if (base.phase == GuidePhase.uncertain) {
        if (accBad) return GuideOutput(base.copy(lastFixAt = now), null, null)
        // 복귀 fix의 공백이 재획득 공백을 넘으면 복귀가 아니라 재획득(silentCatchUp ②) — uncertain 분기가
        // lastFixAt을 갱신해 아래 gap 검사가 이 공백을 못 본다.
        val since = base.uncertainSince
        if (tuning.silentCatchUp && since != null && now - since > reacquireGapSeconds) {
            return GuideOutput(
                base.copy(
                    phase = GuidePhase.reacquiring,
                    windowEdgeHits = 0,
                    speedSamples = emptyList(),
                    courseVotes = emptyList(),
                    lastFixAt = now,
                    reacquiringFromOffRoute = base.resumePhase == GuidePhase.offRoute,
                    reacquirePrevD = base.d,
                    reacquireV = 0.0,
                    reacquireSince = since,
                    uncertainSince = null,
                ),
                GuideEvent.Reacquiring, null,
            )
        }
        return GuideOutput(
            base.copy(phase = base.resumePhase, lastFixAt = now, lastAnnouncedAt = now, uncertainSince = null),
            GuideEvent.UncertainExit, null,
        )
    }
    if (accBad) {
        return GuideOutput(
            base.copy(
                phase = GuidePhase.uncertain,
                // 이탈 중 진입이면 복귀도 이탈로(이탈 상태 소실 방지 — 리뷰 HIGH의 대칭 경로).
                resumePhase = if (base.phase == GuidePhase.offRoute) GuidePhase.offRoute else base.resumePhase,
                uncertainSince = base.lastFixAt ?: now, // 마지막 신뢰 fix 시각(복귀 공백 기준)
                lastFixAt = now,
                speedSamples = emptyList(),
                // ⚠ 창은 비우고 latch(offRouteAxes)는 보존한다. 투영을 못 믿는 기간의 표는 근거가 아니지만, 이탈
                //   사실이 정확도 악화로 소실되면 안 된다.
                courseVotes = emptyList(),
            ),
            GuideEvent.UncertainEnter, null,
        )
    }

    // 2) reacquiring: 전역 재탐색(모호하면 유지 — 다음 fix에서 재시도).
    if (base.phase == GuidePhase.reacquiring) {
        val projection = entryProjection(route, fix, tuning)
        var entryD: Double? = null
        val prevD = base.reacquirePrevD
        val reSince = base.reacquireSince
        if (projection is GuideEntryProjection.Ok) {
            entryD = projection.d
        } else if (projection is GuideEntryProjection.Ambiguous && tuning.reacquireTieBreak && prevD != null && reSince != null) {
            // 재획득 전방 연속성 타이브레이크(§4.3): 전방 창 안 후보가 정확히 1개일 때만 채택. 0·복수는 거부 유지 —
            // 평행도로 이탈 은폐 차단. elapsed는 "마지막으로 확실했던 시점"부터의 경과(고정 보정 없음).
            val elapsed = now - reSince
            val maxAheadD = prevD + base.reacquireV * elapsed * 1.5 + 100
            val maxPerp = maxOf(tuning.offRouteBaseM, 2 * fix.accuracy)
            val inWindow = globalCandidates(route.polyline, fix.point, maxPerp).filter { it.d >= prevD && it.d <= maxAheadD }
            if (inWindow.size == 1) entryD = inWindow[0].d
        }
        if (entryD == null) return GuideOutput(base.copy(lastFixAt = now), null, null)
        // ⚠ 재획득 성공도 복귀다. 방위 축이 잠겨 있으면 위치만으로 풀지 않는다. 이 경로가 §5의 offRoute 분기보다
        //   **먼저** 실행되므로, 여기를 빼면 fix 공백 10초만으로 복귀 계약이 통째로 우회된다.
        // ⚠ 이 판정은 **구조상 항상 hold다.** 재획득 진입에서 창이 비워졌으므로 표가 하나뿐이고 courseAxisMinVotes(8)에
        //   못 미쳐 verdict가 반드시 unknown이다. 그래도 verdict를 부르는 형태로 두는 이유는, 창 초기화 정책이 바뀌면
        //   이 자리가 자동으로 증거 평가로 돌아가야 하기 때문이다.
        val reVotes = if (derived == null) {
            pruneVotes(base.courseVotes)
        } else {
            recordVote(base.courseVotes, now, courseVote(derived, route.polyline, entryD))
        }
        if (base.offRouteAxes.course && courseAxisVerdict(reVotes) != CourseAxisVerdict.on) {
            // 위치는 되찾았지만 방향이 확인되지 않았다 — 이탈 상태를 유지한다. `reacquiringFromOffRoute`를 내리는
            // 이유: 국면을 offRoute로 되돌리므로 재획득 상태가 아니다. 남기면 다음 재획득에서 이벤트 종류를 잘못 가른다.
            return GuideOutput(
                base.copy(phase = GuidePhase.offRoute, lastFixAt = now, courseVotes = reVotes, reacquiringFromOffRoute = false),
                null, null,
            )
        }
        val s = restateAt(route, entryD, now, base).copy(speedWarned = base.speedWarned, lastFixAt = now)
        // 이탈 확정 상태에서 공백으로 넘어온 재확보는 곧 이탈 종료다 — backOnRoute를 내야 UI의 이탈 상태(재조회
        // 버튼)가 함께 닫힌다(리뷰 HIGH).
        return GuideOutput(s, if (base.reacquiringFromOffRoute) GuideEvent.BackOnRoute else GuideEvent.Reacquired, null)
    }
    val lastFix = base.lastFixAt
    val gap = lastFix != null && now - lastFix > reacquireGapSeconds
    if (gap || base.windowEdgeHits >= edgeHitsMax) {
        return GuideOutput(
            base.copy(
                phase = GuidePhase.reacquiring,
                windowEdgeHits = 0,
                speedSamples = emptyList(),
                // 위치를 잃은 동안의 표는 근거가 아니다(latch는 보존).
                courseVotes = emptyList(),
                lastFixAt = now,
                reacquiringFromOffRoute = base.phase == GuidePhase.offRoute,
                // 타이브레이크 기준 보관 — 표본은 지금 리셋되므로 진입 시점에 계산해 둔다.
                // 기준 시각은 "마지막으로 확실했던 시점"(gap=직전 fix 시각·edgeHits=지금).
                reacquirePrevD = base.d,
                reacquireV = estimateSpeedMps(base.speedSamples),
                reacquireSince = if (gap) lastFix else now,
            ),
            GuideEvent.Reacquiring, null,
        )
    }

    // 3) 구속 창 투영 + 단조 전진(스펙 §5.1). 창 크기는 직전 창 속도로 되먹인다(walk는 속도 계수 0이라 현행 동일).
    val vPrev = estimateSpeedMps(base.speedSamples)
    val ahead = maxOf(tuning.windowAheadMinM, 3 * fix.accuracy, vPrev * tuning.windowAheadSpeedS)
    val proj = projectOnPolyline(route.polyline, fix.point, base.d - windowBackMeters, base.d + ahead)
        ?: return GuideOutput(base.copy(lastFixAt = now), null, null)
    val d = maxOf(base.d, proj.d)
    // 투영 점프: 직전 수용 fix 대비 물리 불가능한 전진(tuning.maxSpeedMps 주석 — A10). 단조 전진이라 감소 방향은 없고,
    // 재구성 직후(lastFixAt 초기화)는 기준이 없어 false다. dt=0(동시각 fix)은 전진이 있을 때만 점프다.
    val jumped = lastFix != null && d - base.d > tuning.maxSpeedMps * maxOf(0.0, now - lastFix) * 1.5
    // 방위 축 표결(spec §2.1). 추종 중 기준은 구속 창 투영 결과다. 관측 없으면 표 없음.
    val vote: CourseVote? = if (derived == null) null else courseVote(derived, route.polyline, d)
    // 진단 계측: 이 fix가 실제로 넣은 표. 이탈 분기에서 entry 기준으로 덮인다.
    var loggedVote = vote
    fun emit(s: GuideState, event: GuideEvent?, tone: GuideTone?) = GuideOutput(
        s, event, tone,
        perpMeters = proj.perpMeters, courseVote = loggedVote, derivedCourse = derived, projectionJumped = jumped,
    )
    val courseVotes = if (vote != null) recordVote(base.courseVotes, now, vote) else pruneVotes(base.courseVotes)
    // 창 경계 적중은 "경로 위인데 창이 못 따라간" 신호일 때만 센다. 수직거리가 크면 그것은 이탈 증거이지 창 기아가 아니다.
    val offThreshold = maxOf(tuning.offRouteBaseM, 2 * fix.accuracy)
    // silentCatchUp: 점프 fix는 창 기아 그 자체(perp가 실위치까지의 거리라 아래 조건이 못 센다) — 점프 3회면 재획득.
    // 이탈 증거로도 쓰지 않는다(품질 리뷰 M1, 웹 미러).
    val crawling = tuning.silentCatchUp && jumped
    val edgeHit = crawling || (proj.d >= base.d + ahead - 1 && proj.perpMeters <= offThreshold)
    val windowEdgeHits = if (edgeHit) base.windowEdgeHits + 1 else 0

    // 4) 속도 창(10초 중앙값) — uncertain·reacquiring 밖에서만 표본 수집. 정확도 나쁜 fix(>20m)는 표본에서 배제한다
    //    (투영·전진은 유지 — 위치 축과 속도 축의 품질 요구가 다르다). 점프 fix의 표본은 창 기아 따라잡기 속도라
    //    버린다(silentCatchUp ① — 넣으면 창이 부풀어 재획득이 영영 안 걸린다).
    var samples = base.speedSamples
    if (fix.accuracy <= tuning.speedSampleMaxAccM && !(tuning.silentCatchUp && jumped)) {
        samples = samples + GuideSpeedSample(now, d)
    }
    samples = samples.filterNot { now - it.at > speedWindowSeconds }
    val speeds = segmentSpeeds(samples).sorted()
    val median = if (speeds.isEmpty()) 0.0 else speeds[speeds.size / 2]
    val windowSpan = if (samples.size >= 2) samples[samples.size - 1].at - samples[0].at else 0.0
    var speedGuardActive = base.speedGuardActive
    // 가드 기계는 speedSuggest 프로파일에서만 동작한다(차량 상시 활성 → 재통지 잠식 차단).
    if (tuning.speedSuggest) {
        if (windowSpan >= speedWindowSeconds * 0.8) {
            if (!speedGuardActive && median > speedEnterMps) {
                speedGuardActive = true
            } else if (speedGuardActive && median < speedClearMps) {
                speedGuardActive = false
            }
        } else if (speedGuardActive && samples.isEmpty()) {
            // 표본이 전무하면(정확도 배제·시간창 배수로 소멸) 판정 근거가 없다 — 낡은 판정을 쥔 채 이탈 재통지를
            // 무기한 억제하는 고착 차단(독립 리뷰).
            speedGuardActive = false
        }
    }

    val remainingTotal = route.totalMeters - d
    var next = base.copy(
        d = d,
        stepIndex = stepAt(route, d).index,
        lastFixAt = now,
        windowEdgeHits = windowEdgeHits,
        speedSamples = samples,
        speedGuardActive = speedGuardActive,
        courseVotes = courseVotes,
    )
    // 재무장: 수동 복귀 세션은 잔여가 재무장선 밖으로 나가야 자동 인계 허용.
    if (!next.autoHandoffArmed && remainingTotal > tuning.handoffRearmM) next = next.copy(autoHandoffArmed = true)

    // 5) 이탈 판정(스펙 §5.6).
    if (base.phase == GuidePhase.offRoute) {
        // 이탈 중 복귀 감지는 구속 창이 아니라 전역 후보로 한다. 이탈 동안 창이 뒤에 머물러, 사용자가 경로 앞쪽으로
        // 복귀해도 창 안 투영으로는 영영 못 잡는다.
        // ⚠ 이탈 중 표결 기준은 `state.d`가 아니라 `entryProjection`이 고른 지점이다. `state.d`는 단조 전진이라
        //   역주행·되돌아가기에서 실제 복귀 지점과 다르다. 후보가 모호하면 방위가 맞아도 복귀를 확정하지 않는다.
        // ⚠ 이탈 중에는 창을 비우지 않는다 — 비우면 복귀 판정 표본이 영영 최소치에 못 미친다.
        val entry = entryProjection(route, fix, tuning)
        // 관측은 있는데 기준점이 모호하면 판정 불가 표, 관측이 없으면 표 없음.
        val offVote: CourseVote? = when {
            derived == null -> null
            entry is GuideEntryProjection.Ok -> courseVote(derived, route.polyline, entry.d)
            else -> CourseVote.unknown
        }
        val offVotes = if (offVote != null) recordVote(base.courseVotes, now, offVote) else pruneVotes(base.courseVotes)
        next = next.copy(courseVotes = offVotes)
        loggedVote = offVote // 진단: 이 국면에서 창에 들어간 표는 entry 기준이다.
        if (entry is GuideEntryProjection.Ok) {
            // 축별 해제. 평가 불가(`unknown`)는 해제가 아니다.
            val courseCleared = !base.offRouteAxes.course || courseAxisVerdict(offVotes) == CourseAxisVerdict.on
            if (courseCleared) {
                // restateAt이 guideStateAt을 거치므로 창과 latch가 함께 초기화된다(§2.8).
                val back = restateAt(route, entry.d, now, base).copy(
                    speedSamples = samples,
                    speedGuardActive = speedGuardActive,
                    speedWarned = base.speedWarned,
                    lastFixAt = now,
                )
                return emit(back, GuideEvent.BackOnRoute, null)
            }
        }
        val lastNotice = base.lastOffRouteNoticeAt
        val canRenotify = !speedGuardActive && (lastNotice == null || now - lastNotice >= tuning.offRouteRenotifyS)
        if (canRenotify) {
            // 재통지 톤은 프로파일 몫(차량은 이탈=정보라 무톤, 첫 확정만 경고 — §4.3).
            return emit(
                next.copy(lastOffRouteNoticeAt = now),
                GuideEvent.OffRoute,
                if (tuning.offRouteRenotifyWarns) GuideTone.warning else null,
            )
        }
        return emit(next, null, null)
    }
    val courseVerdict = courseAxisVerdict(courseVotes)
    val isOff = proj.perpMeters > offThreshold && !crawling // 기어가는 fix의 perp는 이탈 증거가 아니다(M1)
    if (isOff) {
        var since = base.offRouteSince ?: now
        var peak = maxOf(base.offRoutePeakPerp ?: 0.0, proj.perpMeters)
        // 복귀 추세 유예(offRouteTrend): 관측 최대 대비 5m 이상 줄면 누적 리셋(§4.3).
        if (tuning.offRouteTrend && proj.perpMeters < peak - 5) {
            since = now
            peak = proj.perpMeters
        }
        next = next.copy(offRouteSince = since, offRoutePeakPerp = peak)
        if (now - since >= tuning.offRouteHoldS) {
            next = next.copy(
                phase = GuidePhase.offRoute,
                resumePhase = if (stepAt(route, d).isLong) GuidePhase.following else GuidePhase.bundle,
                lastOffRouteNoticeAt = now,
                offRoutePeakPerp = null,
                offRouteAxes = next.offRouteAxes.copy(distance = true),
            )
            return emit(next, GuideEvent.OffRoute, GuideTone.warning)
        }
    } else if (base.offRouteSince != null) {
        next = next.copy(offRouteSince = null, offRoutePeakPerp = null)
    }
    // 방위 축은 거리 축과 독립이다. 수직거리가 임계 안이어도 확정한다 — 자기근접으로 수직거리가 무너지는 갈림에서 이
    // 축이 유일한 증거다(spec §1.2).
    if (courseVerdict == CourseAxisVerdict.off) {
        next = next.copy(
            phase = GuidePhase.offRoute,
            resumePhase = if (stepAt(route, d).isLong) GuidePhase.following else GuidePhase.bundle,
            lastOffRouteNoticeAt = now,
            // 거리 축 확정과 같은 상태를 남긴다 — 두 확정 경로가 서로 다른 잔여를 남기면 다음 사람이 어느 쪽을 믿어야
            // 할지 알 수 없다.
            offRouteSince = null,
            offRoutePeakPerp = null,
            offRouteAxes = next.offRouteAxes.copy(course = true),
        )
        return emit(next, GuideEvent.OffRoute, GuideTone.warning)
    }

    // 6) 국면·낭독.
    val cur = stepAt(route, d)
    val curPhase = if (cur.isLong) GuidePhase.following else GuidePhase.bundle
    next = next.copy(phase = curPhase, resumePhase = curPhase)

    // W1) 경유지 도착선 통과 **감지**(N4, spec 2026-08-22 §2.5). 발화와 분리한다 — 같은 fix에 임박 큐가 걸리면 큐가
    //     이기고(시점이 박힌 명령문, `rem >= 0` 하한 때문에 한 fix 지연이 곧 소실) 도착은 pending으로 남는다.
    //     ⚠ 신뢰 가능한 통과만: `!isOff`(이탈 의심 중 투영 불신) + `!jumped`(투영 점프로 전진한 d는 증거가 아니다).
    //       경로가 경유지를 지나가도록 그려지므로 경로 위 투영이 도착선을 넘었다는 것 자체가 증거다.
    val w = route.waypointStepIndex
    if (w != null && !next.waypointReached && !isOff && !jumped && d >= route.steps[w].startD) {
        next = next.copy(waypointReached = true, waypointPending = true)
    }
    // W2) 이전 fix에서 확정됐는데 임박 큐에 밀려 못 나간 도착은 **새 임박보다 먼저** 나간다 — 조밀한 결정 지점에서
    //     도착이 무한히 밀리지 않는다(설계 리뷰 #2).
    if (base.waypointPending && next.waypointPending) {
        return emit(next.copy(waypointPending = false, lastAnnouncedAt = now), GuideEvent.WaypointReached, null)
    }

    // J) 투영 점프 fix는 발화하지 않는다(silentCatchUp ①) — 창이 기아로 기어가는 중이라 d가 실위치가 아니다. 상태는
    //    커밋되므로 따라잡거나 기아 3회 뒤 재획득이 바로잡는다.
    if (tuning.silentCatchUp && jumped) return emit(next, null, null)

    // 6a) 결정 지점 임박 큐(walk 20m = 10 + lag / car max(15m, v×6초), K2): 소리·진동과 짧은 명령형 한 문장으로
    //     "지금이다"를 알린다.
    //
    //     ⚠ **래치가 스텝 단위인 것이 계약이다 — 유닛 단위로 뛰면 안 된다.** 유닛 끝까지 래치를 뛰게 하면 유닛의 첫
    //     스텝만 분류되고 나머지 결정 지점은 큐를 받을 기회가 구조적으로 사라진다(실측 두 건). "무엇을"은 유닛 단위,
    //     "지금이다"는 결정 지점 단위 — 같은 수열일 이유가 없다.
    //     ⚠ **불변식(walk): 전문이 나간 스텝만 큐를 받는다**(`imminentUpTo < announcedUpTo`). car는 명령이 자기 완결이라
    //     이 선행을 요구하지 않는다(`imminentNeedsAnnounce=false`).
    //     ⚠ **6c(전문 낭독)보다 앞이고, 6b(최종 접근)에는 양보하지 않는다.** 알려진 한계: 최종 접근이 먼저 래치되면
    //     마지막 결정 지점의 큐가 사라진다. "결정 지점이 남았으면 최종 접근을 미룬다"를 실제로 구현해 봤고 되돌렸다 —
    //     이탈 판정이 마지막 50m까지 연장되면서 A6 헛경고율이 2배가 됐다(도착 직전의 거짓 "경로 이탈" 경고가 놓친 큐
    //     하나보다 나쁘다).
    //     ⚠ **경계를 이미 지났으면 발화하지 않는다**(`rem >= 0`). 하한이 없으면 uncertain 구간을 지나 창이 `d`를 경계
    //     너머로 끌어올린 fix에서 "잠시 후 왼쪽으로 도세요"가 **모퉁이를 돈 뒤에** 나간다. 지나친 경계는 한 fix 안에서
    //     전부 흘려보낸다.
    //     ⚠ **행동이 없는 경계에서도 래치는 전진시키고 발화만 건너뛴다.**
    //     ⚠ `!isOff`는 6b와 같은 이유다 — 의심 중인 투영을 근거로 명령을 내지 않는다.
    //     ⚠ **단계는 셋이고 래치는 마지막 단계에서만 전진한다**(2026-08-26). 단계 목록 `[imminentAheadMeters, ...imminentRepeatM]`,
    //     `imminentStage`가 다음 단계 index. 한 fix에 두 단계가 함께 걸리면 안쪽 하나만(소급 없음). 행동 없는 경계는
    //     단계를 세지 않고 곧바로 래치를 넘긴다. 웹 6a 미러.
    if (tuning.imminentAheadM != null && !isOff) {
        val imminentAhead = imminentAheadMeters(base.speedSamples, tuning)
        val stages = listOf(imminentAhead) + tuning.imminentRepeatM
        val imminentCap = if (tuning.imminentNeedsAnnounce) next.announcedUpTo else route.steps.size - 1
        var upTo = next.imminentUpTo
        var stageIndex = next.imminentStage
        while (upTo < imminentCap && route.steps[upTo].endD < d) {
            upTo += 1
            stageIndex = 0
        }
        next = next.copy(imminentUpTo = upTo, imminentStage = stageIndex)
        if (upTo < imminentCap) {
            val rem = route.steps[upTo].endD - d
            var stage = -1
            var i = stages.size - 1
            while (i >= stageIndex) {
                if (rem <= stages[i]) {
                    stage = i
                    break
                }
                i -= 1
            }
            if (stage >= 0) {
                val target = upTo + 1
                // 행동은 서버 투영만(없으면 침묵) — 문장 분류 폴백 없음(E16 축3).
                val action = route.steps[target].action
                next = if (action == null || stage == stages.size - 1) {
                    next.copy(imminentUpTo = target, imminentStage = 0)
                } else {
                    next.copy(imminentStage = stage + 1)
                }
                if (action != null) {
                    if (next.announcedUpTo < target) {
                        next = next.copy(announcedUpTo = target, farNoticedUpTo = maxOf(next.farNoticedUpTo, target))
                    }
                    // 반복 단계는 소리뿐이라 발화 시각을 갱신하지 않는다(주기·재통독 리듬은 문장 기준).
                    if (stage == 0) next = next.copy(lastAnnouncedAt = now)
                    return emit(next, GuideEvent.Imminent(listOf(target), action, stage), imminentTone(action))
                }
            }
        }
    }

    // W3) 이번 fix에 확정된 도착은 임박이 나가지 않았으면 바로 나간다(6b 앞 — 최종 접근 래치가 먼저 서면 0a 가드가 이후
    //     판정을 막아 도착이 영영 소실된다).
    if (next.waypointPending) {
        return emit(next.copy(waypointPending = false, lastAnnouncedAt = now), GuideEvent.WaypointReached, null)
    }

    // 6b) 최종 접근 진입: 전 스텝 낭독 완료 AND 진입선 도달 AND 재무장(스펙 2026-08-03 §5.3 + 2026-08-08 §3.2).
    //     ⚠ 단방향 래치다. 진입하면 0a) 가드가 이후 모든 판정을 멈춘다.
    //     ⚠ **`isOff`를 직접 본다** — 5절 early-return은 이미 확정된 offRoute만 막고, 새로 이탈 판정됐으나 확정 유예 전인
    //     중간 상태는 6절이 phase를 되돌려 통과시킨다.
    //     ⚠ **방위 축은 여기서 다시 보지 않는다 — 순서가 곧 불변식이다.** 방위 확정 블록이 위에서 무조건 return하므로 이
    //     지점의 `courseVerdict`는 결코 off가 아니다. 그 배선을 이 블록 **뒤로** 옮기면 종점 부근에서 finalApproachEnter가
    //     먼저 반환되고 확인된 이탈이 영구히 소실된다. 순서를 바꾸지 말 것.
    //     ⚠ **`!jumped`: 튄 잔여 거리로 진입을 확정하지 않는다**(A10, 2026-08-11 하교 실사고). 여기서 미루면 진입과
    //     phase 전이가 원자적이고, d가 유계라 반복 점프는 자기 종결된다.
    //     ⚠ **미도착 경유지가 있으면 진입하지 않는다**(N4 설계 리뷰 #1).
    if (!isOff &&
        !jumped &&
        (route.waypointStepIndex == null || next.waypointReached) &&
        next.autoHandoffArmed &&
        next.announcedUpTo >= route.steps.size - 1 &&
        remainingTotal <= finalApproachEntryMeters(next, fix.accuracy, tuning)
    ) {
        return emit(next.copy(phase = GuidePhase.finalApproach), GuideEvent.FinalApproachEnter, null)
    }

    // 6b'') 지난 유닛 무발화 따라잡기(silentCatchUp ③, 6b 뒤·6c 앞·`!isOff`): 유닛 끝이 d 앞에 있으면 전문 없이 래치
    //      3종을 유닛 끝으로 옮긴다(웹 미러).
    if (tuning.silentCatchUp && !isOff) {
        while (next.announcedUpTo < route.steps.size - 1) {
            val unit = unitAt(route, next.announcedUpTo + 1)
            val unitEnd = unit[unit.size - 1]
            if (route.steps[unitEnd].endD >= d) break
            next = next.copy(
                announcedUpTo = unitEnd,
                imminentUpTo = maxOf(next.imminentUpTo, unitEnd),
                imminentStage = 0,
                farNoticedUpTo = maxOf(next.farNoticedUpTo, unitEnd),
            )
        }
    }

    // 6c) 선행 낭독: 낭독 완료 유닛의 끝까지 잔여 ≤ 임박선이면 다음 유닛 전문. 임박선은 max(거리 하한, v×시간 계수) —
    //     walk는 시간 계수 0이라 40m 고정 동일.
    if (next.announcedUpTo < route.steps.size - 1) {
        val announcedEnd = route.steps[next.announcedUpTo].endD
        val announceAhead = maxOf(tuning.announceAheadM, vPrev * tuning.announceAheadSpeedS)
        if (announcedEnd - d <= announceAhead) {
            val unit = unitAt(route, next.announcedUpTo + 1)
            val announcedBefore = next.announcedUpTo
            // car(silentCatchUp): 묶음 안에서 이미 끝난 스텝은 빼고 읽는다(설계 리뷰 B6). 남는 것이 없으면 마지막 스텝 하나.
            val remaining = if (tuning.silentCatchUp) unit.filter { it > announcedBefore && route.steps[it].endD >= d } else unit
            val indices = if (remaining.isEmpty()) listOf(unit[unit.size - 1]) else remaining
            // 임박이 나가면 그 유닛의 원거리 예고는 소비된다(뒤늦은 원거리 예고 금지).
            next = next.copy(
                announcedUpTo = unit[unit.size - 1],
                farNoticedUpTo = maxOf(next.farNoticedUpTo, unit[unit.size - 1]),
                lastAnnouncedAt = now,
            )
            // ⚠ **톤은 임박 층이 있는 프로파일에서만 뗀다.** walk·car 모두 임박 층이 있어 `ahead`가 6a로 옮겨 갔으므로
            //   여기서 또 울리면 소리가 "곧 뭔가 있다"와 "지금이다" 둘 다를 뜻하게 되어 신호가 흐려진다. 임박 층이 없는
            //   프로파일이 생기면 여기가 그 자리의 유일한 소리라 `ahead`를 든다.
            //   ⚠ walk에서 3초 정숙 구간이 40m 시점에 사라지는 것은 **아는 대가**다(실보행 판정 대상, `docs/BACKLOG.md`).
            val tone: GuideTone? = if (tuning.imminentAheadM == null) GuideTone.ahead else null
            return emit(next, GuideEvent.AnnounceSteps(indices), tone)
        }
    }

    // 6b') 원거리 예고(§4.3 car 전용): 다음 분기 경계선을 하향 통과하는 fix에서 1회. 세션 시작·재획득 재진입이 이미
    //      경계 안이면 크로싱 불성립으로 자연 생략.
    val farNoticeM = tuning.farNoticeM
    if (farNoticeM != null && next.announcedUpTo < route.steps.size - 1 && next.farNoticedUpTo <= next.announcedUpTo) {
        val boundary = route.steps[next.announcedUpTo].endD
        val prevRemaining = boundary - base.d
        val nowRemaining = boundary - d
        if (prevRemaining > farNoticeM && nowRemaining <= farNoticeM) {
            val indices = unitAt(route, next.announcedUpTo + 1)
            next = next.copy(farNoticedUpTo = indices[indices.size - 1], lastAnnouncedAt = now)
            // 낭독 거리는 크로싱 시점의 실측 잔여(§4.7 — 상수 낭독 금지, 리뷰 검출).
            return emit(next, GuideEvent.FarNotice(indices, nowRemaining.roundedAwayFromZero().toInt()), null)
        }
    }

    // 6c) 주기: following=구간 잔여, bundle=묶음 재통독. 기준은 lastAnnouncedAt.
    val sinceAnnounce = now - next.lastAnnouncedAt
    if (cur.isLong) {
        val remainingStep = cur.endD - d
        if (sinceAnnounce >= periodicIntervalSeconds(remainingStep)) {
            return emit(
                next.copy(lastAnnouncedAt = now),
                GuideEvent.Periodic(cur.index, remainingStep.roundedAwayFromZero().toInt(), fix.accuracy),
                null,
            )
        }
    } else if (sinceAnnounce >= bundleRereadSeconds) {
        return emit(next.copy(lastAnnouncedAt = now), GuideEvent.BundleReread(unitAt(route, cur.index)), null)
    }

    // 6d) 속도 제안(최하위, 세션당 1회).
    if (speedGuardActive && !next.speedWarned) return emit(next.copy(speedWarned = true), GuideEvent.SpeedSuggest, null)
    return emit(next, null, null)
}
