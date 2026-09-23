package space.dodoplanet.gildongmu.directions

import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.CustomAccessibilityAction
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.repeatOnLifecycle
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.launch
import space.dodoplanet.gildongmu.a11y.HapticKind
import space.dodoplanet.gildongmu.i18n.appLocalized
import space.dodoplanet.gildongmu.kit.DataLocale
import space.dodoplanet.gildongmu.kit.StationPhoneResult
import space.dodoplanet.gildongmu.kit.TransitBriefingRow
import space.dodoplanet.gildongmu.kit.models.TransitLegStop
import space.dodoplanet.gildongmu.kit.models.TransitRouteLeg
import space.dodoplanet.gildongmu.kit.transitBriefingStations
import space.dodoplanet.gildongmu.kit.transitLegUsesEnglish
import space.dodoplanet.gildongmu.place.StationPhoneStore
import space.dodoplanet.gildongmu.place.callStationPhone
import space.dodoplanet.gildongmu.place.dial

// 경로 브리핑의 지하철역 상세·전화(E45, spec 2026-09-18-briefing-station-entry-design, iOS `RouteBriefing.swift` `BriefingStationRow` 대응).
// 줄은 언제나 같은 텍스트 한 객체이고 진입은 접근성 작업 메뉴(사용자 지정 액션)뿐이다 — 역 개수는 액션 수만 정하고 뷰 종류를 정하지 않는다.

/**
 * 역 진입점을 켜는 소비자의 동작(옵트인). 길찾기 탭만 넘긴다 — push 경로가 없는 소비자(안내 조망의 "다른 경로" 후보, M5 이식)에서
 * 켜지면 작업 메뉴에 무반응 액션이 선다(스크린 리더 사용자에게 진단할 수 없는 고장). 열기와 통지를 한 값으로 묶어 "켜졌는데 동작이 없다"는
 * 조합을 구조적으로 막는다(iOS `stationEntry` 클로저와 같은 판단).
 */
class BriefingStationEntry(
    /** 역 상세 열기 — 노선 힌트는 누르는 순간 확정한 그 줄의 `lineName`(없으면 null), `rowTag`는 pop 복귀 착지할 그 줄. */
    val onOpen: (stop: TransitLegStop, lineName: String?, rowTag: String) -> Unit,
    /** 전화 결과 통지 — 화면의 단일 통지 창구로(진동은 문장이 나가는 조건과 같다). */
    val announce: (text: String, haptic: HapticKind) -> Unit,
    /** 그 줄의 착지 요청자(역 상세에서 돌아오면 커서가 그 줄로 — iOS NavigationStack pop 동형). */
    val rowFocus: (rowTag: String) -> FocusRequester,
)

/** 브리핑 줄에 달릴 역 액션 하나 — :kit 판정(대상 역·노선 힌트)에 **그 줄의 언어로 고른 표시 이름**을 얹는다. */
data class BriefingStationAction(val stop: TransitLegStop, val lineName: String?, val name: String)

/**
 * 그 줄의 역 액션들(spec §3.2·§6). 대상 역은 :kit이 이름 조인으로 고르고, 여기서는 라벨 이름의 언어만 정한다.
 *
 * ⚠ 이름의 언어는 **그 줄이 쓴 언어**다(앱 언어가 아니다). 술어는 구간 줄·하차 줄이 쓰는 것과 같은 하나(`transitLegUsesEnglish`)라 줄이
 *   한국어로 떨어지면 라벨도 함께 떨어진다. 영문은 `stop.nameEn`이 아니라 :kit이 실은 `nameEn`(= 그 줄이 쓴 leg 필드)이다.
 */
fun briefingStationActions(legs: List<TransitRouteLeg>, row: TransitBriefingRow, dataLocale: DataLocale): List<BriefingStationAction> {
    val stations = transitBriefingStations(legs, row)
    if (stations.isEmpty()) return emptyList()
    val usesEnglish = transitLegUsesEnglish(legs[row.index], dataLocale)
    return stations.map { BriefingStationAction(it.stop, it.lineName, (if (usesEnglish) it.nameEn else null) ?: it.stop.name) }
}

/** 작업 메뉴 한 항목의 종류. */
enum class BriefingRotorKind { open, call }

/**
 * 작업 메뉴 순서 — **역별로 묶어 등장 순**(판정 ③): A 상세 → A 전화 → B 상세 → B 전화.
 * 안드로이드는 선언 순서 그대로 노출한다(채팅 산문 블록 선례) — iOS의 역순 선언(SwiftUI 빌더가 역순 노출)은 SwiftUI 전용 함정이라 옮기지 않는다.
 */
