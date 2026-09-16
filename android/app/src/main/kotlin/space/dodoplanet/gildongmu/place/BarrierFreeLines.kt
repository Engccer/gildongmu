package space.dodoplanet.gildongmu.place

import space.dodoplanet.gildongmu.R

/**
 * 무장애 편의시설 라벨 — 응답 `key`를 `barrierFreeInfo.facility.*`로(A26, iOS `barrierFreeFacilityLabel` 이식, spec §12-3). 27종 리터럴 나열
 * (동적 키 조립 금지). 모르는 key는 null → 호출부가 서버 한글 `label`로 폴백한다(빈 라벨보다 낫다).
 */
fun barrierFreeFacilityResId(key: String): Int? = when (key) {
    "wheelchair" -> R.string.barrierFreeInfo_facility_wheelchair
    "restroom" -> R.string.barrierFreeInfo_facility_restroom
    "elevator" -> R.string.barrierFreeInfo_facility_elevator
    "parking" -> R.string.barrierFreeInfo_facility_parking
    "route" -> R.string.barrierFreeInfo_facility_route
    "exit" -> R.string.barrierFreeInfo_facility_exit
    "publictransport" -> R.string.barrierFreeInfo_facility_publictransport
    "ticketoffice" -> R.string.barrierFreeInfo_facility_ticketoffice
    "auditorium" -> R.string.barrierFreeInfo_facility_auditorium
    "room" -> R.string.barrierFreeInfo_facility_room
    "handicapetc" -> R.string.barrierFreeInfo_facility_handicapetc
    "braileblock" -> R.string.barrierFreeInfo_facility_braileblock
    "audioguide" -> R.string.barrierFreeInfo_facility_audioguide
    "brailepromotion" -> R.string.barrierFreeInfo_facility_brailepromotion
    "guidehuman" -> R.string.barrierFreeInfo_facility_guidehuman
    "helpdog" -> R.string.barrierFreeInfo_facility_helpdog
    "bigprint" -> R.string.barrierFreeInfo_facility_bigprint
    "guidesystem" -> R.string.barrierFreeInfo_facility_guidesystem
    "blindhandicapetc" -> R.string.barrierFreeInfo_facility_blindhandicapetc
    "signguide" -> R.string.barrierFreeInfo_facility_signguide
    "videoguide" -> R.string.barrierFreeInfo_facility_videoguide
    "hearingroom" -> R.string.barrierFreeInfo_facility_hearingroom
    "hearinghandicapetc" -> R.string.barrierFreeInfo_facility_hearinghandicapetc
    "lactationroom" -> R.string.barrierFreeInfo_facility_lactationroom
    "stroller" -> R.string.barrierFreeInfo_facility_stroller
    "babysparechair" -> R.string.barrierFreeInfo_facility_babysparechair
    "infantsfamilyetc" -> R.string.barrierFreeInfo_facility_infantsfamilyetc
    else -> null
}
