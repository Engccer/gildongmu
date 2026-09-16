package space.dodoplanet.gildongmu

import java.io.File

/** :app 테스트가 저장소 루트를 찾는 기준점(`gildongmu.appDir`에서 위로). 못 찾으면 실패한다. */
fun repoRoot(): File {
    var dir: File? = File(System.getProperty("gildongmu.appDir") ?: System.getProperty("user.dir")).absoluteFile
    while (dir != null) {
        if (File(dir, "package.json").isFile && File(dir, "android/settings.gradle.kts").isFile) return dir
        dir = dir.parentFile
    }
    error("저장소 루트를 찾지 못했다(package.json + android/settings.gradle.kts)")
}
