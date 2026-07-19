import UIKit
import Accessibility

/// 클립보드 복사 + 완료 통지(웹 PlaceDetail.tsx의 sr-only live region 미러).
/// 포커스는 실행한 컨트롤(버튼·커스텀 액션의 행)에 그대로 남으므로 어느 주소를
/// 복사했는지 맥락이 유지된다. 장소 상세·주소 검색 결과 공용.
func copyAddressToPasteboard(_ address: String) {
    UIPasteboard.general.string = address
    AccessibilityNotification.Announcement(appLocalized("place.addressCopied")).post()
}
