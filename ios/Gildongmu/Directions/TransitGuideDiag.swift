import Foundation

// 대중교통 대기 국면 계측(§13.5, 피드백 #4 "탑승 대기 고정" 원인 확정용).
// ChatFocusDiag 선례의 파일 로그 패턴 — 콘솔 + 기기 파일(Documents/
// transit-guide-diag.log, 2MB 초과 시 .old로 교체)이라 USB 콘솔 없는 실승차에서도
// 보존된다. 회수: `xcrun devicectl device copy from --domain-type appDataContainer`.
// ⚠ Experimental 구성은 DEBUG를 정의하지 않으므로 게이트에 EXPERIMENTAL 명시 필수.
// 릴리스 빌드는 no-op(자동 클로저라 로그 문자열 조립 자체가 일어나지 않는다).

#if DEBUG || EXPERIMENTAL
nonisolated final class TransitGuideFileLog: @unchecked Sendable {
    static let shared = TransitGuideFileLog()
    private let lock = NSLock()
    private var handle: FileHandle?
    private static let maxBytes: UInt64 = 2_000_000

    private static var logURL: URL {
        FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("transit-guide-diag.log")
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
                    .appendingPathComponent("transit-guide-diag.old.log")
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
/// unsafe 표기만 붙인다(ChatFocusDiag 동형).
private nonisolated(unsafe) let transitGuideDateFormatter = ISO8601DateFormatter()

nonisolated func transitGuideLog(_ msg: @autoclosure () -> String) {
    let wallClock = transitGuideDateFormatter.string(from: Date())
    let line = "[TransitGuide] [\(wallClock)] \(msg())"
    print(line)
    TransitGuideFileLog.shared.append(line)
}
#else
@inline(__always) nonisolated func transitGuideLog(_: @autoclosure () -> String) {}
#endif
