package space.dodoplanet.gildongmu.kit

import space.dodoplanet.gildongmu.kit.models.WalkInfraEnvelope
import space.dodoplanet.gildongmu.kit.models.WalkInfrastructure

/**
 * 내 주변 보행 인프라 조회. Kit `WalkInfraService.swift` 미러. GET /api/walk/nearby?lat=&lng= → {walk: WalkInfrastructure}.
 * 게이트 없음(음향신호기=무인증 seed, OSM=무키 정적 seed)이라 항상 노출 가능. 한 소스만 실패해도 200 부분
 * 결과(`WalkSourceStatus`로 보존), 두 소스 전멸만 503(throw). 커버리지 마커 없음 — 제공 지역 밖은 소스별
 * `unsupported`로 자기 표기한다.
 */
class WalkInfraService(val client: APIClient) {
    suspend fun nearby(lat: Double, lng: Double): WalkInfrastructure =
        client.get<WalkInfraEnvelope>("/api/walk/nearby", coordQuery(lat, lng)).walk
}
