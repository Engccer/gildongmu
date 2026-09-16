package space.dodoplanet.gildongmu.kit

/** 안내 경로 origin 후보 fix. Kit `RouteOrigin.swift` 미러. */
data class RouteOriginFix(val lat: Double, val lng: Double, val accuracy: Double, val ageSeconds: Double)

/** `routeOriginStep`의 결정. */
sealed class RouteOriginDecision {
    /** 이 fix로 지금 조회한다(수용 정확도·나이 통과). */
    data class Fetch(val fix: RouteOriginFix) : RouteOriginDecision()

    /** 계속 기다린다. `best`는 갱신된 최선 후보 — 대기 상한이 끝나면 이것으로 조회한다. */
    data class Wait(val best: RouteOriginFix?) : RouteOriginDecision()
}

/**
 * 안내 경로 origin 선택(순수, A18).
 *
 * 세션이 시작되는 순간은 대개 GPS가 가장 나쁜 순간이다(차량 하차·실내 탈출 직후). 그래서 "첫 fix"와
 * "가장 나쁜 fix"가 구조적으로 같은 fix이고, 그 좌표를 그대로 origin으로 삼으면 경로가 통째로 다른 곳에서
 * 출발한다(2026-08-16 실보행: origin이 115m 북쪽이라 건너야 했던 횡단보도가 경로에 없었다).
 *
 * 단발 취득의 정책을 스트림 위에 그대로 옮긴 것이다: `shouldAcceptFix`를 통과하는 첫 fix면 즉시, 그 전까지는
 * `storeCeiling` 이내의 최선값만 보관하고 대기 상한(호출부의 `noFixTimeout`)에 그 최선값으로 조회한다.
 * 재측위 의존은 되살리지 않는다 — 판정만 되돌린다.
 *
 * ⚠ 이 함수는 origin 선택 한 곳의 술어다. 비콘 앵커·최종 접근이 쓰는 `isUsableFix`는 느슨한 정확도가
 * 의도이므로 조이지 않는다("500m 전 정밀 좌표보다 40m 오차의 지금 좌표가 낫다").
 */
fun routeOriginStep(
    best: RouteOriginFix?,
    fix: RouteOriginFix,
    acceptAccuracy: Double = LocationFixPolicy.acceptAccuracy,
    acceptAge: Double = LocationFixPolicy.acceptAge,
    ceiling: Double = LocationFixPolicy.storeCeiling,
): RouteOriginDecision {
    if (shouldAcceptFix(fix.accuracy, fix.ageSeconds, acceptAccuracy, acceptAge)) {
        return RouteOriginDecision.Fetch(fix)
    }
    val candidate = isStorableFix(fix.accuracy, fix.ageSeconds, acceptAge, ceiling)
    if (!candidate || !isBetterFix(fix.accuracy, best?.accuracy)) return RouteOriginDecision.Wait(best)
    return RouteOriginDecision.Wait(fix)
}
