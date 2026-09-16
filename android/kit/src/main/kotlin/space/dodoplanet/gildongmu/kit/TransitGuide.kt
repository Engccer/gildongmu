package space.dodoplanet.gildongmu.kit

/**
 * 출구 번호 소비자 형식 게이트(spec 2026-09-02 §5.1, 웹 `validExitNo` ↔ Kit `TransitGuide.swift` 미러):
 * 양끝 공백만 제거한 뒤 `^[0-9]+(-[0-9]+)?$`. 가운데 공백을 지우면 `"1 2"`가 12번 출구로 둔갑하므로 trim만 한다.
 * `\d` 대신 `[0-9]`: 유니코드 `\d`는 전각 숫자도 통과해 JS `\d`(ASCII)와 갈린다 — 문자 그대로 미러.
 */
fun transitValidExitNo(raw: String?): String? {
    if (raw == null) return null
    val t = raw.trim()
    return if (VALID_EXIT_NO.matches(t)) t else null
}

private val VALID_EXIT_NO = Regex("^[0-9]+(-[0-9]+)?$")
