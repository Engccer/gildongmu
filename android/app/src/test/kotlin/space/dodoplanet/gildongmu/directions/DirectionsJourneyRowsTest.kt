package space.dodoplanet.gildongmu.directions

import space.dodoplanet.gildongmu.a11y.HapticKind
import space.dodoplanet.gildongmu.kit.DirectionsEndpoint
import space.dodoplanet.gildongmu.kit.JourneyAboardDirection
import space.dodoplanet.gildongmu.kit.RecentStation
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

/** B26 단계 5 묶음 B: 입력 줄 순서·착지 줄·지금 탄 열차 단계 줄·진동 판정을 JVM에서 잠근다(문장은 실제 카탈로그). 노드 수준은 `DirectionsJourneyA11yTest`(계측). */
class DirectionsJourneyRowsTest {
    private val ko = CatalogStrings("ko")
    private val ga = RecentStation("가나역", 37.55, 126.95, "2호선", null)
    private val da = RecentStation("다라역", 37.57, 126.97, null, null)
    private val via = DirectionsEndpoint.Place("마바", 37.5, 127.0)
    private val gu = JourneyAboardDirection("내선", "성수방면", listOf("성수"))
    private val up = JourneyAboardDirection("외선", "시청방면", emptyList())

    private fun rows(s: DirectionsUiState, enabled: Boolean = true) = directionsInputRows(s, enabled)
    private fun tags(s: DirectionsUiState, enabled: Boolean = true) = rows(s, enabled).map { it.tag }

    private val aboard = AboardOrigin(ga, "2호선", direction = null)

    @Test fun `빈 상태는 출발지 바꾸기 도착지 입구 버튼 조회`() {
        assertEquals(listOf("field-from", "swap", "field-to", "via-add", "submit"), tags(DirectionsUiState()))
    }

    @Test fun `경유지가 있으면 경유지 칸과 삭제 버튼이 입구 버튼을 대신한다`() {
        assertEquals(listOf("field-from", "swap", "field-to", "field-via", "via-remove", "submit"), tags(DirectionsUiState(via = via)))
    }

    @Test fun `역 칸 하나 - 칸 남은 쪽 추가 지우기 - 경유지 칸과 입구 버튼은 없다`() {
        assertEquals(
            listOf("field-from", "swap", "field-to", "field-board-station", "station-add-alight", "station-clear", "submit"),
            tags(DirectionsUiState(boardStation = ga)),
        )
        assertEquals(
            listOf("field-from", "swap", "field-to", "field-alight-station", "station-add-board", "station-clear", "submit"),
            tags(DirectionsUiState(alightStation = da)),
        )
        // 경유지가 같이 남아 있어도(모델이 배타로 비우지만) 역 칸이 서면 경유지 줄은 없다.
        assertEquals(false, "field-via" in tags(DirectionsUiState(boardStation = ga, via = via)))
    }

    @Test fun `역 칸 둘이면 추가 버튼이 없다`() {
        assertEquals(
            listOf("field-from", "swap", "field-to", "field-board-station", "field-alight-station", "station-clear", "submit"),
            tags(DirectionsUiState(boardStation = ga, alightStation = da)),
        )
    }

    @Test fun `지금 탄 열차 방면 전 - 단계 줄이 출발지 바로 아래이고 바꾸기와 경유지가 없다`() {
        val s = DirectionsUiState(aboardOrigin = aboard, aboardDirectionsState = AboardDirectionsState.Loaded(listOf(gu, up)))
        assertEquals(listOf("field-from", "aboard-step", "field-to", "station-add-alight", "submit"), tags(s))
        assertEquals(listOf("field-from", "aboard-step", "field-to", "field-alight-station", "submit"), tags(s.copy(alightStation = da)))
    }

    @Test fun `지금 탄 열차 방면 확정 - 단계 줄이 없다`() {
        val s = DirectionsUiState(aboardOrigin = aboard.copy(direction = gu), aboardDirectionsState = AboardDirectionsState.Loaded(listOf(gu, up)))
        assertEquals(listOf("field-from", "field-to", "station-add-alight", "submit"), tags(s))
    }

    @Test fun `지금 탄 열차 방면 조회 전 Idle이면 단계 줄이 없다`() {
        assertEquals(listOf("field-from", "field-to", "station-add-alight", "submit"), tags(DirectionsUiState(aboardOrigin = aboard)))
    }

    @Test fun `여정 입력이 꺼지면 역 칸을 그리지 않고 입구 버튼은 종전 경유지 추가 자리다`() {
        assertEquals(listOf("field-from", "swap", "field-to", "via-add", "submit"), tags(DirectionsUiState(boardStation = ga), enabled = false))
    }

    // ── 착지 줄 ──
    @Test fun `입구와 경유지 착지는 경유지 칸 또는 입구 버튼 - 없으면 조회 버튼`() {
        assertEquals(InputRow.ViaAdd, inputLandingRow(DirectionsFieldTarget.transfer, rows(DirectionsUiState())))
        assertEquals(InputRow.ViaAdd, inputLandingRow(DirectionsFieldTarget.via, rows(DirectionsUiState())))
        assertEquals(InputRow.Via, inputLandingRow(DirectionsFieldTarget.transfer, rows(DirectionsUiState(via = via))))
        assertEquals(InputRow.Submit, inputLandingRow(DirectionsFieldTarget.transfer, rows(DirectionsUiState(boardStation = ga))))
    }

