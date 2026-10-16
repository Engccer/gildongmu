import SwiftUI
import GildongmuKit

/// 줄 안에서 여는 대상의 이름에만 링크를 건다(E72 위원장 판정 3·4). 소비자는 셋이다: 둘러보기 「한눈에 보기」 문장,
/// 경로 브리핑 지하철 구간 줄, 채팅 산문 블록.
///
/// 링크는 **시각 탭 경로**일 뿐이다. 줄은 `Text` 하나(= 한 접근성 객체)로 남고, VoiceOver 진입은 소비자가 같은 대상
/// 목록에서 다는 로터 동작이다. 줄 글자에 "버튼"을 넣지 않는다. ⚠ `Text` 안 링크가 VoiceOver 객체를 쪼개는지는 실기기
/// 판정이고(spec 2026-10-17-e72 §3.2), 쪼개지면 `.accessibilityElement(children: .combine)`이 처방이다(실측 전 선반영 금지).
enum InlineTargets {
    /// 자체 스킴. 순번만 싣는다 — 이름·id엔 URL에 안전하지 않은 문자가 있을 수 있다.
    static let scheme = "gildongmu-inline-target"

    static func url(_ index: Int) -> URL {
        URL(string: "\(scheme):///\(index)")!
    }

    static func index(of url: URL) -> Int? {
        guard url.scheme == scheme else { return nil }
        return Int(url.lastPathComponent)
    }

    /// 각 이름의 등장에 `url(순번)` 링크를 건다. 범위 판정(피할 낱말 먼저·긴 이름부터·겹침 건너뛰기)은 Kit
    /// `inlineTargetSpans`가 하고, 여기서는 그 오프셋에 링크와 밑줄만 입힌다. 밑줄은 링크를 색에만 맡기지 않기
    /// 위해서다(WCAG 1.4.1). 인라인 링크는 목표 크기 기준(2.5.8)의 인라인 예외다.
    static func linked(_ text: AttributedString, names: [String], avoiding: [String] = []) -> AttributedString {
        var result = text
        let spans = inlineTargetSpans(in: String(text.characters), names: names, avoiding: avoiding)
        for span in spans {
            let lower = result.characters.index(result.startIndex, offsetBy: span.start)
            let upper = result.characters.index(lower, offsetBy: span.length)
            result[lower..<upper].link = url(span.target)
            result[lower..<upper].underlineStyle = .single
        }
        return result
    }
}

extension View {
    /// 링크 탭을 순번으로 받아 처리한다. 자체 스킴이 아니면 시스템에 넘긴다.
    func inlineTargetTaps(_ open: @escaping (Int) -> Void) -> some View {
        environment(\.openURL, OpenURLAction { url in
            guard let index = InlineTargets.index(of: url) else { return .systemAction }
            open(index)
            return .handled
        })
    }
}
