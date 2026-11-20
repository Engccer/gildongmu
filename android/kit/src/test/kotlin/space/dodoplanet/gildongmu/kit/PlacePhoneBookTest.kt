package space.dodoplanet.gildongmu.kit

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

/** `PlacePhoneBookTests.swift` 다섯 건의 미러(E90). */
class PlacePhoneBookTest {
    @Test fun `같은 장소면 적은 번호를 돌려준다`() {
        val book = PlacePhoneBook(InMemoryKeyValueStore())
        book.note("오아시스마켓", 37.55471, 126.97072, "02-123-4567")

        // 좌표 4자리까지 같으면 같은 장소다(최근 도착지와 같은 축).
        assertEquals("02-123-4567", book.phone("오아시스마켓", 37.55474, 126.97068))
    }

    @Test fun `다른 장소에 번호를 빌려주지 않는다`() {
        val book = PlacePhoneBook(InMemoryKeyValueStore())
        book.note("오아시스마켓", 37.5547, 126.9707, "02-123-4567")

        // 같은 좌표의 다른 이름(같은 건물의 다른 가게, 승차 전 도보의 정류장 제목).
        assertNull(book.phone("서울역 버스환승센터", 37.5547, 126.9707))
        // 같은 이름의 다른 지점.
        assertNull(book.phone("오아시스마켓", 37.5647, 126.9707))
    }

    @Test fun `null이나 빈 번호는 적지도 지우지도 않는다`() {
        val book = PlacePhoneBook(InMemoryKeyValueStore())
        book.note("새가게", 37.5, 127.0, "  ")
        assertNull(book.phone("새가게", 37.5, 127.0))

        // 번호를 모르는 투영 Place(안내 목적지·정류장)가 지나가도 적힌 번호는 남는다.
        book.note("오아시스마켓", 37.5547, 126.9707, "02-123-4567")
        book.note("오아시스마켓", 37.5547, 126.9707, null)
        book.note("오아시스마켓", 37.5547, 126.9707, "")
        assertEquals("02-123-4567", book.phone("오아시스마켓", 37.5547, 126.9707))
    }

    @Test fun `최신 번호 하나만 남고 저장된다`() {
        val store = InMemoryKeyValueStore()
        PlacePhoneBook(store).note("오아시스마켓", 37.5547, 126.9707, "02-123-4567")
        PlacePhoneBook(store).note("오아시스마켓", 37.5547, 126.9707, "02-765-4321")

        // 다른 인스턴스(앱 재실행)에서도 최신 번호 하나만 남는다.
        assertEquals("02-765-4321", PlacePhoneBook(store).phone("오아시스마켓", 37.5547, 126.9707))
    }

    @Test fun `상한을 넘으면 가장 오래된 줄부터 버린다`() {
        var entries = emptyList<PlacePhoneEntry>()
        for (i in 0..PlacePhoneBook.cap) {
            entries = PlacePhoneBook.noted(entries, "가게$i", 37.0 + i * 0.001, 127.0, "02-000-$i")
        }

        assertEquals(PlacePhoneBook.cap, entries.size)
        // 가장 먼저 적은 줄이 밀려나고 가장 나중 줄이 맨 앞이다.
        assertNull(PlacePhoneBook.phone(entries, "가게0", 37.0, 127.0))
        assertEquals("가게${PlacePhoneBook.cap}", entries.first().label)
    }
}
