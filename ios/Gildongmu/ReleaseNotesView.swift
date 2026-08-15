import SwiftUI
import GildongmuKit

/// 설정 > 업데이트 이력(스펙 2026-08-10 §2). 정본 docs/appstore/release-notes.md를
/// scripts/build-release-notes.mjs가 굳힌 번들 release-notes.json을 표시한다.
/// 언어는 ko만 한국어, 나머지는 en 폴백(정본이 2벌 — 스펙 §2.3).
///
/// ⚠ **설치된 빌드보다 높은 버전은 보여 주지 않는다**(백로그 G4②). 정본 md에 다음
/// 버전 노트를 **미리 등재하는 관례**는 그대로 두고 표시 계층이 거른다 — 심사 대기
/// 중에 사용자가 아직 받지 못한 기능을 "업데이트 이력"에서 읽는 일이 없어야 한다.
struct ReleaseNote: Decodable, Identifiable {
    let version: String
    let ko: String
    let en: String
    var id: String { version }
}

enum ReleaseNotesLoader {
    /// 리소스 부재·디코드 실패는 nil — 화면이 오류 1행으로 정직하게 알린다
    /// (빈 목록으로 위장 금지, 3-state).
    ///
    /// 설치된 빌드보다 높은 버전은 여기서 걸러진다.
    ///
    /// ⚠ **필터 결과가 비어도 원본으로 되돌리지 않는다.** 초안은 "그러면 버전 표기가
    /// 어긋난 것"이라며 전량 폴백을 뒀는데, 그 분기가 실제로 열리는 유일한 조건은
    /// **번들에 미래 버전 노트만 있는 상태**이고 그것이 정확히 이 필터가 막으려던
    /// 누출이다(독립 리뷰 지적). 출하된 빌드의 번들에는 자기 버전 이하 항목이 반드시
    /// 들어 있으므로 빈 목록은 실무상 도달하지 않는다.
    static func load(bundle: Bundle = .main) -> [ReleaseNote]? {
        guard let url = bundle.url(forResource: "release-notes", withExtension: "json"),
              let data = try? Data(contentsOf: url),
              let all = try? JSONDecoder().decode([ReleaseNote].self, from: data)
        else { return nil }
        let installed = installedVersion(bundle: bundle)
        return all.filter { isReleaseNoteVisible(noteVersion: $0.version, appVersion: installed) }
    }

    /// 설치된 빌드의 표시 버전(`CFBundleShortVersionString`). 예: `1.7.0`.
    /// 번들 JSON의 버전은 `1.7`(2컴포넌트)이라 **수치 비교**가 필요하다.
    static func installedVersion(bundle: Bundle = .main) -> String? {
        bundle.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String
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