    @Test fun `역 칸 착지는 그 칸 - 칸이 없으면 남은 쪽 추가 버튼`() {
        val one = rows(DirectionsUiState(boardStation = ga))
        assertEquals(InputRow.BoardStation, inputLandingRow(DirectionsFieldTarget.boardStation, one))
        assertEquals(InputRow.AddAlightStation, inputLandingRow(DirectionsFieldTarget.alightStation, one))
        val other = rows(DirectionsUiState(alightStation = da))
        assertEquals(InputRow.AddBoardStation, inputLandingRow(DirectionsFieldTarget.boardStation, other))
        // 지금 탄 열차의 역 B 칸도 같다.
        val onTrain = rows(DirectionsUiState(aboardOrigin = aboard, aboardDirectionsState = AboardDirectionsState.Loading))
        assertEquals(InputRow.AddAlightStation, inputLandingRow(DirectionsFieldTarget.alightStation, onTrain))
        assertEquals(InputRow.Submit, inputLandingRow(DirectionsFieldTarget.boardStation, onTrain))
    }

    @Test fun `칸 비우기 전 커서는 다른 칸 - 둘 다 비면 조회 버튼`() {
        val both = DirectionsUiState(boardStation = ga, alightStation = da)
        assertEquals(InputRow.AlightStation, clearStationCursorRow(both, board = true))
        assertEquals(InputRow.BoardStation, clearStationCursorRow(both, board = false))
        assertEquals(InputRow.Submit, clearStationCursorRow(DirectionsUiState(boardStation = ga), board = true))
        assertEquals(InputRow.Submit, clearStationCursorRow(DirectionsUiState(alightStation = da), board = false))
    }

    // ── 지금 탄 열차 단계 줄 ──
    @Test fun `단계 줄 갈래별 문장과 버튼`() {
        fun spec(state: AboardDirectionsState) = aboardStepSpec(state, ko)
        assertNull(spec(AboardDirectionsState.Idle))

        val lines = spec(AboardDirectionsState.Lines(listOf("2호선", "4호선")))!!
        assertEquals(ko.get("android.journey.aboardLinePrompt"), lines.text)
        assertEquals(listOf("2호선", "4호선"), lines.buttons.map { it.label })
        assertEquals(listOf("aboard-line-0", "aboard-line-1"), lines.buttons.map { it.tag })
        assertEquals(AboardAction.Line("4호선"), lines.buttons[1].action)

        val dirs = spec(AboardDirectionsState.Loaded(listOf(gu, up)))!!
        assertEquals(ko.get("android.journey.aboardDirectionPrompt"), dirs.text)
        assertEquals(listOf(aboardDirectionRowText(gu, ko), "시청방면"), dirs.buttons.map { it.label })
        assertEquals(AboardAction.Direction(up), dirs.buttons[1].action)

        val refresh = ko.get("android.common.refresh")
        for ((state, text) in listOf(
            AboardDirectionsState.Failed to "android.journey.aboardDirectionsFailed",
            AboardDirectionsState.Loaded(emptyList()) to "android.journey.aboardDirectionsEmpty",
        )) {
            val r = spec(state)!!
            assertEquals(ko.get(text), r.text)
            assertEquals(listOf(refresh), r.buttons.map { it.label })
            assertEquals(AboardAction.Refresh, r.buttons.single().action)
        }

        // 문장만: 미커버·로딩.
        for ((state, text) in listOf(
            AboardDirectionsState.Unavailable to "android.journey.aboardDirectionsUnavailable",
            AboardDirectionsState.Loading to "android.journey.aboardDirectionsLoading",
        )) {
            val r = spec(state)!!
            assertEquals(ko.get(text), r.text)
            assertEquals(emptyList(), r.buttons)
        }
    }

    // ── 방면 조회 끝 진동 ──
    @Test fun `조회 중에서 미커버 열차 없음 실패로 넘어올 때만 진동이 나가고 질문은 침묵이다`() {
        val loading = AboardDirectionsState.Loading
        assertEquals(HapticKind.attention, aboardArrivalHaptic(loading, AboardDirectionsState.Unavailable))
        assertEquals(HapticKind.failure, aboardArrivalHaptic(loading, AboardDirectionsState.Failed))
        assertEquals(HapticKind.attention, aboardArrivalHaptic(loading, AboardDirectionsState.Loaded(emptyList())))
        // 질문(노선·방면)은 통지하지 않는다.
        assertNull(aboardArrivalHaptic(loading, AboardDirectionsState.Lines(listOf("2호선", "4호선"))))
        assertNull(aboardArrivalHaptic(loading, AboardDirectionsState.Loaded(listOf(gu))))
        // 조회 중에서 온 전이만 센다: 첫 관찰(null)·같은 상태·다른 출발은 전이가 아니다.
        assertNull(aboardArrivalHaptic(null, AboardDirectionsState.Failed))
        assertNull(aboardArrivalHaptic(AboardDirectionsState.Failed, AboardDirectionsState.Failed))
        assertNull(aboardArrivalHaptic(AboardDirectionsState.Idle, AboardDirectionsState.Unavailable))
    }
}
