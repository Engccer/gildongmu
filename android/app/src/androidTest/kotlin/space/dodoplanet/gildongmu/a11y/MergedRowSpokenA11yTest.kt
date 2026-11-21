package space.dodoplanet.gildongmu.a11y

import androidx.activity.ComponentActivity
import androidx.compose.foundation.layout.Column
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.CustomAccessibilityAction
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.semantics.customActions
import androidx.compose.ui.semantics.getOrNull
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/**
 * A77: 낭독 이름이 있는 병합 줄은 낭독 이름 하나만 내고(자식 글자 없음 — 한소네가 둘을 이어 두 번 냈다), 앞에 붙인 작업 메뉴·헤딩은 남는다.
 * 낭독 이름이 없는 줄은 자식 글자를 그대로 병합한다(한국어 화면 불변).
 */
@RunWith(AndroidJUnit4::class)
class MergedRowSpokenA11yTest {
    @get:Rule
    val rule = createAndroidComposeRule<ComponentActivity>()

    @Test
    fun spokenRowKeepsActionsAndHeadingAndDropsChildText() {
        val actions = listOf(CustomAccessibilityAction("Copy address") { true })
        rule.setContent {
            MaterialTheme {
                Column(Modifier.semantics { customActions = actions }.headingText().mergedRow("row", spoken = "Gana Tongdak, about 480m")) {
                    Text("Gana Tongdak (가나통닭)")
                    Text("about 480m")
                }
            }
        }
        val config = rule.onNodeWithTag("row").fetchSemanticsNode().config
        assertEquals(listOf("Gana Tongdak, about 480m"), config.getOrNull(SemanticsProperties.ContentDescription))
        assertNull("자식 글자가 함께 실리지 않는다", config.getOrNull(SemanticsProperties.Text))
        assertEquals(listOf("Copy address"), config.getOrNull(androidx.compose.ui.semantics.SemanticsActions.CustomActions)?.map { it.label })
        assertNotNull("헤딩이 남는다", config.getOrNull(SemanticsProperties.Heading))
    }

    @Test
    fun rowWithoutSpokenMergesChildText() {
        rule.setContent {
            MaterialTheme {
                Column(Modifier.mergedRow("row")) {
                    Text("가나통닭")
                    Text("약 480m")
                }
            }
        }
        val config = rule.onNodeWithTag("row").fetchSemanticsNode().config
        assertEquals(listOf("가나통닭", "약 480m"), config.getOrNull(SemanticsProperties.Text)?.map { it.text })
        assertNull(config.getOrNull(SemanticsProperties.ContentDescription))
    }
}
