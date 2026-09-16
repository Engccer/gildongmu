package space.dodoplanet.gildongmu.chat

import space.dodoplanet.gildongmu.kit.models.AddressMatch
import space.dodoplanet.gildongmu.kit.models.JusoAddress
import space.dodoplanet.gildongmu.kit.models.Place

/**
 * juso 주소 항목 + 카카오 지오코딩 좌표 → 장소(웹 `src/lib/address-to-place.ts` 미러, 채팅 주소 카드 → 상세). juso는 공식 주소·영문,
 * 카카오는 좌표 정본으로 역할을 나눈다. 영문 주소는 en 데이터 로케일에서만 채운다(상세가 영문 주소를 우선 표시하므로 ko UI 누수 방지).
 * iOS에 대응물이 없어 :app에 둔다 — iOS가 같은 경로를 얻으면 :kit로 옮긴다(D5).
 */
fun jusoAddressToPlace(address: JusoAddress, match: AddressMatch, dataLocale: String): Place {
    val road = address.roadAddrPart1.ifEmpty { address.roadAddr }
    return Place(
        id = "juso-${address.roadAddr}",
        name = address.bdNm.ifEmpty { road },
        category = "",
        address = address.jibunAddr,
        roadAddress = road,
        englishAddress = address.engAddr.takeIf { dataLocale == "en" && it.isNotEmpty() },
        lat = match.lat,
        lng = match.lng,
    )
}
