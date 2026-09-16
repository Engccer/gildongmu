package space.dodoplanet.gildongmu.kit

/**
 * 단발 위치 취득의 수용 판정(순수 함수). Kit `LocationFix.swift` 미러. 설계 정본은
 * `docs/superpowers/specs/2026-08-02-location-accuracy-design.md`. 값의 단위는 미터·초.
 */
object LocationFixPolicy {
    /** 수용 정확도 상한(m). 도심 실측 평균 오차가 7~13m라 대개 빠르게 충족된다. */
    const val acceptAccuracy: Double = 30.0

    /** 수용 나이 상한(초). */
    const val acceptAge: Double = 10.0

    /** 단발 취득 타임아웃(초). 초과하면 그때까지의 최선 fix를 쓴다 — 무한 대기는 침묵이다. */
    const val timeout: Double = 8.0

    /** 순위 가중용 취득 타임아웃(초). 좌표를 못 얻으면 좌표 없이 진행하는 소비자라 짧게 끊는다. */
    const val softTimeout: Double = 2.0

    /** "주변" 주장에 쓰는 캐시 수명(초). */
    const val freshTTL: Double = 60.0

    /** 검색 근접 블렌딩 전용 캐시 수명(초). */
    const val softTTL: Double = 300.0

    /** 공유 스토어에 올릴 수 있는 정확도 상한(m). "최신 값"과 "답으로 쓸 값"은 다른 축이다. */
    const val storeCeiling: Double = 100.0
}

/** 공유 스토어에 올릴 수 있는 fix인가. `shouldAcceptFix`보다 정확도 상한이 느슨하다. */
fun isStorableFix(
    accuracy: Double,
    age: Double,
    acceptAge: Double = LocationFixPolicy.acceptAge,
    ceiling: Double = LocationFixPolicy.storeCeiling,
): Boolean {
    if (!(accuracy > 0) || !accuracy.isFinite()) return false
    if (!(age >= 0) || age > acceptAge) return false // NaN age도 거른다(Swift `guard age >= 0`)
    return accuracy <= ceiling
}

/**
 * 캐시된 fix를 재측위 없이 답으로 쓸 수 있는가. ⚠ 나이만 보면 안 된다 — 저장 상한이 재사용
 * 기준보다 느슨하므로, 나이만 보는 읽기는 게이트가 거부한 정확도의 좌표를 "현재 위치"로 승격시킨다.
 */
fun canReuseCachedFix(
    accuracy: Double?,
    age: Double?,
    ttl: Double,
    acceptAccuracy: Double = LocationFixPolicy.acceptAccuracy,
): Boolean {
    if (!isCacheFresh(age, ttl)) return false
    if (accuracy == null || !(accuracy > 0) || !accuracy.isFinite()) return false
    return accuracy <= acceptAccuracy
}

/** fix를 앵커로 채택할지. 음수·0·NaN·무한 accuracy는 좌표 무효 신호라 반드시 거른다. */
fun shouldAcceptFix(
    accuracy: Double,
    age: Double,
    acceptAccuracy: Double = LocationFixPolicy.acceptAccuracy,
    acceptAge: Double = LocationFixPolicy.acceptAge,
): Boolean {
    if (!(accuracy > 0) || !accuracy.isFinite()) return false
    if (!(age >= 0) || age > acceptAge) return false
    return accuracy <= acceptAccuracy
}

/** 두 fix 중 어느 쪽이 더 나은 후보인가(타임아웃 시 최선값 선택용). 무효 좌표는 후보가 되지 않는다. */
fun isBetterFix(candidate: Double, than: Double?): Boolean {
    if (!(candidate > 0) || !candidate.isFinite()) return false
    if (than == null || !(than > 0) || !than.isFinite()) return true
    return candidate < than
}

/** 캐시를 그대로 쓸 수 있는가. 나이를 모르면(null) 신선하지 않은 것으로 본다. */
fun isCacheFresh(age: Double?, ttl: Double): Boolean {
    if (age == null || !(age >= 0)) return false
    return age <= ttl
}
