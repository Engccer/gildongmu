package space.dodoplanet.gildongmu.kit

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

/**
 * ⚠ 이 표는 웹 `korean-particle.test.ts`의 `PARTICLE_CASES`·Kit `KoreanParticleTests`의 `particleCases`와
 * **같은 케이스**를 든다. 판정 불가(`null`)는 `"-"`로 적는다.
 * 열: (단어, 목적격 을/를, 주격 이/가, 보조사 은/는, 방향 (으)로).
 */
private data class Row(val word: String, val obj: String, val subject: String, val topic: String, val direction: String)

private val particleCases = listOf(
    Row("성내로", "를", "가", "는", "로"),
    Row("천호대로", "를", "가", "는", "로"),
    Row("이마트", "를", "가", "는", "로"),
    Row("명일로24길", "을", "이", "은", "로"),
    Row("강동구청", "을", "이", "은", "으로"),
    Row("봉래면옥", "을", "이", "은", "으로"),
    Row("GS25", "-", "-", "-", "-"),
    Row("스타벅스 R", "-", "-", "-", "-"),
    Row("자택 아파트 101", "-", "-", "-", "-"),
    Row("카페(임시)", "-", "-", "-", "-"),
    Row("", "-", "-", "-", "-"),
)

class KoreanParticleTest {
    @Test
    fun `표대로 조사를 고른다`() {
        for (r in particleCases) {
            assertEquals(r.obj, KoreanParticle.objectMarker(r.word) ?: "-", "${r.word} 목적격")
            assertEquals(r.subject, KoreanParticle.subjectMarker(r.word) ?: "-", "${r.word} 주격")
            assertEquals(r.topic, KoreanParticle.topicMarker(r.word) ?: "-", "${r.word} 보조사")
            assertEquals(r.direction, KoreanParticle.directionMarker(r.word) ?: "-", "${r.word} 방향")
        }
    }

    @Test
    fun `판정 불가면 null이라 호출자가 대체 문형을 고른다`() {
        assertNull(KoreanParticle.objectMarker("GS25"))
        assertNull(KoreanParticle.hasFinalConsonant(""))
    }
}
