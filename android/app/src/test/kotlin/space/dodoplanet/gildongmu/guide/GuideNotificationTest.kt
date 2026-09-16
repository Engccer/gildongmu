package space.dodoplanet.gildongmu.guide

import space.dodoplanet.gildongmu.directions.CatalogStrings
import space.dodoplanet.gildongmu.kit.BeaconDest
import kotlin.test.Test
import kotlin.test.assertEquals

/** spec §4-3·§7-2 — 띠바·알림 본문은 한 조립기를 지난다. */
class GuideNotificationTest {
    private val ko = CatalogStrings("ko")
    private val tracking = WalkGuideUiState(status = GuideStatus.tracking, destinationLabel = "길동역")

    @Test fun `띠바 — 거리 있으면 남은 거리, 없으면 안내 중, 종료 화면은 도착·종료`() {
        assertEquals("길동역까지 남은 거리 850m", bandSummaryText(tracking.copy(bandDistanceMeters = 850), ko))
        assertEquals("길동역까지 남은 거리 1.2km", bandSummaryText(tracking.copy(bandDistanceMeters = 1200), ko))
        assertEquals("길동역까지 안내 중", bandSummaryText(tracking, ko))
        val ended = WalkGuideUiState(destinationLabel = "길동역", arrivalDest = BeaconDest(1.0, 2.0))
        assertEquals("길동역 안내 종료", bandSummaryText(ended.copy(endKind = SessionEndKind.stopped), ko))
        assertEquals("길동역 도착", bandSummaryText(ended.copy(endKind = SessionEndKind.arrived), ko))
        assertEquals("길동역 도착", bandSummaryText(ended.copy(endKind = SessionEndKind.presumed), ko))
    }

    @Test fun `알림 본문 — 상태 문장 우선, 비면 띠바 요약, 제목은 시트 제목과 같은 문장`() {
        assertEquals("길동역까지 안내 중", notificationBodyText(tracking, ko))
        assertEquals("경로에서 벗어난 것 같습니다", notificationBodyText(tracking.copy(statusText = "경로에서 벗어난 것 같습니다", bandDistanceMeters = 80), ko))
        assertEquals("도보 안내, 길동역", notificationTitleText(tracking, ko))
    }
}
