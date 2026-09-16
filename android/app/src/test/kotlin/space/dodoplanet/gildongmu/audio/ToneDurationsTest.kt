package space.dodoplanet.gildongmu.audio

import space.dodoplanet.gildongmu.kit.BeaconTone
import space.dodoplanet.gildongmu.kit.Fixtures
import space.dodoplanet.gildongmu.kit.LeftRightToneScheme
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/** spec §5-1 길이 표 드리프트 가드 + §10-1 소스 가드 ⑤(raw 파일 집합·바이트 == 웹 파일). */
class ToneDurationsTest {
    private val raw = Fixtures.repoRoot.resolve("android/app/src/main/res/raw")
    private val web = Fixtures.repoRoot.resolve("public/sounds/guide")

    /** 톤 × scheme → raw 파일 이름(확장자 제외). left·right만 scheme으로 갈린다. */
    private val expectedNames: Set<String> =
        BeaconTone.entries.flatMap { t -> LeftRightToneScheme.entries.map { s -> t.resourceName(s).replace('-', '_') } }.toSet()

    @Test fun `파서 자가 시험 — 합성 바이트열(ID3v2 + 417바이트 프레임 84개 + ID3v1 꼬리)`() {
        val id3 = byteArrayOf('I'.code.toByte(), 'D'.code.toByte(), '3'.code.toByte(), 4, 0, 0, 0, 0, 0, 10) + ByteArray(10)
        val frame = ByteArray(417).also { it[0] = 0xFF.toByte(); it[1] = 0xFB.toByte(); it[2] = 0x90.toByte(); it[3] = 0xC0.toByte() }
        var body = ByteArray(0)
        repeat(84) { body += frame }
        val bytes = id3 + body + ("TAG" + "x".repeat(125)).toByteArray()
        assertEquals(84 * 1152.0 / 44100, mp3DurationSeconds(bytes), 1e-9)
        // Xing 프레임 수가 있으면 그 값이 우선(합성: 헤더 0xC0 = mono → 사이드 정보 17바이트 뒤 "Xing" + flags 1 + frames 200).
        val xing = frame.copyOf().also { f ->
            val x = 4 + 17
            "Xing".toByteArray().copyInto(f, x)
            f[x + 7] = 1
            f[x + 11] = 200.toByte()
        }
        assertEquals(200 * 1152.0 / 44100, mp3DurationSeconds(id3 + xing + body), 1e-9)
    }

    @Test fun `표가 파일과 맞는다(±0_05초)`() {
        assertEquals(15, expectedNames.size)
        for (tone in BeaconTone.entries) for (scheme in LeftRightToneScheme.entries) {
            val name = tone.resourceName(scheme).replace('-', '_')
            val actual = mp3DurationSeconds(raw.resolve("$name.mp3").readBytes())
            assertTrue(actual > 0, name)
            assertEquals(ToneDurations.seconds(tone, scheme), actual, 0.05, name)
        }
    }

    @Test fun `raw 이름 집합·바이트가 웹 파일과 같다`() {
        // `guide_` 접두만 이 가드의 대상(채팅 효과음 `chat_*`은 M6 소유).
        val files = raw.listFiles { f -> f.extension == "mp3" && f.name.startsWith("guide_") }!!.map { it.nameWithoutExtension }.toSet()
        assertEquals(expectedNames, files)
        for (name in files) {
            val webName = name.removePrefix("guide_").replace('_', '-') + ".mp3"
            assertTrue(raw.resolve("$name.mp3").readBytes().contentEquals(web.resolve(webName).readBytes()), "$name != $webName")
        }
    }

    @Test fun `발화 지연 문턱 0_6초가 표를 가른다 — 최장 톤 + 여유가 상한 안`() {
        val longest = BeaconTone.entries.maxOf { ToneDurations.seconds(it, LeftRightToneScheme.pitch) }
        assertTrue(longest + 0.15 <= 3.0)
        assertEquals(2.20, longest)
    }
}
