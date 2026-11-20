package space.dodoplanet.gildongmu.guide

import space.dodoplanet.gildongmu.kit.Fixtures
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * E90 「안내 시트의 목적지에 전화 걸기」 배선 가드(iOS `guide-destination-call-guard.test.ts`의 안드로이드 몫, Compose는 JVM 레인이 없어 소스로 잠근다).
 * 번호는 세션 통로를 타지 않고 목적지 전화번호부(`PlacePhoneBook`)를 거친다: 고르는 자리가 적고 안내 시트가 찾는다.
 * 적는 자리가 하나 빠지면 오류 없이 그 진입 경로에서만 전화 동작이 사라진다.
 */
class GuideDestinationCallGuardTest {
    private val pkg = Fixtures.repoRoot.resolve("android/app/src/main/kotlin/space/dodoplanet/gildongmu")
    private fun read(rel: String) = pkg.resolve(rel).readText()
    private fun count(src: String, needle: String) = Regex(Regex.escape(needle)).findAll(src).count()

    @Test fun `안내 시트 — 제목 메뉴와 장소 상세가 같은 번호를 쓰고 번호는 세션 통로를 타지 않는다`() {
        val sheet = read("guide/ui/GuideSheet.kt")
        assertTrue(sheet.contains("AppConfig.placePhoneBook.guideDestinationPhone(ui.dest, ui.destinationLabel)"))
        assertTrue(sheet.contains("items = guideTitleMenuItems(destinationPhone)"))
        assertTrue(sheet.contains("guideDestinationPlace(it, ui.destinationLabel, destinationPhone)"))
        assertTrue(sheet.contains("GuideTitleMenuItem.call -> destinationPhone?.let { phone ->"))
        // 번호는 안내 세션(요청·모델·UI 상태)에 실리지 않는다.
        for (file in listOf("WalkStartRequest.kt", "WalkGuideUiState.kt", "WalkGuideModel.kt")) {
            assertTrue(!Regex("""(?i)\bphone""").containsMatchIn(read("guide/$file")), file)
        }
    }

    @Test fun `장소를 길찾기 끝점·안내 목적지로 넘기는 자리가 번호를 적는다`() {
        // 파일별 적는 자리 수. 장소(`Place`)를 도착지로 넘기는 새 자리를 더하면 여기도 더한다.
        val sites = mapOf(
            "directions/EndpointPicker.kt" to "        noteDestinationPhone(place)\n", // 끝점 검색 후보 선택(길찾기 폼·안내 시트 목적지 바꾸기, 수동 위치 지정은 {} 명시)
            "place/PlaceDetailScreen.kt" to "AppConfig.placePhoneBook.noteDestination(place)", // 「여기까지 길찾기」(「여기부터」는 목적지가 아니다)
            "guide/ui/GuideHereButtons.kt" to "AppConfig.placePhoneBook.noteDestination(place)", // 「여기로 목적지 변경」(경유지는 목적지가 아니다)
        )
        for ((file, needle) in sites) assertEquals(1, count(read(file), needle), file)
        // 지정 화면(수동 위치)은 목적지가 아니라 적지 않는다 — 명시적 빈 람다.
        assertTrue(read("location/ManualLocationPickerViewModel.kt").contains("noteDestinationPhone = {}"))
        // 길찾기 폼·안내 시트 검색은 전화번호부 적는 자리를 건넨다.
        assertTrue(read("directions/DirectionsViewModel.kt").contains("noteDestinationPhone = phoneBook::noteDestination"))
        assertTrue(read("guide/ui/GuideSheet.kt").contains("noteDestinationPhone = AppConfig.placePhoneBook::noteDestination"))
        // 「여기까지」만 적는다.
        assertTrue(read("place/PlaceDetailScreen.kt").contains("if (role == DirectionsPrefillRole.to) AppConfig.placePhoneBook.noteDestination(place)"))
        // 정문 승격(iOS A11): 안내 제목이 정문 이름·좌표가 되므로 고른 장소의 번호를 그 열쇠로도 적는다.
        assertTrue(Regex("""if \(promoted != null && to is DirectionsEndpoint\.Place\) \{\s+phoneBook\.guideDestinationPhone\(BeaconDest\(queried\.lat, queried\.lng\), to\.label\)\s+\?\.let \{ phoneBook\.note\(promoted\.label, promoted\.lat, promoted\.lng, it\) \}""")
            .containsMatchIn(read("directions/DirectionsViewModel.kt")))
    }

    @Test fun `역은 적지 않는다`() {
        val src = read("directions/DestinationPhone.kt")
        assertTrue(src.contains("if (stationLayoutKind(place) != null) return"))
    }
}
