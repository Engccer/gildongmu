package space.dodoplanet.gildongmu.kit

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue
import kotlin.test.fail

/**
 * 진행 상태 진동(E30 실험판) — Kit `TrendHapticsTests` 미러. 스위치 대상 톤은 **정확히** 가까워짐·정지·신뢰 불가
 * 셋이다. 나머지 10종은 스위치와 무관하게 진동한다("꺼짐 = 현재 동작", 위원장 2026-09-13).
 */
class BeaconTonesTest {
    @Test fun `옵트인 톤은 closer·tick·unreliable 셋뿐이다`() {
        assertEquals(setOf(BeaconTone.closer, BeaconTone.tick, BeaconTone.unreliable), BeaconTone.entries.filter { it.hapticIsOptIn }.toSet())
    }

    @Test fun `우선 톤·이벤트 톤·세션 경계 톤은 옵트인이 아니다`() {
        val alwaysOn = listOf(
            BeaconTone.warning, BeaconTone.nearby, BeaconTone.farther, BeaconTone.ahead, BeaconTone.crosswalk,
            BeaconTone.left, BeaconTone.right, BeaconTone.back, BeaconTone.start, BeaconTone.stop,
        )
        for (tone in alwaysOn) assertFalse(tone.hapticIsOptIn, "$tone")
    }

    /** 케이스 이름이 곧 소리 파일 이름이고 저장 키는 설정 값의 주소다 — 공유 fixture가 없어 Swift 원본과 직접 대조한다. */
    @Test fun `톤 케이스·좌우 방식·저장 키는 Swift 원본과 같다`() {
        val source = SwiftSource.read("BeaconTones.swift")
        fun casesOf(enumName: String): List<String> =
            Regex("""public enum $enumName: String[^{]*\{[ \t\r\n]*case ([A-Za-z, ]+)""").find(source)?.groupValues?.get(1)
                ?.split(",")?.map { it.trim() } ?: fail("$enumName 케이스 선언을 찾지 못했다")
        assertEquals(casesOf("BeaconTone"), BeaconTone.entries.map { it.rawValue })
        assertEquals(casesOf("LeftRightToneScheme"), LeftRightToneScheme.entries.map { it.rawValue })
        // 저장 키는 선언한 enum과 짝으로 대조한다(파일 안 선언 순서에 묶이지 않고, 두 키가 서로 바뀐 것도 잡는다).
        val keys = Regex("""public enum ([A-Za-z]+)[^{]*\{[^}]*?public static let storageKey = "([A-Za-z0-9]+)"""").findAll(source)
            .associate { it.groupValues[1] to it.groupValues[2] }
        assertEquals(mapOf("TrendHaptics" to TrendHaptics.storageKey, "LeftRightToneScheme" to LeftRightToneScheme.storageKey), keys)
        assertTrue(source.contains("""public static let `default`: LeftRightToneScheme = .${LeftRightToneScheme.default.rawValue}"""))
    }
}
