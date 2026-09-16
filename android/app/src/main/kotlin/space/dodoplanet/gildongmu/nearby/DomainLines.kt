package space.dodoplanet.gildongmu.nearby

import space.dodoplanet.gildongmu.kit.clinicKindKey
import space.dodoplanet.gildongmu.kit.joinText
import space.dodoplanet.gildongmu.kit.models.CultureEvent
import space.dodoplanet.gildongmu.kit.models.NightClinic

// 소아 진료·아이 놀 곳·문화행사 문장(iOS `ClinicNearbyView`·`KidsNearbyView`·`EventsNearbyView` 이식, spec §12-1).
// 리소스는 낱말·람다로 받는다(JVM 검증). 미지 값 처리는 표마다 다르다(spec §12 머리 표) — 여기서는 원문 그대로 / `unknown` 문구.

/** 소아 진료 낱말 묶음(화면이 리소스에서 채운다 — `clinicWords(res)`). */
class ClinicWords(
    val kindClinic: String,
    val kindHospital: String,
    val open: String,
    val closed: String,
    val unknown: String,
    val untilMidnight: String,
    val untilTime: (hours: String, minutes: String) -> String,
)

/** 진료 종별 — 두 값("의원"·"병원")만 앱 언어, 그 밖은 원문 그대로(:kit `clinicKindKey`). */
fun clinicKindText(kind: String, w: ClinicWords): String = when (clinicKindKey(kind)) {
    "clinic" -> w.kindClinic
    "hospital" -> w.kindHospital
    else -> kind
}

/** 진료 상태 3-state — open은 종료시각까지(2400 = 자정), closed/unknown은 각자의 문장. 목록 행과 상세 도메인 섹션이 공유. */
fun clinicStatusText(status: NightClinic.OpenStatus, w: ClinicWords): String = when (status.state) {
    "open" -> status.end?.let { joinText(w.open, clinicEndTimeText(it, w)) } ?: w.open
    "closed" -> w.closed
    else -> w.unknown
}

private fun clinicEndTimeText(hhmm: Int, w: ClinicWords): String =
    if (hhmm == 2400) w.untilMidnight else w.untilTime((hhmm / 100).toString(), (hhmm % 100).toString())

/** 아이 놀 곳 종류 — 네 값만 앱 언어, 미지 값은 원문 그대로(계약 확장에 깨지지 않게). */
fun kidsKindLabel(kind: String, kidscafe: String, playground: String, playcenter: String, park: String): String = when (kind) {
    "kidscafe" -> kidscafe
    "playground" -> playground
    "playcenter" -> playcenter
    "park" -> park
    else -> kind
}

/** indoor/outdoor 3-state — unknown도 문장으로(생략 금지: 0건·미확인 혼동 방지). */
fun kidsInOutLabel(value: String, indoor: String, outdoor: String, unknown: String): String = when (value) {
    "indoor" -> indoor
    "outdoor" -> outdoor
    else -> unknown
}

/** 요금 — 무료면 "무료"만(요금 원문 중복 낭독 금지), 유료면 원문. 유료·요금 부재는 꼬리 공백을 걷는다. */
fun eventFeeText(e: CultureEvent, free: String, paid: (String) -> String): String =
    if (e.isFree) free else paid(e.fee ?: "").trim()
