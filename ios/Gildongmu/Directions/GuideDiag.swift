import Foundation

// 도보 안내 세션 fix 계측(spec 2026-08-09 §7 1단계). 방위 축 파라미터를 정하는
// 유일한 근거이므로 매 fix의 원시 센서값을 그대로 남긴다.
// 파일 싱크는 공용 DiagFileLog(Documents/guide-diag.log) — 콘솔 없는 실보행에서도 보존된다.
// ⚠ Experimental 구성은 DEBUG를 정의하지 않으므로 게이트에 EXPERIMENTAL 명시 필수.
// 릴리스 빌드는 no-op(자동 클로저라 로그 문자열 조립 자체가 일어나지 않는다).

#if DEBUG || EXPERIMENTAL
/// ISO8601DateFormatter는 문서상 스레드 안전 — 컴파일러가 Sendable을 증명 못 해
/// unsafe 표기만 붙인다(TransitGuideDiag 동형).
private nonisolated(unsafe) let guideDiagDateFormatter = ISO8601DateFormatter()

nonisolated func guideDiagLog(_ msg: @autoclosure () -> String) {
    let wallClock = guideDiagDateFormatter.string(from: Date())
    let line = "[GuideDiag] [\(wallClock)] \(msg())"
    print(line)
    DiagFileLog.guide.append(line)
}
#else
@inline(__always) nonisolated func guideDiagLog(_ msg: @autoclosure () -> String) {}
#endif
