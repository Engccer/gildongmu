package space.dodoplanet.gildongmu.kit

import space.dodoplanet.gildongmu.kit.models.BarrierFreeDetail
import space.dodoplanet.gildongmu.kit.models.BarrierFreeDetailResponse
import space.dodoplanet.gildongmu.kit.models.BarrierFreeNearbyResponse
import space.dodoplanet.gildongmu.kit.models.BarrierFreePlace

/**
 * 옵트인 확장 요청 — 라우트 기본 상한(8)은 limit 미지정 소비자(CLI/MCP)용, "더 보기" 재료는 이 앱이 limit으로
 * 명시 확보한다(웹 FETCH_LIMIT 미러).
 */
private const val fetchLimit = 50

/**
 * 무장애 여행 정보 조회. Kit `BarrierFreeService.swift` 미러. `nearby`는 여느 서비스와 같이 throw(`APIError`) —
 * 3-state 매핑은 화면 모델 몫. `match`만 예외: 웹 계약상 실패를 전부 `{"detail":null}`로 반환하는 매칭 보조
 * 엔드포인트라, 네트워크·디코딩 오류까지 null로 수렴시켜 호출부(장소 상세)가 무음 미노출할 수 있게 한다.
 * `/api/places/barrier-free/detail` 라우트는 웹·CLI가 소비 — 앱에 필요하면 재도입.
 */
class BarrierFreeService(val client: APIClient) {
    suspend fun nearby(lat: Double, lng: Double): List<BarrierFreePlace> =
        client.get<BarrierFreeNearbyResponse>("/api/places/barrier-free", coordQuery(lat, lng) + ("limit" to fetchLimit.toString())).places

    /** 비-throw: 네트워크 오류·디코딩 오류·`{"detail":null}` 모두 null로 수렴(웹 match 계약). 취소는 통과한다. */
    suspend fun match(lat: Double, lng: Double, name: String): BarrierFreeDetail? =
        optional {
            client.get<BarrierFreeDetailResponse>("/api/places/barrier-free/match", coordQuery(lat, lng) + ("name" to name))
        }?.detail
}
