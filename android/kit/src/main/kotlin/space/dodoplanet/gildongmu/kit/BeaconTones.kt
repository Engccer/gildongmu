package space.dodoplanet.gildongmu.kit

/**
 * 실시간 길 안내 효과음 식별자 — Kit `BeaconTones.swift` 미러.
 *
 * 2026-08-03 위원장 청취 선정으로 **소리 정본이 합성 데이터에서 파일로 바뀌었다**: 웹 `public/sounds/guide/<이름>.mp3`
 * ↔ iOS 리소스 `guide-<이름>.mp3`(바이트 동일, `sounds-drift.test.ts`가 강제).
 *
 * **의미 계약**: 가까워짐=상승, 멀어짐=하강, 도착=연타 종(여정 끝 1회), **tick=정지**, 예고=가벼운 트릴,
 * 경고=낮은 이중음(이탈), **신뢰 불가=현재 안내를 믿을 수 없음**.
 *
 * ⚠ **`tick`의 뜻이 2026-08-08에 바뀌었다.** 종전에는 간략에서 정체(`hold`) 신호, 상세에서 생존 하트비트라는
 * **두 뜻**이었다. 지금은 도플러 속도로 판정한 **정지** 하나만 뜻한다(`GuideMotion`).
 *
 * ⚠ **`unreliable`은 원인이 아니라 상태를 뜻한다.** 원인이 셋(GPS 정확도 불량·fix 부재·경로 재획득)인데 사용자가
 * 취할 행동은 같아서 소리를 나누면 학습 부담만 는다. 원인 구분은 전경 음성이 담당한다.
 *
 * **결정 지점 행동 톤 4종(N2, 2026-08-22)**: 횡단보도=음향신호기식 비프 4연음×2, 왼쪽·오른쪽=상승 2음 모티프
 * (좌우 구분은 `LeftRightToneScheme`), 뒤로 돌기=하강 글라이드 2회. `ahead`는 "그 외"(지하보도 등)로 남는다.
 * 백그라운드·잠금에서 문장이 나가지 않으므로 이 소리가 다음 행동을 알리는 유일한 채널이다.
 */
enum class BeaconTone {
    closer, farther, nearby, tick, start, stop, ahead, crosswalk, left, right, back, warning, unreliable;

    val rawValue: String get() = name

    /**
     * 소리 파일 이름(확장자 제외). 웹·iOS 파일명과 1:1 대응.
     * ⚠ `left`·`right`는 케이스가 행동이고 파일은 표현이라 scheme이 파일을 고른다.
     * ⚠ 안드로이드 리소스 이름은 `-`를 허용하지 않는다 — [3] `:app`이 자기 리소스 규칙으로 바꿔 싣는다.
     */
    fun resourceName(scheme: LeftRightToneScheme): String = when (this) {
        left -> "guide-left-${scheme.rawValue}"
        right -> "guide-right-${scheme.rawValue}"
        else -> "guide-$rawValue"
    }

    /**
     * 이 톤의 진동이 **설정 스위치(`TrendHaptics`)에 걸리는가**. 참인 셋(가까워짐·정지·신뢰 불가)은 보행 내내
     * 반복되는 상태 신호라 기본은 소리만이고, 스위치를 켠 사용자에게만 진동을 더한다(E30 실험판, 위원장
     * 2026-09-13 "꺼짐 = 현재 동작"). 거짓인 10종(이탈·도착·행동·세션 경계)은 스위치와 무관하게 진동한다.
     */
    val hapticIsOptIn: Boolean
        get() = when (this) {
            closer, tick, unreliable -> true
            else -> false
        }

    companion object {
        fun fromRawValue(raw: String): BeaconTone? = entries.firstOrNull { it.name == raw }

        /** 리듀서 우선 톤 → 재생 톤(Swift `init(guide:)`). 이름이 같은 케이스끼리 1:1이며 변환은 여기 한 곳이다. */
        fun fromGuide(guide: GuideTone): BeaconTone = when (guide) {
            GuideTone.ahead -> ahead
            GuideTone.crosswalk -> crosswalk
            GuideTone.left -> left
            GuideTone.right -> right
            GuideTone.back -> back
            GuideTone.warning -> warning
        }
    }
}

/**
 * 진행 상태 진동 스위치(E30 실험판) — 저장 키만 여기 둔다(설정 토글과 재생기가 같은 키를 읽는다). 기본 꺼짐.
 * 정식판엔 토글이 없어 값이 저장되지 않으므로 동작이 종전과 같다.
 */
object TrendHaptics {
    const val storageKey = "trendHapticsEnabled"
}

/**
 * 왼쪽·오른쪽 톤의 구분 방식 — 실기기 선택 대기 중인 두 후보(spec `2026-08-22-walk-tone-taxonomy-design.md` §3).
 * 판정 뒤 패자와 이 타입을 지운다.
 *
 * - `pan`: 같은 모티프를 좌·우 채널에 하드 패닝. 이어폰에서 직관적이지만 주머니 속 스피커·세로 방향 폰에서는
 *   좌우가 거의 갈리지 않는다.
 * - `pitch`: 왼쪽=낮은 모티프, 오른쪽=높은 모티프(모노). 스피커에서도 성립하는 쪽이라 **기본값**이다.
 */
enum class LeftRightToneScheme {
    pan, pitch;

    val rawValue: String get() = name

    companion object {
        const val storageKey = "leftRightToneScheme"
        val default: LeftRightToneScheme = pitch

        fun fromRawValue(raw: String): LeftRightToneScheme? = entries.firstOrNull { it.name == raw }
    }
}
