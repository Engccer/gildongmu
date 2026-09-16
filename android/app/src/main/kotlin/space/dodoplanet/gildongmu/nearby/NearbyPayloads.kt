package space.dodoplanet.gildongmu.nearby

import space.dodoplanet.gildongmu.kit.NearbyCoord
import space.dodoplanet.gildongmu.kit.WalkInfraService
import space.dodoplanet.gildongmu.kit.models.NightClinic
import space.dodoplanet.gildongmu.kit.models.WalkInfrastructure

// M2b kind들의 한 커밋 payload(spec §12-1). 조각 병합이 있는 것(walkInfra·conditions)은 Task 4·5가 더한다.

/** 소아 진료(iOS `ClinicPayload`) — 화면이 밝히는 메타 두 값만(공휴일 기준·보완 실패). */
data class ClinicPayload(val clinics: List<NightClinic>, val basis: String, val supplementFailed: Boolean)

/** 보행 인프라(iOS `WalkInfraPayload`) — `asOf`는 커밋 시각의 앱 언어 short time(헤딩이자 착지 지점). */
data class WalkInfraPayload(val walk: WalkInfrastructure, val asOf: String)

suspend fun fetchWalkInfra(service: WalkInfraService, coord: NearbyCoord, now: () -> String): WalkInfraPayload =
    WalkInfraPayload(service.nearby(coord.lat, coord.lng), now())
