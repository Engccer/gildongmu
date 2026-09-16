package space.dodoplanet.gildongmu.kit

/** 쿼리 파라미터 하나(Swift `URLQueryItem` 대응). 값은 `APIClient`가 퍼센트 인코딩한다. */
typealias QueryItem = Pair<String, String>

/** 좌표 쿼리 파라미터(`?lat=&lng=`) 조립 — 좌표 기반 서비스 공용. Kit `CoordQuery.swift` 미러. */
internal fun coordQuery(lat: Double, lng: Double): List<QueryItem> =
    listOf("lat" to lat.toString(), "lng" to lng.toString())
