package space.dodoplanet.gildongmu

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.setMain
import org.junit.jupiter.api.extension.AfterEachCallback
import org.junit.jupiter.api.extension.BeforeEachCallback
import org.junit.jupiter.api.extension.ExtensionContext

/** `viewModelScope`(Dispatchers.Main.immediate)를 JVM에서 돌리는 JUnit5 확장. 테스트 클래스에 `@ExtendWith`. */
@OptIn(ExperimentalCoroutinesApi::class)
class MainDispatcherExtension(val dispatcher: TestDispatcher = StandardTestDispatcher()) : BeforeEachCallback, AfterEachCallback {
    override fun beforeEach(context: ExtensionContext) = Dispatchers.setMain(dispatcher)
    override fun afterEach(context: ExtensionContext) = Dispatchers.resetMain()
}
