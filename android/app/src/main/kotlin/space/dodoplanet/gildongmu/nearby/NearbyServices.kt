package space.dodoplanet.gildongmu.nearby

import space.dodoplanet.gildongmu.kit.BarrierFreeService
import space.dodoplanet.gildongmu.kit.ConditionsService
import space.dodoplanet.gildongmu.kit.NearbyService
import space.dodoplanet.gildongmu.kit.WalkInfraService

/** kind 팩토리가 받는 서비스 묶음(전부 `AppConfig.apiClient` 위, `MainActivity`가 조립). */
class NearbyServices(
    val nearby: NearbyService,
    val barrierFree: BarrierFreeService,
    val walkInfra: WalkInfraService,
    val conditions: ConditionsService,
)
