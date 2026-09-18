import Testing
import Foundation
@testable import GildongmuKit

/// 경로 브리핑의 출구 번호 줄(E25) — 웹 `transit-exit-lines.test.ts`와 같은 케이스를 본다.
/// 갈리면 같은 경로가 웹과 앱에서 다른 줄을 낸다.
struct TransitExitLinesTests {
    /// 앱 카탈로그의 `transitGuide.exitBound`를 대신하는 테스트용 조립기(ko 문구와 같은 모양).
    private let exitBound: (String) -> String = { "\($0)번 출구 방면" }

    private func walk() -> TransitRouteLeg {
        TransitRouteLeg(
            mode: "walk", lineName: nil, fromName: nil, toName: "개화", stationCount: nil,
            minutes: 2, serviceStatus: nil, firstServiceTime: nil, lastServiceTime: nil,
            distanceMeters: 131)
    }

    private func subway(board: String? = nil, alight: String? = nil) -> TransitRouteLeg {
        TransitRouteLeg(
            mode: "subway", lineName: "수도권 9호선", fromName: "개화", toName: "중앙보훈병원",
            stationCount: 15, minutes: 30, serviceStatus: nil, firstServiceTime: nil, lastServiceTime: nil,
            exit: (board == nil && alight == nil) ? nil : TransitLegExit(board: board, alight: alight))
    }

    private func bus() -> TransitRouteLeg {
        TransitRouteLeg(
            mode: "bus", lineName: "370", fromName: "정류소", toName: "환승정류소",
            stationCount: 5, minutes: 10, serviceStatus: nil, firstServiceTime: nil, lastServiceTime: nil)
    }

    // MARK: 하차 줄

    @Test func 빠른하차와_출구가_함께_있으면_문_먼저_출구가_끝에() {
        let quick = QuickExit(transfer: QuickExitDoor(kind: "door", doors: ["6-3"]))
        let line = alightLineText(
            quick, station: "노량진", exitAlight: "7", lang: "ko", exitBound: exitBound)
        #expect(line == "노량진 하차, 빠른 환승 6-3 문, 7번 출구 방면")
    }

    @Test func 빠른하차가_없으면_하차역과_출구만으로_줄이_선다() {
        let line = alightLineText(
            nil, station: "중앙보훈병원", exitAlight: "1", lang: "ko", exitBound: exitBound)
        #expect(line == "중앙보훈병원 하차, 1번 출구 방면")
    }

    @Test func 출구가_없으면_종전_빠른하차_문장_그대로() {
        let quick = QuickExit(elevator: QuickExitDoor(kind: "door", doors: ["6-4"]))
        let line = alightLineText(quick, station: "여의도", exitAlight: nil, lang: "ko", exitBound: exitBound)
        #expect(line == "여의도 하차, 엘리베이터 6-4 문")
    }

    @Test func 둘_다_없으면_줄을_만들지_않는다() {
        #expect(alightLineText(nil, station: "여의도", exitAlight: nil, lang: "ko", exitBound: exitBound) == nil)
    }

