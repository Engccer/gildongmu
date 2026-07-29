import Foundation
import UIKit

#if DEBUG
/// VO 포커스 진단 로그(DEBUG 전용, dodo R184 LiveDiagFileLog 이식). VO 포커스 이동은
/// 실기기 전용에 침묵 실패라(시뮬레이터 AX 브리지로 검증 불가) 실패 시 가설 패치를
/// 반복하지 말고 이 로그로 실착지를 확정한다(계측 우선). 콘솔과 기기 파일
/// (Documents/chat-focus-diag.log, 2MB 초과 시 .old로 교체)에 함께 남기므로 USB 콘솔
/// 없는 실사용 테스트에서도 보존된다. 회수:
/// `xcrun devicectl device copy from --domain-type appDataContainer`
nonisolated final class ChatFocusFileLog: @unchecked Sendable {
    static let shared = ChatFocusFileLog()
    private let lock = NSLock()
    private var handle: FileHandle?
    private static let maxBytes: UInt64 = 2_000_000

    private static var logURL: URL {
        FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("chat-focus-diag.log")
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
                let old = url.deletingLastPathComponent().appendingPathComponent("chat-focus-diag.old.log")
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

/// ISO8601DateFormatter는 문서상 스레드 안전(NSDateFormatter와 달리) — 컴파일러가 Sendable을
/// 증명 못 해 unsafe 표기만 붙인다(호출당 할당 회피 목적의 공유 인스턴스).
private nonisolated(unsafe) let chatFocusDateFormatter = ISO8601DateFormatter()

nonisolated func chatFocusLog(_ msg: String) {
    let wallClock = chatFocusDateFormatter.string(from: Date())
    let line = "[ChatFocus] [\(String(format: "%.1f", ProcessInfo.processInfo.systemUptime))s] [\(wallClock)] \(msg)"
    print(line)
    ChatFocusFileLog.shared.append(line)
}

/// VoiceOver 포커스가 실제 어느 요소에 앉는지 파일 로그로 남긴다(앱 수명 1회 설치).
/// 완료 시 질문 헤딩 이동의 실패 원인을 가설이 아니라 로그로 확정하기 위한 관찰자.
@MainActor private var chatFocusObserverInstalled = false

@MainActor func installChatFocusObserverOnce() {
    guard !chatFocusObserverInstalled else { return }
    chatFocusObserverInstalled = true
    NotificationCenter.default.addObserver(
        forName: UIAccessibility.elementFocusedNotification, object: nil, queue: .main
    ) { note in
        // queue: .main이라 런타임은 항상 메인 — accessibilityLabel의 MainActor 격리를
        // assumeIsolated로 타입시스템에 단언한다(리뷰 검출). note는 비-Sendable이라
        // 격리 경계 통과를 unsafe 바인딩으로 명시(같은 스레드 내 이동이라 실제 경합 없음).
        nonisolated(unsafe) let note = note
        MainActor.assumeIsolated {
            let element = note.userInfo?[UIAccessibility.focusedElementUserInfoKey]
            let label = (element as? NSObject)?.accessibilityLabel ?? String(describing: element)
            chatFocusLog("VO focus -> \(String(label.prefix(80)))")
        }
    }
    // VO 통지(Announcement)가 실제로 발화됐는지 관찰(홀드 짧은 탭 무발화 회귀 계측,
    // 2026-07-29). 통지는 *게시*와 *발화*가 분리된 계층이라 — post() 호출 자체는
    // Announcement가 도달했는지 말해주지 않는다 — 이 옵저버가 그 발화 결과를 확정한다.
    NotificationCenter.default.addObserver(
        forName: UIAccessibility.announcementDidFinishNotification, object: nil, queue: .main
    ) { note in
        nonisolated(unsafe) let note = note
        MainActor.assumeIsolated {
            let text = note.userInfo?[UIAccessibility.announcementStringValueUserInfoKey] as? String ?? ""
            let success = (note.userInfo?[UIAccessibility.announcementWasSuccessfulUserInfoKey] as? Bool) ?? false
            chatFocusLog("VO announcement didFinish success=\(success) text=\(String(text.prefix(80)))")
        }
    }
}
#endif
