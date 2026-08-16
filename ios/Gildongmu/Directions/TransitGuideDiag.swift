import Foundation

// 대중교통 대기 국면 계측(§13.5, 피드백 #4 "탑승 대기 고정" 원인 확정용).
// 파일 싱크는 공용 DiagFileLog(Documents/transit-guide-diag.log) — 콘솔 없는 실승차에서도 보존된다.
// ⚠ Experimental 구성은 DEBUG를 정의하지 않으므로 게이트에 EXPERIMENTAL 명시 필수.
// 릴리스 빌드는 no-op(자동 클로저라 로그 문자열 조립 자체가 일어나지 않는다).

#if DEBUG || EXPERIMENTAL
/// ISO8601DateFormatter는 문서상 스레드 안전 — 컴파일러가 Sendable을 증명 못 해
/// unsafe 표기만 붙인다(ChatFocusDiag 동형).
private nonisolated(unsafe) let transitGuideDateFormatter = ISO8601DateFormatter()

nonisolated func transitGuideLog(_ msg: @autoclosure () -> String) {
    let wallClock = transitGuideDateFormatter.string(from: Date())
    let line = "[TransitGuide] [\(wallClock)] \(msg())"
    print(line)
    DiagFileLog.transitGuide.append(line)
}
#else
@inline(__always) nonisolated func transitGuideLog(_: @autoclosure () -> String) {}
#endif
