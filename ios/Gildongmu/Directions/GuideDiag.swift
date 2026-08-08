import Foundation

// 도보 안내 세션 fix 계측(spec 2026-08-09 §7 1단계). 방위 축 파라미터를 정하는
// 유일한 근거이므로 매 fix의 원시 센서값을 그대로 남긴다.
// TransitGuideDiag 선례의 파일 로그 패턴 — 콘솔 + 기기 파일(Documents/
// guide-diag.log, 2MB 초과 시 .old로 교체)이라 USB 콘솔 없는 실보행에서도 보존된다.
// 회수: `xcrun devicectl device copy from --domain-type appDataContainer`.
// ⚠ Experimental 구성은 DEBUG를 정의하지 않으므로 게이트에 EXPERIMENTAL 명시 필수.
// 릴리스 빌드는 no-op(자동 클로저라 로그 문자열 조립 자체가 일어나지 않는다).

#if DEBUG || EXPERIMENTAL
nonisolated final class GuideFileLog: @unchecked Sendable {
    static let shared = GuideFileLog()
    private let lock = NSLock()
    private var handle: FileHandle?
    private static let maxBytes: UInt64 = 2_000_000

    private static var logURL: URL {
        FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("guide-diag.log")
    }

    func append(_ line: String) {
        lock.withLock {
            guard let handle = ensureHandleLocked() else { return }
            handle.write(Data((line + "\n").utf8))
        }
    }

    private func ensureHandleLocked() -> FileHandle? {
        if let handle {
            if (try? handle.offset()) ?? 0 > Self.maxBytes {
                try? handle.close()
                self.handle = nil
                let url = Self.logURL
                let old = url.deletingLastPathComponent()
                    .appendingPathComponent("guide-diag.old.log")
                try? FileManager.default.removeItem(at: old)
                try? FileManager.default.moveItem(at: url, to: old)
            } else {
                return handle
            }
        }
        let url = Self.logURL
        if !FileManager.default.fileExists(atPath: url.path) {
            FileManager.default.createFile(atPath: url.path, contents: nil)
        }
        guard let newHandle = try? FileHandle(forWritingTo: url) else { return nil }
        _ = try? newHandle.seekToEnd()
        handle = newHandle
        return newHandle
    }
}

/// ISO8601DateFormatter는 문서상 스레드 안전 — 컴파일러가 Sendable을 증명 못 해
/// unsafe 표기만 붙인다(TransitGuideDiag 동형).
private nonisolated(unsafe) let guideDiagDateFormatter = ISO8601DateFormatter()

nonisolated func guideDiagLog(_ msg: @autoclosure () -> String) {
    let wallClock = guideDiagDateFormatter.string(from: Date())
    let line = "[GuideDiag] [\(wallClock)] \(msg())"
    print(line)
    GuideFileLog.shared.append(line)
}
#else
@inline(__always) nonisolated func guideDiagLog(_ msg: @autoclosure () -> String) {}
#endif
