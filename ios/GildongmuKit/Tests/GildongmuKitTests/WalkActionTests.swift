import Foundation
import Testing
@testable import GildongmuKit

/// 행동 → 소리 표(N2·K2). 문장 분류(`walkStepAction`)는 2026-09-02에 Kit에서 지웠다 — 행동은
/// 서버 투영만 들어오므로 여기서 문장을 단언하지 않는다(웹 정본 `walk-action.test.ts`가 서버 분류를 본다).
@Test func imminentToneByAction() {
    #expect(imminentTone(.crosswalk) == .crosswalk)
    #expect(imminentTone(.left) == .left)
    #expect(imminentTone(.right) == .right)
    #expect(imminentTone(.back) == .back)
    // 지하보도는 "그 외" — 횡단보도 비프는 음향신호기의 인용이라 붙이면 거짓 인용이 된다.
    #expect(imminentTone(.underpass) == .ahead)
}

/// 갈래 선택은 회전과 같은 소리(K2 §3.1, 웹 walk-action.test.ts 동형).
@Test func keepActionsShareTurnTones() {
    #expect(imminentTone(.keepLeft) == .left)
    #expect(imminentTone(.keepRight) == .right)
}
