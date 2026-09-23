package space.dodoplanet.gildongmu.kit

import kotlinx.serialization.Serializable
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * 대안 경로 이름 조립 규칙(spec 2026-09-24 §4.1). 웹 `transit-alternative-name.test.ts`·Kit
 * `TransitAlternativeNameTests`와 같은 공유 fixture(`transit-alternative-name-cases.json`)를 읽는다.
 */
class TransitAlternativeNameTest {
    @Serializable
    private data class CaseFile(val cases: List<Case>) {
        @Serializable
        data class Case(
            val name: String,
            val highlight: List<String>? = null,
            val displayIndex: Int? = null,
            val parts: List<Part>,
        )

        @Serializable
        data class Part(val key: String, val index: Int? = null)
    }

    @Test fun sharedCases() {
        val cases = Fixtures.sharedJson("transit-alternative-name-cases.json", CaseFile.serializer()).cases
        assertTrue(cases.size >= 10)
        for (c in cases) {
            val got = TransitAlternativeName.parts(c.highlight, c.displayIndex).map { CaseFile.Part(it.key, it.index) }
            assertEquals(c.parts, got, c.name)
        }
    }
}
