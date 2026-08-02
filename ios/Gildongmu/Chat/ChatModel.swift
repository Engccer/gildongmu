import SwiftUI
import UIKit
import Observation
import Accessibility
import GildongmuKit

/// 채팅 메시지 하나(앱 로컬). 웹 ChatMessage 미러.
struct ChatMessage: Identifiable {
    enum Role { case user, assistant }
    let id = UUID()
    let role: Role
    let text: String
    var renders: [ChatRenderPayload] = []
    var sources: [ChatSource] = []
}

/// 채팅 상태. place가 있으면 장소 앵커 채팅(sheet), nil이면 일반 채팅(채팅 탭).
/// 장소 채팅은 sheet 표시마다, 일반 채팅은 세션 리셋마다 새 대화(웹 계약).
/// 스트림 소비는 단일 Task로 관리하고 sheet dismiss 시 취소한다(SearchModel 패턴).
@Observable @MainActor
final class ChatModel {
    let place: Place?
    private(set) var messages: [ChatMessage] = []
    /// 진행 통지 문장(status 이벤트). 스트리밍 중에만 존재.
    private(set) var progress: String?
    private(set) var isStreaming = false
    /// 답변 도착 세대. 뷰가 완료 포커스(질문 헤딩 이동)를 놓는 신호(헌장 §6).
    private(set) var answerRevision = 0
    /// 질문 전송 세대. 뷰가 보내기 버튼으로 VO 포커스를 선점 이동시키는 신호 —
    /// 포커스를 쥔 요소(추천 질문 등)가 사라져 VO가 최상단으로 리셋되는 이탈 차단.
    /// 두 전송 진입점(입력바·추천 질문 버튼)을 모두 덮는 유일한 지점이라 모델에 둔다.
    private(set) var questionRevision = 0
    private var streamTask: Task<Void, Never>?

    private let service = ChatService()
    /// 전송·완료 효과음. 두 전송 진입점(입력바·추천 질문)과 두 채팅 화면(탭·장소 sheet)을
    /// 모두 덮는 유일한 지점이 이 모델이라 여기서 재생한다(웹은 ChatInterface가 담당).
    private let soundPlayer = SoundPlayer()

    init(place: Place? = nil) {
        self.place = place
    }

    /// 전송. in-flight 가드(스트리밍 중 재진입 차단)는 호출부 가드와 이중.
    func send(_ text: String) {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        // 동의 가드(스펙 §1 이중 방어): UI 게이트가 뚫려도 미동의 전송은 구조적으로 불가.
        guard AIChatConsent.granted, !trimmed.isEmpty, !isStreaming else { return }

        messages.append(ChatMessage(role: .user, text: trimmed))
        soundPlayer.play(.chatSend)
        questionRevision += 1
        isStreaming = true

        streamTask = Task {
            // 일반 채팅만 전송 직전 위치 1회 시도(캐시 있으면 즉시 반환, 최초만 권한 팝업).
            // 실패·거부 시 userLocation 없이 계속 — 위치는 필수가 아니다.
            // 장소 채팅은 기존 계약 유지(위치 요청 트리거 아님, 직전 좌표 재사용만).
            // ⚠ 이 호출은 반환값을 버리지만 **부수효과가 목적**이다. 공유 스토어를
            // 갱신해야 세 줄 뒤 `requestBody()`의 `lastCoordinate`가 채워진다.
            // `primeAuthorization()`으로 바꾸면 이미 허용된 세션에서 즉시 반환해
            // 좌표가 없는 채로 전송되고, 위치 기반 도구가 통째로 죽는다(최초 설치
            // 세션만 우연히 동작한다). 타임아웃은 짧게 — 이 구간에 진행 통지가 없다.
            if place == nil {
                _ = try? await LocationService.shared.currentCoordinate(
                    timeout: LocationFixPolicy.softTimeout
                )
            }
            let body = requestBody()

            var done: (text: String, renders: [ChatRenderPayload], sources: [ChatSource])?
            var errored = false
            do {
                for try await event in service.stream(body, baseURL: AppConfig.apiBaseURL) {
                    switch event {
                    case .status(let categories):
                        announceProgress(categories)
                    case .done(let text, let renders, let sources):
                        done = (text, renders, sources)
                    case .error:
                        errored = true
                    case .unknown:
                        break // 전방 호환: 미지 이벤트는 무시
                    }
                }
            } catch {
                errored = true
            }
            guard !Task.isCancelled else { return }

            progress = nil
            isStreaming = false
            if let done, !errored {
                // 빈 done.text는 오류가 아니라 폴백 문장(웹 1회 폴백 미러)
                let answer = done.text.isEmpty ? appLocalized("ios.chat.emptyAnswer") : done.text
                appendAssistant(ChatMessage(role: .assistant, text: answer, renders: done.renders, sources: done.sources), success: true)
            } else {
                appendAssistant(ChatMessage(role: .assistant, text: appLocalized("ios.chat.failed")), success: false)
            }
        }
    }

