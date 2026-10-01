package space.dodoplanet.gildongmu.guide

/** 전경 판정 입력: 앱 Activity STARTED 플래그(`GuideSession.setForeground`). 화면 꺼짐은 백그라운드다(E53 — 잠금·다른 앱을 가르지 않는다). */
class AndroidGuideEnvironment : GuideEnvironment {
    @Volatile var foreground = false
    override fun isForeground(): Boolean = foreground
}
