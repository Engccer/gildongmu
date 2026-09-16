package space.dodoplanet.gildongmu.kit

// 음성 전사를 검색어로 쓰기 전의 정규화. 웹 `src/lib/format.ts` normalizeVoiceQuery ↔ Kit
// `VoiceQuery.swift` 미러(계약 정본은 웹). 순수 함수만.

/** 후행 문장부호 제거 대상. 중간에 나온 같은 문자는 건드리지 않는다. */
private const val TRAILING_PUNCTUATION = ".,!?…。、．，！？·"

/**
 * 전사에 실제 발화가 담겼는지 판정한다(글자·숫자가 하나라도 있으면 발화로 본다).
 * 받아쓰기 무발화 종료 시 STT가 "."만 내놓는 실측 케이스를 소비 지점 앞 한 곳에서 거른다.
 * `normalizeVoiceQuery`와 책임이 다르다 — 정규화는 검색어를 다듬고, 이 판정은 소비할지를 가른다.
 */
fun hasSpeechContent(text: String): Boolean =
    text.codePoints().anyMatch { Character.isLetterOrDigit(it) }

/**
 * 음성 전사에서 후행 문장부호(와 그 사이 공백)를 제거한다. STT는 발화를 문장으로 보고 끝에
 * 마침표를 붙이는데 juso는 "12."를 건물번호로 못 읽어 0건이 된다(실호출 확정 2026-07-26).
 * 후행만 제거하고, 전부 지워 빈 문자열이 되면 원문을 되돌린다(정규화는 개선이지 파괴가 아니다).
 */
fun normalizeVoiceQuery(text: String): String {
    var end = text.length
    while (end > 0) {
        val ch = text[end - 1]
        if (ch in TRAILING_PUNCTUATION || ch.isWhitespace()) end -= 1 else break
    }
    val stripped = text.substring(0, end).trim()
    return if (stripped.isEmpty()) text.trim() else stripped
}
