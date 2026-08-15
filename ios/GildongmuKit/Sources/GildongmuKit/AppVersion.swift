import Foundation

/// 버전 문자열 비교(순수 함수).
///
/// 업데이트 이력이 **설치된 빌드보다 높은 버전**을 보여 주던 결함(백로그 G4②)을 닫는
/// 판정 축이다. 미리 등재하는 관례(다음 버전 노트를 정본 md에 먼저 적는다)는 그대로
/// 두고, 표시 계층이 거른다.
///
/// ⚠ **문자열 완전 일치·사전순 비교로는 안 된다.** 두 함정이 실재한다:
/// ①`MARKETING_VERSION`은 `1.7.0`인데 정본 md에서 뽑은 노트 버전은 `1.7`이라
/// **컴포넌트 수가 다르다**(그 완전 일치 비교가 1.7 제출 게이트를 두 번 막았다)
/// ②사전순이면 `1.10 < 1.9`가 된다.
/// 그래서 점으로 끊어 **수치**로 비교하고, 없는 컴포넌트는 0으로 채운다(`1.7 == 1.7.0`).
public func compareVersionStrings(_ lhs: String, _ rhs: String) -> ComparisonResult {
    let a = versionComponents(lhs)
    let b = versionComponents(rhs)
    for i in 0..<max(a.count, b.count) {
        let x = i < a.count ? a[i] : 0
        let y = i < b.count ? b[i] : 0
        if x != y { return x < y ? .orderedAscending : .orderedDescending }
    }
    return .orderedSame
}

/// 숫자로 읽히지 않는 컴포넌트(`1.7-beta`의 `7-beta`)는 **앞쪽 숫자만** 취한다.
/// 통째로 0으로 떨구면 `1.7-beta`가 `1.0`이 되어 옛 버전으로 위장한다.
private func versionComponents(_ version: String) -> [Int] {
    version.split(separator: ".").map { part in
        Int(part.prefix(while: { $0.isNumber })) ?? 0
    }
}

/// 이 노트를 설치된 빌드에서 보여 주는가.
///
/// `appVersion`이 nil이면(Info.plist를 못 읽음) **거르지 않는다** — 판정 근거가 없을
/// 때 목록을 비우면 "이력이 없다"는 거짓을 말하게 된다. 거르지 못하는 것은 정보 과잉이고
/// 비우는 것은 정보 부재라, 둘 중 덜 나쁜 쪽을 고른다.
public func isReleaseNoteVisible(noteVersion: String, appVersion: String?) -> Bool {
    guard let appVersion, !appVersion.isEmpty else { return true }
    return compareVersionStrings(noteVersion, appVersion) != .orderedDescending
}
