import Testing
@testable import GildongmuKit

/// G4② — 업데이트 이력이 설치된 빌드보다 높은 버전을 보여 주지 않는다.
struct AppVersionTests {
    @Test func 컴포넌트_수가_달라도_같은_버전이다() {
        // MARKETING_VERSION은 `1.7.0`, 정본 md에서 뽑은 노트 버전은 `1.7`이다.
        #expect(compareVersionStrings("1.7", "1.7.0") == .orderedSame)
        #expect(isReleaseNoteVisible(noteVersion: "1.7", appVersion: "1.7.0"))
    }

    @Test func 사전순이_아니라_수치로_비교한다() {
        #expect(compareVersionStrings("1.10", "1.9") == .orderedDescending)
        #expect(!isReleaseNoteVisible(noteVersion: "1.10", appVersion: "1.9.0"))
    }

    @Test func 미출시_버전은_감춘다() {
        #expect(!isReleaseNoteVisible(noteVersion: "1.8", appVersion: "1.7.0"))
        #expect(!isReleaseNoteVisible(noteVersion: "1.7.1", appVersion: "1.7.0"))
    }

    @Test func 지난_버전은_보인다() {
        #expect(isReleaseNoteVisible(noteVersion: "1.6", appVersion: "1.7.0"))
        #expect(isReleaseNoteVisible(noteVersion: "1.0", appVersion: "1.7.0"))
    }

    @Test func 앱_버전을_모르면_거르지_않는다() {
        // 판정 근거가 없을 때 목록을 비우면 "이력이 없다"는 거짓이 된다.
        #expect(isReleaseNoteVisible(noteVersion: "9.9", appVersion: nil))
        #expect(isReleaseNoteVisible(noteVersion: "9.9", appVersion: ""))
    }

    @Test func 숫자가_아닌_꼬리는_앞쪽_숫자만_읽는다() {
        // 통째로 0으로 떨구면 `1.7-beta`가 `1.0`이 되어 옛 버전으로 위장한다.
        #expect(compareVersionStrings("1.7-beta", "1.7") == .orderedSame)
        #expect(compareVersionStrings("1.8-beta", "1.7") == .orderedDescending)
    }
}
