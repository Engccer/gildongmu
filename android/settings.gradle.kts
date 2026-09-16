// 길동무 안드로이드 빌드 루트. 모듈 둘: :app(Compose 화면·플랫폼 서비스) · :kit(순수 Kotlin/JVM,
// iOS GildongmuKit 미러 — 안드로이드 의존 0, KitPurityTest가 잠근다).
pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}

plugins {
    // JDK 자동 조달(foojay). `gradle/gradle-daemon-jvm.properties`의 21과 짝이다 — 기계 경로를
    // gradle.properties에 박지 않고도 어느 머신이든 JDK 21로 돈다(없으면 ~/.gradle/jdks에 내려받는다).
    id("org.gradle.toolchains.foojay-resolver-convention") version "1.0.0"
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
    }
}

rootProject.name = "gildongmu-android"
include(":app", ":kit")
