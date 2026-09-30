import Foundation
import UIKit

// 도보 안내 세션 fix 계측(spec 2026-08-09 §7 1단계). 방위 축 파라미터를 정하는
// 유일한 근거이므로 매 fix의 원시 센서값을 그대로 남긴다. 안내 시트 착지(`sheetFocus`, E57)도 여기 남는다.
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

/// VoiceOver 커서가 **실제로** 앉아 있는 요소의 라벨(앞 40자). 착지 로그의 `vo=`(A35 spec §4.5, E57) —
/// 포커스 바인딩은 우리 대상 중 어디인지만 말하고(다른 곳이면 nil), 이 값은 제목·버튼처럼 바인딩 밖
/// 요소로 간 경우를 이름으로 드러낸다. VO가 꺼져 있으면 nil. 도보·대중교통·나들이 착지 로그가 함께 쓴다.
@MainActor func voFocusedLabel() -> String? {
    guard UIAccessibility.isVoiceOverRunning,
          let element = UIAccessibility.focusedElement(using: .notificationVoiceOver) else { return nil }
    let label = (element as? NSObject)?.accessibilityLabel ?? String(describing: element)
    return String(label.prefix(40))
}
#else
@inline(__always) nonisolated func guideDiagLog(_ msg: @autoclosure () -> String) {}
@inline(__always) @MainActor func voFocusedLabel() -> String? { nil }
#endif
