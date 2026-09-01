import Foundation

/// 판정에 쓰는 실측 fix. `accuracy`는 미터, `at`은 epoch seconds.
///
/// ⚠ `CLLocation.horizontalAccuracy`는 무효 fix에 **음수**를 준다. 음수를 그대로
/// 빼면 separation이 커져 거짓 이동이 되므로 `accuracy > 0`이 자격 조건이다.
public struct ManualFix: Equatable, Codable, Sendable {
    public let lat: Double
    public let lng: Double
    public let accuracy: Double
    public let at: Double

    public init(lat: Double, lng: Double, accuracy: Double, at: Double) {
        self.lat = lat; self.lng = lng; self.accuracy = accuracy; self.at = at
    }
}

/// 사용자가 직접 지정한 현재 위치. 웹 `src/lib/manual-location.ts` 미러.
///
/// `origin`은 **지정 시점의 적격 실측 fix**이고 이동 판정의 기준점이다.
/// `lat`/`lng`(장소 좌표)를 기준점으로 쓰지 않는다 — 장소 검색 결과 좌표는
/// 건물 중심이나 대표 출입구라 사용자가 서 있는 지점과 100m 이상 떨어질 수 있다.
public struct ManualLocation: Equatable, Codable, Sendable {
    /// 단조 증가. 판정 왕복 중 재지정을 가르는 CAS 토큰.
    public let revision: Int
    public let label: String
    /// 라벨의 라틴 표기(E28 병기, additive) — **지정 시점**에 저장한다(장소=서버 `nameRoman`,
    /// 주소=juso `engAddr`). 없으면 병기 없음. 저장소의 옛 값(키 부재)은 nil로 읽힌다.
    public let labelRoman: String?
    public let lat: Double
    public let lng: Double
    public let origin: ManualFix?
    public let setAt: Double

    public init(revision: Int, label: String, labelRoman: String? = nil, lat: Double, lng: Double,
                origin: ManualFix?, setAt: Double) {
        self.revision = revision; self.label = label; self.labelRoman = labelRoman
        self.lat = lat; self.lng = lng; self.origin = origin; self.setAt = setAt
    }
}

/// 수동 위치 라벨의 병기 이름(웹 `useManualLocationBilingual` 미러) — 비-ko에서 `labelRoman`이 1순위,
/// 없으면 한글 그대로. 검증 가능/불가 틀(`manualLocation.manual*`)은 호출부가 `primary`에 씌운다.
public func manualLocationBilingualName(_ manual: ManualLocation, lang: String) -> BilingualName {
    bilingualName(lang: lang, ko: manual.label, en: nil, roman: manual.labelRoman)
}

public enum ManualVerdict: String, Equatable, Sendable {
    case keep, drop, undecidable
}

public enum ManualLocationPolicy {
    /// 답이 달라지는 거리(m). `LocationFixPolicy`가 "100m가 최근접 정류소 순위를
    /// 뒤집는다"를 실측했다.
    public static let movedMeters: Double = 100

    /// 판정용 fix의 사용 자격 상한(m). `LocationFixPolicy.storeCeiling`과 같은 취지.
    /// ⚠ `movedMeters`와 값은 같지만 **축이 다르다**(답이 달라지는 거리 / 사용 자격).
    public static let judgeCeilingMeters: Double = 100

    /// 판정용 fix의 나이 상한(초). `LocationFixPolicy.acceptAge` 미러.
    public static let fixMaxAgeSeconds: Double = 10
}

public func isEligibleManualFix(_ fix: ManualFix, now: Double) -> Bool {
    guard fix.accuracy.isFinite, fix.accuracy > 0,
          fix.accuracy <= ManualLocationPolicy.judgeCeilingMeters,
          fix.lat.isFinite, fix.lng.isFinite,
          (-90...90).contains(fix.lat), (-180...180).contains(fix.lng),
          fix.at.isFinite else { return false }
    return now - fix.at <= ManualLocationPolicy.fixMaxAgeSeconds
}

/// 라벨이 **검증 가능형**(`지정한 위치, X`)인가, **검증 불가형**(`…(위치 확인 불가)`)인가.
/// 웹 `src/lib/manual-location.ts`의 같은 이름 함수와 미러다.
///
/// ⚠ `origin` 유무만 보면 안 된다. `origin`이 있어도 **지금** 판정이 불가능한 상태
/// (권한 철회 · 실내 측위 실패 · 정확도 상한 초과 · fix 나이 초과)면 이동을 검증할
/// 수단이 없는데도 검증 가능형 라벨이 나간다 — 애초에 검증 불가인 `origin == nil`
/// 쪽이 오히려 정직한 라벨을 받는 **역전**이 된다(spec §4.5가 표로 금지).
///
/// `verdict`는 **마지막 판정 시도의 결과**이고 `nil`은 "아직 판정하지 않음"이다
/// (지정 직후·저장소 복원 직후). 지정 시점에는 적격 실측 fix를 방금 잡아 `origin`으로
/// 삼았으므로 판정 전 상태를 검증 가능형으로 두는 것이 마지막으로 확인된 사실과 같다.
public func isManualLocationVerified(_ manual: ManualLocation, verdict: ManualVerdict?) -> Bool {
    guard manual.origin != nil else { return false }
    return verdict != .undecidable
}

/// 웹 `judgeManualLocation` 미러. separation은 "두 오차 원이 겹치지 않고도 남는 거리"다.
public func judgeManualLocation(manual: ManualLocation, fix: ManualFix?, now: Double) -> ManualVerdict {
    guard let origin = manual.origin else { return .undecidable }
    guard let fix, isEligibleManualFix(fix, now: now) else { return .undecidable }

    let centerDistance = haversineMeters(lat1: fix.lat, lng1: fix.lng, lat2: origin.lat, lng2: origin.lng)
    let separation = centerDistance - fix.accuracy - origin.accuracy
    return separation > ManualLocationPolicy.movedMeters ? .drop : .keep
}
