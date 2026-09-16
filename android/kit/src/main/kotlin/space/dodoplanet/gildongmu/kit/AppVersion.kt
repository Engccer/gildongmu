package space.dodoplanet.gildongmu.kit

/**
 * 버전 문자열 비교(순수 함수). Kit `AppVersion.swift` 미러. 반환은 `compareTo` 규약
 * (음수·0·양수, Swift `ComparisonResult` 대응).
 *
 * ⚠ 문자열 완전 일치·사전순 비교로는 안 된다: ①`1.7.0`과 `1.7`은 컴포넌트 수가 다르고
 * ②사전순이면 `1.10 < 1.9`가 된다. 점으로 끊어 수치로 비교하고 없는 컴포넌트는 0으로 채운다.
 */
fun compareVersionStrings(lhs: String, rhs: String): Int {
    val a = versionComponents(lhs)
    val b = versionComponents(rhs)
    for (i in 0 until maxOf(a.size, b.size)) {
        val x = a.getOrElse(i) { 0 }
        val y = b.getOrElse(i) { 0 }
        if (x != y) return if (x < y) -1 else 1
    }
    return 0
}

/** 숫자로 읽히지 않는 컴포넌트(`1.7-beta`의 `7-beta`)는 앞쪽 숫자만 취한다(통째로 0이면 옛 버전으로 위장). */
private fun versionComponents(version: String): List<Int> =
    version.split(".").filter { it.isNotEmpty() }.map { part -> part.takeWhile { it.isDigit() }.toIntOrNull() ?: 0 }

/**
 * 이 노트를 설치된 빌드에서 보여 주는가. `appVersion`이 null·빈 문자열이면 거르지 않는다 —
 * 판정 근거가 없을 때 목록을 비우면 "이력이 없다"는 거짓을 말하게 된다.
 */
fun isReleaseNoteVisible(noteVersion: String, appVersion: String?): Boolean {
    if (appVersion.isNullOrEmpty()) return true
    return compareVersionStrings(noteVersion, appVersion) <= 0
}
