package space.dodoplanet.gildongmu.kit

import space.dodoplanet.gildongmu.kit.models.WhereAmIData
import space.dodoplanet.gildongmu.kit.models.WhereAmIResponse

/**
 * "현재 위치 정위" 조회. Kit `WhereAmIService.swift` 미러. GET /api/where-am-i?lat=&lng= envelope {data: WhereAmIData?}:
 * 키 없음→data:null(null 반환, 죽은 기능 아님), 네 조각 전부 비면 502(throw), 그 외 200+data.
 */
class WhereAmIService(val client: APIClient) {
    suspend fun locate(lat: Double, lng: Double): WhereAmIData? =
        client.get<WhereAmIResponse>("/api/where-am-i", coordQuery(lat, lng)).data
}
