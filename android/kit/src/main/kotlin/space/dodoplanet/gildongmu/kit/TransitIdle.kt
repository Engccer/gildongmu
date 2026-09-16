package space.dodoplanet.gildongmu.kit

/**
 * 대중교통 안내의 **유휴 폴 정지** 한계(E36, spec `2026-09-11-transit-background-poll-design.md` §4.2.6).
 * Kit `TransitIdle.swift` 미러.
 *
 * 백그라운드 폴을 살리면(E36) 하차 뒤 시트를 닫지 않고 잊은 세션이 밤새 폴한다 — `transitSessionPollCap`은
 * 상한이 아니라 감속 문턱이다. 도보의 A23 안전망(`sessionIdleStep`)은 fix 두절·무이동 축이라 대중교통에
 * 맞지 않고, 그쪽은 세션을 **끝내지만** 여기는 **폴만 멈춘다**(지연 열차에 타고 있는 사용자를 끊지 않는다 —
 * 어떤 조작이든 즉시 재개). 그래서 이름으로 가른다.
 *
 * 축은 **마지막 사용자 조작 이후 경과**(앱 층이 든다 — 세션 시작·모든 사용자 입력·전경 복귀).
 * 리듀서에는 시계 축을 넣지 않는다(A36과 같은 정신).
 *
 * ⚠ 값은 잠정: 30분은 짧은 구간의 하한, 2×구간 소요는 지연 여유. 실승차 판정 BACKLOG §2 E36 ⑨.
 */
const val transitIdleFloorMs: Double = 30 * 60_000.0

/** 유휴 한계(ms). `legMinutes`는 ODsay 구간 소요 분(`TransitGuideLeg.minutes`), null이면 하한. */
fun transitIdlePollLimitMs(legMinutes: Int?): Double =
    maxOf(transitIdleFloorMs, maxOf(0, legMinutes ?: 0).toDouble() * 2 * 60_000)