    @Test func 형식에_맞지_않는_출구는_부재로_본다() {
        #expect(alightLineText(nil, station: "여의도", exitAlight: "null", lang: "ko", exitBound: exitBound) == nil)
        #expect(alightLineText(nil, station: "여의도", exitAlight: "1 2", lang: "ko", exitBound: exitBound) == nil)
        #expect(alightLineText(nil, station: "여의도", exitAlight: "", lang: "ko", exitBound: exitBound) == nil)
        #expect(
            alightLineText(nil, station: "여의도", exitAlight: "3-1", lang: "ko", exitBound: exitBound)
                == "여의도 하차, 3-1번 출구 방면")
    }

    @Test func 역_이름이_없으면_줄을_만들지_않는다() {
        #expect(alightLineText(nil, station: "", exitAlight: "1", lang: "ko", exitBound: exitBound) == nil)
    }

    @Test func en도_같은_분기를_탄다() {
        let quick = QuickExit(transfer: QuickExitDoor(kind: "door", doors: ["6-3"]))
        let line = alightLineText(
            quick, station: "Noryangjin", exitAlight: "7", lang: "en",
            exitBound: { "Toward Exit \($0)" })
        #expect(line == "Get off at Noryangjin, quick transfer at door 6-3, Toward Exit 7")
    }

    // MARK: 승차 출구가 실리는 줄

    @Test func 도보_다음이_탑승이면_그_도보_줄이_싣는다() {
        let legs = [walk(), subway(board: "1")]
        #expect(boardExitAfterWalk(legs, at: 0) == "1")
        #expect(boardExitOnBoardLine(legs, at: 1) == nil)
    }

    @Test func 앞에_도보가_없으면_탑승_줄이_싣는다() {
        #expect(boardExitOnBoardLine([bus(), subway(board: "5")], at: 1) == "5")
        #expect(boardExitOnBoardLine([subway(board: "2")], at: 0) == "2")
    }

    @Test func 실을_것이_없으면_둘_다_nil() {
        #expect(boardExitAfterWalk([walk(), walk()], at: 0) == nil)
        #expect(boardExitAfterWalk([walk()], at: 0) == nil)
        #expect(boardExitAfterWalk([walk(), subway(alight: "1")], at: 0) == nil)
        #expect(boardExitOnBoardLine([walk(), subway(board: "1")], at: 0) == nil)
        #expect(boardExitAfterWalk([walk(), subway(board: " ")], at: 0) == nil)
        #expect(boardExitOnBoardLine([bus(), subway(board: "null")], at: 1) == nil)
    }

    @Test func 불변식_한_탑승_구간의_승차_출구는_한_줄에만_실린다() {
        let routes: [[TransitRouteLeg]] = [
            [walk(), subway(board: "1"), walk()],
            [bus(), subway(board: "5"), walk()],
            [subway(board: "2"), walk(), bus()],
            [walk(), subway(board: "1"), subway(alight: "3"), walk()],
            [walk(), bus(), walk(), subway(board: "4"), walk()],
        ]
        for legs in routes {
            for (i, leg) in legs.enumerated() where leg.mode != "walk" {
                let onWalk = i > 0 && legs[i - 1].mode == "walk" ? boardExitAfterWalk(legs, at: i - 1) : nil
                let onBoard = boardExitOnBoardLine(legs, at: i)
                #expect([onWalk, onBoard].compactMap { $0 }.count <= 1)
                // 서버가 실은 값은 반드시 어느 한 줄에 도달한다(조용한 누락 금지).
                #expect((onWalk ?? onBoard) == leg.exit?.board)
            }
        }
    }

    // MARK: 줄 단위 영어 자격 (하차 줄 역명이 구간 줄과 같은 술어를 본다)

    @Test(arguments: [nil, "", " \t\r\n", "\u{00A0}\u{200B}\u{3000}"] as [String?])
    func 이름의_부재는_문구_인자로_전달되지_않는다(_ name: String?) {
        #expect(transitBriefingName(name) == nil)
    }

    @Test(arguments: ["천호(풍납토성)", "  서울 역 \n", "City Hall", "  VHS Medical Center  "])
    func 정상_이름은_공백과_부역명까지_원문을_보존한다(_ name: String) {
        #expect(transitBriefingName(name) == name)
        #expect(alightLineText(nil, station: name, exitAlight: "1", lang: "ko", exitBound: exitBound)
                == "\(name) 하차, 1번 출구 방면")
    }

    @Test(arguments: ["", " ", "\t\n\r", "\u{00A0}\u{200B}\u{3000}"])
    func 빈_영문은_구간과_하차_역명을_함께_한국어로_돌린다(_ blank: String) {
        for leg in [subwayEn(lineEn: blank), subwayEn(fromEn: blank), subwayEn(toEn: blank)] {
            #expect(!transitLegUsesEnglish(leg, lang: .en))
            #expect(transitAlightStationName(leg, lang: .en) == "중앙보훈병원")
        }
    }

    @Test(arguments: ["", " ", "\t\n\r", "\u{00A0}\u{200B}\u{3000}"])
    func 빈_하차역은_빠른하차나_출구가_있어도_문장을_만들지_않는다(_ blank: String) {
        let quick = QuickExit(transfer: QuickExitDoor(kind: "door", doors: ["6-3"]))
        for lang in ["ko", "en"] {
            for detail: QuickExit? in [nil, quick] {
                #expect(alightLineText(detail, station: blank, exitAlight: "1", lang: lang, exitBound: exitBound) == nil)
            }
        }
    }

    @Test(arguments: [nil, "", " \t\n", "\u{3000}"] as [String?])
    func 없는_한국어_이름은_영어_자격을_막지_않고_하차역을_추정하지_않는다(_ blank: String?) {
        let leg = TransitRouteLeg(
            mode: "subway", lineName: "수도권 9호선", fromName: blank, toName: blank,
            stationCount: 15, minutes: 30, serviceStatus: nil, firstServiceTime: nil, lastServiceTime: nil,
            lineNameEn: "Line 9")
        #expect(transitLegUsesEnglish(leg, lang: .en))
        #expect(transitAlightStationName(leg, lang: .ko) == "")
        #expect(transitAlightStationName(leg, lang: .en) == "")
        let walk = TransitRouteLeg(
            mode: "walk", lineName: nil, fromName: nil, toName: blank, stationCount: nil,
            minutes: 2, serviceStatus: nil, firstServiceTime: nil, lastServiceTime: nil)
        #expect(transitLegUsesEnglish(walk, lang: .en))
    }

    @Test(arguments: ["", " \t\n", "\u{3000}"])
    func 도보_행선지의_빈_영문도_한국어로_돌린다(_ blank: String) {
        let leg = TransitRouteLeg(
            mode: "walk", lineName: nil, fromName: nil, toName: "개화", stationCount: nil,
            minutes: 2, serviceStatus: nil, firstServiceTime: nil, lastServiceTime: nil, toNameEn: blank)
        #expect(!transitLegUsesEnglish(leg, lang: .en))
    }

    private func subwayEn(lineEn: String? = "Line 9", fromEn: String? = "Gaehwa", toEn: String? = "VHS Medical Center")
        -> TransitRouteLeg
    {
        TransitRouteLeg(
            mode: "subway", lineName: "수도권 9호선", fromName: "개화", toName: "중앙보훈병원",
            stationCount: 15, minutes: 30, serviceStatus: nil, firstServiceTime: nil, lastServiceTime: nil,
            lineNameEn: lineEn, fromNameEn: fromEn, toNameEn: toEn)
    }

    @Test func ko_세션은_영문이_다_있어도_한국어() {
        #expect(transitLegUsesEnglish(subwayEn(), lang: .ko) == false)
        #expect(transitAlightStationName(subwayEn(), lang: .ko) == "중앙보훈병원")
    }

    @Test func en_세션은_노선_승차_하차_영문이_다_있을_때만_영어() {
        #expect(transitLegUsesEnglish(subwayEn(), lang: .en))
        #expect(transitAlightStationName(subwayEn(), lang: .en) == "VHS Medical Center")
        // 하나라도 없으면 줄 전체가 한국어 — 하차 역명만 영문으로 바꾸지 않는다(구간 줄과 어긋난다).
        #expect(transitLegUsesEnglish(subwayEn(lineEn: nil), lang: .en) == false)
        #expect(transitAlightStationName(subwayEn(lineEn: nil), lang: .en) == "중앙보훈병원")
        #expect(transitLegUsesEnglish(subwayEn(fromEn: nil), lang: .en) == false)
        #expect(transitLegUsesEnglish(subwayEn(toEn: nil), lang: .en) == false)
        #expect(transitAlightStationName(subwayEn(toEn: nil), lang: .en) == "중앙보훈병원")
    }

    @Test func 도보_구간은_행선지_영문만_본다() {
        let named = TransitRouteLeg(
            mode: "walk", lineName: nil, fromName: nil, toName: "개화", stationCount: nil,
            minutes: 2, serviceStatus: nil, firstServiceTime: nil, lastServiceTime: nil, toNameEn: "Gaehwa")
        #expect(transitLegUsesEnglish(named, lang: .en))
        #expect(transitLegUsesEnglish(walk(), lang: .en) == false)
        // 마지막 도보(행선지 없음)는 영문 조각이 필요 없다.
        let last = TransitRouteLeg(
            mode: "walk", lineName: nil, fromName: nil, toName: nil, stationCount: nil,
            minutes: 2, serviceStatus: nil, firstServiceTime: nil, lastServiceTime: nil)
        #expect(transitLegUsesEnglish(last, lang: .en))
        #expect(transitAlightStationName(last, lang: .en) == "")
    }
}
