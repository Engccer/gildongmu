import Testing
@testable import GildongmuKit

// 산문 블록 ↔ 카드 장소 대응(채팅 산문 커스텀 액션의 근거). 결정론 부분 문자열 매칭:
// 긴 이름 우선으로 대응 구간을 가려 짧은 이름이 긴 이름 안에서 재매칭되지 않고,
// 반환은 산문 첫 등장 순, 같은 이름은 한 번만(액션 라벨이 동일해 구분 불가).

private func place(_ id: String, _ name: String) -> Place {
    Place(
        id: id, name: name, category: "", address: "", roadAddress: "",
        englishAddress: nil, lat: 37.5, lng: 127.0, phone: nil, link: nil, distanceMeters: nil
    )
}

@Test func returnsMentionsInOrderOfAppearance() {
    let places = [place("a", "스타벅스 강동역점"), place("b", "이디야 천호점"), place("c", "투썸 명일점")]
    let text = "가까운 곳은 이디야 천호점이고, 조금 더 가면 스타벅스 강동역점이 있어요."
    #expect(chatPlaceMentions(in: text, places: places).map(\.id) == ["b", "a"])
}

@Test func longerNameMasksShorterOne() {
    // "이마트24"가 먼저 대응되면 그 안의 "이마트"는 별개 언급이 아니다.
    let places = [place("short", "이마트"), place("long", "이마트24 길동점")]
    #expect(chatPlaceMentions(in: "편의점은 이마트24 길동점이 가깝습니다.", places: places).map(\.id) == ["long"])
    // 둘 다 따로 등장하면 둘 다.
    #expect(
        chatPlaceMentions(in: "이마트24 길동점 옆에 이마트도 있어요.", places: places).map(\.id) == ["long", "short"]
    )
}

@Test func ignoresEmptyNamesAndDedupesByName() {
    let places = [place("x", ""), place("w", "  "), place("y", "강동역"), place("z", "강동역")]
    #expect(chatPlaceMentions(in: "강동역에서 강동역 방면", places: places).map(\.id) == ["y"])
}

@Test func noMentionYieldsEmpty() {
    #expect(chatPlaceMentions(in: "근처에 카페가 많아요.", places: [place("a", "스타벅스")]).isEmpty)
    #expect(chatPlaceMentions(in: "", places: [place("a", "스타벅스")]).isEmpty)
}
