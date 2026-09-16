package space.dodoplanet.gildongmu.nearby

import space.dodoplanet.gildongmu.kit.models.CultureEvent
import space.dodoplanet.gildongmu.kit.models.NightClinic
import kotlin.test.Test
import kotlin.test.assertEquals

/** spec §12-1 — 소아 진료·아이 놀 곳·문화행사 문장(iOS 함수 이식). 미지 값 분기는 §12 머리 표대로. */
class DomainLinesTest {
    private val w = ClinicWords("의원", "병원", "진료 중", "진료 종료", "진료 여부 알 수 없음", "자정까지") { h, m -> "${h}시 ${m}분까지" }

    @Test fun `진료 상태 3-state — open은 종료시각·자정, closed·unknown은 각자 문장`() {
        assertEquals("진료 중, 23시 30분까지", clinicStatusText(NightClinic.OpenStatus("open", 900, 2330), w))
        assertEquals("진료 중, 자정까지", clinicStatusText(NightClinic.OpenStatus("open", 900, 2400), w))
        assertEquals("진료 중", clinicStatusText(NightClinic.OpenStatus("open"), w))
        assertEquals("진료 종료", clinicStatusText(NightClinic.OpenStatus("closed"), w))
        assertEquals("진료 여부 알 수 없음", clinicStatusText(NightClinic.OpenStatus("unknown"), w))
        assertEquals("진료 여부 알 수 없음", clinicStatusText(NightClinic.OpenStatus("whatever"), w))
    }

    @Test fun `진료 종별은 두 값만 번역, 그 밖은 원문`() {
        assertEquals("의원", clinicKindText("의원", w))
        assertEquals("병원", clinicKindText("병원 ", w)) // :kit이 공백을 걷는다
        assertEquals("보건소", clinicKindText("보건소", w))
    }

    @Test fun `아이 놀 곳 kind는 네 값만 번역·미지 원문, 실내외는 unknown 문구(생략 금지)`() {
        val label = { k: String -> kidsKindLabel(k, "키즈카페", "놀이터", "놀이센터", "공원") }
        assertEquals("놀이터", label("playground")); assertEquals("공원", label("park")); assertEquals("zoo", label("zoo"))
        val inOut = { v: String -> kidsInOutLabel(v, "실내", "실외", "실내외 정보 없음") }
        assertEquals("실내", inOut("indoor")); assertEquals("실외", inOut("outdoor")); assertEquals("실내외 정보 없음", inOut("mixed"))
    }

    @Test fun `요금 문구 — 무료는 원문 중복 금지, 유료 빈 요금은 꼬리 공백 제거`() {
        assertEquals("무료", eventFeeText(event(isFree = true, fee = "무료"), "무료") { "유료 $it" })
        assertEquals("유료 10,000원", eventFeeText(event(isFree = false, fee = "10,000원"), "무료") { "유료 $it" })
        assertEquals("유료", eventFeeText(event(isFree = false, fee = null), "무료") { "유료 $it" })
    }

    private fun event(isFree: Boolean, fee: String?) = CultureEvent(
        id = "1", title = "t", category = "c", place = "p", district = "d", dateText = "date", timeText = "time",
        isFree = isFree, fee = fee, target = "all", lat = 37.5, lng = 127.1, distanceMeters = 100,
    )
}
