package space.dodoplanet.gildongmu.a11y

/** 단일 polite 통지 슬롯. 같은 문장이라도 `seq`가 바뀌면 `StatusLine`이 한 프레임 비웠다 다시 써서 발화한다(spec §3-4). */
data class Notice(val seq: Int, val text: String)
