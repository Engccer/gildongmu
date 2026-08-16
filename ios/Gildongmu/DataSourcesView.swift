import SwiftUI

/// 설정 > 정보 출처. 앱이 쓰는 자료의 제공처를 한 화면에 모은다.
/// 웹은 화면마다 각주로 출처를 붙이지만 iOS는 그 자리가 없어 여기가 유일한 표기 지점이고,
/// OpenStreetMap(ODbL 1.0)의 저작자 표시·사본 제공 고지 의무를 이 화면이 이행한다.
///
/// 목록 라벨은 채팅 출처 사전 `chat.source.*`를 그대로 쓴다(복제 금지). 순서도 그 사전의
/// 선언 순서를 따르므로 사전이 늘면 이 목록도 같은 자리에 늘린다.
///
/// ⚠ 키는 항상 문자열 리터럴로 호출한다(check-xcstrings-keys.mjs 린터 계약) — 배열에
/// 키를 담아 동적으로 조회하면 린터가 누락을 못 잡는다. 그래서 라벨 배열은 조회 결과를
/// 담고, 매 렌더 계산해 언어 전환에 따라간다(정적 저장 금지).
struct DataSourcesView: View {
    var body: some View {
        List {
            Section {
                // 한 줄 = 한 접근성 객체: 각 출처는 단일 Text 한 행.
                ForEach(Array(sourceLabels.enumerated()), id: \.offset) { _, label in
                    Text(label)
                }
            }

            Section {
                // OSM 행은 제공처 이름을 품은 라이선스 문장 하나로 갈음한다
                // (`chat.source.osm`을 따로 얹으면 같은 이름이 두 번 낭독된다).
                Text(appLocalized("dataSources.osmLicense"))
                // 인터랙티브 요소는 별도 접근성 객체가 정상이라 합치지 않는다.
                Link(appLocalized("dataSources.osmLink"), destination: Self.osmLicenseURL)
                // ODbL 1.0 §4.6 사본 제공 고지 — 문의처가 없으면 이행이 성립하지 않으므로
                // 문장이 아니라 메일 링크로 둔다(설정의 "문제 신고"와 같은 주소).
                Link(appLocalized("dataSources.osmCopyRequest"), destination: Self.copyRequestURL)
            }
        }
        .navigationTitle(appLocalized("dataSources.title"))
        .navigationBarTitleDisplayMode(.inline)
    }

    private static let osmLicenseURL = URL(string: "https://www.openstreetmap.org/copyright")!
    private static let copyRequestURL = URL(string: "mailto:engccer@gmail.com")!

    /// `chat.source` 사전 선언 순서 그대로(osm은 위 라이선스 행이 담당).
    private var sourceLabels: [String] {
        [
            appLocalized("chat.source.kakao"),
            appLocalized("chat.source.tourapi"),
            appLocalized("chat.source.juso"),
            appLocalized("chat.source.seoulopen"),
            appLocalized("chat.source.airkorea"),
            appLocalized("chat.source.kma"),
            appLocalized("chat.source.tago"),
            appLocalized("chat.source.nmc"),
            appLocalized("chat.source.kakaomobility"),
            appLocalized("chat.source.ncp"),
            appLocalized("chat.source.odsay"),
            appLocalized("chat.source.tmap"),
            appLocalized("chat.source.kric"),
            appLocalized("chat.source.korail"),
            appLocalized("chat.source.seoulmetro"),
            appLocalized("chat.source.perplexity"),
        ]
    }
}
