import SwiftUI
import UIKit
import Accessibility
import GildongmuKit

/// 클립보드 복사 + 완료 통지(웹 PlaceDetail.tsx의 sr-only live region 미러).
/// 포커스는 실행한 컨트롤(버튼·커스텀 액션의 행)에 그대로 남으므로 어느 주소를
/// 복사했는지 맥락이 유지된다. 장소 상세·주소 검색 결과 공용.
func copyAddressToPasteboard(_ address: String) {
    UIPasteboard.general.string = address
    AccessibilityNotification.Announcement(appLocalized("place.addressCopied")).post()
}

extension View {
    /// 주소 행 VoiceOver 커스텀 액션(한 손가락 위/아래 쓸기): 도로명·지번·영문
    /// 복사 — PlaceRow 전화·길찾기 동형. 종류별 분리는 장소 상세 복사 버튼
    /// 분리와 같은 근거(택배·행정서식은 지번 필요). 보유한 주소만 낸다
    /// (빈 주소 = 죽은 액션). 검색 결과·채팅 카드 공용.
    func addressCopyActions(_ address: JusoAddress) -> some View {
        // ⚠ 선언은 역순: VoiceOver 쓸기 메뉴가 빌더 선언의 역순으로 노출된다
        // (실기기 관측 2026-07-20). 사용자 경험 순서는 도로명 → 지번 → 영문.
        accessibilityActions {
            if !address.engAddr.isEmpty {
                Button(appLocalized("place.copyEnglishAddress")) { copyAddressToPasteboard(address.engAddr) }
            }
            if !address.jibunAddr.isEmpty {
                Button(appLocalized("place.copyJibunAddress")) { copyAddressToPasteboard(address.jibunAddr) }
            }
            if !address.roadAddr.isEmpty {
                Button(appLocalized("place.copyRoadAddress")) { copyAddressToPasteboard(address.roadAddr) }
            }
        }
    }
}
