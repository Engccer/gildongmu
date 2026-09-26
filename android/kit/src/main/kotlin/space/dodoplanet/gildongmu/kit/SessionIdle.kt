package space.dodoplanet.gildongmu.kit

// ── 잊힌 안내 세션의 국면 무관 안전망(2026-08-26) ──
// 웹 `session-idle.ts` ↔ Kit `SessionIdle.swift` 미러. 공유 fixture `session-idle-scenarios.json`이 동조 강제.
// 도착 추정(`FinalApproach.kt` `presumedArrivalStep`)은 최종 접근 국면에 들어간 세션만 정리한다 — 그 문을
// 못 지난 세션(GPS 두절·이탈 상태로 종점 접근·간략 강등·목적지 150m 밖 실내 진입)에는 종전에 어떤 상한도
// 없어 출근 도보 안내가 몇 시간이고 켜져 있었다. 이 판정은 국면을 보지 않는다. 두절 축은 도착 추정보다 길고,
// 무이동 축은 도착 추정과 같은 5분이다(2026-09-26 위원장 판정, 나들이 spec §9). 같은 워치독 틱에서는 도착 추정이
// 먼저 판정되므로 동점이면 도착이 이긴다.

/** usable fix 두절이 이만큼 지속되면 세션을 끝낸다(2026-09-26 위원장 판정 5분). */
const val sessionIdleNoFixSeconds = 300.0

/** usable fix는 오는데 앵커 기준 이동이 이만큼 없으면 끝낸다(2026-09-26 위원장 판정 5분). */
const val sessionIdleStationarySeconds = 300.0

/** 세션 진행 앵커 이탈 하한(m). 실내 wifi 지터가 도착 추정의 10m를 넘어 "이동"으로 읽히는 것을 막는다. */
const val sessionProgressEpsilonMeters = 25.0

enum class SessionIdleReason {
    noFix,
    stationary;

    val rawValue: String get() = name
}

private fun finiteNonNegative(x: Double): Boolean = x.isFinite() && x >= 0

/**
 * 판정 순서(noFix → stationary)가 계약이다 — 둘 다 성립하면 원인이 더 앞선 noFix.
 * `secondsSinceProgress` **null = 무이동 축 없음**(자동차 — 정체·휴게소 정차와 구분할 수 없어 켜지 않는다,
 * spec 2026-08-31 §4). 축 선택은 `GuideTuning.sessionIdleStationaryAxis`.
 */
fun sessionIdleStep(secondsSinceUsableFix: Double, secondsSinceProgress: Double?): SessionIdleReason? {
    if (!finiteNonNegative(secondsSinceUsableFix)) return null
    if (secondsSinceProgress != null && !finiteNonNegative(secondsSinceProgress)) return null
    if (secondsSinceUsableFix >= sessionIdleNoFixSeconds) return SessionIdleReason.noFix
    if (secondsSinceProgress != null && secondsSinceProgress >= sessionIdleStationarySeconds) {
        return SessionIdleReason.stationary
    }
    return null
}
