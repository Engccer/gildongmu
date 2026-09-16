package space.dodoplanet.gildongmu.kit

// 거리·문자열 포맷 헬퍼 — 여러 서비스·산문 빌더 공용. Kit `Format.swift` 미러.

/**
 * 웹 `src/lib/format.ts` formatDistance 미러 — 단일 정본, 앱 로컬 사본 금지.
 * 1000m 미만은 "{m}m", 이상은 후행 0 없는 소수 km("1.1km"·"10.6km"·"6.285km", 1,000의
 * 배수만 정수 "1km"). 단위 표기는 전 로케일 공통. 표는 웹 `DISTANCE_CASES`가 정본이고
 * `FormatTest`가 같은 표를 든다.
 *
 * ⚠ Kotlin `Double.toString()`은 정수에 "1.0"을 남기므로 1,000의 배수만 정수 표기로 가른다
 * (Swift `String(Double)`과 같은 함정).
 */
fun formatDistance(meters: Int): String {
    if (meters < 1000) return "${meters}m"
    if (meters % 1000 == 0) return "${meters / 1000}km"
    return "${meters / 1000.0}km"
}

/** 첫 non-null·non-empty 값(웹 `||` 폴백 동형). 빈 조각이 트레일링 쉼표로 낭독되는 것을 막는다. */
internal fun firstNonEmpty(vararg values: String?): String? = values.firstOrNull { !it.isNullOrEmpty() }

// ⚠ `\b`를 쓰지 않는다. 한글·한자가 word character라 "35m입니다" 같은 CJK 직결 꼴에서
// 경계가 성립하지 않아 치환이 조용히 no-op이 된다. 부정 전방탐색으로 "라틴 문자가 뒤따르지
// 않음"만 요구한다. 숫자는 `\d`가 아니라 `[0-9]` — JVM 테스트의 java.util.regex는 ASCII이고 안드로이드
// 기기의 것은 ICU라 `\d`가 전각 숫자까지 받아 둘이 갈린다(README §3, `RegexPortabilityTest`).
private val METERS_ABBREVIATION = Regex("""([0-9])m(?![A-Za-z])""")

/**
 * 낭독 전용: 미터 약어를 로케일 단어로 풀어 쓴다(순수 변환, 단어는 주입). 시각 표기는
 * `formatDistance` 원문을 유지하고 이 결과는 접근성 라벨(contentDescription)에만 쓴다.
 * km는 치환하지 않는다(iOS 실기기 확인: 오독은 m뿐).
 */
fun spokenDistanceUnits(text: String, meters: String): String =
    METERS_ABBREVIATION.replace(text) { "${it.groupValues[1]} $meters" }
