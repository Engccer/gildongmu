package space.dodoplanet.gildongmu

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text

/** M0 뼈대: 첫 빌드·설치 경로 확인용. 검색 화면은 M1 spec이 정한다. */
class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            MaterialTheme {
                Text(text = getString(R.string.app_name))
            }
        }
    }
}
