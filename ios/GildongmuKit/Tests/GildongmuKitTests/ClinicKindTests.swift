import Foundation
import Testing
@testable import GildongmuKit

/// 웹 `src/lib/__tests__/clinic-kind.test.ts` 미러 — 두 값만 키, 그 밖은 nil.
@Test func clinicKindKeyMapsOnlyTwoValues() {
    #expect(clinicKindKey("의원") == "clinic")
    #expect(clinicKindKey(" 병원 ") == "hospital")
    #expect(clinicKindKey("종합병원") == nil)
    #expect(clinicKindKey("보건소") == nil)
    #expect(clinicKindKey("") == nil)
}
