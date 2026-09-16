package space.dodoplanet.gildongmu.nearby

import space.dodoplanet.gildongmu.kit.models.SurroundingsSceneItem
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull

/** spec §12-2 — 묶음 제목 임계·12 bucket 전수·항목 문장(도로명은 비-ko에서 로마자만)·행 키. */
class SceneLinesTest {
    private val item = SurroundingsSceneItem(
        name = "카페", nameRoman = "Cafe", distanceMeters = 30, road = "천호대로", roadRoman = "Cheonho-daero",
        category = "카페", id = "kakao-1", lat = 37.5, lng = 127.1, categoryRaw = "음식점 > 카페",
    )

    @Test fun `묶음 제목은 3개 초과에만 곳수 병기`() {
        assertEquals("왼쪽", sceneBucketTitle("왼쪽", 3) { "${it}곳" })
        assertEquals("왼쪽 4곳", sceneBucketTitle("왼쪽", 4) { "${it}곳" })
    }

    @Test fun `12 bucket 키 전수 매핑, 미지 값 null(호출부 원값 노출)`() {
        listOf("left", "right", "across", "beyond", "n", "ne", "e", "se", "s", "sw", "w", "nw").forEach { assertNotNull(sceneBucketResId(it), it) }
        assertNull(sceneBucketResId("up"))
    }

    @Test fun `항목 문장 — 도로명은 비-ko에서 로마자만, 없으면 평문`() {
        assertEquals("30m 앞 카페, 천호대로", sceneItemLine(item, "카페", "ko", { d, n, r -> "$d 앞 $n, $r" }) { d, n -> "$d 앞 $n" })
        assertEquals("30m Cafe, Cheonho-daero", sceneItemLine(item, "Cafe", "en", { d, n, r -> "$d $n, $r" }) { d, n -> "$d $n" })
        assertEquals("30m 천호대로", sceneItemLine(item.copy(roadRoman = null), "x", "en", { d, _, r -> "$d $r" }) { d, n -> "$d $n" }) // 로마자 부재는 원문
        assertEquals("30m 앞 카페", sceneItemLine(item.copy(road = null), "카페", "ko", { _, _, _ -> "x" }) { d, n -> "$d 앞 $n" })
    }

    @Test fun `행 키는 scene-item-{bucket}-{index}(place-{id}와 충돌하지 않는다)`() {
        assertEquals("scene-item-left-3", sceneItemKey("left", 3))
    }
}
