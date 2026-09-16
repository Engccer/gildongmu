package space.dodoplanet.gildongmu.place

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import space.dodoplanet.gildongmu.a11y.Notice
import space.dodoplanet.gildongmu.kit.PlaceHoursService
import space.dodoplanet.gildongmu.kit.PlaceHoursToday
import space.dodoplanet.gildongmu.kit.StationService
import space.dodoplanet.gildongmu.kit.isStation
import space.dodoplanet.gildongmu.kit.models.Place

/** 상세 화면 문장(호출 시점 람다). */
class PlaceStrings(
    val copied: () -> String,
    val noAppToOpen: () -> String,
    val hoursLine: (String) -> String,
    val allDay: () -> String,
    val closed: () -> String,
    val nextDay: (String) -> String,
)

/**
 * 영업시간 한 줄(E24): 실패·부재·매칭 실패·쿼터 소진을 구분하지 않고 null = 줄 없음(침묵). 시간표형만 쓰고 단정형("지금 영업 중")은
 * 쓰지 않는다. "Google Maps"는 attribution 의무 표기라 번역·변형하지 않는다(문구는 카탈로그 `placeHours.*`).
 */
fun hoursLineText(hours: PlaceHoursToday, s: PlaceStrings): String {
    if (hours.allDay) return s.hoursLine(s.allDay())
    if (hours.ranges.isEmpty()) return s.closed()
    val ranges = hours.ranges.joinToString(", ") { r -> "${r.open}~${if (r.closesNextDay) s.nextDay(r.close) else r.close}" }
    return s.hoursLine(ranges)
}

/**
 * 장소 상세 상태: 영업시간 줄(진입 시 1회, 조용히) + 통지(복사·열기 실패) + 조용한 조각(역 자동 섹션 5종 — spec §12-3, 역일 때만).
 * `station`은 테스트 편의로 nullable(없으면 역 섹션 로드 없음).
 */
class PlaceDetailViewModel(
    val place: Place,
    private val hours: PlaceHoursService,
    private val strings: PlaceStrings,
    station: StationService? = null,
    dataLocale: () -> String = { "ko" },
) : ViewModel() {
    private val _hoursLine = MutableStateFlow<String?>(null)
    val hoursLine: StateFlow<String?> = _hoursLine.asStateFlow()

    /** 역 자동 섹션 5종 — null = 역이 아니거나 아직 도착 전(로딩 표시 없음, 값이 생기면 조용히 나타난다). */
    private val _station = MutableStateFlow<StationSections?>(null)
    val station: StateFlow<StationSections?> = _station.asStateFlow()

    private val _notice = MutableStateFlow(Notice(0, ""))
    val notice: StateFlow<Notice> = _notice.asStateFlow()

    val kakaoPlaceId: String? = kakaoPlaceIdOf(place.id)

    init {
        viewModelScope.launch {
            val today = hours.today(place.lat, place.lng, place.name, place.roadAddress) // 전송 계층이 IO로 옮긴다
            _hoursLine.value = today?.let { hoursLineText(it, strings) }
        }
        if (station != null && isStation(place)) {
            viewModelScope.launch { _station.value = loadStationSections(station, place.name, dataLocale()) }
        }
    }

    /** 복사 뒤 통지 — 포커스가 버튼에 그대로 남으므로 통지가 유일한 증거. */
    fun onCopied() = post(strings.copied())

    fun onOpenFailed() = post(strings.noAppToOpen())

    private fun post(text: String) {
        _notice.value = Notice(_notice.value.seq + 1, text)
    }
}
