package space.dodoplanet.gildongmu.nearby

import space.dodoplanet.gildongmu.kit.BarrierFreeService
import space.dodoplanet.gildongmu.kit.ConditionsService
import space.dodoplanet.gildongmu.kit.NearbyService
import space.dodoplanet.gildongmu.kit.WalkInfraService

/**
 * kind 팩토리가 받는 서비스 묶음(전부 `AppConfig.apiClient` 위, `MainActivity`가 조립). `shortTimeNow`는 **앱 언어** short time —
 * 인자 없는 `DateFormat.getTimeInstance`·`configuration.locales[0]`는 시스템 로케일이라 한 줄 안에서 언어가 섞인다(`AppLocale` 함정).
 */
class NearbyServices(
    val nearby: NearbyService,
    val barrierFree: BarrierFreeService,
    val walkInfra: WalkInfraService,
    val conditions: ConditionsService,
    val shortTimeNow: () -> String,
)
