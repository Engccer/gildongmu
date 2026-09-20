package space.dodoplanet.gildongmu

import androidx.test.platform.app.InstrumentationRegistry

/** 앱 데이터와 분리된 테스트 APK의 계약 fixture. JVM Fixtures의 저장소 탐색을 기기에서 쓰지 않는다. */
object DeviceFixtures {
    fun kit(name: String): String =
        InstrumentationRegistry.getInstrumentation().context.assets.open(name)
            .bufferedReader().use { it.readText() }.also { check(it.isNotBlank()) { "fixture가 비었다: $name" } }
}
