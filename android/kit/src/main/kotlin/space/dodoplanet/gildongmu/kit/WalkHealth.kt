package space.dodoplanet.gildongmu.kit

import kotlin.math.abs
import kotlin.math.ln

/** 도착 화면 걸음·칼로리 요약(spec 2026-08-17 §4). Kit `WalkHealth.swift` 미러. */
data class WalkHealthSummary(
    val steps: Int,
    /** 활동 칼로리(반올림 정수). 휴식 대사분은 포함하지 않는다. */
    val kcal: Int,
    /** 체중 미입력·범위 밖이라 기본 체중으로 계산했는가(화면이 "기준 체중" 꼬리를 붙인다). */
    val usedDefaultWeight: Boolean,
)

object WalkHealth {
    const val defaultWeightKg: Double = 65.0

    /** 만보계가 거리를 주지 않을 때의 보폭. */
    const val fallbackStrideMeters: Double = 0.7

    /**
     * ACSM 보행식 `VO2 = 3.5 + 0.1×v`에서 휴식 대사 3.5를 뺀 순 보행분: `0.1×v(m/min) × 체중/200 (kcal/min)`에
     * 시간을 곱하면 `0.0005 × 거리(m) × 체중`. 시간이 소거되어 정지·속도가 결과에 들어오지 않고 0거리는 정의상 0kcal다.
     */
    const val netKcalPerKgKm: Double = 0.5

    /** 설정 저장 키(설정 "칼로리 추정용 체중"). 0 = 미입력. */
    const val weightStorageKey = "walkWeightKg"

    /** 설정 저장 키(종료 화면의 체중 입력 권유를 무시한 횟수). 0 = 아직 무시하지 않음. */
    const val weightPromptDismissalsKey = "walkWeightPromptDismissals"

    /**
     * 설정 저장 키(권유가 뜬 화면에서 [체중 입력하기]를 눌렀다는 표식).
     * ⚠ 화면 상태로 두면 **시트 최소화가 지운다**(iOS 실사고 — 최소화 시 콘텐츠 뷰가 파괴된다). 그러면
     * [체중 입력하기]를 누른 뒤 최소화했다 돌아와 닫은 화면이 무시로 계상된다. 소비 지점은 [닫기] 하나이고 거기서 지운다.
     */
    const val weightPromptEngagedKey = "walkWeightPromptEngaged"

    /**
     * 권유를 이만큼 무시하면 그 뒤로 띄우지 않는다(위원장 판정 2026-09-08 — 입력을 원하지 않는 사용자에게
     * 매 도착마다 반복되는 것이 노이즈다, spec 2026-09-11).
     */
    const val maxWeightPromptDismissals = 2

    val weightRange: ClosedFloatingPointRange<Double> = 20.0..300.0

    /**
     * 요약을 보여 줄 최소 보행 거리(m). 이보다 짧으면 걸음·칼로리를 셈하는 것이 무의미하다(위원장 판정
     * 2026-08-19 — 시작 직후 중지, 목적지 코앞 시작 등). 잠정값.
     */
    const val minMeaningfulDistanceMeters: Double = 50.0

    /**
     * 종료 화면이 체중 입력 권유(고지 문장 + [체중 입력하기] 버튼)를 낼 것인가. 체중을 입력했으면 무시 횟수를
     * 보지 않는다 — 입력자에게는 이 축이 존재하지 않는다. 숨긴 뒤에는 기준 체중이 칼로리 문장 안으로 들어간다.
     */
    fun shouldShowWeightPrompt(usedDefaultWeight: Boolean, dismissals: Int): Boolean =
        usedDefaultWeight && dismissals < maxWeightPromptDismissals

    /**
     * [닫기]를 눌렀을 때의 다음 무시 횟수. 권유가 **그 화면에 실제로 표시됐고** 사용자가 [체중 입력하기]를
     * 누르지 않았을 때만 1 증가한다. 시트 최소화·스와이프·30분 만료 소거는 호출 자체가 없다.
     *
     * 상한 clamp를 두지 않는 근거는 **함수 계약이 아니라 호출부 계약이다**: 유일한 호출부가 같은 `current`로
     * 계산한 `shouldShowWeightPrompt`를 `promptShown`으로 넘기고, 그 술어가 `current < max`를 이미 담고 있다.
     * 두 번째 호출부가 생기면 이 조건부터 확인할 것.
     */
    fun nextWeightPromptDismissals(current: Int, promptShown: Boolean, promptEngaged: Boolean): Int {
        if (!promptShown || promptEngaged) return current
        return current + 1
    }

    /** 저장값 → 유효 체중. 범위 밖·null·비유한값은 null(=기본 체중 사용). */
    fun normalizedWeight(raw: Double?): Double? {
        if (raw == null || !raw.isFinite() || raw !in weightRange) return null
        return raw
    }

    /**
     * 설정 체중 입력의 편집 종료 판정(A39, spec `2026-09-11-settings-weight-commit-design.md` §2.2). 종전엔 범위
     * 밖을 **0으로 덮어** "저장됨"과 "무시됨"을 뭉갰다(3-state). 세 결과를 갈라 화면이 각각 다르게 처리한다.
     */
    sealed class WeightCommitOutcome {
        /** 유효값 — 저장한다. */
        data class Store(val weight: Double) : WeightCommitOutcome()

        /** 빈 입력 — 미입력(기본 체중)으로 되돌리는 정당한 조작. */
        data object Clear : WeightCommitOutcome()

