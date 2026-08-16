import Foundation

// 진단 로그 파일 싱크(공용). 콘솔과 함께 기기 파일 Documents/<이름>.log에 남겨 USB
// 콘솔 없는 실보행·실승차·실측에서도 보존한다. 2MB 초과 시 <이름>.old.log로 교체.
// 회수: `xcrun devicectl device copy from --domain-type appDataContainer`.
// 소비자는 GuideDiag·TransitGuideDiag·ChatFocusDiag·AudioSignalDiag(파일 이름만 다르던
// 사본 넷을 2026-08-17 통합). 새 진단 로그는 여기 인스턴스를 하나 더 두는 것으로 끝낸다.
// ⚠ Experimental 구성은 DEBUG를 정의하지 않으므로 게이트에 EXPERIMENTAL 명시 필수.

#if DEBUG || EXPERIMENTAL
nonisolated final class DiagFileLog: @unchecked Sendable {
    static let guide = DiagFileLog(fileName: "guide-diag")
    static let transitGuide = DiagFileLog(fileName: "transit-guide-diag")
    static let chatFocus = DiagFileLog(fileName: "chat-focus-diag")
    static let audioSignal = DiagFileLog(fileName: "audio-signal-diag")

    private let fileName: String
    private let lock = NSLock()
    private var handle: FileHandle?
    private static let maxBytes: UInt64 = 2_000_000

    init(fileName: String) { self.fileName = fileName }

    private var logURL: URL {
        FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("\(fileName).log")
    }

    func append(_ line: String) {
        lock.withLock {
            guard let handle = ensureHandleLocked() else { return }
            // ⚠ `write(_:)`는 실패 시 Swift에서 잡을 수 없는 ObjC 예외를 던진다
            //   (디스크가 차면 실측 중 크래시가 된다). throwing 형태를 쓴다.
            try? handle.write(contentsOf: Data((line + "\n").utf8))
        }
    }

    private func ensureHandleLocked() -> FileHandle? {
        if let handle {
            if (try? handle.offset()) ?? 0 > Self.maxBytes {
                try? handle.close()
                self.handle = nil
                let url = logURL
                let old = url.deletingLastPathComponent().appendingPathComponent("\(fileName).old.log")
                try? FileManager.default.removeItem(at: old)
                try? FileManager.default.moveItem(at: url, to: old)
            } else {
                return handle
            }
        }
        let url = logURL
        if !FileManager.default.fileExists(atPath: url.path) {
            FileManager.default.createFile(atPath: url.path, contents: nil)
        }
        guard let newHandle = try? FileHandle(forWritingTo: url) else { return nil }
        _ = try? newHandle.seekToEnd()
        handle = newHandle
        return newHandle
    }
}
#endif
