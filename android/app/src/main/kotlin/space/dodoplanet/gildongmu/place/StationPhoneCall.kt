package space.dodoplanet.gildongmu.place

import androidx.annotation.StringRes
import space.dodoplanet.gildongmu.BuildConfig
import space.dodoplanet.gildongmu.R
import space.dodoplanet.gildongmu.a11y.HapticKind
import space.dodoplanet.gildongmu.kit.ResultHapticKind
import space.dodoplanet.gildongmu.kit.StationPhoneResult
import space.dodoplanet.gildongmu.kit.briefingPhoneAnnouncement
import space.dodoplanet.gildongmu.kit.models.TransitLegStop

/** 역 전화 액션의 결과 통지 한 건 — 문장(인자 없음)과 진동. 소비 화면이 자기 단일 통지 창구(`StatusLine`)에 싣는다. */
data class StationPhoneNotice(@param:StringRes val text: Int, val haptic: HapticKind)

/**
 * 역 전화 액션의 단일 창구(E45 spec §5.1, iOS `callStationPhone` 미러). 경로 브리핑 작업 메뉴가 쓰고, 안내 시트 경유역 행(M5 이식)도
 * 같은 한 벌을 지나야 한다 — 두 벌이면 한쪽만 고쳐져 같은 상황에서 다른 말을 하게 된다.
 *
 * - 번호가 있으면 다이얼러를 열고 **통지하지 않는다**(null — 화면 전환이 곧 응답이다).
 * - ⚠ 번호가 있어도 열지 못할 수 있다(받는 앱 없음). 그때 조용히 끝나면 통지 0·진동 0·화면 변화 0이고 라벨은 "…에 전화 걸기" 그대로라
 *   스크린 리더 사용자에게 단서가 없다 — 조회 실패와 같은 창구로 떨어뜨린다(사용자가 할 일 "다른 수단으로 건다"가 같다).
 * - 없음·모름·실패는 문장과 진동을 함께 낸다. 화면이 바뀌지 않는 활성화 응답이라 통지가 유일한 증거다.
 * - ⚠ 모름(null)은 조회 전·첫 조회 중·보관 한도 축출을 겹쳐 든다. 아무도 다시 조회하지 않으면 "찾고 있습니다"가 영영 거짓이므로
 *   **통지 전에 조회를 킥오프**해 사후적으로 참이 되게 한다(`prefetch`는 저장소 스코프라 호출부가 사라져도 끝까지 돈다).
 *
 * `lineName`은 조회 노선 힌트(없으면 빈 문자열 — 노선 표가 모르면 저장소가 "없음"으로 즉답한다, 판정 복제 금지). 메인 스레드 전용(저장소 계약).
 */
fun callStationPhone(store: StationPhoneStore, stop: TransitLegStop, lineName: String, dial: (String) -> Boolean): StationPhoneNotice? {
    when (val result = store.result(stop.name, stop.lat, stop.lng, lineName)) {
        is StationPhoneResult.Direct -> return if (dial(result.phone)) null else stationPhoneNotice(StationPhoneResult.Failed)
        is StationPhoneResult.Representative -> return if (dial(result.phone)) null else stationPhoneNotice(StationPhoneResult.Failed)
        null -> {
            store.prefetch(listOf(stop), lineName)
            return stationPhoneNotice(null)
        }
        else -> return stationPhoneNotice(result)
    }
}

/**
 * :kit 판정(키·진동) → 앱 리소스. 키는 리터럴 `when`으로 되받는다(iOS 관례 — :kit이 키를 늘렸는데 여기 갈래가 빠지면 디버그에서 즉시
 * 드러낸다). 릴리스는 실패 문장으로 떨어뜨려 침묵을 피한다.
 */
internal fun stationPhoneNotice(result: StationPhoneResult?): StationPhoneNotice? {
    val notice = briefingPhoneAnnouncement(result) ?: return null
    val text = when (notice.key) {
        "ios.station.phoneMissing" -> R.string.android_station_phoneMissing
        "ios.station.phonePending" -> R.string.android_station_phonePending
        "ios.station.phoneError" -> R.string.android_station_phoneError
        else -> {
            check(!BuildConfig.DEBUG) { "briefingPhoneAnnouncement 키 미매핑: ${notice.key}" }
            R.string.android_station_phoneError
        }
    }
    val haptic = when (notice.haptic) {
        ResultHapticKind.success -> HapticKind.success
        ResultHapticKind.attention -> HapticKind.attention
        ResultHapticKind.failure -> HapticKind.failure
    }
    return StationPhoneNotice(text, haptic)
}
