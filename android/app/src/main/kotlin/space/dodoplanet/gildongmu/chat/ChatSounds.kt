package space.dodoplanet.gildongmu.chat

/**
 * 대화 턴 경계 효과음(iOS `SoundPlayer` 미러). 전송은 짧은 단음, 완료는 성패 무관 2음 상승 — 시각장애 사용자에게 턴 경계를 비언어로 알린다.
 * 모델이 두 전송 진입점과 두 화면을 모두 덮는 유일한 지점이라 ViewModel이 부른다.
 */
interface ChatSounds {
    fun send()
    fun receive()
}
