package space.dodoplanet.gildongmu.settings

import kotlinx.serialization.Serializable

/** 설정 화면(스택, spec §14-1) — 탭 루트 4개의 상단 바 `SettingsAction`이 연다. `AppRoot`에 한 줄 등록. */
@Serializable data object SettingsRoute

/** 정보 출처(설정 → 스택, spec §14-4). */
@Serializable data object DataSourcesRoute
