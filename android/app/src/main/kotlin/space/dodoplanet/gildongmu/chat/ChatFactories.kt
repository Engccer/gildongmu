package space.dodoplanet.gildongmu.chat

import android.content.Context
import android.media.AudioAttributes
import android.media.SoundPool
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.createSavedStateHandle
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import space.dodoplanet.gildongmu.AppConfig
import space.dodoplanet.gildongmu.R
import space.dodoplanet.gildongmu.i18n.AppLocale
import space.dodoplanet.gildongmu.kit.LocationFixPolicy
import space.dodoplanet.gildongmu.kit.SearchService
import space.dodoplanet.gildongmu.kit.models.ChatRequestBody
import space.dodoplanet.gildongmu.kit.models.Place
import space.dodoplanet.gildongmu.storage.SharedPreferencesStore

/**
 * 채팅 ViewModel 팩토리 — 이 패키지가 앱 컨텍스트로 스스로 만든다(`MainActivity`·`AppFactories`는 골격 세션 소유, M3 관례).
 * ⚠ Activity를 캡처하지 않는다. 문자열·언어는 호출 시점에 읽는다.
 */
fun chatViewModelFactory(context: Context, place: Place?): ViewModelProvider.Factory {
    val app = context.applicationContext
    val services = ChatServices.get(app)
    return viewModelFactory {
        initializer {
            ChatViewModel(
                place = place,
                stream = HttpChatStreamSource(AppConfig.API_BASE_URL),
                suggestions = HttpChatSuggestionsSource(AppConfig.API_BASE_URL),
                geocode = { query -> withContext(Dispatchers.IO) { SearchService(AppConfig.apiClient).geocode(query, 1).firstOrNull() } },
                consent = services.consent,
                location = StoreChatLocation,
                lang = { AppLocale.current(app.resources) },
                dataLocale = { AppLocale.dataLocale(app.resources) },
                strings = chatStrings(app.resources),
                sounds = services.sounds,
                savedState = createSavedStateHandle(),
            )
        }
    }
}

/** 앱에 하나인 채팅 부속(동의 저장소·효과음). 탭·장소 화면이 같은 인스턴스를 본다. */
class ChatServices private constructor(app: Context) {
    val consent = ChatConsentStore(SharedPreferencesStore(app, "gildongmu.chat"))
    val sounds: ChatSounds = SoundPoolChatSounds(app)

    companion object {
        @Volatile private var instance: ChatServices? = null

        fun get(context: Context): ChatServices =
            instance ?: synchronized(this) { instance ?: ChatServices(context.applicationContext).also { instance = it } }
    }
}

/** 유효 좌표 사용분(iOS `LocationService.currentCoordinate(timeout: softTimeout)` + `lastCoordinate`) — 수동 위치 > GPS 저장 좌표(M2c spec §13-2, 앱 층 진입점은 `EffectiveLocation`뿐). */
private object StoreChatLocation : ChatLocation {
    override suspend fun prime() = AppConfig.effectiveLocation.prime(timeoutMs = (LocationFixPolicy.softTimeout * 1000).toLong())

    override fun last(): ChatRequestBody.Coordinate? = AppConfig.effectiveLocation.last()?.let { ChatRequestBody.Coordinate(it.lat, it.lng) }
}

/**
 * 효과음 재생(`SoundPool`). 용도는 `USAGE_ASSISTANCE_SONIFICATION` — TalkBack은 NAVIGATION_GUIDANCE·ASSISTANT·ALARM 재생이 시작될 때 발화를
 * 끊으므로 그 셋을 쓰지 않는다(설계 리뷰 m7). 로드 전 재생 요청은 조용히 무시한다(효과음은 채팅을 막을 이유가 아니다).
 */
private class SoundPoolChatSounds(context: Context) : ChatSounds {
    private val pool = SoundPool.Builder()
        .setMaxStreams(2)
        .setAudioAttributes(
            AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_ASSISTANCE_SONIFICATION)
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                .build(),
        )
        .build()
    private val loaded = HashSet<Int>()
    private val sendId: Int
    private val receiveId: Int

    init {
        pool.setOnLoadCompleteListener { _, id, status -> if (status == 0) synchronized(loaded) { loaded += id } }
        sendId = pool.load(context, R.raw.chat_send, 1)
        receiveId = pool.load(context, R.raw.chat_receive, 1)
    }

    override fun send() = play(sendId)

    override fun receive() = play(receiveId)

    private fun play(id: Int) {
        if (synchronized(loaded) { id in loaded }) pool.play(id, 1f, 1f, 1, 0, 1f)
    }
}
