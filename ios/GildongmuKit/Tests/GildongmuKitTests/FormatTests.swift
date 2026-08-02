import Testing
@testable import GildongmuKit

/// 거리 표기 계약. 표는 웹 `src/lib/__tests__/format.test.ts`의 `DISTANCE_CASES`와
/// **같아야 하고**, 웹 드리프트 가드가 이 파일을 읽어 대조한다.
///
/// ⚠ 아래 `distanceCases` 리터럴의 모양(`(입력, "기대")`)을 바꾸면 그 가드가 표를
/// 못 찾는다. 가드는 못 찾으면 조용히 통과하지 않고 실패한다.
private let distanceCases: [(Int, String)] = [
    (120, "120m"),
    (999, "999m"),
    (1000, "1km"),
    (1049, "1km"),
    (1050, "1km 100m"),
    (1187, "1km 200m"),
    (1999, "2km"),
    (3640, "3km 600m"),
    (89700, "89km 700m"),
]

@Suite struct FormatDistanceTests {
    @Test func matchesSharedTable() {
        for (meters, expected) in distanceCases {
            #expect(formatDistance(meters) == expected, "\(meters)m")
        }
    }

    /// 100m 단위 반올림을 km·나머지로 따로 하면 여기서 "1km 1000m"이 나온다.
    @Test func carryDoesNotLeakIntoRemainder() {
        #expect(formatDistance(1999) == "2km")
        #expect(formatDistance(1950) == "2km")
        #expect(formatDistance(9999) == "10km")
    }

    /// 소수 km는 낭독이 길어 폐기했다("일 점 영 킬로미터").
    @Test func neverUsesDecimalPoint() {
        for (meters, _) in distanceCases {
            #expect(!formatDistance(meters).contains("."))
        }
    }
}
