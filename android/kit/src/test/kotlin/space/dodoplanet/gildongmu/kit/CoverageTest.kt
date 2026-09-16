package space.dodoplanet.gildongmu.kit

import kotlinx.serialization.Serializable
import kotlin.test.Test
import kotlin.test.assertContentEquals
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class CoverageTest {
    @Test fun `한국 좌표는 커버리지 안`() {
        assertTrue(isInKorea(37.5665, 126.978))
        assertFalse(isInKorea(37.7749, -122.4194))
    }

    /** 프리필터를 상수(≤132.0)로 두었을 때 잘려 나가던 구간 — 독도 영해 링은 동경 132.12까지 뻗는다. */
    @Test fun `프리필터가 링을 잘라내지 않는다`() {
        assertTrue(isInKorea(37.24, 132.05))
        assertFalse(isInKorea(37.24, 132.2))
    }

    @Serializable
    private data class BoundaryCaseFile(val cases: List<Case>) {
        @Serializable
        data class Case(val name: String, val lat: Double, val lng: Double, val inside: Boolean)
    }

    /** 웹 `coverage.test.ts`·Kit `CoverageTests`와 같은 공유 fixture — 국경 판정 드리프트 가드. */
    @Test fun `국경 공유 golden 전수`() {
        val cases = Fixtures.sharedJson("korea-boundary-cases.json", BoundaryCaseFile.serializer()).cases
        assertTrue(cases.size >= 15)
        // inside: true 케이스가 아홉이라, 리소스를 못 읽어 링이 비면(전 좌표 "밖") 여기서 즉시 실패한다.
        for (c in cases) assertEquals(c.inside, isInKorea(c.lat, c.lng), c.name)
    }

    /** 리소스는 웹 정본의 바이트 동일 사본이다(iOS `korea-boundary-drift.test.ts`와 같은 계약). */
    @Test fun `국경 링 리소스는 웹 정본과 바이트 동일`() {
        val web = Fixtures.repoRoot.resolve("src/lib/data/korea-boundary.json").readBytes()
        val resource = checkNotNull(javaClass.getResourceAsStream("/korea-boundary.json")) { "리소스 부재" }.use { it.readBytes() }
        assertContentEquals(web, resource)
    }
}
