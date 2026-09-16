package space.dodoplanet.gildongmu.kit

/**
 * 한국어 조사 판정(순수 함수, ko 전용). 웹 `src/lib/korean-particle.ts` ↔ Kit
 * `KoreanParticle.swift` 미러 — 표 대조는 `KoreanParticleTest`가 강제한다.
 *
 * ⚠ **한글이 아니면 `null`이다.** 영문·숫자·기호로 끝나는 고유명사는 받침을 알 수 없다.
 * 호출자는 `null`을 받으면 그 자리의 조사 삽입만 포기하고 조사 없이도 문법적인 형태로 물러난다.
 *
 * 이름 변경(Kotlin 예약어): Swift `object(_:)` → `objectMarker`. 나머지 셋도 짝을 맞춰
 * `subjectMarker`·`topicMarker`·`directionMarker`로 둔다.
 */
object KoreanParticle {
    private const val HANGUL_FIRST = 0xAC00
    private const val HANGUL_LAST = 0xD7A3
    private const val JONGSEONG_COUNT = 28

    /** ㄹ 받침의 종성 인덱스 — "(으)로"만 이 받침을 받침 없음과 같이 다룬다(서울로·길동으로). */
    private const val JONGSEONG_RIEUL = 8

    /**
     * 마지막 글자의 종성 인덱스(0 = 받침 없음). 한글 음절이 아니면 `null`.
     * ⚠ `last()`(UTF-16 단위)가 아니라 **마지막 코드 포인트**를 본다.
     */
    private fun jongseongIndex(word: String): Int? {
        if (word.isEmpty()) return null
        val value = word.codePointBefore(word.length)
        if (value < HANGUL_FIRST || value > HANGUL_LAST) return null
        return (value - HANGUL_FIRST) % JONGSEONG_COUNT
    }

    /** 마지막 글자에 받침이 있는가. 한글 음절이 아니면 `null`. */
    fun hasFinalConsonant(word: String): Boolean? = jongseongIndex(word)?.let { it != 0 }

    /** 목적격 조사 `을`/`를`. 판정 불가면 `null`. */
    fun objectMarker(word: String): String? = hasFinalConsonant(word)?.let { if (it) "을" else "를" }

    /** 주격 조사 `이`/`가`. 판정 불가면 `null`. */
    fun subjectMarker(word: String): String? = hasFinalConsonant(word)?.let { if (it) "이" else "가" }

    /** 보조사 `은`/`는`. 판정 불가면 `null`. */
    fun topicMarker(word: String): String? = hasFinalConsonant(word)?.let { if (it) "은" else "는" }

    /** 방향·자격 조사 `으로`/`로`. ㄹ 받침은 `로`(서울로). 판정 불가면 `null`. */
    fun directionMarker(word: String): String? =
        jongseongIndex(word)?.let { if (it == 0 || it == JONGSEONG_RIEUL) "로" else "으로" }
}
