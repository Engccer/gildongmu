package space.dodoplanet.gildongmu.nearby

import space.dodoplanet.gildongmu.kit.models.NightClinic

// M2b kind들의 한 커밋 payload(spec §12-1). 조각 병합이 있는 것(walkInfra·conditions)은 Task 4·5가 더한다.

/** 소아 진료(iOS `ClinicPayload`) — 화면이 밝히는 메타 두 값만(공휴일 기준·보완 실패). */
data class ClinicPayload(val clinics: List<NightClinic>, val basis: String, val supplementFailed: Boolean)
