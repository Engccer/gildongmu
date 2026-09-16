package space.dodoplanet.gildongmu.kit

import java.text.Normalizer

// 장소명 영문 병기 조립(E28) — 웹 `src/lib/bilingual-name.ts` ↔ Kit `BilingualName.swift` 미러.
// 규칙은 공유 fixture `bilingual-name-cases.json`이 못 박는다(`BilingualNameTest`).
// 영문 원천 없는 이름은 한글 + 로마자 한 줄 괄호 `Roman (한글)`, **접근 가능한 이름은 괄호 앞만**.
// 이 타입은 "무엇을 1순위로 보이고 무엇을 괄호에 넣는가"만 정한다 — 화면은 `display`를 그리고
// 접근성 라벨(contentDescription)에는 `primary`만 준다.

data class BilingualName(
    /** 시각·낭독 모두의 1순위 이름. 병기하지 않으면 ko 원문. */
    val primary: String,
    /** 괄호에 넣을 한글 원문. null이면 병기 없음. */
    val secondary: String?,
) {
    /** 시각 문자열 `Primary (한글)` — 병기 없으면 primary만. */
    val display: String get() = if (secondary == null) primary else "$primary ($secondary)"
}

/** 한글(음절·호환 자모)이 하나라도 있는가 — 웹 `hasHangul` 미러. */
fun hasHangul(text: String): Boolean =
    text.codePoints().anyMatch { it in 0x3131..0x318E || it in 0xAC00..0xD7A3 }

/**
 * 원천이 이미 `Latin (한글)` 병기 형태(TourAPI en `title`)면 라틴 선두가 primary, 괄호 안이
 * secondary다 — 웹 `EMBEDDED_BILINGUAL`·서버 `romanNameOf` 게이트와 같은 정규식.
 */
// Swift `\s` 대신 같은 뜻의 명시 집합 REGEX_SPACE_MEMBERS(JVM ASCII ↔ 안드로이드 ICU 차이 회피, README §3).
private val EMBEDDED_BILINGUAL = Regex("""^([^가-힣()]*[A-Za-z][^가-힣()]*?)[$REGEX_SPACE_MEMBERS]*\(([^()]*[가-힣][^()]*)\)[$REGEX_SPACE_MEMBERS]*$""")

private fun nfc(text: String): String = Normalizer.normalize(text, Normalizer.Form.NFC)

internal fun parseEmbeddedBilingual(name: String): BilingualName? {
    val m = EMBEDDED_BILINGUAL.matchEntire(nfc(name)) ?: return null
    val primary = m.groupValues[1].trimSwiftWhitespaces()
    if (primary.isEmpty()) return null
    return BilingualName(primary, m.groupValues[2].trimSwiftWhitespaces())
}

/** 한글이 섞인 후보는 후보가 아니다 — 접근 가능한 이름에 한글이 새는 유일한 경로를 막는다. */
private fun latinCandidate(value: String?): String? {
    val trimmed = value?.trimSwiftWhitespacesAndNewlines() ?: return null
    if (trimmed.isEmpty() || hasHangul(trimmed)) return null
    return trimmed
}

/**
 * 규칙(순서가 곧 우선순위): ①ko → 병기 없음 ②후보 = en 원천 → 로마자 → 없음(한글 섞인 후보는
 * 후보 아님) ③한글 없는 이름(`CU`)은 괄호 잉여 — 후보만 ④후보가 한글 원문과 같으면 병기 없음.
 * `lang`은 앱 선택 언어(ko 외 전부 영문 데이터, 웹 `prefersEnglish` 동형).
 */
fun bilingualName(lang: String, ko: String, en: String?, roman: String?): BilingualName {
    if (lang == "ko") return BilingualName(ko, null)
    parseEmbeddedBilingual(ko)?.let { return it }
    val candidate = latinCandidate(en) ?: latinCandidate(roman) ?: return BilingualName(ko, null)
    if (!hasHangul(ko)) return BilingualName(candidate, null)
    if (nfc(candidate) == nfc(ko.trimSwiftWhitespacesAndNewlines())) return BilingualName(ko, null)
    return BilingualName(candidate, ko)
}
