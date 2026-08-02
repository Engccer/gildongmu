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

@Suite struct SpokenDistanceUnitsTests {
    private func spoken(_ s: String) -> String {
        spokenDistanceUnits(s, meters: "미터", kilometers: "킬로미터")
    }

    @Test func expandsBothUnits() {
        #expect(spoken("1km 200m") == "1 킬로미터 200 미터")
        #expect(spoken("300m") == "300 미터")
        #expect(spoken("89km") == "89 킬로미터")
    }

    /// formatDistance 전 출력 모양이 변환을 통과하는지(경계표 재사용).
    @Test func coversAllFormatDistanceShapes() {
        for (input, expected) in distanceCases {
            let s = spoken(formatDistance(input))
            #expect(!s.contains("km"), "km 잔존: \(expected) → \(s)")
            // "미터"·"킬로미터" 단어 자체의 m은 정상이므로 숫자+m 패턴만 검사
            #expect(s.range(of: #"\dm\b"#, options: .regularExpression) == nil,
                    "m 잔존: \(expected) → \(s)")
        }
    }

    /// 오차 반경 표기(±)도 숫자+m 꼴이라 함께 풀린다(의미 무관, 낭독 문제는 동일).
    @Test func expandsErrorRadius() {
        #expect(spoken("목적지 근처 (약 ±30m)") == "목적지 근처 (약 ±30 미터)")
    }

    /// 서버 안내문 속 일반 단어는 건드리지 않는다.
    @Test func leavesProseAlone() {
        #expect(spoken("횡단보도 이용") == "횡단보도 이용")
        #expect(spoken("천호대로를 따라 이동") == "천호대로를 따라 이동")
        // 숫자 뒤가 아니면 불변("m" 단독, 영단어 속 m)
        #expect(spoken("markets") == "markets")
    }

    /// 서버 완성 문장 속 거리도 풀린다(브리핑 스텝 낭독 대상).
    @Test func expandsInsideServerSentence() {
        #expect(spoken("교차로에서 우회전 후 명일로를 따라 244m 이동")
                == "교차로에서 우회전 후 명일로를 따라 244 미터 이동")
    }
}
