package space.dodoplanet.gildongmu.place

import androidx.compose.runtime.Composable
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import space.dodoplanet.gildongmu.R
import space.dodoplanet.gildongmu.a11y.BodyLine
import space.dodoplanet.gildongmu.i18n.AppLocale
import space.dodoplanet.gildongmu.i18n.appLocalized
import space.dodoplanet.gildongmu.kit.bilingualName
import space.dodoplanet.gildongmu.kit.joinText
import space.dodoplanet.gildongmu.kit.models.CultureEvent
import space.dodoplanet.gildongmu.kit.models.NightClinic
import space.dodoplanet.gildongmu.nearby.clinicStatusText
import space.dodoplanet.gildongmu.nearby.clinicWords
import space.dodoplanet.gildongmu.nearby.eventFeeText

// 장소 상세 도메인 섹션(iOS `domainSection`, spec §12-1) — 그 화면에 온 이유라 서열 1위(한글 보조 줄 다음, 분류 앞). 전부 평문 한 줄 = 한 객체.

/** 소아 진료: 진료 상태 / 오시는 길 / 달빛 지정(true일 때만 — 위원장 판정 2026-07-26: 목록 미표기·상세 조건부). */
@Composable
fun ClinicDomainSection(clinic: NightClinic) {
    val res = LocalContext.current.resources
    val words = clinicWords(res)
    BodyLine(clinicStatusText(clinic.openStatus, words), "domain-status")
    if (clinic.directions.isNotEmpty()) BodyLine(appLocalized(res, R.string.clinicNearby_directions, clinic.directions), "domain-directions")
    if (clinic.designated == true) BodyLine(stringResource(R.string.android_clinic_designated), "domain-designated")
}

/** 문화행사: 장소·자치구(병기) / 기간·시간(원본 완성 표기, 재조합 금지) / 요금 / 대상. 값이 빈 필드는 줄 자체를 만들지 않는다. */
@Composable
fun CultureEventSection(event: CultureEvent) {
    val res = LocalContext.current.resources
    val lang = AppLocale.current(res)
    // 개최 장소는 주소가 아니라 시설 설명이라 주소 슬롯이 아닌 여기서 밝힌다. 비-ko는 로마자 병기(E28): 시각 `Roman (한글), 자치구`, 낭독은 로마자만.
    val place = bilingualName(lang, event.place, en = null, roman = event.placeRoman)
    val venue = joinText(place.display, event.district)
    if (venue.isNotEmpty()) BodyLine(venue, "domain-venue", joinText(place.primary, event.district).takeIf { it != venue })
    val whenText = joinText(event.dateText, event.timeText)
    if (whenText.isNotEmpty()) BodyLine(whenText, "domain-when")
    BodyLine(eventFeeText(event, stringResource(R.string.eventsNearby_free)) { appLocalized(res, R.string.eventsNearby_paid, it) }, "domain-fee")
    if (event.target.isNotEmpty()) BodyLine(appLocalized(res, R.string.eventsNearby_target, event.target), "domain-target")
}
