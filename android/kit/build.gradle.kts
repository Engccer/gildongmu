// :kit — iOS GildongmuKit의 Kotlin 미러(판정 계층 [2]). 순수 JVM: 안드로이드 플러그인도
// 안드로이드 의존성도 없다. 여기에 AndroidX 계열 의존성을 더하는 순간 D5 경계가 깨진다(KitPurityTest가 잠근다).
plugins {
    alias(libs.plugins.kotlin.jvm)
    alias(libs.plugins.kotlin.serialization)
}

kotlin {
    // 컴파일러는 JDK 21 toolchain에서 돌리되 바이트코드는 17로 낸다(:app D8이 소비).
    jvmToolchain(21)
    compilerOptions {
        jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17)
        allWarningsAsErrors.set(true)
    }
}

java {
    sourceCompatibility = JavaVersion.VERSION_17
    targetCompatibility = JavaVersion.VERSION_17
}

dependencies {
    implementation(libs.kotlinx.serialization.json)
    implementation(libs.kotlinx.coroutines.core)

    testImplementation(kotlin("test"))
    testImplementation(libs.kotlinx.coroutines.test)
    testRuntimeOnly(libs.junit.platform.launcher)
}

tasks.test {
    useJUnitPlatform()
    // fixture 로더가 저장소 루트를 찾는 기준점(Fixtures.kt). 모듈 디렉터리에서 위로 올라간다.
    systemProperty("gildongmu.kitDir", projectDir.absolutePath)
}
