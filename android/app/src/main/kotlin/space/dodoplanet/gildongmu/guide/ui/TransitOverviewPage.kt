package space.dodoplanet.gildongmu.guide.ui

import androidx.compose.runtime.Composable
import space.dodoplanet.gildongmu.directions.Strings
import space.dodoplanet.gildongmu.guide.TransitGuideUiState

/**
 * 조망이 닫힌 뒤 시트가 할 일(iOS `GuideOverviewSheet`의 `followUp` 콜백 → 시트 `OverviewFollowUp`, E15-1 spec §4.3 「닫힌 뒤 행동」 계약).
 * 조망 안에서 시트 컨트롤에 착지하거나 `beginReboard()`를 직접 부르지 않는다 — 페이지가 닫힌 뒤 시트 한 곳(`runPendingFollowUp`)이 실행한다.
 */
enum class TransitOverviewExit {
    /** 「탑승 변경」 — 닫힌 뒤 모델 `beginReboard()`(역을 물을 수 있는 구간은 질문 헤딩, 그 밖은 대기 목록 라벨 착지가 맡는다). */
    beginReboard,
    /** 다른 경로로 전환 확정 — 닫힌 뒤 상태 문장 착지(E38, 새 경로의 첫 상태를 읽는 자리). */
    routeSwitched,
}

/**
 * 대중교통 진행 상황 조망 페이지(iOS `GuideOverviewSheet` + `TransitOverviewAdapter`, E15-1). 시트 안의 페이지라(M4b — 시트 위에 시트를 올리지 않는다)
 * 시트가 고른다: 진행 상황 버튼이 열고, 뒤로·닫기·국면 전이가 닫는다. 진입 착지(헤더)는 이 페이지가 맡는다.
 *
 * `onClose(exit)`: 닫기 — `exit`이 null이면 그냥 닫기(시트가 이월된 착지 또는 진행 상황 버튼으로 되돌린다), 아니면 닫힌 뒤 할 일. 조망이 열린 채 국면이
 * 바뀌면 시트가 스스로 닫는다(그 행·행동은 낡았다). 「다른 경로」 조회는 페이지가 어떤 경로로 닫혀도 시트가 `cancelAltRoutes`로 거둔다.
 */
@Composable
fun TransitOverviewPage(ui: TransitGuideUiState, strings: Strings, nav: GuideNav, onClose: (exit: TransitOverviewExit?) -> Unit) {
    // 5-E: TransitOverviewAdapter
}
