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
    (1049, "1.049km"),
    (1050, "1.05km"),
    (1187, "1.187km"),
    (1999, "1.999km"),
    (3640, "3.64km"),
    (89700, "89.7km"),
    (123456, "123.456km"),
]

@Suite struct FormatDistanceTests {
    @Test func matchesSharedTable() {
        for (meters, expected) in distanceCases {
            #expect(formatDistance(meters) == expected, "\(meters)m")
        }
    }

    /// 위원장 지시(2026-08-02): 원값 그대로, 후행 0 없이. ⚠ Swift String(Double)은
    /// 정수에 "1.0"을 남기므로 정수 분기가 빠지면 여기서 잡힌다.
    @Test func neverLeavesTrailingZero() {
        #expect(formatDistance(1000) == "1km")
        #expect(formatDistance(2000) == "2km")
        #expect(formatDistance(1100) == "1.1km")
        #expect(formatDistance(10600) == "10.6km")
    }
}

@Suite struct SpokenDistanceUnitsTests {
    private func spoken(_ s: String) -> String {
        spokenDistanceUnits(s, meters: "미터")
    }

    /// m만 풀고 km는 그대로 둔다(VO가 km는 정확히 발화, 위원장 실기기 확인).
    @Test func expandsOnlyMeters() {
        #expect(spoken("300m") == "300 미터")
        #expect(spoken("10.6km") == "10.6km")
        #expect(spoken("6.285km") == "6.285km")
    }

    /// formatDistance 전 출력 모양에서 **미터 약어가 남지 않는지**(경계표 재사용).
    /// km 표기는 그대로 남는 것이 정상이다.
    @Test func coversAllFormatDistanceShapes() {
        for (input, expected) in distanceCases {
            let s = spoken(formatDistance(input))
            #expect(s.range(of: #"\dm(?![A-Za-z])"#, options: .regularExpression) == nil,
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
        #expect(spoken("10kmh") == "10kmh")
    }

    /// 서버 완성 문장 속 거리도 풀린다(브리핑 스텝 낭독 대상).
    @Test func expandsInsideServerSentence() {
        #expect(spoken("교차로에서 우회전 후 명일로를 따라 244m 이동")
                == "교차로에서 우회전 후 명일로를 따라 244 미터 이동")
    }

    /// **CJK 직결 꼴이 핵심 케이스다.** ICU `\b`는 한글을 word character로 봐서
    /// "35m입니다"에서 경계가 성립하지 않는다. `\b` 회귀 시 이 테스트가 잡는다.
    @Test func expandsWhenCJKFollowsImmediately() {
        #expect(spoken("약 35m입니다.") == "약 35 미터입니다.")
        #expect(spoken("약 5m에 있습니다") == "약 5 미터에 있습니다")
        #expect(spoken("半径300m以内") == "半径300 미터以内")
    }
}