    /// sheet dismiss 시 진행 중 스트림 폐기.
    func cancel() {
        streamTask?.cancel()
        streamTask = nil
        progress = nil
        isStreaming = false
    }

    /// 답변(성공·실패 공통)을 붙이고 완료 신호: 효과음 + 햅틱 + 포커스 이동 세대 증가.
    /// 답변 산문은 말풍선 한 곳에만. 별도 낭독 통지 없음(포커스 이동이 곧 통지).
    /// 완료음은 웹과 동일하게 성패 무관 턴 경계 신호(성패는 햅틱·실패 문구가 구분).
    private func appendAssistant(_ message: ChatMessage, success: Bool) {
        messages.append(message)
        soundPlayer.play(.chatReceive)
        answerRevision += 1
        UINotificationFeedbackGenerator().notificationOccurred(success ? .success : .error)
    }

    /// status 이벤트당 1회 진행 통지(웹 polite live region의 iOS 문법).
    private func announceProgress(_ categories: [String]) {
        let labels = categories.map(toolLabel).joined(separator: ", ")
        let message = labels.isEmpty
            ? appLocalized("ios.chat.progressFallback")
            : appLocalized("chat.progress.searching", labels)
        progress = message
        AccessibilityNotification.Announcement(message).post()
    }

    /// 대화 전체 히스토리 + 장소 앵커(웹 불변식: 주변 기준은 장소, 길찾기 출발지는 userLocation).
    /// 일반 채팅은 placeContext 미포함(키 생략) — 웹 "byte-identical" 계약.
    private func requestBody() -> ChatRequestBody {
        ChatRequestBody(
            messages: messages.map { .init(role: $0.role == .user ? "user" : "assistant", text: $0.text) },
            userLocation: LocationService.shared.lastCoordinate.map { .init(lat: $0.lat, lng: $0.lng) },
            locale: AppLanguage.current,
            placeContext: place.map { place in
                .init(
                    name: place.name,
                    lat: place.lat,
                    lng: place.lng,
                    category: place.category.isEmpty ? nil : place.category,
                    isStation: isStation(place)
                )
            }
        )
    }

    /// 도구 카테고리 라벨(카탈로그 chat.progress.tool.*, 웹 미러). 미지 키는 원문 유지.
    private func toolLabel(_ category: String) -> String {
        switch category {
        case "search_places": appLocalized("chat.progress.tool.search_places")
        case "search_address": appLocalized("chat.progress.tool.search_address")
        case "get_subway_arrivals": appLocalized("chat.progress.tool.get_subway_arrivals")
        case "get_night_clinics": appLocalized("chat.progress.tool.get_night_clinics")
        case "get_kids_places": appLocalized("chat.progress.tool.get_kids_places")
        case "get_surroundings": appLocalized("chat.progress.tool.get_surroundings")
        case "get_bus_arrivals": appLocalized("chat.progress.tool.get_bus_arrivals")
        case "get_bike_stations": appLocalized("chat.progress.tool.get_bike_stations")
        case "get_air_quality": appLocalized("chat.progress.tool.get_air_quality")
        case "get_weather": appLocalized("chat.progress.tool.get_weather")
        case "get_station_meta": appLocalized("chat.progress.tool.get_station_meta")
        case "get_station_facilities": appLocalized("chat.progress.tool.get_station_facilities")
        case "get_car_route": appLocalized("chat.progress.tool.get_car_route")
        case "get_transit_route": appLocalized("chat.progress.tool.get_transit_route")
        case "get_walk_route": appLocalized("chat.progress.tool.get_walk_route")
        case "get_nearby_barrier_free": appLocalized("chat.progress.tool.get_nearby_barrier_free")
        case "get_walk_infrastructure": appLocalized("chat.progress.tool.get_walk_infrastructure")
        case "search_web": appLocalized("chat.progress.tool.search_web")
        case "unknown": appLocalized("chat.progress.tool.unknown")
        default: category
        }
    }
}
