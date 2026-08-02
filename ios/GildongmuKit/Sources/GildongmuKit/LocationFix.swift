import Foundation

/// 단발 위치 취득의 수용 판정(순수 함수).
///
/// 앱 타깃 테스트 번들이 없어 `LocationService`를 직접 테스트할 수 없으므로,
/// 판정 로직만 Kit으로 내려 테스트 가능하게 한다(비콘 `beaconGateStep` 선례 동형).
/// 설계 정본은 `docs/superpowers/specs/2026-08-02-location-accuracy-design.md`.

public enum LocationFixPolicy {
    /// 수용 정확도 상한(미터). 도심 실측 평균 오차가 7~13m라 대개 빠르게 충족된다.
    /// 100m는 최근접 정류소 순위를 뒤집는 것이 실측됐고 이 값은 그 절반 이하다.
    public static let acceptAccuracy: Double = 30

    /// 수용 나이 상한(초). Apple 예제의 15초에서 보행 이동분을 감안해 낮췄다
    /// (문서가 내비 앱은 임계를 더 낮추라고 명시한다).
    public static let acceptAge: Double = 10

    /// 단발 취득 타임아웃(초). 초과하면 그때까지의 최선 fix를 쓴다 — 무한 대기는
    /// 침묵이고, 침묵은 시각장애 사용자에게 "고장"과 구분되지 않는다.
    public static let timeout: Double = 8

    /// 순위 가중용 취득 타임아웃(초). 검색어를 넣고 기다리는 자리라 `timeout`(8초)은
    /// 그대로 침묵이 된다. 좌표를 못 얻으면 좌표 없이 진행하는 소비자라 짧게 끊는다.
    public static let softTimeout: Double = 2

    /// "주변" 주장에 쓰는 캐시 수명(초). 보행 1.2m/s로 60초면 약 72m이고,
    /// 100m가 순위를 뒤집는 것이 실측됐으므로 그 아래로 잡는다.
    public static let freshTTL: Double = 60

    /// 검색 근접 블렌딩 전용 캐시 수명(초). 순위 가중이라 정밀도 요구가 낮고,
    /// 매 검색마다 재측위하면 지연이 붙는다.
    public static let softTTL: Double = 300

    /// 공유 스토어에 올릴 수 있는 정확도 상한(미터). `acceptAccuracy`보다 느슨한
    /// 이유는 "최신 값"과 "답으로 쓸 값"이 다른 축이기 때문이다(30~100m 구간의
    /// fix는 값은 갱신하되 캐시 재사용으로는 답하지 않는다). 다만 셀·Wi-Fi 측위의
    /// km급 좌표는 어떤 용도로도 위치가 아니므로 여기서 막는다.
    public static let storeCeiling: Double = 100
}

/// 공유 스토어(`lastCoordinate`)에 올릴 수 있는 fix인가.
///
/// `shouldAcceptFix`보다 정확도 상한이 느슨하다. 스트림에는 "더 나은 것을 기다리는
/// 창"이 없어서 상한을 좁히면 정확도가 계속 30m를 넘는 구간에서 값이 낡은 채 굳는다.
/// 걷는 사용자에게는 "정밀하지만 500m 전 좌표"보다 "40m 오차의 지금 좌표"가 낫다.
public func isStorableFix(
    accuracy: Double,
    age: Double,
    acceptAge: Double = LocationFixPolicy.acceptAge,
    ceiling: Double = LocationFixPolicy.storeCeiling
) -> Bool {
    guard accuracy > 0, accuracy.isFinite else { return false }
    guard age >= 0, age <= acceptAge else { return false }
    return accuracy <= ceiling
}

/// 캐시된 fix를 재측위 없이 답으로 쓸 수 있는가.
///
/// ⚠ **나이만 보면 안 된다.** 저장 상한이 재사용 기준보다 느슨하므로, 나이만 보는
/// 읽기는 게이트가 거부한 정확도의 좌표를 그대로 "현재 위치"로 승격시킨다
/// (지하철 안 셀 측위 좌표가 지상에서 60초간 재사용되는 경로).
public func canReuseCachedFix(
    accuracy: Double?,
    age: Double?,
    ttl: Double,
    acceptAccuracy: Double = LocationFixPolicy.acceptAccuracy
) -> Bool {
    guard isCacheFresh(age: age, ttl: ttl) else { return false }
    guard let accuracy, accuracy > 0, accuracy.isFinite else { return false }
    return accuracy <= acceptAccuracy
}

/// fix를 앵커로 채택할지. **음수 accuracy는 좌표 무효 신호**라 반드시 거른다
/// (`horizontalAccuracy` 문서: "A negative value indicates that the latitude and
/// longitude are invalid"). 비콘 리듀서가 이미 지키는 규칙을 단발 경로에도 적용한다.
public func shouldAcceptFix(
    accuracy: Double,
    age: Double,
    acceptAccuracy: Double = LocationFixPolicy.acceptAccuracy,
    acceptAge: Double = LocationFixPolicy.acceptAge
) -> Bool {
    guard accuracy > 0, accuracy.isFinite else { return false }
    guard age >= 0, age <= acceptAge else { return false }
    return accuracy <= acceptAccuracy
}

/// 두 fix 중 어느 쪽이 더 나은 후보인가(타임아웃 시 최선값 선택용).
/// 무효 좌표는 어떤 경우에도 후보가 되지 않는다.
public func isBetterFix(_ candidate: Double, than current: Double?) -> Bool {
    guard candidate > 0, candidate.isFinite else { return false }
    guard let current, current > 0, current.isFinite else { return true }
    return candidate < current
}

/// 캐시를 그대로 쓸 수 있는가. 나이를 모르면(nil) 신선하지 않은 것으로 본다 —
/// 나이 없는 캐시를 신선으로 치면 수명 무한이던 종전 동작으로 되돌아간다.
public func isCacheFresh(age: Double?, ttl: Double) -> Bool {
    guard let age, age >= 0 else { return false }
    return age <= ttl
}
