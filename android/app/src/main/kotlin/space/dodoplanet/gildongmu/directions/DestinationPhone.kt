package space.dodoplanet.gildongmu.directions

import space.dodoplanet.gildongmu.kit.BeaconDest
import space.dodoplanet.gildongmu.kit.PlacePhoneBook
import space.dodoplanet.gildongmu.kit.models.Place
import space.dodoplanet.gildongmu.kit.stationLayoutKind

/**
 * 안내 목적지의 전화번호(E90) — 목적지 전화번호부가 제목의 이름·좌표로 아는 번호. 모르면 null이다.
 * 제목 메뉴의 「전화 걸기」와 「장소 상세 보기」의 전화 줄이 같은 값을 쓴다.
 */
fun PlacePhoneBook.guideDestinationPhone(dest: BeaconDest?, label: String): String? =
    dest?.let { phone(label, it.lat, it.lng) }

/**
 * 목적지를 고르는 자리가 그때 손에 든 번호를 전화번호부에 적는다(E90). 번호가 없으면 아무것도 하지 않는다.
 * ⚠ 장소(`Place`)를 길찾기 끝점·안내 목적지로 넘기는 새 자리는 이것을 함께 부른다(가드 `GuideDestinationCallGuardTest`).
 * 역은 적지 않는다 — 역의 번호는 운영사 대표번호이고, 그것을 대표번호라고 밝히는 역 상세는 안내 시트의 목적지 상세(분류 없는 최소 `Place`)에서 열리지 않는다.
 */
fun PlacePhoneBook.noteDestination(place: Place) {
    if (stationLayoutKind(place) != null) return
    note(place.name, place.lat, place.lng, place.phone)
}
