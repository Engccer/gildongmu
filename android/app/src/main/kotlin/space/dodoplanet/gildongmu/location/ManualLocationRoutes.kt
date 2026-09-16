package space.dodoplanet.gildongmu.location

import kotlinx.serialization.Serializable

/** 현재 위치 수동 지정 화면(스택, spec §13-3) — 허브 표시줄 버튼이 연다. `AppRoot`에 한 줄 등록. */
@Serializable data object ManualLocationRoute
