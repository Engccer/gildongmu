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
}