fun briefingRotorOrder(actions: List<BriefingStationAction>): List<Pair<BriefingStationAction, BriefingRotorKind>> =
    actions.flatMap { listOf(it to BriefingRotorKind.open, it to BriefingRotorKind.call) }

/**
 * 작업 메뉴 항목 전부 — 길이는 언제나 `actions.size * 2`다(전화 액션은 상태와 무관하게 상시, 판정 ④). 상태로 갈리는 것은 전화 **라벨**뿐이고
 * (대표번호면 "대표번호로 전화 걸기"), 동작은 누르는 순간 저장소를 다시 읽는 단일 창구가 정한다. 컴포저블 밖 순수 함수라 JVM이 잠근다.
 */
fun briefingCustomActions(
    actions: List<BriefingStationAction>,
    lookedUp: (BriefingStationAction) -> StationPhoneResult?,
    strings: Strings,
    onOpen: (BriefingStationAction) -> Unit,
    onCall: (BriefingStationAction) -> Unit,
): List<CustomAccessibilityAction> = briefingRotorOrder(actions).map { (station, kind) ->
    when (kind) {
        BriefingRotorKind.open -> CustomAccessibilityAction(strings.get("transitGuide.openStation", station.name)) { onOpen(station); true }
        BriefingRotorKind.call -> {
            val label = if (lookedUp(station) is StationPhoneResult.Representative) "transitGuide.callStationRepresentative" else "transitGuide.callStation"
            CustomAccessibilityAction(strings.get(label, station.name)) { onCall(station); true }
        }
    }
}

/**
 * 역 액션을 든 브리핑 줄. **저장소는 이 하위 컴포저블만 관찰한다** — 전화 라벨이 직통·대표번호로 갈리므로 라벨 계산이 저장소를 읽어야 하는데,
 * 그 읽기가 브리핑 본문에 있으면 번호 도착·30초 재확인·6분 축출마다 브리핑 전체가 다시 그려진다(E44 리뷰 M5).
 *
 * 전화 액션은 저장소 상태와 **무관하게 항상** 선다(판정 ④) — 번호 없음·찾는 중·실패를 액션 부재로 뭉개면 3상태가 사라지고, 메뉴를 연 사이
 * 목록 길이가 변한다. 상태로 갈리는 것은 라벨뿐이다.
 */
@Composable
fun BriefingStationRow(
    text: String,
    tag: String,
    spoken: String?,
    actions: List<BriefingStationAction>,
    entry: BriefingStationEntry,
    strings: Strings,
    store: StationPhoneStore = StationPhoneStore.shared,
) {
    val context = LocalContext.current
    val results by store.results.collectAsState()
    // 줄이 보이는 동안(STARTED) 이 줄의 역만 신선하게 유지한다 — 저장소는 갱신되지 않은 값을 6분에 지우고, 브리핑은 출발 전에 오래 머무는
    // 화면이다. ⚠ `leg.stops` 전체가 아니라 이 줄의 역만(줄당 최대 2건, spec §5.2). 공유 조회 자체는 저장소 스코프라 취소되지 않는다.
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    // 키는 대상(역·노선)만 — 표시 이름이 언어로 바뀌어도 루프를 다시 시작하지 않는다(iOS `taskKey` 동형).
    LaunchedEffect(actions.map { it.stop to it.lineName }, lifecycle) {
        lifecycle.repeatOnLifecycle(Lifecycle.State.STARTED) {
            coroutineScope {
                for (a in actions) launch { store.keepFresh(a.stop.name, a.stop.lat, a.stop.lng, a.lineName ?: "") }
            }
        }
    }
    val custom = briefingCustomActions(
        actions,
        lookedUp = { a -> StationPhoneStore.key(a.stop.name, a.stop.lat, a.stop.lng, a.lineName ?: "")?.let { results[it] } },
        strings = strings,
        onOpen = { a -> entry.onOpen(a.stop, a.lineName, tag) },
        onCall = { a ->
            callStationPhone(store, a.stop, a.lineName ?: "", context::dial)?.let { entry.announce(appLocalized(context.resources, it.text), it.haptic) }
        },
    )
    TextRow(text, tag, spoken = spoken, actions = custom, focus = entry.rowFocus(tag))
}
