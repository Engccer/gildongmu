package space.dodoplanet.gildongmu.kit

import kotlinx.serialization.Serializable

/**
 * 판정에 쓰는 실측 fix. `accuracy`는 미터, `at`은 epoch 초. Kit `ManualLocation.swift` 미러.
 *
 * ⚠ 플랫폼 위치 API는 무효 fix에 **0 이하 정확도**를 줄 수 있다(iOS `horizontalAccuracy`는 음수). 그대로 빼면
 * separation이 커져 거짓 이동이 되므로 `accuracy > 0`이 자격 조건이다.
 */
@Serializable
data class ManualFix(val lat: Double, val lng: Double, val accuracy: Double, val at: Double)

/**
 * 사용자가 직접 지정한 현재 위치. 웹 `src/lib/manual-location.ts` ↔ Kit `ManualLocation.swift` 미러.
 *
 * `origin`은 **지정 시점의 적격 실측 fix**이고 이동 판정의 기준점이다. `lat`/`lng`(장소 좌표)를 기준점으로 쓰지
 * 않는다 — 장소 검색 결과 좌표는 건물 중심이나 대표 출입구라 사용자가 서 있는 지점과 100m 이상 떨어질 수 있다.
 */
@Serializable
data class ManualLocation(
    /** 단조 증가. 판정 왕복 중 재지정을 가르는 CAS 토큰. */
    val revision: Int,
    val label: String,
    /**
     * 라벨의 라틴 표기(E28 병기, additive) — **지정 시점**에 저장한다(장소=서버 `nameRoman`, 주소=juso `engAddr`).
     * 없으면 병기 없음. 저장소의 옛 값(키 부재)은 null로 읽힌다.
     */
    val labelRoman: String? = null,
    val lat: Double,
    val lng: Double,
    val origin: ManualFix?,
    val setAt: Double,
)

/**
 * 수동 위치 라벨의 병기 이름(웹 `useManualLocationBilingual` 미러) — 비-ko에서 `labelRoman`이 1순위, 없으면 한글
 * 그대로. 검증 가능/불가 틀(`manualLocation.manual*`)은 호출부가 `primary`에 씌운다.
 */
fun manualLocationBilingualName(manual: ManualLocation, lang: String): BilingualName =
    bilingualName(lang, ko = manual.label, en = null, roman = manual.labelRoman)

enum class ManualVerdict {
    keep, drop, undecidable;

    val rawValue: String get() = name

    companion object {
        fun fromRawValue(raw: String): ManualVerdict? = entries.firstOrNull { it.name == raw }
    }
}

object ManualLocationPolicy {
    /** 답이 달라지는 거리(m). 위치 정책이 "100m가 최근접 정류소 순위를 뒤집는다"를 실측했다. */
    const val movedMeters = 100.0

    /**
     * 판정용 fix의 사용 자격 상한(m). 위치 스토어 저장 상한과 같은 취지.
     * ⚠ `movedMeters`와 값은 같지만 **축이 다르다**(답이 달라지는 거리 / 사용 자격).
     */
    const val judgeCeilingMeters = 100.0

    /** 판정용 fix의 나이 상한(초). 위치 정책의 수용 나이 미러. */
    const val fixMaxAgeSeconds = 10.0
}

fun isEligibleManualFix(fix: ManualFix, now: Double): Boolean {
    if (!(fix.accuracy.isFinite() && fix.accuracy > 0 && fix.accuracy <= ManualLocationPolicy.judgeCeilingMeters)) return false
    if (!(fix.lat.isFinite() && fix.lng.isFinite() && fix.lat in -90.0..90.0 && fix.lng in -180.0..180.0)) return false
    if (!fix.at.isFinite()) return false
    return now - fix.at <= ManualLocationPolicy.fixMaxAgeSeconds
}

/**
 * 라벨이 **검증 가능형**(`지정한 위치, X`)인가, **검증 불가형**(`…(위치 확인 불가)`)인가. 웹 `src/lib/manual-location.ts`의
 * 같은 이름 함수 미러.
 *
 * ⚠ `origin` 유무만 보면 안 된다. `origin`이 있어도 **지금** 판정이 불가능한 상태(권한 철회 · 실내 측위 실패 ·
 * 정확도 상한 초과 · fix 나이 초과)면 이동을 검증할 수단이 없는데도 검증 가능형 라벨이 나간다 — 애초에 검증
 * 불가인 `origin == null` 쪽이 오히려 정직한 라벨을 받는 **역전**이 된다(spec §4.5가 표로 금지).
 *
 * `verdict`는 **마지막 판정 시도의 결과**이고 null은 "아직 판정하지 않음"이다(지정 직후·저장소 복원 직후).
 * 지정 시점에는 적격 실측 fix를 방금 잡아 `origin`으로 삼았으므로 판정 전 상태를 검증 가능형으로 두는 것이
 * 마지막으로 확인된 사실과 같다.
 */
fun isManualLocationVerified(manual: ManualLocation, verdict: ManualVerdict?): Boolean {
    if (manual.origin == null) return false
    return verdict != ManualVerdict.undecidable
}

/** 웹 `judgeManualLocation` 미러. separation은 "두 오차 원이 겹치지 않고도 남는 거리"다. */
fun judgeManualLocation(manual: ManualLocation, fix: ManualFix?, now: Double): ManualVerdict {
    val origin = manual.origin ?: return ManualVerdict.undecidable
    if (fix == null || !isEligibleManualFix(fix, now)) return ManualVerdict.undecidable
    val centerDistance = haversineMeters(fix.lat, fix.lng, origin.lat, origin.lng)
    val separation = centerDistance - fix.accuracy - origin.accuracy
    return if (separation > ManualLocationPolicy.movedMeters) ManualVerdict.drop else ManualVerdict.keep
}
