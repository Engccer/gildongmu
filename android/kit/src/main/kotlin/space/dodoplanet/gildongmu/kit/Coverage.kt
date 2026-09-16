package space.dodoplanet.gildongmu.kit

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.double
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

/**
 * 대한민국 서비스 커버리지 정본 술어 — 웹 `src/lib/coverage.ts` ↔ Kit `Coverage.swift` 미러
 * (값·알고리즘 동조, 공유 fixture `korea-boundary-cases.json`이 세 구현의 합의를 강제한다).
 *
 * **판정은 국경 폴리곤이고 사각형은 프리필터다.** 사각형만으로는 후쿠오카·대마도가 "한국 안"으로
 * 통과하고 개성·해주는 파주와 위경도가 겹쳐 어떤 사각형 뺄셈으로도 갈리지 않는다.
 *
 * ⚠ 이 술어의 뜻은 "한국 안인가"이지 "이 upstream이 답하는 범위인가"가 아니다.
 */
private data class LatLng(val lat: Double, val lng: Double)

/**
 * 국경 링. 리소스 `korea-boundary.json`은 웹 정본 `src/lib/data/korea-boundary.json`의
 * **바이트 동일 사본**이고 `CoverageTest`가 그 동일성을 강제한다.
 * ⚠ 파싱에 실패해 비면 전 좌표가 "밖"이 되어 앱이 통째로 죽는다 — 그 상태는 공유 fixture의
 * `inside: true` 케이스가 즉시 잡는다.
 */
private val koreaRings: List<List<LatLng>> by lazy {
    val text = KoreaBoundary::class.java.getResourceAsStream("/korea-boundary.json")
        ?.use { it.readBytes().decodeToString() }
        ?: return@lazy emptyList()
    runCatching {
        Json.parseToJsonElement(text).jsonObject["rings"]!!.jsonArray.map { ring ->
            ring.jsonArray.mapNotNull { point ->
                val p = point.jsonArray
                if (p.size == 2) LatLng(p[0].jsonPrimitive.double, p[1].jsonPrimitive.double) else null
            }
        }
    }.getOrDefault(emptyList())
}

/** 리소스 조회용 앵커(클래스로더). */
private object KoreaBoundary

/**
 * 프리필터 사각형은 **링에서 유도한다** — 상수로 두면 "사각형이 폴리곤을 감싼다"는 전제가
 * 링 갱신 때마다 조용히 깨질 수 있다(종전 상수 ≤132.0은 동경 132.12까지 뻗는 독도 영해 링을
 * 잘라내 거짓 "밖"을 냈다).
 */
private val koreaPrefilter: DoubleArray by lazy {
    var latMin = Double.POSITIVE_INFINITY
    var latMax = Double.NEGATIVE_INFINITY
    var lngMin = Double.POSITIVE_INFINITY
    var lngMax = Double.NEGATIVE_INFINITY
    for (ring in koreaRings) for (p in ring) {
        latMin = minOf(latMin, p.lat); latMax = maxOf(latMax, p.lat)
        lngMin = minOf(lngMin, p.lng); lngMax = maxOf(lngMax, p.lng)
    }
    doubleArrayOf(latMin, latMax, lngMin, lngMax)
}

fun isInKorea(lat: Double, lng: Double): Boolean {
    val (latMin, latMax, lngMin, lngMax) = koreaPrefilter
    if (lat < latMin || lat > latMax || lng < lngMin || lng > lngMax) return false

    for (ring in koreaRings) {
        var inside = false
        for (i in 0 until maxOf(0, ring.size - 1)) {
            val (y1, x1) = ring[i]
            val (y2, x2) = ring[i + 1]
            if ((y1 > lat) != (y2 > lat)) {
                val xAt = x1 + ((lat - y1) * (x2 - x1)) / (y2 - y1)
                if (lng < xAt) inside = !inside
            }
        }
        if (inside) return true
    }
    return false
}
