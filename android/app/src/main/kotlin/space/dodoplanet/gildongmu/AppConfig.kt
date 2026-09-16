package space.dodoplanet.gildongmu

/// 빌드 구성 게이트(iOS `AppConfig` 미러). 실험 기능은 플래그 값을 손으로 고치는 것이 아니라
/// 빌드 구성(`experimental`)으로 가른다. 검증되면 참조 자체를 지운다(항상 참 상수를 남기지 않는다).
object AppConfig {
    val experimentalGuidanceEnabled: Boolean = BuildConfig.EXPERIMENTAL
}
