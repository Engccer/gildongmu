package space.dodoplanet.gildongmu.directions

import space.dodoplanet.gildongmu.kit.Fixtures
import kotlin.test.Test
import kotlin.test.assertTrue

/**
 * 길찾기 조회 화면의 정체 줄 배선(B17, 웹·iOS 가드 `src/lib/__tests__/e80-traffic-wiring-guard.test.ts`의 안드로이드판).
 * 옵트인이나 행 한 줄이 빠지면 자동차 결과에서 정체 줄이 조용히 사라지고, 행이 없는 모양은 「정보 없음」과 같아 화면·낭독으로 드러나지 않는다.
 */
class CarTrafficWiringGuardTest {
    private val dir = Fixtures.repoRoot.resolve("android/app/src/main/kotlin/space/dodoplanet/gildongmu/directions")

    @Test fun `조회 화면은 자동차 정체를 옵트인하고 결과에 정체 행을 세운다`() {
        assertTrue(Regex("""routes\.car\([^)]*traffic = true\)""").containsMatchIn(dir.resolve("DirectionsViewModel.kt").readText()), "조회 옵트인")
        assertTrue(dir.resolve("RouteRows.kt").readText().contains("""carCongestionText(briefing.congestion, english = lang != "ko", strings)?.let { TextRow(it, "car-congestion") }"""), "정체 행")
    }

    @Test fun `「출발 지점부터」 문턱과 이름 상한은 웹·iOS와 같다`() {
        val text = dir.resolve("RouteText.kt").readText()
        assertTrue(text.contains("private const val carJamFromStartMeters = 100"))
        assertTrue(text.contains("private const val carBriefingJamMax = 3"))
    }
}
