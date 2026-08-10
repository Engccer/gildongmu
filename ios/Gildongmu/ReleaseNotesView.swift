import SwiftUI

/// 설정 > 업데이트 이력(스펙 2026-08-10 §2). 정본 docs/appstore/release-notes.md를
/// scripts/build-release-notes.mjs가 굳힌 번들 release-notes.json을 표시한다.
/// 언어는 ko만 한국어, 나머지는 en 폴백(정본이 2벌 — 스펙 §2.3).
struct ReleaseNote: Decodable, Identifiable {
    let version: String
    let ko: String
    let en: String
    var id: String { version }
}

enum ReleaseNotesLoader {
    /// 리소스 부재·디코드 실패는 nil — 화면이 오류 1행으로 정직하게 알린다
    /// (빈 목록으로 위장 금지, 3-state).
    static func load(bundle: Bundle = .main) -> [ReleaseNote]? {
        guard let url = bundle.url(forResource: "release-notes", withExtension: "json"),
              let data = try? Data(contentsOf: url)
        else { return nil }
        return try? JSONDecoder().decode([ReleaseNote].self, from: data)
    }
}

struct ReleaseNotesView: View {
    private let notes = ReleaseNotesLoader.load()

    var body: some View {
        List {
            if let notes {
                ForEach(notes) { note in
                    Section {
                        // 한 줄 = 한 접근성 객체: 본문을 빈 줄 제외 줄 단위 Text로.
                        // "새로운 기능"/"개선" 소제목 줄도 본문 행(heading 부여는 과잉).
                        ForEach(Array(lines(of: note).enumerated()), id: \.offset) { _, line in
                            Text(line)
                        }
                    } header: {
                        // 버전 heading이 로터 헤딩 점프의 버전 간 이동 수단(스펙 §2.2).
                        Text(appLocalized("ios.settings.releaseNotesVersion", note.version))
                            .accessibilityAddTraits(.isHeader)
                    }
                }
            } else {
                Text(appLocalized("ios.settings.releaseNotesError"))
            }
        }
        .navigationTitle(appLocalized("ios.settings.releaseNotes"))
        .navigationBarTitleDisplayMode(.inline)
    }

    private func lines(of note: ReleaseNote) -> [String] {
        let body = AppLanguage.dataLocale == "ko" ? note.ko : note.en
        return body.split(separator: "\n")
            .map { $0.trimmingCharacters(in: .whitespaces) }
            .filter { !$0.isEmpty }
    }
}