        /** 비수치·범위 밖 — 저장하지 않고 직전 값을 유지하며 통지한다. */
        data object Reject : WeightCommitOutcome()
    }

    /**
     * 쉼표 소수점(`62,5`)은 여기서 흡수한다 — 판정과 같은 자리에 둬야 표기 축이 갈리지 않는다.
     * 양끝 공백 제거는 Swift `.whitespaces`(공백 구분자 + 탭, 줄바꿈 제외)와 같은 집합이다.
     *
     * ⚠ `toDoubleOrNull`만 쓰지 않는다 — JVM 문법은 `65d`·`65f` 접미사와 제어 문자 여백을 받아 Swift
     * `Double(String)`이 거절하는 입력을 저장한다. 십진 표기만 통과시킨 뒤 파싱한다.
     */
    fun weightCommit(text: String): WeightCommitOutcome {
        val trimmed = text.trim { it == '\t' || Character.getType(it) == Character.SPACE_SEPARATOR.toInt() }
        if (trimmed.isEmpty()) return WeightCommitOutcome.Clear
        val normalized = trimmed.replace(",", ".")
        val raw = if (DECIMAL_NUMBER.matches(normalized)) normalized.toDoubleOrNull() else null
        val weight = normalizedWeight(raw) ?: return WeightCommitOutcome.Reject
        return WeightCommitOutcome.Store(weight)
    }

    private val DECIMAL_NUMBER = Regex("""[+-]?([0-9]+\.?[0-9]*|\.[0-9]+)([eE][+-]?[0-9]+)?""")

    /** 음식 사다리 한 칸(Swift 튜플 `(key, kcal)` 대응). */
    data class FoodRung(val key: String, val kcal: Double)

    /**
     * 태운 칼로리를 한국 음식 한 단위에 빗댄다(위원장 요청 2026-08-18 — 수치만으로는 감이 없고, 외국인에게는
     * 한국 음식 자체가 재미다). 문장은 앱 문자열 `ios.beacon.food.<key>`(단위 1개)와 `ios.beacon.food.<key>Many`
     * (최상단 항목 n단위)에 있다. 값은 흔히 알려진 대략치(kcal)이고 정밀 영양 정보가 아니다 — 문장도 "약"으로 말한다.
     */
    val foodLadder: List<FoodRung> = listOf(
        FoodRung("cherryTomato", 3.0), // 방울토마토 한 알
        FoodRung("cucumberHalf", 8.0), // 오이 반 개
        FoodRung("kimchi", 15.0), // 김치 한 접시
        FoodRung("tangerine", 40.0), // 귤 한 개
        FoodRung("boiledEgg", 75.0), // 삶은 달걀 한 개
        FoodRung("apple", 95.0), // 사과 한 개
        FoodRung("banana", 105.0), // 바나나 한 개
        FoodRung("riceHalfBowl", 150.0), // 밥 반 공기
        FoodRung("hotteok", 200.0), // 호떡 한 개
        FoodRung("riceBowl", 300.0), // 밥 한 공기
        FoodRung("ramyeon", 500.0), // 라면 한 그릇
    )

    data class FoodComparison(
        val key: String,
        /** 1이면 단위 1개 문장, 2 이상이면 최상단 항목의 n단위 문장. */
        val count: Int,
    )

    /**
     * 칼로리 → 가장 가까운 음식 단위(비율 기준 최근접). 사다리 최상단의 1.5배를 넘으면 최상단 항목 n단위로,
     * 최하단의 절반에도 못 미치면 null(비유가 성립하지 않으면 말하지 않는다).
     */
    fun foodComparison(kcal: Int): FoodComparison? {
        if (kcal <= 0) return null
        val first = foodLadder.first()
        val last = foodLadder.last()
        val value = kcal.toDouble()
        if (value < first.kcal * 0.5) return null
        if (value > last.kcal * 1.5) {
            return FoodComparison(last.key, (value / last.kcal).roundedAwayFromZero().toInt())
        }
        // Swift `min(by:)`와 같이 동률이면 앞선 항목을 고른다(`minBy`도 첫 최소를 반환한다).
        val nearest = foodLadder.minBy { abs(ln(value / it.kcal)) }
        return FoodComparison(nearest.key, 1)
    }

    /** 계산에 쓰는 거리: 만보계 거리가 유한한 양수면 그것, 아니면 걸음×보폭. */
    fun effectiveDistanceMeters(steps: Int, distanceMeters: Double?): Double {
        if (distanceMeters != null && distanceMeters.isFinite() && distanceMeters > 0) return distanceMeters
        return maxOf(0, steps).toDouble() * fallbackStrideMeters
    }

    /**
     * 요약을 보여 줄 만큼 걸었는가. 종료 화면(도착·중지 모두)이 이 판정으로 요약 행의 유무를 가른다 —
     * 3-state의 "측정 성공·값 0"은 여전히 성공이지만 표시할 가치가 없다.
     */
    fun isMeaningfulWalk(steps: Int, distanceMeters: Double?): Boolean =
        effectiveDistanceMeters(steps, distanceMeters) >= minMeaningfulDistanceMeters

    fun summary(steps: Int, distanceMeters: Double?, weightKg: Double?): WalkHealthSummary {
        val safeSteps = maxOf(0, steps)
        val meters = effectiveDistanceMeters(safeSteps, distanceMeters)
        val weight = normalizedWeight(weightKg)
        val kcal = (meters / 1000) * (weight ?: defaultWeightKg) * netKcalPerKgKm
        return WalkHealthSummary(safeSteps, kcal.roundedAwayFromZero().toInt(), weight == null)
    }
}
