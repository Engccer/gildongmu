// :app — Jetpack Compose 화면 + 플랫폼 서비스([3]·[4]). 판정은 :kit에서 가져온다.
// 빌드 구성 셋(iOS Debug/Release/Experimental 미러): debug · release · experimental.
// experimental은 applicationId `.dev` 접미 + 표시 이름 "길동무 실험" + 아이콘 구분으로
// 정식판과 한 기기에 공존한다. 표시 이름 접미사는 스크린 리더 사용자의 유일한 구분 수단이다(O6).
plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.compose)
}

android {
    namespace = "space.dodoplanet.gildongmu"
    // Compose 1.12(BOM 2026.09.00)가 compileSdk 37 이상을 요구한다. compileSdk는 컴파일 API 표면이고
    // targetSdk(런타임 동작 옵트인)·minSdk(설치 하한)와 별개다 — D8의 targetSdk 36·minSdk 31은 그대로.
    compileSdk = 37
    compileSdkMinor = 2

    defaultConfig {
        applicationId = "space.dodoplanet.gildongmu"
        minSdk = 31
        targetSdk = 36
        versionCode = 1
        versionName = "0.1.0"
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    buildTypes {
        debug {
            buildConfigField("boolean", "EXPERIMENTAL", "false")
        }
        release {
            isMinifyEnabled = false
            buildConfigField("boolean", "EXPERIMENTAL", "false")
        }
        create("experimental") {
            initWith(getByName("debug"))
            applicationIdSuffix = ".dev"
            buildConfigField("boolean", "EXPERIMENTAL", "true")
            // 라이브러리(AAR)는 debug/release만 있으므로 실험판은 debug 산출물을 쓴다.
            matchingFallbacks += listOf("debug")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    testOptions {
        unitTests.all { it.useJUnitPlatform() }
    }
}

tasks.withType<Test>().configureEach {
    // 소스 가드·fixture 로더가 저장소 루트를 찾는 기준점.
    systemProperty("gildongmu.appDir", projectDir.absolutePath)
}

java {
    toolchain {
        languageVersion.set(JavaLanguageVersion.of(21))
    }
}

dependencies {
    implementation(project(":kit"))
    implementation(libs.kotlinx.coroutines.core)
    implementation(platform(libs.compose.bom))
    implementation(libs.compose.ui)
    implementation(libs.compose.foundation)
    implementation(libs.compose.material3)
    implementation(libs.activity.compose)
    implementation(libs.lifecycle.viewmodel.compose)

    // AGP 내장 Kotlin은 kotlin-test의 JUnit5 변형을 자동 선택하지 않는다 — 명시한다.
    testImplementation(kotlin("test-junit5"))
    testImplementation(libs.kotlinx.coroutines.test)
    testImplementation(testFixtures(project(":kit")))
    testRuntimeOnly(libs.junit.platform.launcher)

    androidTestImplementation(platform(libs.compose.bom))
    androidTestImplementation(libs.compose.ui.test.junit4)
    androidTestImplementation(libs.compose.ui.test.junit4.accessibility)
    androidTestImplementation(libs.androidx.test.ext.junit)
    androidTestImplementation(libs.androidx.test.runner)
    androidTestImplementation(testFixtures(project(":kit")))
    debugImplementation(libs.compose.ui.test.manifest)
}
