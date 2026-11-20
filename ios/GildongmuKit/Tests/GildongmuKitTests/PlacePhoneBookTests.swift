import Foundation
import Testing
@testable import GildongmuKit

private func freshDefaults() -> UserDefaults {
    let name = "PlacePhoneBookTests.\(UUID().uuidString)"
    let defaults = UserDefaults(suiteName: name)!
    defaults.removePersistentDomain(forName: name)
    return defaults
}

@Test func placePhoneBookReturnsNotedPhoneForSamePlace() {
    let book = PlacePhoneBook(defaults: freshDefaults())
    book.note(label: "오아시스마켓", lat: 37.55471, lng: 126.97072, phone: "02-123-4567")

    // 좌표 4자리까지 같으면 같은 장소다(최근 도착지와 같은 축).
    #expect(book.phone(label: "오아시스마켓", lat: 37.55474, lng: 126.97068) == "02-123-4567")
}

@Test func placePhoneBookDoesNotLendPhoneToAnotherPlace() {
    let book = PlacePhoneBook(defaults: freshDefaults())
    book.note(label: "오아시스마켓", lat: 37.5547, lng: 126.9707, phone: "02-123-4567")

    // 같은 좌표의 다른 이름(같은 건물의 다른 가게, 승차 전 도보의 정류장 제목).
    #expect(book.phone(label: "서울역 버스환승센터", lat: 37.5547, lng: 126.9707) == nil)
    // 같은 이름의 다른 지점.
    #expect(book.phone(label: "오아시스마켓", lat: 37.5647, lng: 126.9707) == nil)
}

@Test func placePhoneBookNilOrBlankPhoneNeitherWritesNorErases() {
    let book = PlacePhoneBook(defaults: freshDefaults())
    book.note(label: "새가게", lat: 37.5, lng: 127.0, phone: "  ")
    #expect(book.phone(label: "새가게", lat: 37.5, lng: 127.0) == nil)

    // 번호를 모르는 투영 Place(안내 목적지·정류장)가 지나가도 적힌 번호는 남는다.
    book.note(label: "오아시스마켓", lat: 37.5547, lng: 126.9707, phone: "02-123-4567")
    book.note(label: "오아시스마켓", lat: 37.5547, lng: 126.9707, phone: nil)
    book.note(label: "오아시스마켓", lat: 37.5547, lng: 126.9707, phone: "")
    #expect(book.phone(label: "오아시스마켓", lat: 37.5547, lng: 126.9707) == "02-123-4567")
}

@Test func placePhoneBookKeepsLatestPhoneAndPersists() {
    let defaults = freshDefaults()
    PlacePhoneBook(defaults: defaults).note(label: "오아시스마켓", lat: 37.5547, lng: 126.9707, phone: "02-123-4567")
    PlacePhoneBook(defaults: defaults).note(label: "오아시스마켓", lat: 37.5547, lng: 126.9707, phone: "02-765-4321")

    // 다른 인스턴스(앱 재실행)에서도 최신 번호 하나만 남는다.
    #expect(PlacePhoneBook(defaults: defaults).phone(label: "오아시스마켓", lat: 37.5547, lng: 126.9707) == "02-765-4321")
}

@Test func placePhoneBookDropsOldestBeyondCap() {
    var entries: [PlacePhoneEntry] = []
    for i in 0...PlacePhoneBook.cap {
        entries = PlacePhoneBook.noted(entries, label: "가게\(i)", lat: 37.0 + Double(i) * 0.001, lng: 127.0, phone: "02-000-\(i)")
    }

    #expect(entries.count == PlacePhoneBook.cap)
    // 가장 먼저 적은 줄이 밀려나고 가장 나중 줄이 맨 앞이다.
    #expect(PlacePhoneBook.phone(in: entries, label: "가게0", lat: 37.0, lng: 127.0) == nil)
    #expect(entries.first?.label == "가게\(PlacePhoneBook.cap)")
}
