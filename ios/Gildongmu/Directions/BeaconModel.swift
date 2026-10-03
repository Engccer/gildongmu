import CoreLocation
import Foundation
import GildongmuKit
import Observation
import SwiftUI

/// 거리 추적 오케스트레이터. **판정은 전부 Kit이 하고 여기는 배선만 한다.**
///
/// 이 계층에 로직을 두면 검증이 불가능하다(앱 타깃 테스트 번들이 없다). 그래서
/// 리듀서는 `beaconStep`, 톤·통지 판정은 `beaconGateStep`, fix 수용 판정은
/// `isUsableFix`가 맡고, 이 클래스는 권한·타임아웃·I/O만 담당한다.
///
/// 백그라운드 계약(spec §12.2, 2026-08-06 — 종전 §8.1 전경 전용을 위원장 결정으로
/// 번복): `UIBackgroundModes: location`이 선언된 빌드(Experimental)는 세션 중
/// 백그라운드에서도 위치 스트림이 계속 흘러 추적이 산다. 미선언 빌드는 종전대로
/// 전경 전용이며, 그 분기는 `LocationService.backgroundLocationDeclared`가 가른다.
@Observable @MainActor
final class BeaconModel {
    enum Status: Equatable {
        case idle
        case tracking
        /// 권한 거부·제한.
        case denied
        /// 위치 서비스 꺼짐·취득 실패. `denied`와 문구가 달라야 한다. 사용자가 취할
        /// 행동이 다르다(설정에서 권한 허용 vs 하늘이 트인 곳으로 이동).
        case unavailable

        /// 사용자가 할 조치가 남은 상태 — 종료 화면을 닫아도 상태 문장·복구 버튼이 살아야 한다.
        /// `failResolution != .none`이 아닌 이유: `.unavailable`은 복구 버튼 없이도 문장("하늘이 트인 곳")은
        /// 남아야 한다. `status == .idle`이 아닌 이유: `.tracking`은 실패가 아니다(설계 리뷰 MAJOR ④).
        var isFailure: Bool { self == .denied || self == .unavailable }
    }

    /// 안내 방식 = 거리의 기준(스펙 §3). 간략=직선(비콘, 전 수단), 상세=경로 추종.
    enum GuideMode: Equatable { case brief, detail }

    /// 안내 수단(B1 §4.1 봉인 구성 키): 리듀서 튜닝·경로 소스·낭독 문구를 원자
    /// 결정한다. 세션 시작 시 고정되고 중도 변경은 없다(재시작뿐).
    enum GuideSessionKind: Equatable { case walk, car }

    private(set) var status: Status = .idle
    /// 추적 중인 목적지 이름. 추적 화면이 이 값을 읽는다.
    ///
    /// 뷰가 파생하지 않고 모델이 드는 이유는 경합이다. 뷰의 `trackedDestination`은
    /// 도착지가 "현재 위치"로 바뀌는 순간 nil이 되는데, 같은 변화가 추적도 멈춘다.
    /// 두 반응이 같은 프레임에 걸리면 시트가 닫히기 직전 **내용 없는 화면**이 한 프레임
    /// 스친다(스크린 리더에겐 빈 화면이 스쳐 지나가는 것이라 시각보다 혼란이 크다).
    /// 시작 시점의 이름을 모델이 붙들면 그 질문 자체가 없어진다.
    ///
    /// ⚠ `stop()`에서 비우지 않는다. 시트 dismiss 애니메이션 동안 내용부가 다시
    /// 평가되므로, 비우면 같은 빈 화면이 닫히는 길에 재현된다. 추적 중이 아닐 때 이
    /// 값을 읽는 곳은 없다.
    private(set) var destinationLabel = ""
    /// 목적지 라틴 표기(E28 서버 로마자 등, A55). `destinationLabel`과 **함께만** 바뀐다. 승격본·이름 없는 진입은 nil.
    private(set) var destinationRoman: String?
    /// 통지(시작·목적지 전환)에 실을 목적지 이름(A55). 대중교통 `TransitGuideModel.spokenDestinationName`과 **같은 판정**이다 —
    /// 데이터 언어가 en이면 라틴 표기만, 없으면 nil. 한글 라벨이 영어 문장에 섞이지 않게(E27 한 줄 한 언어).
    private var spokenDestinationName: String? {
        TransitWalkLegText.destinationName(label: destinationLabel, roman: destinationRoman, english: transitGuideIsEn)
    }
    /// 화면에 보이는 상태 1줄. 웹에는 눈에 보이는 live region이 있는데 그게 없으면
    /// VoiceOver를 끈 사람에게 아무 변화도 안 보인다(2.1(a) 반려 전력과 동형).
    /// ⚠ **항상 발화 원문이다** — 전경 복귀 재생(handleScenePhaseChange)이 이 값을
    /// 그대로 발화하므로 표시용 라벨을 여기 넣으면 음성으로 샌다(리뷰 MEDIUM).
    /// "다음 안내," 라벨은 아래 `statusIsNextPreview` 플래그로 뷰가 붙인다.
    private(set) var statusText = "" {
        didSet { statusIsNextPreview = false }
    }
    /// 상태 행이 주기 예고(다음 구간 미리보기)인가 — 뷰가 "다음 안내," 라벨을 붙이는
    /// 근거(실보행 판정 2026-08-10 ②, 표시 전용). statusText가 바뀌면 자동 해제된다.
    private(set) var statusIsNextPreview = false
    /// 잠금·백그라운드에서 소리가 나지 않는 상태. 세션 내내 참일 수 있는 지속 상태라
    /// `statusText`(단일 슬롯, 곧 다음 안내가 덮는다)와 별도 행으로 낸다 — 음성 1회는
    /// 놓치면 끝이고, 비-VO 사용자에게는 이것이 잠금 후 무음의 유일한 단서다.
    ///
    /// ⚠ 판정 축이 "승격에 실패했는가"가 아니라 **"지금 들리는가"**다: 억제 중 시작해
    /// 승격이 미뤄진 세션은 실패한 적이 없어도 `.ambient`로 돌고 있다(접근성 감사 M3).
    private(set) var soundDegraded = false
    /// 현재 실패의 해결 수단. 뷰가 이 값으로 해결 버튼을 고른다.
    /// ⚠ 권한 거부(설정 열기)와 정밀 위치 꺼짐(그 자리 시스템 팝업)은 버튼이
    /// **다르다**. openSettingsURLString이 여는 화면에는 정확한 위치 토글이 없다
    /// (위원장 실기기 확인 2026-08-02). 위치 서비스 전역 꺼짐·취득 실패는 앱 설정
    /// 화면에서 해결되지 않으므로 none.
    enum FailResolution { case none, settings, precise }
    private(set) var failResolution: FailResolution = .none

    /// 검색 시트가 떠 있는 동안 **톤과 통지를 모두** 죽인다. 시트에 받아쓰기가 있고,
    /// 헌장 §6의 홀드 계약 불변식은 "녹음 중 SR 발화 0"이다. polite 통지는 VoiceOver가
    /// 실제로 말하는 음성이라 톤보다 전사 오염 위험이 오히려 크다(스피커→마이크 경로는
    /// 이 저장소에서 세 번 실측됐다). 추적과 상태 텍스트는 유지한다.
    var outputSuppressed = false {
        // 톤 재생기에도 전파한다. 재생 경로만 막으면 인터럽션·구성변경 옵서버가
        // 여전히 세션 카테고리를 되돌려 받아쓰기 세션을 깬다(리뷰 I-8).
        didSet {
            tones.isSuppressed = outputSuppressed
            // 억제 해제 복구(스펙 §4.3): 받아쓰기 몇 초 사이 소비된 실행 안내(횡단보도·
            // 회전)를 최신 1개만 되살린다. 밀린 것 전부 재생은 금지(최신 우선).
            if !outputSuppressed, let pending = pendingRecovery {
                pendingRecovery = nil
                // 복구 시점에 실위치가 그 유닛 첫 스텝에 이미 들어섰으면 방향 구절을 뗀 문장으로(E62 — 이미 돈 회전을
                // 다시 지시하지 않는다). 판정은 리듀서와 같은 실위치(원시 d + lag).
                let entered = pendingRecoveryEntered.flatMap { alt -> String? in
                    guard let gs = guideState, gs.d + projectionLagMeters >= alt.startD else { return nil }
                    return alt.text
                }
                pendingRecoveryEntered = nil
                announce(entered ?? pending, speechClass: .actionable)
            }
        }
    }

    // MARK: - 실시간 길 안내(상세 모드) 상태

    private(set) var mode: GuideMode = .brief
    private(set) var sessionKind: GuideSessionKind = .walk
    /// 자동차 청취자(K2 §6.1). 세션 시작에 읽어 고정한다 — 중간 변경은 다음 세션부터
    /// (발화 채널이 도중에 바뀌면 진행 중 통지 슬롯이 갈린다).
    private(set) var listener: CarListener = .default
    /// 발화 채널 프로파일 — `stop()`이 지우지 않는다(다음 시작에 교체). 도착 문장은 stop()
    /// 뒤에 나가는데 `sessionKind`는 그때 이미 walk라, 채널 판정을 여기서 읽는다(설계 리뷰 B10).
    private var driverChannel = false
    private var tuning: GuideTuning {
        switch sessionKind {
        case .car: listener == .driver ? .carDriver : .car
        case .walk: .walk
        }
    }
    /// 종료 화면이 어느 수단의 세션이었나 — `stop()` **앞**에서 기록(B10). 자동차면 시트가
    /// "여기서 도보 안내 시작" 인계 버튼을 보인다. `clearArrival()`이 비운다.
    private(set) var arrivalSessionKind: GuideSessionKind?
    /// 전 구간 목록(시트 조망, 위원장 판정 2026-08-10 — 시트가 길찾기 목록을 덮어
    /// 추적 중 경로 전체를 볼 수단이 없던 공백의 해소). 상세 모드에서만.
    var routeStepDescriptions: [String]? {
        guard mode == .detail else { return nil }
        return guideRoute?.steps.map(\.description)
    }
    /// 조망 목록의 경유지 구획 행(N4): `stepIndex` 앞에 "경유지 {label} 도착".
    var routeWaypointRow: (stepIndex: Int, text: String)? {
        guard mode == .detail, let w = guideRoute?.waypointStepIndex, let label = routeWaypointLabel
        else { return nil }
        return (w, appLocalized("directions.viaArrived", label))
    }
    /// 목록의 "지금 이 구간" 표식 위치. 이탈·불확실·최종 접근에선 nil —
    /// 근거 없는 표식은 거짓 정밀이다(관측이 없으면 표도 없다).
    var currentStepIndex: Int? {
        guard mode == .detail, let state = guideState else { return nil }
        switch state.phase {
        case .following, .bundle: return state.stepIndex
        case .uncertain, .reacquiring, .offRoute, .finalApproach: return nil
        }
    }
    /// 조망 모달 "대안 경로 보기" 노출 조건(spec 2026-08-14 §2): 조회 화면에 다른 줄이
    /// 있던 세션. 대상 `alternateLine`은 조회 화면의 다른 줄 중 계단 회피 우선이다(E52 `WalkLineKind.switchAlternate`).
    var alternativePreviewAvailable: Bool {
        sessionKind == .walk && mode == .detail && alternateLine != nil
    }

    /// 프리뷰 스텝 목록(조망 행 문법 재사용) — ready에서만. "지금 이 구간" 표식은
    /// 없다(대안 경로 위에 현재 위치가 없다 — 근거 없는 표식은 거짓 정밀).
    var alternativePreviewSteps: [String]? {
        guard case .ready(_, let fetched) = alternativePreviewState else { return nil }
        return fetched.route.steps.map(\.description)
    }

    /// 이탈 상태 — 시트가 "경로 다시 조회" 버튼 노출에 쓴다.
    private(set) var offRoute = false
    /// 직전 `offRoute` 해제가 경로 커밋(자동 채택·재조회·전환)이었는가 — 시트가 "재조회
    /// 버튼이 사라진" 전이에서 제목 행 착지 여부를 가르는 데 쓴다(헌장 §5: 포커스를 쥔
    /// 요소가 제거되는 전이는 선점 이동. 자연 복귀 `backOnRoute`는 종전대로 무이동).
    private(set) var offRouteEndedByReroute = false
    /// 마지막 실행 안내(상세=스텝·묶음, 간략=거리 통지). 진행 상황 버튼의 uncertain
    /// 분기가 소비한다. 상태·오류 통지는 대상이 아니다(스펙 §4.2 리뷰 #23).
    private(set) var lastGuidance: String?
    /// 경로 기준 잔여 거리·예상 시간 상시 표시 1줄(상세 모드 전용, 웹 progress 미러 —
    /// 위원장 실측 판정 2026-08-03 묶음 A). 통지 채널에 태우지 않는다(매 fix 갱신).
    private(set) var remainingText: String?
    /// "현재 도로" 행(car 상세 전용, E56 spec 2026-09-30) — 지금 진행거리가 속한 링크의 도로 이름
    /// ("현재 도로, 올림픽대로"). 이름을 모르면(무명 링크·스팬 강등) nil이고 행 자체가 없다.
    /// 구간 전문을 싣던 "현재 안내" 행의 자리다 — 지금 할 일은 하단 2행이 말한다.
    /// walk·간략·최종 접근에선 nil, 이탈 중 숨김은 뷰 몫.
    private(set) var currentRoadText: String?
    /// 하단 2행 윗줄(walk 상세 전용, spec 2026-08-11): 현재 행동(동적 카운트다운·상태
    /// 대체) 또는 최종 접근 문형. 비-VO 사용자에게도 보이는 가시 상태다(2.1(a) 계열).
    private(set) var liveTopText: String?
    /// 하단 2행 아랫줄: 다음 예고("다음 안내," 라벨 포함 완성 문자열). 이탈·최종
    /// 유닛에서는 nil(요소 제거 — 빈 텍스트 낭독 금지).
    private(set) var liveNextText: String?
    /// 하단 2행 표시 유닛(walk 상세 전용, spec §4.1) — 경로 커밋 시 재구축.
    private var displayUnits: [DisplayUnit] = []
    /// 표시 입력 스텝(live target 조각 포함) — walk 주기 통지의 직진 목표 이름이
    /// 여기서 나온다(위원장 실보행 피드백 2026-08-12). 표시 유닛과 수명이 같다.
    private var liveSteps: [LiveStepInput] = []
    /// 하단 2행 리듀서 소상태. 재조회·이탈 복귀·모드 전환에서 nil 리셋.
    private var liveRowsState: LiveRowsState?
    /// 횡단 중 남은 거리 행 문장(E62 — "횡단보도 끝까지 약 30m", 말 없이 화면에만). nil이면 남은 거리 행은 종전 문장.
    private var liveCrossingText: String?
    /// 상태 행에 올린 임박 문장과 그 대상 스텝(E62 a11y 감사 M1). 그 스텝에 들어서면 상태 행에서 지운다.
    private var imminentStatus: (target: Int, text: String)?
    /// 표시 좌표계 램프인 기준점(원시 d) — 상태 재구성 지점마다 그 시점 d로 교체.
    private var liveBaselineD: Double = 0

    /// 세션이 쥐는 경로. 메모리에만 두고 세션 종료와 함께 폐기한다(스펙 §7.3 약관 경계).
    private var guideRoute: GuideRoute? {
        // 경로가 바뀌면 옛 경로 기준의 횡단 남은 거리 행과 "들어선 뒤" 복구 문장을 버린다(E62 구현 리뷰) — 커밋 자리는
        // 남은 거리 행을 하단 2행 재설정보다 먼저 갱신해, 비우지 않으면 새 경로 첫 fix 동안 옛 "횡단보도 끝까지"가 남는다.
        didSet {
            liveCrossingText = nil
            pendingRecovery = nil
            pendingRecoveryEntered = nil
            imminentStatus = nil
        }
    }
    /// 상세 경로의 총 소요시간(초, provider 원값) — walk 잔여 시간 비례 추정의 분모.
    private var guideRouteDurationSeconds: Int?
    /// car 도로명 스팬(§4.7 — 현재 진행거리가 속한 링크만 답한다).
    private var roadSpans: [CarRoadSpan] = []
    /// car ETA(§4.6): 현 위치→목적지 재조회 totalTime + 갱신 시각(단조 초).
    private var etaSeconds: Double?
    private var etaUpdatedAt: Double?
    /// ETA 호출 캡(시작 조회·주기·수동 재조회 전부 포함, §4.6).
    private var etaCallCount = 0
    private var etaTask: Task<Void, Never>?
    private var guideState: GuideState?
    /// 시작 직후 경로 조회 대기·진행 중 — 이 동안 비콘 발화를 보류해 "간략 첫 거리 →
    /// 곧바로 상세 시작" 이중 발화를 막는다. 조회 자체는 첫 수용 fix가 트리거한다
    /// (피드백 라운드1 8번): start() 직후 `currentCoordinate()`는 첫 fix 전이라 캐시
    /// 게이트에서 즉시 실패해 첫 세션의 상세 안내가 구조적으로 죽었다.
    /// 시트가 읽는다(E57): 조회 중엔 첫 정보 행(남은 거리)이 아직 없어 착지를 이 값이 false가 될 때까지 미룬다.
    private(set) var awaitingRoute = false
    /// 전경 복귀 처리(`handleScenePhaseChange(.active)` — 놓친 통지 상환 게시)를 마칠 때마다 1 증가. 시트의 복귀 착지가 여기서
    /// 시작한다(E57 spec §3.2): 루트가 모델에 복귀를 전하는 순서와 시트의 scenePhase 순서는 정해져 있지 않아, 시트가
    /// 먼저 돌면 갚을 통지가 게시되기 전에 착지해 그 발화를 끊는다.
    private(set) var foregroundReturnSeq = 0
    private var routeFetchTask: Task<Void, Never>?
    /// 첫 수용 fix 대기 상한 감시. 초과 시 상세를 포기하고 간략으로 정직 폴백
    /// (위치 대기 문구 — 경로 실패와 원인이 다르므로 문구를 가른다).
    private var fixWaitTask: Task<Void, Never>?
    /// 수용 정확도 미달 fix 중 최선값(A18). 대기 상한이 끝나면 이것으로 조회한다 —
    /// 세션 시작 fix는 대개 그 세션에서 가장 나쁜 fix라 그대로 origin으로 삼으면
    /// 경로가 다른 곳에서 출발한다. 판정은 Kit `routeOriginStep`.
    private var routeOriginBest: RouteOriginFix?
    /// `routeOriginBest`를 보관한 uptime. 대기 상한에 소비할 때 계측 `age`는 저장 시점
    /// 스냅샷이 아니라 **소비 시점 기준**이어야 한다(15초 뒤 쓰면 그만큼 낡은 좌표다).
    private var routeOriginBestAt: Double?
    /// 억제 중 소비된 실행 안내의 최신 1개(해제 시 복구 발화).
    private var pendingRecovery: String?
    /// 억제 복구 대상이 유닛 전문일 때, 그 유닛 첫 스텝 시작과 "들어선 뒤" 문장(E62). 복구 시점에 들어섰으면 이것을 읽는다.
    private var pendingRecoveryEntered: (startD: Double, text: String)?
    /// 재조회 latest-wins 세대 토큰 + in-flight 가드(repo 관례).
    private var rerouteToken = 0
    private var rerouteInFlight = false
    /// 시작 경로 조회의 세대 토큰. defer가 stale task에서 새 세션의 awaitingRoute를
    /// 조기 해제하는 레이스 차단(독립 리뷰 MEDIUM — 빠른 목적지 변경 시).
    private var routeFetchToken = 0
    /// 마지막 수용 fix 좌표·시각(진행 상황 버튼의 직선거리·신선도 게이트용, 양 모드 기록).
    private var lastFixCoord: (lat: Double, lng: Double)?
    private var lastFixCoordAt: Double?
    /// 재조회 진행 중 — 시트가 버튼 라벨 교체(rerouteBusy)에 쓴다(라벨이 곧 상태 신호).
    private(set) var isRerouting = false
    /// 수동 전환 진행 신호(M3) — isRerouting과 분리(버튼별 busy 귀속).
    private(set) var isSwitchingVariant = false

    private let routeService = RouteService(client: APIClient(baseURL: AppConfig.apiBaseURL))
    /// 세션 단일성 토큰(B2 §3.2 — GuideSessionCoordinator claim/release 검증 키).
    private var sessionToken: Int?

    private var uptimeNow: Double { ProcessInfo.processInfo.systemUptime }

    private var beaconState = BeaconState.initial
    private var gateState = BeaconGateState.initial
    /// 톤 계층 상태(간략·상세 공용 — 모드 차이는 입력 조립에만 있다).
    private var toneState = ToneLayerState.initial
    /// 정지 판정 상태(도플러 3-state).
    private var motionState = MotionJudgeState.initial
    /// 추적 시트가 부근 재구성 앵커로 읽는다(M1). 쓰기는 여전히 모델 내부만.
    private(set) var dest: BeaconDest?
    /// 경유지(N4, spec 2026-08-22-waypoint-ios §4.1). 좌표와 라벨 한 벌.
    struct Waypoint: Equatable {
        let dest: BeaconDest
        let label: String
    }
    /// **미도착** 경유지. 모든 경로 fetch가 이 값을 `via`로 싣고, 도착 통지 뒤 nil이 된다
    /// (이후 재조회는 출발→도착만 간다). 시트 버튼 라벨("경유지 추가"↔"C, 경유지 변경")의
    /// 근거이기도 하다.
    private(set) var waypoint: Waypoint?
    /// **현재 경로에 결박된** 경유지 라벨(설계 리뷰 #10 — `waypoint`와 분리). fetch 커밋
    /// 시점에 기록되어 도착 뒤 `waypoint`가 nil이 돼도 조망의 "경유지 C 도착" 행이 남고,
    /// 새 경유지 D를 더해 경로를 다시 받기 전까지 옛 경로에 D가 붙지 않는다.
    private(set) var routeWaypointLabel: String?
    /// 이 세션이 경유지를 지났는가(N4 2026-09-24). 지난 뒤 재조회 경로(경유지 없음)에서도 남은 거리 행을
    /// "목적지 {dest}까지"로 둔다 — 같은 행이 이유 없이 "남은 거리"로 되돌아가지 않게(설계 리뷰 #7).
    private var waypointPassedInSession = false
    /// 목적지 전환이 보관한 유도기 버퍼(스펙 2026-08-12 §3.1 승계 조항) —
    /// 다음 fetchGuideRoute 성공이 1회 소비한다. stop()이 소거.
    private var carriedCourseDerivation: CourseDerivationState?
    private let tones = BeaconTonePlayer(label: "beacon")
    /// 발화 지연 슬롯(spec 2026-08-14) — 안내 효과음이 재생 중이면 그 잔여만큼
    /// 통지를 미룬다. 수명 계약(latest-wins·세대·재평가)은 Kit 타입이 소유하고
    /// 여기는 톤 잔여·실제 게시를 클로저로 주입만 한다(§5 배선).
    @ObservationIgnored private lazy var deferredAnnouncer = DeferredAnnouncer(
        clock: { ProcessInfo.processInfo.systemUptime },
        toneEndsAt: { [weak self] in self?.tones.toneEndsAt },
        post: { [weak self] text, high, bypass, speechClass, onLateDrop in
            self?.post(
                text, highPriority: high, bypassSuppression: bypass, speechClass: speechClass,
                onLateDrop: onLateDrop) ?? false
        }
    )
    /// 기기 음성 대기 한 칸(E53, spec 2026-09-30 §4.2 — 세 안내 모델 공유 타입). 백그라운드 ∧ 토글 켬의 행동 문장만
    /// 여기로 온다(정식판에선 오지 않는다). 세션 경계는 `deferredAnnouncer.advanceGeneration()`과 같은 자리에서 `reset()`.
    @ObservationIgnored private lazy var deviceSpeech = GuideSpeechOutput.makeDeviceQueue(
        foregroundDeviceSpeech: false,
        isSuppressed: { [weak self] in self?.outputSuppressed ?? true },
        toneEndsAt: { [weak self] in self?.tones.toneEndsAt },
        backgroundAudible: { [weak self] in self?.tones.isBackgroundAudible ?? false }
    )
    private var startTask: Task<Void, Never>?
    private var watchdog: Task<Void, Never>?
    private var lastFixAt: Double?
    private var startedAt: Double?
    private var lastStaleNoticeAt: Double?
    /// 시작 재진입 가드. 클로저 가드만으론 await를 넘는 더블탭을 못 막는다(repo 관례).
    private(set) var starting = false
    /// 백그라운드 복귀 리셋 직후의 첫 안내를 삼킨다. 앵커를 버리면 다음 fix가 first-fix
    /// 경로를 타서 절대거리가 재발화되는데, 사용자가 유발한 사건이 아니다.
    private var suppressNextNotice = false
    /// `.background`를 실제로 거쳤는가. `.inactive`(제어센터·알림센터 같은 짧은
    /// 인터럽션)만으로 앵커를 버리면 추세가 계속 초기화된다(`GildongmuApp`의
    /// `backgroundedAt` 패턴과 같은 판정).
    private var wasBackgrounded = false

    /// 앱이 전경인가. 사후 정리의 정지 톤·도착 종을 전경에서만 내는 판정이 읽는다. 음성 통지의 게이트는
    /// E53(2026-09-30)부터 채널 술어(`GuideSpeechOutput.channel`, 같은 게시 시점 조회)다 — 백그라운드에서 톤은
    /// 남기고 발화는 토글이 켜진 실험판의 행동 문장만 기기 음성으로 낸다(정식판은 종전대로 전부 막는다).
    ///
    /// ⚠ **플랫폼 동작에 기대지 않고 명시적으로 막는다.** 백그라운드에서
    /// announcement가 발화되지 않는 것은 실측으로 확인했으나 한 차례 실측은 API
    /// 계약이 아니다. OS 버전·VoiceOver 상태에 따라 무시·지연 전달·복귀 후 뒤늦은
    /// 발화가 가능하다.
    ///
    /// ⚠ **캐시 플래그가 아니라 게시 시점 조회다**(접근성 감사 2026-08-08). 이 게이트는
    /// 이제 모든 발화를 좌우하므로, `scenePhase` 전이를 한 번 놓치면 전경에서도 음성이
    /// 영구 소실된다(톤은 계속 나서 고장으로도 안 읽힌다). 실제 상태를 읽으면 그 고착이
    /// 구조적으로 불가능해진다. `.inactive`(제어센터·알림 센터)는 사용자가 화면을 보고
    /// 있는 중이라 허용한다.
    private var isForeground: Bool {
        UIApplication.shared.applicationState != .background
    }
    /// 이 안내가 낸 통지가 모두 끝났는가 — 톤 뒤로 미룬 문장이 없고, 게시한 VoiceOver 통지(세 모델 공용 장부)가 끝났다.
    /// 시트의 첫 정보 행 착지가 이것을 기다린다(E57 spec §3.3 — 착지 낭독이 요약·상환을 끊지 않게, 통지가 없으면 곧장).
    var announcementsSettled: Bool { !deferredAnnouncer.hasPending && GuideSpeechOutput.announcementsFinished }

    /// 백그라운드에서 억제된 발화가 있었는가. 복귀 시 **현재 상태 하나만** 낭독한다 —
    /// 누적 재생은 낡은 정보를 순서대로 읽어 혼란만 준다(spec §6.5). 백그라운드 기기 음성으로 문장을 넘기면
    /// 내린다 — 마지막 상태를 들었으니 갚을 것이 없다(E53 §4.3, `post`).
    private var missedAnnouncement = false

    private let noFixTimeout = 15.0
    private let staleRenotifyInterval = 30.0
    /// fix 부재를 **톤**으로 알리기 시작하는 경과(초). 음성 임계(15초)보다 짧다 —
    /// 톤은 발화를 가로막지 않아 더 자주 울려도 침해가 적고, 백그라운드에서는 이것이
    /// 유일한 채널이다. fix 신선도 창(5초)보다 크게 잡아 정상 지터를 걸러낸다.
    /// 초기값이며 실사용 판정 대상이다.
    private let noFixSeconds = 8.0

    /// 이 세션의 계단 회피(도보 전용). 시작 시점 값을 받아 보관하고, 수동 전환의 fetch 성공
    /// 커밋에서만 `sessionVariant`와 함께 바뀐다(E42 — 계단 회피는 이제 줄의 성질이다).
    private var accessible = false
    /// 이 세션의 도보 경로 축(M3, nil=기본 파이프라인·`.shortest`=최단). 세션 시작 시 확정되고
    /// **수동 전환의 fetch 성공 커밋에서만** 바뀐다(실패 시 기존 경로·기존 축 유지). 재조회·이탈
    /// 자동 재조회는 이 값을 그대로 쓴다(spec §3.2 — 경로 정체성은 세션 인자가 고정한다).
    private(set) var sessionVariant: WalkRouteVariant?
    /// 이 세션의 줄 종류(E42 조회 화면의 줄). 줄이 없는 세션(승차 전 도보·인계·간략 폴백)은 nil.
    /// 전환 문장·프리뷰 헤더가 이 이름을 쓴다 — 요청 축(`sessionVariant`·`accessible`)과 한 쌍으로만 바뀐다.
    private(set) var sessionLine: WalkLineKind?
    /// 조회 화면의 다른 줄(전환 대상). nil이면 전환 진입점이 없다 — 죽은 버튼(둘째 줄 부재)을
    /// 사전 차단한다(`carGuideStartable` 선례). 전환 커밋에서 `sessionLine`과 맞바뀐다.
    private(set) var alternateLine: WalkLineKind?

    // MARK: - 이탈 시 자동 재조회 (E10ⓑ 자동 채택, 2026-09-02)

    /// 자동 재조회는 이탈 확정이 아니라 리듀서 `rerouteNeeded`(돌아가기 국면에서 계속 멀어지거나 나란히 계속 걸음)에서
    /// 조회해 **즉시 채택**한다(E63 위원장 판정 2026-10-03 — 먼저 돌아가게, 계속 벗어나면 자동). 운전자 채널만 확정 즉시
    /// 조회하고 `rerouteNeeded`는 그 조회가 실패·신선도 미달로 끝난 뒤의 재시도로만 쓴다(E63 spec §3.8).
    /// 남긴 안전망은 채택 시점의 신선도 검사 하나다(`RerouteProposalGate`: 취득점 수단별 이동 상한(`rerouteMaxDriftMeters`
    /// 도보 30m·자동차 150m)·120초 + 최근 fix 15초) — 낡은 출발점의 경로를 채택하면 도로 중앙 안내(§5.6 실사고 계열)가
    /// 되므로 미달이면 조용히 버리고 수동 "경로 다시 조회" 버튼이 예비로 남는다.
    /// latest-wins 토큰 — 폐기·목적지 변경·세션 종료·수동 재조회 시 증가. 토큰이 일치하고
    /// 이탈이 지속 중일 때만 응답을 채택한다(복귀 후 늦게 도착한 응답이 경로를 갈아치우는
    /// 경로 차단). 조회 실패는 그 회차 종결(재시도·통지 없음 — 쿼터 방어).
    private var proposalToken = 0
    /// 세션당 자동 조회 횟수(상한 5, RerouteProposalGate — GPS 진동으로 확정 회차가
    /// 반복 생성될 때 쿼터·통지 폭주의 마지막 방어선).
    private var proposalFetchCount = 0
    /// 진행 중인 자동 조회의 토큰 — 그 조회가 아직 유효하면(`== proposalToken`) `rerouteNeeded`를 무시한다(리듀서는 이미
    /// 재무장했다. 새 요청이 토큰을 올려 진행 중 조회를 버리면 느린 망에서 채택 없이 예산만 쓴다, E63 spec §3.5). 폐기(복귀·
    /// 경로 교체·수동 재조회)로 토큰이 올라가면 늦게 끝나는 옛 조회가 다음 회차를 막지 않는다.
    private var proposalInFlightToken: Int?
    /// 이 이탈 회차에 이탈 문장을 실제로 게시했는가(E63 §3.4). 확정에서 지우고, 게시가 버려지면(`onDropped`) 되돌린다.
    /// 거짓이면 복귀 때 "경로로 복귀했습니다"를 말하지 않는다 — 벗어났다는 말을 듣지 않은 사용자에게 복귀만 들리지 않게.
    private var offRouteNoticePosted = false
    /// 돌아가기 국면의 상태 행 문장(마지막 이탈 문장, 보류면 벗어난 쪽만). 재획득 문구를 되돌릴 때 읽는다(D12).
    private var offRouteLine: String?
    /// 이 이탈 회차의 자동 재조회 요청 수와 확정 시각·좌표(로그 `rerouteTrigger n= sinceConfirm= moved=`, E63 spec §6).
    private var rerouteTriggerCount = 0
    private var offRouteConfirmedAt: Double?
    private var offRouteConfirmCoord: (lat: Double, lng: Double)?
    /// 직전 계단 회피 판정(열화 전이 통지 기준 — spec 2026-08-08 §2.3).
    /// 원시 문자열이다: 알려진 셋 밖의 값도 중복 통지를 막는 식별자로 쓴다.
    private var lastStepFree: String?
    /// 발화되지 못한 계단 회피 경고(백그라운드 게이트에 걸린 것).
    /// ⚠ 진행 안내와 달리 **세션에 1회뿐인 안전 경고**라 다음 fix가 대신 말해 주지
    /// 않는다. `missedAnnouncement` 복귀 재생은 그 시점의 `statusText` 하나만 읽는데
    /// 그 사이 도착한 fix가 그것을 실행 안내로 덮어써, 경고가 통째로 사라진다
    /// (a11y 리뷰 H1). 전달될 때까지 여기 남겨 두고 전경 복귀 때 갚는다.
    private var pendingStepFreeNotice: String?

    // MARK: 대안 경로 프리뷰 상태 (spec 2026-08-14 §3)

    /// 프리뷰 상태 — 자동 재조회와 같은 토큰(latest-wins) 패턴. `noRoute`와
    /// `failed`를 가른다(3-state: "대안 없음"과 "조회 실패"는 다른 사실이다).
    enum AlternativePreviewState {
        case idle
        case fetching(token: Int)
        case ready(RerouteProposal, fetched: DetailFetchResult)
        case noRoute
        case failed
    }
    private(set) var alternativePreviewState: AlternativePreviewState = .idle
    private var alternativePreviewToken = 0
    /// 채택 성공 세대 — 시트(프리뷰·조망)가 onChange로 연쇄 닫힘·포커스 복귀에 쓴다.
    /// 값 자체는 의미 없고 증가가 이벤트다(offRoute onChange 관례의 세대 판).
    private(set) var variantAdoptedSeq = 0
    /// 전환 커밋(E42): 요청 축과 두 줄 종류를 **한 원자 블록에서** 맞바꾼다 — 헤더 라벨·프리뷰
    /// 조회·채택·수동 전환이 같은 판정을 공유한다(사본 drift 방지 — 이 파일은 단위 테스트 레인이 없다).
    private func commitLineSwitch(to target: WalkLineKind) {
        sessionVariant = target.variant
        accessible = target.accessible
        alternateLine = sessionLine
        sessionLine = target
        // 전환 뒤의 복구 재시작은 전환된 줄로 시작해야 한다(A13 — 고른 경로가 조용히 바뀌지 않게).
        syncStartRequestWithSession()
    }

    // MARK: - 최종 접근 (spec 2026-08-08 §3.0·§3.4)

    /// 최종 접근 활성 여부. **이 동안 거리·방향·도착 발화의 소유자는 이 층 하나뿐이다**
    /// — 경로 리듀서는 진입 즉시 판정을 멈추고(Kit 0a 가드), 비콘 리듀서는 아예 돌리지
    /// 않는다. "근처"와 "18미터"가 같은 fix에서 연달아 나가는 경로를 구조적으로 없앤다.
    private(set) var inFinalApproach = false
    /// 세션이 쥔 종점 오프셋 기하. 재조회 시 통째로 교체한다(새 경로는 새 종점이다).
    private var finalApproachGeometry: FinalApproachPayload?
    // 도착 추정 에피소드(spec 2026-08-13 §4 상태 초기화 계약 — 이전 에피소드 값이 새 에피소드로 새면
    // 조기 종료다). 2026-09-02 §2.2부터 **도착 창**(최종 접근 국면 또는 간략 근처 창)이 소유한다: 진입
    // 순간에 항상 재초기화되고, `resetArrivalWindow()`가 통째로 지운다.
    private var arrivalWindowEnteredAt: Double?
    private var progressAnchor: RoutePoint?
    private var lastProgressAt: Double?
    private var lastUsableDistanceToDest: Double?
    /// 간략 근처 창 플래그 — Kit `briefArrivalWindowStep`(래치 ∧ 정확도 ≤ 30m)의 마지막 usable fix 값.
    /// 저장하는 이유는 워치독(noFix 모양)이 fix 없이 읽기 때문이다. `nearby` 래치를 직접 읽지 않는다 —
    /// 래치는 정확도로 스케일돼 100m fix에서 200m까지 켜져 있다(설계 리뷰 BLOCKER).
    private var briefWindowActive = false
    /// 도착 창 안인가 — 도착 추정(`maybePresumeArrival`)의 국면 게이트. 두 창은 배타다(`inFinalApproach`는
    /// 상세 경로 처리에서만 참이 되고 간략 인계는 그것을 세우지 않는다).
    private var inArrivalWindow: Bool { inFinalApproach || briefWindowActive }
    // 국면 무관 세션 안전망(Kit `sessionIdleStep`, 2026-08-26). 도착 추정과 달리 세션 전체가
    // 에피소드다 — start()가 기준을 세우고 매 usable fix가 앵커를 전진시킨다.
    private var sessionProgressAnchor: RoutePoint?
    private var sessionLastProgressAt: Double?
    /// 종료 화면의 종류(3-state 정직성 — 시트가 소비). `.stopped`는 도착이 아닌 종료
    /// (사용자 중지·목적지 변경·권한 상실)로, 걸음·칼로리 요약을 보여 주기 위해서만
    /// 화면을 남긴다(위원장 판정 2026-08-19) — 요약이 성립하지 않으면 곧 소거된다.
    enum SessionEndKind { case arrived, presumed, stopped }
    private(set) var endKind: SessionEndKind = .arrived
    /// `.stopped` 종료 화면의 첫 문장(중지 사유). 도착 종류는 시트가 키를 직접 고른다.
    private(set) var endText = ""
    /// 진입 배치 서술을 냈는가. 1회뿐이라 주기 통지와 별도로 센다.
    private var finalApproachIntroSpoken = false
    /// 발화되지 못한 진입 배치 서술(백그라운드 게이트에 걸린 것).
    /// ⚠ 1회뿐인 발화라 다음 주기가 대신 말해 주지 않는다(`pendingStepFreeNotice` 선례).
    private var pendingFinalApproachIntro: String?
    /// 마지막 주기 통지 시각(단조). 신뢰 불가 fix에서는 갱신하지 않고 정지·유지한다.
    private var lastFinalTickAt: Double?

    var isTracking: Bool { status == .tracking }

    /// 종료 화면 상태(위원장 판정 2026-08-11): 도착으로 세션이 끝나도 시트를 유지해
    /// 목적지 주변 확인의 발판을 남긴다(대중교통 `pendingWalkHandoff` 동형). 값은
    /// 주변 확인 앵커(목적지) 좌표이고, 라벨은 `destinationLabel`이 이어 든다(stop()이
    /// 비우지 않는 값). 소거는 닫기(시트 바인딩)와 새 세션 시작뿐 — `stop()`은
    /// 건드리지 않는다(도착 직후의 stop()이 지우면 종료 화면이 성립하지 않는다).
    /// 종류는 `endKind`가 가른다 — 도착이 아닌 종료(`.stopped`)도 도보 세션이면 같은
    /// 화면을 걸음·칼로리 요약을 위해 남긴다(2026-08-19, `stopLeavingSummary`).
    private(set) var arrivalDest: BeaconDest? {
        // 종료 시각(A31 축 ②): 세 종료 경로가 따로 기록하지 않는다 — 경로마다 두면 하나가 빠진다.
        didSet { endedAt = arrivalDest == nil ? nil : (oldValue == nil ? .now : endedAt) }
    }
    /// 종료 화면이 생긴 시각. **잠자기 중에도 전진하는 단조 시계** — `uptimeNow`(systemUptime)는 잠자기
    /// 동안 멈춰 "주머니에 8시간"이 0분이 되고, 벽시계는 앞으로 교정되면 1분 된 새 화면을 30분 지난
    /// 것으로 읽는다(설계 리뷰 MAJOR ⑤). 판정은 Kit `isEndScreenStale`.
    private var endedAt: ContinuousClock.Instant?

    // MARK: - 승차 전 도보(prewalk, A25 spec 2026-08-30 §4.2)

    /// 도보 세션이 끝난 사유 — `onSessionEnd`로 `GuideSession`에 전달된다.
    enum EndReason { case arrived, userStopped, startFailed, ended }

    /// 승차역 라벨. nil이 아니면 이 도보 세션은 대중교통 안내의 승차 전 구간이다: 종료 화면을
    /// 남기지 않고(승차역은 여정의 끝이 아니다), 시트가 "승차역 도착" 선언 버튼을 보이며, 잊힌
    /// 세션 안전망이 돌지 않는다(지하 진입 = fix 두절이 곧 그 버튼이 필요한 순간). `stop()`이 비운다.
    /// ⚠ 종료 화면 분기는 `stop()` **뒤**에 도는데 `stop()`이 이 값을 지우므로, 확정·추정·
    ///   `stopLeavingSummary` 세 경로는 `stop()` 앞에서 지역 변수로 캡처한다.
    /// ⚠ 표시 라벨이라 **ko·en 쌍**이다(E27 잔여 ①) — 영문 역명이 있으면 선언 버튼·도착 문장이
    /// 영문으로 나가고, 없으면 한국어 원문으로 떨어진다.
    private(set) var prewalkTarget: TransitLabel?
    /// 세션 종료 1회 콜백. 발화점은 둘뿐 — `stop()` 정리 완료 뒤 다음 MainActor 턴, 그리고
    /// `begin()`의 시작 Task 말미(시작되지 않아 `stop()`이 돌지 않는 경로: `.startFailed`).
    /// 경로마다 부르지 않는다 — 종료 경로가 7곳이라 하나를 빠뜨리면 연결이 조용히 끊긴다.
    var onSessionEnd: ((EndReason) -> Void)?
    /// `stop()`이 소비할 사유. `stop()` 직전에 대입하고 `stop()`·`begin()`이 `.ended`로 되돌린다.
    private var pendingEndReason: EndReason = .ended
    /// 시작 Task 세대. `Task.cancel()`은 플래그라 취소된 옛 시작 Task가 말미까지 달릴 수 있는데,
    /// 그때 새 세션의 `onSessionEnd`를 `.startFailed`로 소비하지 않게 세대가 다르면 건드리지 않는다.
    private var startGeneration = 0

    // MARK: - 도착 건강 요약(spec 2026-08-17)

    private let pedometer: PedometerQuerying
    /// 도보 세션 창의 시작(벽시계). `.car`는 nil. stop()에서 지우지 않는다 —
    /// 도착 처리가 stop() 뒤에 읽는다(arrivalDest 대입과 같은 순서 계약).
    private var sessionStartedAt: Date?
    /// 세션 세대. 비동기 조회 결과는 이 토큰이 그대로일 때만 커밋한다(같은 목적지 재시작을
    /// 목적지 비교로는 못 가른다 — 설계 리뷰 BLOCKER 3).
    private var arrivalSessionToken = UUID()
    /// `.negligible` = 측정은 성공했지만 `WalkHealth.minMeaningfulDistanceMeters` 미만
    /// (표시 안 함, 재조회 무의미).
    private enum ArrivalHealthLoad { case idle, loading, loaded, negligible, unavailable, failed }
    private var arrivalHealthLoad: ArrivalHealthLoad = .idle
    private var arrivalHealthTask: Task<Void, Never>?
    /// 도착 종료 화면의 건강 요약 행. nil이면 행이 없다(부재를 설명하지 않는다).
    private(set) var arrivalHealth: WalkHealthSummary?
    /// 마지막으로 받은 만보계 표본. 도착 화면에서 체중을 입력하고 돌아오면 같은 표본으로
    /// 다시 계산해야 "기준 체중" 안내가 사라진다(재조회 없이 — 만보계 왕복은 한 번뿐).
    private var arrivalHealthSample: (steps: Int, distance: Double?)?
    /// 세션 시작 이후 만보계 라이브 누적(걸음·거리). 종료 순간 "요약을 보여 줄 만큼
    /// 걸었는가"를 **동기**로 가르는 근거다(2026-08-19) — 사후 질의만으로는 그 판정이
    /// 비동기라 종료 화면을 띄운 뒤에야 지울 수 있고, 그것이 깜빡임·포커스 경합이 된다.
    /// 권한 거부·미지원이면 nil로 남는다(= 요약 없음). `stop()`은 갱신만 멈추고 값은
    /// 남긴다(도착·중지 처리가 stop() 뒤에 읽는다 — `sessionStartedAt` 동형).
    private var liveHealthSample: (steps: Int, distance: Double?)?
    /// 띠바(N1)용 잔여 거리. 상세 모드는 경로 기준 잔여, 간략은 마지막 fix 직선 거리.
    /// **10m 이상 변했을 때만 갱신**한다 — 커서가 띠바에 있으면 VoiceOver가 라벨 변경을
    /// 매번 낭독하므로 매 fix 갱신은 발화 과밀이다(설계 리뷰 M7). 시작·목적지 변경·종료에서 nil.
    private(set) var bandDistanceMeters: Int?
    /// 남은 거리 행의 경유지 잔여(E57) — 띠바와 같은 규칙으로 10m 이상 변했을 때만 바꾼다. 경유지 목표가 아니면 nil.
    private var shownWaypointMeters: Int?

    init(pedometer: PedometerQuerying = PedometerService()) {
        self.pedometer = pedometer
    }

    /// 도착 종료 화면 닫기(시트 presentation 바인딩·닫기 버튼 경로).
    ///
    /// 도착 문장(`guide.arrived`·`guide.arrivedPresumed`)은 `stop()` **뒤에** `statusText`에
    /// 다시 넣은 값이라 세션 종료를 살아 넘긴다 — 도착 종료 화면과 전경 복귀 상환이
    /// 그것을 읽기 때문이다. 화면을 닫으면 두 소비자가 모두 사라지므로 여기서 함께
    /// 비운다. 안 비우면 길찾기 탭 선두 섹션(비추적 상태 줄, `!statusText.isEmpty`)이
    /// 그 문장을 시작 실패 상태처럼 계속 띄우고, 새 경로 조회는 이 모델을 건드리지
    /// 않아 다음 세션까지 남는다(위원장 실사용 발견 2026-08-17: 도착 뒤 목적지를
    /// 바꿔 조회해도 첫 수단 섹션 위에 도착 문장이 남았다).
    func clearArrival() {
        // 판별선은 종료 종류가 아니라 **실패 상태 잔존**이다(A31 축 ③, spec 2026-09-02 §4). 권한 상실
        // 종료는 `stopAndFail` → `.stopped` 화면 → `fail()`이 실패 문장을 `statusText`에 넣고 `status`를
        // 올리므로, 화면을 닫은 뒤에도 그 문장·복구 버튼이 길찾기 탭 선두에 남아야 한다. 종전의
        // `endKind != .stopped` 예외는 안전망·사용자 중지 종료(같은 `.stopped`)의 문장까지 영영 남겼다.
        // `liveTopText`는 시트 내용이라 화면과 수명을 같이한다 — `fail()`이 쓰는 자리가 아니다.
        liveTopText = nil
        if !status.isFailure { statusText = "" }
        dropWeightPromptEngagement()
        arrivalDest = nil
        arrivalSessionKind = nil
        endKind = .arrived
        endText = ""
        resetArrivalHealth()
    }

    /// 체중 권유 응답 표식은 그 종료 화면의 것이다 — 닫기 밖의 소거(30분 만료·인계·새 세션 시작·teardown)에서
    /// 다음 화면으로 새지 않게 한다(E31). 나들이 종료 화면과 같은 키라 도보 종료 화면이 있을 때만 지운다
    /// (코디네이터가 대중교통·나들이 시작마다 `clearArrival()`을 부른다). ⚠ `arrivalDest = nil`을 쓰는 자리는
    /// 전부 이 함수를 먼저 부른다 — 가드 `weight-prompt-wiring.test.ts`.
    private func dropWeightPromptEngagement() {
        if arrivalDest != nil { UserDefaults.standard.set(false, forKey: WalkHealth.weightPromptEngagedKey) }
    }

    /// 승차 전 도보 세션으로 표식(A25). `requestStart` **앞**에 건다 — 시작 Task의 실패 판정이
    /// 이 값을 함께 지운다.
    func markPrewalk(target: TransitLabel) {
        prewalkTarget = target
    }

    /// 승차 전 도보 해제(연결 취소·다른 세션 시작). 추적 중이면 세션은 그대로 두고 표식만 뗀다.
    func clearPrewalk() {
        prewalkTarget = nil
        onSessionEnd = nil
    }

    /// "승차역 도착" 선언(A25 §4.3) — 도착 판정이 닿지 않는 경우(입구가 멀어 지하로 먼저 진입)의
    /// 사용자 행위. 확정 도착과 같은 모양: 종·`.arrived` 사유·stop()·도착 문장(.high, 직접 응답).
    func declarePrewalkArrival() {
        guard isTracking, let station = prewalkTarget else { return }
        let text = TransitGuideTextRenderer.render(
            transitPrewalkArrivedLine(isEn: transitGuideIsEn, station: station))
        playTone(.nearby)
        pendingEndReason = .arrived
        stop()
        statusText = text
        lastGuidance = text
        liveTopText = text
        announce(text, highPriority: true, speechClass: .actionable)
    }

    private func resetArrivalHealth() {
        arrivalHealthTask?.cancel()
        arrivalHealthTask = nil
        arrivalHealth = nil
        arrivalHealthSample = nil
        arrivalHealthLoad = .idle
    }

    // MARK: - 시작·중지

    /// 세션 시작 인자 **한 벌**. 재시작이 이것을 그대로 다시 쓴다.
    ///
    /// ⚠ 인자가 호출부마다 흩어져 있는 것이 A13의 근본 원인이었다: 정밀 위치 복구
    /// 경로가 `dest`·`label`·`accessible`만 다시 적고 `variant`·(당시)`shortestAvailable`·
    /// `kind`를 빠뜨려, **최단 경로로 시작한 세션이 재시작 뒤 추천 경로가 되고**
    /// 자동차 세션은 도보가 됐다. 증상이 조용하다(재시작은 성공하고 안내도 정상이라
    /// 사용자는 자기가 고른 경로가 아니라는 것을 한참 듣고서야 안다). 인자를 하나 더
    /// 넘기는 수정은 다음 인자가 늘 때 같은 자리에서 재발한다.
    struct StartRequest {
        let dest: BeaconDest
        let label: String
        /// 목적지 라틴 표기(A55). ⚠ 기본값 없음 — 빠뜨리면 en 세션의 시작 문장이 조용히 한글 원명을 싣는다. 없으면 nil.
        let labelRoman: String?
        let kind: GuideSessionKind
        let accessible: Bool
        let variant: WalkRouteVariant?
        /// 조회 화면에서 고른 줄(E42). 줄이 없는 진입(승차 전 도보·인계·간략 폴백·자동차)은 nil.
        /// ⚠ 기본값 없음 — `variant`·`accessible`은 이 종류의 투영이어야 하고, 호출부가 셋을 함께 적는다.
        let line: WalkLineKind?
        /// 조회 화면의 다른 줄(수동 전환 대상). 없으면 nil — 전환 진입점을 그리지 않는다.
        let alternate: WalkLineKind?
        /// 경유지(N4). 기본값 없음 — 호출부가 nil을 적어야 한다(경유지가 있는 조회에서 시작
        /// 버튼이 이 인자를 빠뜨리면 경유지 없는 안내가 조용히 시작된다, A13 동형).
        let waypoint: Waypoint?
    }

    /// 직전에 시작한 세션의 인자. 시작 실패(정밀 위치 꺼짐 등) 뒤에도 남아 있어야
    /// 복구 재시작이 같은 세션을 재현한다.
    private var lastStartRequest: StartRequest?

    /// ⚠ `accessible`·`kind`에 **기본값을 두지 않는다** — 백로그 A4·A13이 둘 다
    /// 생략 가능한 안전 인자가 만든 결함이었다(spec 2026-08-08 §2.5,
    /// [[no-default-for-safety-parameters]]). 계단 회피 개념이 없는 수단은 호출부가
    /// `false`를 적고, 그 사실이 코드에 드러나는 것이 이 required의 목적이다.
    /// 줄이 없는 진입(간략 폴백 한 곳)만 쓴다 — 경로 축·줄 종류는 여기서 정하지 않는다(E42 설계 리뷰:
    /// 기본값을 둔 인자는 A13의 재발 자리라 인자 자체를 두지 않는다).
    func toggle(
        dest: BeaconDest, label: String, labelRoman: String?, kind: GuideSessionKind, accessible: Bool,
        waypoint: Waypoint?
    ) {
        if isTracking {
            stopByUser()
        } else {
            requestStart(StartRequest(
                dest: dest, label: label, labelRoman: labelRoman, kind: kind, accessible: accessible,
                variant: nil, line: nil, alternate: nil, waypoint: waypoint))
        }
    }

    /// 시작 요청의 거부 게이트(N1 §2.4). 다른 안내(대중교통 포함, 시작 대기 포함)가 살아
    /// 있으면 **시작하지 않고** 통지만 한다 — 종전 "새 시작 = 기존 중지"의 반전.
    /// ⚠ `lastStartRequest`는 게이트를 통과한 뒤에만 기록한다(설계 리뷰 m3 — 거부된
    /// 요청이 `restart()`의 대상으로 남으면 사용자가 고르지 않은 안내가 시작된다).
    /// 통지는 `.high`: 버튼 활성화의 직접 응답이라 착지 낭독에 잠식되면 "버튼이 동작하지
    /// 않는다"가 된다(헌장 §6).
    func requestStart(_ request: StartRequest) {
        guard !GuideSession.shared.isActive else {
            announceNow(appLocalized("guide.alreadyActive"), highPriority: true, bypassSuppression: true)
            return
        }
        begin(request)
    }

    /// 같은 세션을 다시 시작한다(정밀 위치 허용 후 복구 경로).
    ///
    /// ⚠ 저장된 시작 인자가 없으면 **아무것도 하지 않는다.** 추측 기본값으로 시작하면
    /// 사용자가 고르지 않은 수단·경로로 안내가 시작되고, 그것이 A13이 만든 증상 그
    /// 자체다. 추적 중에도 no-op이다 — 이 함수는 시작이지 토글이 아니다.
    func restart() {
        guard !isTracking, let request = lastStartRequest else { return }
        begin(request)
    }

    private func begin(_ request: StartRequest) {
        guard !starting else { return }
        starting = true
        lastStartRequest = request
        // 요청 축·줄 종류는 시작 값으로 정하고, 이후엔 수동 전환 커밋(`commitLineSwitch`)에서만
        // 바뀐다(E42 — 계단 회피는 이제 줄의 성질이라 세션 중 전환될 수 있다).
        self.accessible = request.accessible
        sessionVariant = request.variant
        sessionLine = request.line
        alternateLine = request.alternate
        waypoint = request.waypoint
        routeWaypointLabel = nil
        waypointPassedInSession = false
        lastStepFree = nil
        pendingStepFreeNotice = nil
        pendingEndReason = .ended
        startGeneration += 1
        let generation = startGeneration
        startTask = Task { [weak self] in
            await self?.start(dest: request.dest, label: request.label, labelRoman: request.labelRoman, kind: request.kind)
            guard let self, self.startGeneration == generation else { return }
            self.starting = false
            // 시작 실패 한 판정(권한 거부·정밀 위치·서비스 꺼짐·claim 거부·취소 전부): 세션이
            // 시작되지 않았으면 `stop()`이 돌지 않으므로 여기서 콜백을 소비한다.
            if !self.isTracking, let cb = self.onSessionEnd {
                self.onSessionEnd = nil
                self.prewalkTarget = nil
                cb(.startFailed)
            }
        }
    }

    private func start(dest: BeaconDest, label: String, labelRoman: String?, kind: GuideSessionKind = .walk) async {
        guard !isTracking else { return }
        // 채널은 권한 가드보다 **앞**에서 정한다 — 가드 실패 통지(`fail`)가 이전 세션 채널로 나가지
        // 않게(품질 리뷰 m10).
        listener = CarListener(rawValue: UserDefaults.standard.string(forKey: CarListener.storageKey) ?? "")
            ?? .default
        driverChannel = kind == .car && listener == .driver

        // 권한 게이트는 `authorizationSnapshot`을 직접 본다. `currentCoordinate()`는
        // 캐시 우선이라 권한을 보지 않고 반환하는 경로가 있고, 그러면 권한 회수 후에도
        // "성공"해서 시작 톤만 나고 fix는 영영 오지 않는다(무한 침묵).
        guard LocationService.shared.isLocationServiceEnabled else {
            fail(with: .unavailable, key: "beacon.weak", highPriority: false)
            return
        }
        switch LocationService.shared.authorizationSnapshot {
        case .denied, .restricted:
            fail(with: .denied, key: "beacon.denied", resolution: .settings, highPriority: false)
            return
        case .notDetermined:
            // 팝업 자체가 신호다. 허용 여부는 아래에서 다시 확인한다.
            await LocationService.shared.primeAuthorization()
            guard !Task.isCancelled else { return }
            switch LocationService.shared.authorizationSnapshot {
            case .authorizedWhenInUse, .authorizedAlways: break
            default:
                fail(with: .denied, key: "beacon.denied", resolution: .settings, highPriority: false)
                return
            }
        default:
            break
        }

        // 정밀 위치가 꺼져 있으면 좌표가 1~20km 오차라 "가까워지는 중/멀어지는 중"이
        // 전부 잡음이 된다. 데드밴드(max(15, accuracy))도 그 규모에서는 의미를 잃는다.
        // 걸으면서 소리만 듣는 기능이라 틀린 안내가 화면으로 반증되지도 않는다.
        guard LocationService.shared.accuracySnapshot != .reducedAccuracy else {
            fail(with: .unavailable, key: "beacon.reduced", resolution: .precise, highPriority: false)
            return
        }

        // await를 넘어온 뒤 화면을 떠났을 수 있다. 여기서 안 막으면 다른 탭에서 톤이
        // 계속 나는 좀비 추적이 되고, 그 화면의 onDisappear는 이미 지나갔다.
        guard !Task.isCancelled else { return }

        // 세션 단일성(B2 §3.2, N1 반전): 다른 안내가 돌고 있으면 **거부**. `requestStart`의
        // 선판정이 권한 대기 동안 뒤집힌 경합의 최종 게이트다.
        guard let token = GuideSession.shared.coordinator.claim(stop: { [weak self] in self?.stop() }) else {
            announceNow(appLocalized("guide.alreadyActive"), highPriority: true, bypassSuppression: true)
            return
        }
        sessionToken = token
        bandDistanceMeters = nil

        // 보류 발화 폐기 + 세대 증가(spec 2026-08-14 §4-2): 이전 세션이 남긴 지연
        // 문장(도착 통지 등)이 새 세션 안에서 발화하지 않게 한다. 기기 음성 대기 칸도 같은 경계(E53 §4.2 ⑤).
        deferredAnnouncer.advanceGeneration()
        deviceSpeech.reset()
        self.dest = dest
        dropWeightPromptEngagement()
        arrivalDest = nil  // 새 세션 시작 = 이전 종료 화면 소거
        arrivalSessionKind = nil
        endKind = .arrived
        endText = ""
        resetArrivalHealth()
        arrivalSessionToken = UUID()
        liveHealthSample = nil
        let sessionStart = kind == .walk ? Date() : nil
        sessionStartedAt = sessionStart
        // 권한 팝업은 여기(사용자가 전경에서 시작을 누른 자리)에서만 — 도착 시 팝업 금지.
        if let sessionStart {
            pedometer.requestAuthorizationIfNeeded()
            let token = arrivalSessionToken
            pedometer.startLiveUpdates(from: sessionStart) { [weak self] steps, distance in
                guard let self, self.arrivalSessionToken == token else { return }
                self.liveHealthSample = (steps, distance)
            }
        }
        // 억제 잔류 차단(스펙 2026-08-12 §5.4, 마일스톤 리뷰 BLOCKER): 검색 시트가
        // 열린 채 세션이 죽으면 시트 onChange가 발화할 기회 없이 뷰가 소멸해 억제가
        // 고착된다 — 세션 경계가 무조건 해제한다(TransitGuideModel.stop() 동형).
        outputSuppressed = false
        destinationLabel = label
        destinationRoman = labelRoman
        sessionKind = kind
        // 로그 수단 표식(K2 §6.6): 2026-08-22 실주행 로그에 표식이 없어 속도로만 도보·자동차를 갈랐다.
        guideDiagLog("session kind=\(kind) listener=\(listener.rawValue)")
        beaconState = .initial
        gateState = .initial
        toneState = .initial
        motionState = .initial
        lastFixAt = nil
        lastStaleNoticeAt = nil
        suppressNextNotice = false
        startedAt = ProcessInfo.processInfo.systemUptime
        sessionProgressAnchor = nil
        sessionLastProgressAt = nil
        status = .tracking
        statusText = ""
        failResolution = .none
        UIApplication.shared.isIdleTimerDisabled = true
        // 오디오 승격은 **첫 톤보다 먼저**. 승격 실패는 전경에서 보이지 않으므로
        // (`.ambient`로도 start 톤이 난다) 시작 시점에 알려야 잠그기 전에 안다.
        tones.beginSession()
        playTone(.start)
        if soundDegraded {
            // 음성으로 1회 알리고, 지속 상태는 `soundDegraded` 행이 계속 든다. 진동은 상태 변화(E30 확장).
            resultHaptic(.attention)
            announce(appLocalized("ios.beacon.soundBackgroundUnavailable"), speechClass: .actionable)
        }

        LocationService.shared.startBeaconUpdates(
            onFix: { [weak self] fix in self?.handle(fix: fix) },
            onError: { [weak self] code in self?.handle(locationError: code) },
            onAuthChange: { [weak self] status in self?.handle(authorization: status) },
            onAccuracyChange: { [weak self] accuracy in self?.handle(accuracy: accuracy) }
        )
        startWatchdog()

        // 상세 적격 시도(스펙 §4.1). 조회 트리거는 첫 수용 fix(handle(fix:))다 — 여기서 바로
        // 띄우면 origin 취득이 첫 fix 전이라 항상 실패해 간략 폴백이 고정된다(8번).
        // 대기·조회 중엔 비콘 발화를 보류하고, 실패는 간략으로 정직 폴백.
        // ⚠ **로케일 게이트는 E16 축3으로 사라졌다**(서버가 en 문장을 만든다). 이 플래그가
        // 상세 조회의 **유일한 트리거**라, 여기만 ko로 남기면 시작 버튼은 열려 있는데
        // 세션이 조용히 직선거리로 도는 상태가 된다(리뷰 검출).
        awaitingRoute = true
        routeFetchToken += 1
        startFixWaitWatch(token: routeFetchToken)
    }

    /// 수용 fix가 상한(noFixTimeout) 내에 오지 않으면 그때까지의 최선 fix로 조회하고,
    /// 최선값조차 없으면 상세를 포기하고 간략 폴백(A18 — 단발 취득의 최선값 정책과
    /// 같은 모양). 없으면 awaitingRoute가 발화를 무한 보류해 세션이 침묵에 갇힌다.
    private func startFixWaitWatch(token: Int) {
        fixWaitTask?.cancel()
        routeOriginBest = nil
        routeOriginBestAt = nil
        fixWaitTask = Task { [weak self, timeout = noFixTimeout] in
            try? await Task.sleep(for: .seconds(timeout))
            guard let self, !Task.isCancelled else { return }
            guard token == self.routeFetchToken, self.isTracking,
                  self.awaitingRoute, self.routeFetchTask == nil else { return }
            if var best = self.routeOriginBest, let dest = self.dest {
                if let at = self.routeOriginBestAt { best.ageSeconds += self.uptimeNow - at }
                self.startRouteFetch(origin: best, reason: "best", dest: dest, token: token)
                return
            }
            guideDiagLog("routeOrigin reason=none")
            self.awaitingRoute = false
            self.fallbackToBrief(key: "guide.detailNoLocation")
            // 위치 부재는 이 문구가 이미 말했다 — 워치독 약신호 통지가 같은 시점에
            // 겹치지 않게 재통지 창(30초)을 소비한다.
            self.lastStaleNoticeAt = self.uptimeNow
        }
    }

    /// 수단별 상세 경로 데이터(§4.1 봉인 구성의 경로 소스 축). nil = 상세 부적격
    /// (car는 provider 비-tmap·기하 검증 실패 포함 — §5 fail-closed).
    /// 상세 경로 fetch 결과 — 시작 조회·재조회·전환·자동 재조회가 공유하는 커밋 입력.
    typealias DetailFetchResult = (
        route: GuideRoute, spans: [CarRoadSpan], durationSeconds: Int?,
        stepFreeRaw: String?, stepFree: StepFreeStatus?, stepFreeNotice: String?,
        finalApproach: FinalApproachPayload?, liveSteps: [LiveStepInput],
        /// 서버가 실제로 돌려준 경로의 줄 종류(E42 — 요청이 아니라 응답). 전환·프리뷰 문장의 이름.
        /// nil = 자동차·구버전 서버·어느 이름도 참이 아닌 응답(계단 문구가 남은 계단 회피).
        lineKind: WalkLineKind?
    )

    /// `waypoint`는 **인자로 받는다**(가변 `self.waypoint`를 읽지 않는다 — 왕복 중 경유지가
    /// 바뀌면 호출부 커밋 가드가 스냅샷 불일치로 응답을 폐기한다, 설계 리뷰 #8).
    /// 경유지를 보냈는데 응답에 표지가 없으면 nil(상세 부적격) — 서버가 이미 throw하지만
    /// 클라 가드로 한 번 더. "경유 안 한 경로"를 "경유한 경로"로 안내하는 것이 최악이다.
    private func fetchDetailData(
        origin: (lat: Double, lng: Double), dest: BeaconDest,
        variant: WalkRouteVariant?, accessible: Bool, waypoint: Waypoint?
    ) async throws -> DetailFetchResult? {
        let via = waypoint.map { (lat: $0.dest.lat, lng: $0.dest.lng) }
        if sessionKind == .car {
            let briefing = try await routeService.car(
                originLat: origin.lat, originLng: origin.lng,
                destLat: dest.lat, destLng: dest.lng,
                // 안내 문장 언어(A26) — walk와 같은 규율, 기본값 없는 인자라 생략은 컴파일이 막는다.
                lang: AppLanguage.dataLocale,
                includeGeometry: true, via: via
            )
            if via != nil, briefing.waypoint == nil { return nil }
            guard briefing.provider == "tmap", let car = buildCarGuide(briefing: briefing) else {
                return nil
            }
            // 자동차에는 계단 회피·최종 접근 기하가 없다 — 타입이 그 사실을 말한다.
            // 하단 2행 입력(K2 §4): live 조각(target·anchor)은 없고 행동은 스텝의 서버 투영.
            return (car.route, car.roadSpans, briefing.durationSeconds, nil, nil, nil, nil,
                    liveStepsFrom(route: car.route, steps: []), nil)
        }
        let briefing = try await routeService.walk(
            originLat: origin.lat, originLng: origin.lng,
            destLat: dest.lat, destLng: dest.lng,
            accessible: accessible,
            // 안내 문장 언어(E16 축3) — 기본값 없는 인자라 새 조회 경로가 빠뜨리면 컴파일이 막는다.
            // 타입이 `DataLocale`이라 오타가 들어갈 자리가 없다(2026-09-02).
            lang: AppLanguage.dataLocaleValue,
            includeGeometry: true,
            variant: variant,
            // 건너는 길 이름은 실험판만(E62 §3.5 — 추론이라 실보행이 게이트).
            crossingRoad: AppConfig.experimentalCrossingRoadEnabled,
            via: via
        )
        guard let briefing else { return nil }
        if via != nil, briefing.waypoint == nil { return nil }
        guard let route = buildGuideRoute(
            briefing.steps.map {
                // ⚠ `action`을 빠뜨리면 walk 프로파일(서버 투영만 본다)에서 임박 큐가
                // 전면 침묵한다 — 웹 테스트·타입 검사·Kit fixture가 전부 통과시키는 자리다
                // (fixture는 action을 직접 싣는다). E16 축3 §4.2.1. `crossing`도 같다 — 빠뜨리면 횡단 중 침묵(E62 R1)과
                // 횡단 끝 전 다음 전문 유예(R5)가 오류 없이 꺼진다.
                GuideStepGeometry(
                    description: $0.description, pathCoords: $0.pathCoords, action: $0.action,
                    crossing: $0.crossing ?? false)
            },
            waypointStepIndex: briefing.waypoint?.stepIndex
        ) else { return nil }
        return (
            route, [], briefing.durationSeconds,
            briefing.stepFree, briefing.stepFreeStatus, briefing.stepFreeNotice,
            briefing.finalApproach,
            // 스팬과 응답 스텝(live 조각·횡단 플래그)을 index로 짝지어 표시 입력을 만든다(spec §5, A26).
            liveStepsFrom(route: route, steps: briefing.steps.map {
                (target: $0.live?.target, anchor: $0.live?.anchor, crossing: $0.crossing ?? false,
                 body: $0.parts?.body, crossingClock: $0.crossingClock)
            }),
            briefing.lineKind
        )
    }

    /// 열화 전이 판정(spec 2026-08-08 §2.3, 웹 `consumeStepFreeNotice` 미러). 상태가
    /// 열화이고 직전과 다를 때만 문장을 돌려준다. 직전 상태를 갱신하는 부작용이
    /// 있으므로 기하 빌드까지 성공한 뒤 정확히 1회 부른다.
    ///
    /// ⚠ **신호는 상태 분류가 아니라 "서버가 문장을 실었는가"다**(a11y 리뷰 H2).
    /// 서버는 열화일 때만 문장을 채우므로 문장의 존재 자체가 경고를 뜻한다. 알려진
    /// 상태 셋으로 분류되는지로 가르면 서버가 넷째 상태를 추가하는 순간 문장이 와
    /// 있는데도 침묵하는데, 같은 응답에 웹은 낭독한다 — 모르는 상태일수록 보수적으로
    /// 말해야 한다. 중복 판정은 원시 문자열로 막는다.
    private func consumeStepFreeNotice(
        _ raw: String?, _ status: StepFreeStatus?, _ notice: String?
    ) -> String? {
        let prev = lastStepFree
        // 정상(applied)·미요청은 침묵하되 기준은 갱신한다 — 이후 열화가 오면 전이다.
        let benign = raw == nil || status == .applied
        // ⚠ 열화인데 문장이 비어 오면(서버 계약 위반) 기준을 갱신하지 않는다.
        //    갱신하면 문장이 정상화된 뒤에도 전이가 사라져 영영 침묵한다(리뷰 L5).
        if benign || notice != nil { lastStepFree = raw }
        guard !benign, let notice, raw != prev else { return nil }
        return notice
    }

    /// 시작 경로 조회 착수 + origin 계측(A18). `reason`은 `accepted`(수용 정확도
    /// 통과)·`best`(대기 상한에 최선값). 종전엔 이 분기가 계측 전에 반환해 origin
    /// fix의 정확도·나이가 로그에 없었고, 그래서 115m 어긋남의 원인 값을 역산으로만
    /// 추정해야 했다.
    private func startRouteFetch(origin: RouteOriginFix, reason: String, dest: BeaconDest, token: Int) {
        guideDiagLog(
            "routeOrigin lat=\(String(format: "%.6f", origin.lat)) "
                + "lng=\(String(format: "%.6f", origin.lng)) "
                + "acc=\(String(format: "%.1f", origin.accuracy)) "
                + "age=\(String(format: "%.1f", origin.ageSeconds)) reason=\(reason)"
        )
        routeOriginBest = nil
        routeOriginBestAt = nil
        let coord = (lat: origin.lat, lng: origin.lng)
        routeFetchTask = Task { [weak self] in
            await self?.fetchGuideRoute(origin: coord, dest: dest, token: token)
        }
    }

    /// 상세 경로 조회 — 첫 수용 fix가 트리거하고 그 좌표가 origin이다(8번: 위치
    /// 재조회 의존 제거). 성공하면 상세 모드 + 원자 시작 발화, 실패는 간략 폴백.
    /// "이 세션에서 현재 목적지에 대해 조회"가 곧 상세 적격 조건이다(스펙 §4.1).
    private func fetchGuideRoute(
        origin: (lat: Double, lng: Double), dest: BeaconDest, token: Int
    ) async {
        // defer는 다른 가드를 거치지 않으므로 세대 토큰으로 자기 세션에만 작용시킨다.
        // 없으면 stale task의 defer가 새 세션의 awaitingRoute를 조기 해제해 이중 발화
        // 방지(§4.1)가 깨진다(독립 리뷰 MEDIUM).
        defer { if token == routeFetchToken { awaitingRoute = false } }
        let waypointAtFetch = waypoint
        do {
            let fetched = try await fetchDetailData(
                origin: origin, dest: dest, variant: sessionVariant, accessible: accessible,
                waypoint: waypointAtFetch)
            // 커밋 가드: 세대 토큰 + 목적지·경유지 스냅샷(왕복 중 경유지 추가·변경·도착이면
            // 도착 응답 폐기 — 그 전이가 토큰을 올려 새 조회를 시작한다).
            guard !Task.isCancelled, token == routeFetchToken, isTracking,
                  self.dest == dest, self.waypoint == waypointAtFetch else { return }
            guard let fetched else {
                fallbackToBrief()
                return
            }
            guideRoute = fetched.route
            routeWaypointLabel = waypointAtFetch?.label
            guideRouteDurationSeconds = fetched.durationSeconds
            roadSpans = fetched.spans
            if sessionKind == .car {
                // 시작 조회가 ETA 1회차(§4.6 캡 포함), 주기 타이머 가동.
                etaCallCount = 1
                if let dur = fetched.durationSeconds, dur > 0 {
                    etaSeconds = Double(dur)
                    etaUpdatedAt = uptimeNow
                } else {
                    etaSeconds = nil
                    etaUpdatedAt = nil
                }
                startEtaTimer()
            }
            resetFinalApproach(geometry: fetched.finalApproach)
            // 목적지 전환이 보관해 둔 유도기 버퍼가 있으면 잇는다(§3.1 승계 —
            // 세션 시작 경로에서는 nil이라 종전 냉시동과 동일).
            let initial = initialGuideState(
                route: fetched.route, now: uptimeNow,
                hasFinalApproachGeometry: fetched.finalApproach != nil,
                courseDerivation: carriedCourseDerivation ?? initialDerivationState
            )
            carriedCourseDerivation = nil
            guideState = initial.state
            mode = .detail
            offRoute = false
            updateRemaining(route: fetched.route, state: initial.state)
            // 하단 2행: 표시 유닛은 경로와 수명이 같다(spec 2026-08-11, car 확장 K2 §4).
            displayUnits = buildDisplayUnits(fetched.liveSteps)
            liveSteps = fetched.liveSteps
            resetLiveRowsBaseline(state: initial.state)
            if sessionKind == .walk {
                currentRoadText = nil
            } else {
                // car는 "지금 어느 도로"가 정보라 "현재 도로" 행을 liveRows 앞에 둔다(E56).
                refreshCurrentRoad(state: initial.state)
            }
            // 시작 요약 + 첫 안내를 한 문장으로(원자 발화 — 두 통지의 경합 제거).
            // 목적지 이름은 통지 언어로(A55 — en이면 라틴 표기). 라틴 표기가 없으면 원명 그대로(종전 문장 — 이름 없는 시작 문장은 없다).
            let spokenDest = spokenDestinationName ?? destinationLabel
            let summary = sessionKind == .car
                ? GuideText.carStart(
                    route: fetched.route, firstIndices: initial.firstIndices,
                    destination: spokenDest)
                : GuideText.start(
                    route: fetched.route, firstIndices: initial.firstIndices,
                    destination: spokenDest)
            // 계단 회피 열화 문장이 있으면 그 앞에 붙인다 — 세션 전체에 걸린 조건이라
            // 걷기 전에 들어야 한다(spec §2.3). 별도 통지로 내보내면 경합한다.
            let notice = consumeStepFreeNotice(
                fetched.stepFreeRaw, fetched.stepFree, fetched.stepFreeNotice
            )
            let text = notice.map { "\($0) \(summary)" } ?? summary
            lastGuidance = GuideText.unit(route: fetched.route, indices: initial.firstIndices)
            statusText = text
            // 발화가 버려졌으면(백그라운드·억제) 경고만 따로 남긴다 — 진행 안내와 달리
            // 다음 fix가 대신 말해 주지 않는다(리뷰 H1).
            // ⚠ .high 필수(스펙 2026-08-12 §3.1, 마일스톤 리뷰 MAJOR): 목적지 전환
            // 경로에서는 이 요약이 검색 시트 닫힘의 커서 복원 낭독과 겹칠 수 있다 —
            // 기본 우선순위만 잠식되는 비대칭이 performReroute 실사고의 기제.
            announce(text, highPriority: true, speechClass: .actionable) { [weak self] in
                if let notice { self?.pendingStepFreeNotice = notice }
            }
        } catch {
            guard !Task.isCancelled, isTracking else { return }
            fallbackToBrief()
        }
    }

    /// car ETA 주기 갱신 타이머(§4.6 — 10분). 캡 소진·간략 전환 시 자연 무동작.
    private func startEtaTimer() {
        etaTask?.cancel()
        etaTask = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(600))
                guard let self else { return }
                guard !Task.isCancelled else { return }
                await self.refreshCarEta()
            }
        }
    }

    private func refreshCarEta() async {
        guard sessionKind == .car, isTracking, mode == .detail else { return }
        guard etaCallCount < 6 else { return }
        // 이탈 중 동결(§4.4): 낡은 경로 기준 ETA 갱신은 거짓이라 건너뛴다.
        guard guideState?.phase != .offRoute else { return }
        guard let dest else { return }
        etaCallCount += 1
        let token = routeFetchToken
        do {
            let origin = try await LocationService.shared.currentCoordinate()
            let briefing = try await routeService.car(
                originLat: origin.lat, originLng: origin.lng,
                destLat: dest.lat, destLng: dest.lng,
                lang: AppLanguage.dataLocale,
                via: waypoint.map { (lat: $0.dest.lat, lng: $0.dest.lng) }
            )
            // 세대 일치 커밋(§4.6) — 중지·재조회·목적지 변경 후 도착 응답 폐기.
            guard token == routeFetchToken, isTracking, mode == .detail, self.dest == dest,
                  briefing.durationSeconds > 0
            else { return }
            etaSeconds = Double(briefing.durationSeconds)
            etaUpdatedAt = uptimeNow
            if let route = guideRoute, let state = guideState {
                updateRemaining(route: route, state: state)
            }
        } catch {
            // 조용히 직전 값 유지 — stale 판정은 etaUpdatedAt이 담당(§4.6 3-state).
        }
    }

    /// "현재 도로" 행 갱신(E56) — **현재 진행거리가 속한 링크에서 직접 유도**한다. 스텝 단위가
    /// 아니다: 한 안내 구간 안에서 도로가 바뀌는 스텝이 15%다(실호출 게이트, spec §2.2 —
    /// "통일로를 따라 338m" 뒤 안내 지점 없이 퇴계로 931m). 원천은 서버 `roadLinks`이고 문장을
    /// 읽지 않는다. 진행 상황 조망의 "{road} 주행 중"과 같은 함수라 두 곳이 어긋나지 않는다.
    /// 매 fix·커밋 지점에서 부른다(웹 `useRouteGuide` 미러).
    private func refreshCurrentRoad(state: GuideState) {
        let text = roadNameAt(spans: roadSpans, d: state.d).map { appLocalized("guide.currentRoad", $0) }
        // 매 fix 호출이라 동일 값 재대입을 걸러 관찰 무효화(재렌더)를 막는다 — 같은 이름이 이어지면
        // 행이 불변이라 VoiceOver가 다시 읽지 않는다.
        if currentRoadText != text { currentRoadText = text }
    }

    /// 하단 2행 갱신(walk·car 상세, spec 2026-08-11·K2 §4). 매 fix·커밋 지점에서 부른다 —
    /// 상태 국면(uncertain·offRoute 포함)도 리듀서가 행을 소유하므로 국면 가드가 없다.
    /// 렌더 규칙은 공유 fixture 러너와 동일해야 한다(GuideText.liveTop/liveNext).
    private func refreshLiveRows(state: GuideState) {
        let out = guideLiveRows(
            prev: liveRowsState, units: displayUnits,
            d: state.d, baselineD: liveBaselineD, phase: state.phase,
            // car는 임박 임계(속도 함수)와 같은 시점에 "잠시 후"로 넘어간다(K2 §4).
            turnApproachM: turnApproachMeters(speedSamples: state.speedSamples, tuning: tuning)
        )
        liveRowsState = out.state
        let kind = sessionKind
        // 돌아가기 국면의 윗줄은 마지막 이탈 문장(벗어난 쪽·돌아갈 쪽, E63) — 없으면 종전 문장.
        let top = out.top.map { $0 == .offRoute ? (offRouteLine ?? GuideText.liveTop($0, kind: kind)) : GuideText.liveTop($0, kind: kind) }
        let next = out.next.map { GuideText.liveNext($0, kind: kind) }
        // 매 fix 호출이라 동일 값 재대입을 걸러 관찰 무효화(재렌더)를 막는다.
        if liveTopText != top { liveTopText = top }
        if liveNextText != next { liveNextText = next }
        // 횡단 중 남은 거리 행(E62 판정 4) — `updateRemaining`이 남은 거리 행에 쓴다(같은 fix에서 뒤에 불린다).
        liveCrossingText = out.crossingRemaining.map(GuideText.crossingRemaining)
    }

    /// 하단 2행 기준 재설정(상태 재구성 지점 — 커밋·이탈 복귀·재획득). 램프인
    /// 기준점과 클램프가 함께 새 기준으로 시작한다(spec §3 F7·§4.2 리셋 계약).
    private func resetLiveRowsBaseline(state: GuideState) {
        liveBaselineD = state.d
        liveRowsState = nil
        refreshLiveRows(state: state)
    }

    private func clearLiveRows() {
        liveTopText = nil
        liveNextText = nil
        liveRowsState = nil
        liveCrossingText = nil
    }

    /// 상세 불가 시 간략 폴백(조용한 강등 금지 — 통지가 모드를 말한다, 스펙 §4.1).
    /// 문구는 원인별로 가른다(8번): 경로 실패(기본)와 위치 대기 실패는 사용자가 취할
    /// 행동이 다르다(잠시 후 전환 재시도 vs 하늘 트인 곳으로 이동).
    private func fallbackToBrief(key: String = "guide.detailUnavailable") {
        resetArrivalWindow()  // 옛 창 에피소드는 지운다 — 간략 복귀의 첫 usable fix가 새로 연다(spec 2026-09-02 §2.2)
        mode = .brief
        remainingText = nil
        currentRoadText = nil
        clearLiveRows()
        // 경로가 없으면 경로 기반 계단 판정도 없다(3-state). 복구된 상세가 열화면
        // 새 판정으로 다시 통지된다 — 반복이 아니다. 갚지 못한 경고도 대상이
        // 사라졌으므로 버린다(간략 폴백엔 따라갈 경로 자체가 없다).
        lastStepFree = nil
        pendingStepFreeNotice = nil
        // E40: 경로를 못 받아 직선거리로 떨어지는 이 문장도 시작 통지다 — 목적지를 말한다.
        // `guide.detailNoLocation`은 대상 밖(위치를 못 잡은 상태라 목적지가 행동을 바꾸지 않는다).
        var text = key == "guide.detailUnavailable"
            ? appLocalized(key, destinationLabel)
            : appLocalized(key)
        // 경유지가 있는 세션의 간략 폴백은 경유지를 **조용히** 버리지 않는다(설계 리뷰 #7):
        // 간략 안내는 기하를 몰라 목적지 직선 안내가 되고, 화면엔 경유지가 남아 거짓이
        // 된다. 사실을 말하고 비운다 — 사용자가 다시 더할 수 있다(세션 보류보다 낫다).
        // 그 문장은 `.high` — 안내 방식이 바뀐 사실은 착지 라벨로 대체될 수 없다.
        // N4(위원장 문안 2026-09-26): 원인절("경로를 찾지 못했습니다")이 참인 경로 실패에서는 강등 문장을 경유지
        // 문장으로 **대체**한다(붙이면 "안내합니다"가 두 번 이어지고 실패 대상을 목적지로 잘못 짚는다, 웹
        // `directions.viaDropped` 동형). 위치 실패(`detailNoLocation`)에 그 문장을 붙이면 거짓 원인이라 원인 없는
        // 문장(`waypointSkipped`)을 덧붙인다 — 간략 안내는 이후 스스로 상세로 돌아가지 않으므로 경유지를 남기면
        // 화면과 안내가 어긋난다. 이름은 괄호 안이라 조사를 붙이지 않는다.
        var droppedWaypoint = false
        if let dropped = waypoint {
            waypoint = nil
            routeWaypointLabel = nil
            syncStartRequestWithSession()
            droppedWaypoint = true
            text = key == "guide.detailUnavailable"
                ? appLocalized("ios.guide.waypointDropped", dropped.label, destinationLabel)
                : text + " " + appLocalized("ios.guide.waypointSkipped", dropped.label)
        }
        statusText = text
        announce(text, highPriority: droppedWaypoint, speechClass: .actionable)
    }

    /// 재시작 요청을 **세션의 현재 목적지·라벨·경유지**로 다시 맞춘다. 세션 중 목적지
    /// 전환·경유지 추가/변경·경유지 도착·폴백 소거가 일어나면 시작 시점 스냅샷은 낡는데,
    /// 실패(정밀 위치 꺼짐 등) 뒤 `restart()`가 그 낡은 값으로 시작하면 사용자가 마지막에
    /// 정한 목적지·경유지가 **조용히** 되돌아간다 — A13이 경계한 바로 그 패턴의 다른
    /// 진입점(code-quality 리뷰 2026-08-22). 수단은 세션 불변이라 승계하고, 요청 축·줄 종류는
    /// **세션 현재값**을 쓴다 — 수동 전환(E42)이 그 넷을 함께 바꾸므로 시작 시점 값은 낡는다.
    private func syncStartRequestWithSession() {
        guard let request = lastStartRequest, let dest else { return }
        lastStartRequest = StartRequest(
            dest: dest, label: destinationLabel, labelRoman: destinationRoman, kind: request.kind,
            accessible: accessible, variant: sessionVariant,
            line: sessionLine, alternate: alternateLine, waypoint: waypoint)
    }

    /// 경로 기준 잔여 거리·예상 시간 갱신(웹 `progressOf` 미러). walk는 provider
    /// 총 소요시간의 잔여 비례 축소, car는 재조회 ETA의 경과 차감 카운트다운(§4.6 —
    /// 비례 축소는 정체 국소성에 취약해 폐기). 근거 없으면 시간 생략(날조 금지).
    ///
    /// 경유지가 있는 세션은 **다음 목표** 기준 한 줄이다(N4 spec 2026-09-24 §4.1 — 도착 전 경유지,
    /// 도착 뒤 목적지). 띠바는 총 잔여를 유지한다. 라벨은 경로에 결박된 `routeWaypointLabel`
    /// (도착 뒤 `waypoint = nil`이어도 남는다)이고, 없으면 종전 행으로 물러난다.
    private func updateRemaining(route: GuideRoute, state: GuideState) {
        let remainingMeters = Int(max(0, route.totalMeters - state.d).rounded())
        updateBandDistance(remainingMeters)
        // 행의 목적지 잔여는 띠바와 같은 10m 갱신 값이다(E57 spec §3.6): 시트가 열리면 커서가 이 행에 앉는데,
        // 1km 미만은 미터 원값이라 매 fix 문자열이 바뀌어 커서 위에서 매초 다시 읽힌다(띠바 설계 리뷰 M7과 같은 기제).
        let shownMeters = bandDistanceMeters ?? remainingMeters
        let target = guideNextTarget(route: route, state: state)
        let distancePart: String
        let minutes: Int?
        if target.kind == .waypoint, let viaLabel = routeWaypointLabel {
            // 경유지 거리는 띠바 값과 다른 양이라 같은 규칙(10m 이상 변했을 때만)을 따로 적용한다(E57 §3.6).
            let meters = max(0, Int(target.meters.rounded()))
            if shownWaypointMeters.map({ abs($0 - meters) >= 10 }) ?? true { shownWaypointMeters = meters }
            distancePart = appLocalized(
                "directions.viaRemaining", viaLabel, formatDistance(shownWaypointMeters ?? meters))
            minutes = etaMinutes(route: route, remainingMeters: target.meters, toWaypoint: true)
        } else if (target.kind == .destination && routeWaypointLabel != nil) || waypointPassedInSession {
            shownWaypointMeters = nil
            // 경유지를 지난 세션은 재조회 경로(경유지 없음)에서도 목적지 목표다(설계 리뷰 #7).
            distancePart = appLocalized(
                "directions.viaDestRemaining", destinationLabel, formatDistance(shownMeters))
            minutes = etaMinutesNow(route: route, state: state)
        } else {
            shownWaypointMeters = nil
            distancePart = appLocalized("guide.remainingDistance", formatDistance(shownMeters))
            minutes = etaMinutesNow(route: route, state: state)
        }
        let timePart = minutes.map { appLocalized("guide.remainingTime", String($0)) }
        // 횡단 중엔 남은 거리 행이 횡단보도 끝까지의 거리다(E62 판정 4). 10m 단위라 행 문자열도 그때만 바뀐다.
        let text = liveCrossingText ?? joinText(distancePart, timePart)
        // 같은 문장이면 대입하지 않는다 — 행이 불변이라 커서 위에서 다시 읽히지 않는다.
        if remainingText != text { remainingText = text }
    }

    /// 띠바 거리 양자화(10m). 같은 구간이면 라벨을 건드리지 않는다(설계 리뷰 M7).
    private func updateBandDistance(_ meters: Int) {
        let clamped = max(0, meters)
        if let current = bandDistanceMeters, abs(current - clamped) < 10 { return }
        bandDistanceMeters = clamped
    }

    /// 잔여 시간(분) — 상시 표시와 진행 상황 조망이 같은 산식을 쓴다(사본 금지).
    /// 근거 없으면 nil(3-state — 날조 금지).
    private func etaMinutesNow(route: GuideRoute, state: GuideState) -> Int? {
        etaMinutes(
            route: route, remainingMeters: max(0, route.totalMeters - state.d), toWaypoint: false)
    }

    /// ko 도착 문장의 목적지 + 방향 조사("서울역으로"·"학교로"). 받침을 모르는 이름(영문·숫자 끝)은 `로` —
    /// 읽는 소리(에스·오·일·엘)는 대부분 `로`를 받고, 조사를 빼면 문장이 깨진다(N4 spec 2026-09-24 §3).
    /// 비-ko는 원문(웹 `useRouteGuide` 동형).
    private func destinationWithDirectionParticle(_ label: String) -> String {
        guard AppLanguage.current == "ko" else { return label }
        return label + (KoreanParticle.direction(label) ?? "로")
    }

    /// 목표 잔여(m)까지의 시간(분). walk는 총 소요의 잔여 비례, car는 재조회 ETA 카운트다운이다 —
    /// 그 ETA는 목적지까지라 **경유지 목표에는 없다**(nil, 날조 금지 — N4 spec 2026-09-24 §4.1).
    private func etaMinutes(route: GuideRoute, remainingMeters: Double, toWaypoint: Bool) -> Int? {
        // 목표를 이미 밟은 값(0m)에 "약 1분"을 붙이지 않는다(설계 리뷰 #11 — 근거 없는 수치).
        if remainingMeters < 1 { return nil }
        if sessionKind == .car {
            guard !toWaypoint, let eta = etaSeconds, let at = etaUpdatedAt else { return nil }
            return max(1, Int((max(0, eta - (uptimeNow - at)) / 60).rounded()))
        }
        guard let dur = guideRouteDurationSeconds, dur > 0, route.totalMeters > 0 else { return nil }
        return max(1, Int((Double(dur) * remainingMeters / route.totalMeters / 60).rounded()))
    }

    private func fail(
        with status: Status, key: String, resolution: FailResolution = .none, prewalkCancelled: Bool = false,
        highPriority: Bool
    ) {
        self.status = status
        failResolution = resolution
        // 승차 전 도보면 사유 뒤에 "대중교통 안내는 시작하지 않았다"를 **두 문장**으로 잇는다(A54 위원장 판정: 완결 문장 둘은
        // 쉼표 결합이 아니라 마침표). 사유 키는 상태 줄 겸용이라 마침표가 없어 문장 틀 키가 로케일별 마침표를 든다.
        statusText = prewalkCancelled
            ? appLocalized("ios.beacon.prewalkCancelledWith", appLocalized(key)) : appLocalized(key)
        announce(statusText, highPriority: highPriority, speechClass: .actionable)
    }

    /// 중지. 어느 경로로 불려도 idle timer가 반드시 풀리도록 먼저 해제한다
    /// (전역 가변 상태라 누수되면 화면이 영영 안 꺼진다).
    ///
    /// ⚠ 톤 엔진은 여기서 정리하지 않는다. 정지 톤을 예약한 직후 엔진을 멈추면
    /// 하강 3음이 한 프레임도 나지 않는다. 정리는 `teardown()` 몫이다.
    func stop(playStopTone: Bool = false) {
        // 갚지 못한 계단 경고는 세션과 함께 버린다. 전경 복귀 재생이 추적 가드보다
        // 앞이라(아래 `handleScenePhaseChange`) 남겨 두면 끝난 경로의 경고가 뒤늦게
        // 발화된다.
        pendingStepFreeNotice = nil
        // 보류 발화 폐기(spec 2026-08-14 §4-2): 취소하지 않으면 일반 정지 뒤 끝난
        // 경로의 명령이 약 0.8초 뒤에 발화한다. 도착 통지는 stop() **뒤에** 새로
        // 예약되므로 여기서 비워도 소실되지 않는다(호출 순서가 계약 — 게시 시점에
        // isTracking을 검사하지 않는 이유이기도 하다). teardown()은 stop() 경유.
        // 기기 음성 대기 칸도 같은 경계에서 버림 통지 없이 비운다(E53 §4.2 ⑤ — 위에서 비운 장부를 되살리지 않게).
        deferredAnnouncer.advanceGeneration()
        deviceSpeech.reset()
        resetFinalApproach(geometry: nil)
        if let token = sessionToken {
            sessionToken = nil
            GuideSession.shared.coordinator.release(token)
        }
        startTask?.cancel()
        startTask = nil
        starting = false
        UIApplication.shared.isIdleTimerDisabled = false
        watchdog?.cancel()
        watchdog = nil
        LocationService.shared.stopBeaconUpdates()
        pedometer.stopLiveUpdates()  // 값(liveHealthSample)은 남긴다 — 종료 처리가 뒤에 읽는다
        if playStopTone && status == .tracking { playTone(.stop) }
        // 원복은 정지 톤 **뒤에**. 먼저 원복하면 그 톤이 `.ambient`로 나가 잠금
        // 상태에서 들리지 않는다(세션 종료를 소리로 확인할 수 없게 된다).
        // 운전자 채널은 도착 문장이 이 오디오 세션 위의 발화라 그 문장이 말하기 시작할 때까지 다리를 두고(B9), 그 뒤는
        // `speechBusy`가 발화가 끝날 때까지 기다린다(E53 §7 — 길이 어림 금지). 백그라운드 음성 안내도 같다(백그라운드 ∧
        // 토글 켬이면 이어질 도착 문장이 기기 음성이다. 그 밖 0초 — 정식판 불변).
        tones.endSession(
            holdSeconds: driverChannel ? deviceSpeechEndBridgeSeconds : GuideSpeechOutput.sessionEndHoldSeconds(),
            speechBusy: { [weak self] in GuideSpeechOutput.speechBusy(self?.deviceSpeech) })
        if status == .tracking { status = .idle }
        statusText = ""
        failResolution = .none
        soundDegraded = false
        // 억제 잔류 차단(스펙 §5.4, 리뷰 BLOCKER) — 검색 시트째 소멸하는 종료
        // 경로(권한 철회·정밀 꺼짐)에서 onChange 해제가 오지 않는다.
        outputSuppressed = false
        beaconState = .initial
        gateState = .initial
        toneState = .initial
        motionState = .initial
        dest = nil
        // 세션 종료 = 경로 폐기(스펙 §7.3 약관 경계: 메모리 한정·세션 간 재사용 금지).
        routeFetchTask?.cancel()
        routeFetchTask = nil
        fixWaitTask?.cancel()
        fixWaitTask = nil
        routeOriginBest = nil
        routeOriginBestAt = nil
        awaitingRoute = false
        mode = .brief
        sessionKind = .walk
        guideRoute = nil
        guideRouteDurationSeconds = nil
        guideState = nil
        lastGuidance = nil
        remainingText = nil
        bandDistanceMeters = nil
        currentRoadText = nil
        clearLiveRows()
        displayUnits = []
        liveSteps = []
        liveBaselineD = 0
        offRoute = false
        roadSpans = []
        etaSeconds = nil
        etaUpdatedAt = nil
        etaCallCount = 0
        etaTask?.cancel()
        etaTask = nil
        pendingRecovery = nil
        pendingRecoveryEntered = nil
        lastFixCoord = nil
        lastFixCoordAt = nil
        isRerouting = false
        isSwitchingVariant = false
        carriedCourseDerivation = nil
        waypoint = nil
        routeWaypointLabel = nil
        waypointPassedInSession = false
        rerouteToken += 1  // in-flight 재조회 응답 폐기(latest-wins)
        routeFetchToken += 1  // stale 경로 조회 defer 무효화
        // 세션 종료 = 진행 중 자동 재조회·회차 카운터 전부 무효(E10ⓑ — 상한은 세션당이다).
        clearProposal()
        proposalFetchCount = 0
        offRouteNoticePosted = false
        offRouteLine = nil
        rerouteTriggerCount = 0
        offRouteConfirmedAt = nil
        offRouteConfirmCoord = nil
        resetAlternativePreview()
        prewalkTarget = nil
        // 종료 콜백은 정리가 **끝난 뒤** 다음 턴에 — 이 stop()을 부른 자리가 뒤에 내는 종료
        // 문장(도착·유휴·권한)이 연결 문장보다 먼저 나가고, 정리 도중 다른 모델 시작이
        // 재진입하지 않는다(spec 2026-08-30 §4.2).
        let reason = pendingEndReason
        pendingEndReason = .ended
        if let cb = onSessionEnd {
            onSessionEnd = nil
            Task { @MainActor in cb(reason) }
        }
    }

    /// 화면 이탈 정리. 중지에 더해 오디오 자원까지 반납한다.
    ///
    /// 도착 종료 화면도 여기서 소거한다(독립 리뷰 MINOR): `stop()`은 도착 직후에도
    /// 불리는 경로라 이 값을 보존해야 하지만, 화면을 아예 떠나는 teardown 뒤에 남으면
    /// 재진입 시 유령 도착 화면이 된다(현재는 시트가 탭 전환을 막아 도달 불가 —
    /// presentationDetents 도입 등으로 열리는 경로가 생기면 이 줄이 방어선이다).
    func teardown() {
        stop()
        dropWeightPromptEngagement()
        arrivalDest = nil
        arrivalSessionKind = nil
        endKind = .arrived
        endText = ""
        tones.shutdown()
    }


    /// 종료 화면을 언제 띄우는가. 중지 버튼은 시트가 떠 있는 채로 내용만 바꾸므로 즉시(도착
    /// 동형), 스와이프·VO escape는 시스템이 dismiss를 이미 커밋한 뒤라 그 안에서 바인딩을
    /// 되돌리지 않고 `onDismiss` 뒤에 다시 띄운다.
    /// 사용자 중지(시트·탭 인라인 "중지" 버튼 — N1부터 시트 스와이프·VO escape는 중지가
    /// 아니라 최소화다). 정지 톤을 내고, 도보 세션이고 요약이 성립하면 종료 화면을 남긴다
    /// (아래 `stopLeavingSummary`). 종료 화면이 남는 전이는 포커스를 쥔 컨트롤(중지 버튼)을
    /// 통째로 없애므로 착지 문장을 `.high`로도 통지한다(도착 경로 동형 — 착지가 실패해도
    /// 화면의 존재를 알 수 있다). 요약이 없어 그냥 닫히는 경로는 정지 톤이 신호다(승차 전 도보만 정지 톤 뒤에
    /// "대중교통 안내는 시작하지 않았다"까지 두 문장을 낸다, A54).
    func stopByUser() {
        let text = appLocalized("ios.beacon.stopped")
        let prewalk = prewalkTarget != nil  // stop() 앞 캡처(A25 §4.2)
        pendingEndReason = .userStopped
        if stopLeavingSummary(playStopTone: true, text: text) {
            announce(text, highPriority: true, speechClass: .actionable)
        } else if prewalk {
            // 승차 전 도보는 종료 화면이 없다 — 정지 사유 뒤에 "대중교통 안내는 시작하지 않았다"를 마침표 두 문장으로(A54 위원장
            // 판정, 권한 상실 `stopAndFail`과 같은 문장 틀). 이 모델의 창구라 정지음 뒤에 나가고 원복 다리 동안 오디오 세션을 쥔다
            // (대중교통 창구는 세션 전이라 정지음과 겹치고 화면이 꺼지면 버린다 — A54 접근성 감사). `.high`: 시트가 닫혀 커서가
            // 아래 화면으로 옮겨 가 그 라벨을 읽는다. 이 문장은 착지 라벨로 대체될 수 없다(통지 우선순위 판별선).
            announce(
                appLocalized("ios.beacon.prewalkCancelledWith", appLocalized("ios.beacon.stoppedJoin")),
                highPriority: true, speechClass: .actionable)
        }
    }

    /// 도착이 아닌 종료(사용자 중지·목적지 변경·권한 상실). `stop()`으로 세션을 끝낸 뒤,
    /// 도보 세션이었고 라이브 누적이 `WalkHealth.minMeaningfulDistanceMeters` 이상이면 도착과
    /// 같은 모양으로 종료 화면을 남겨 걸음·칼로리 요약을 보여 준다(spec 2026-08-17 §2,
    /// 2026-08-19 개정 — 종전엔 도착 두 경로만 요약이 나왔다). 반환 = 종료 화면을 남겼는가.
    ///
    /// 판정은 **동기**다(라이브 누적이 근거). 그래서 요약이 없는 종료는 종전 "중지 = 닫힘"과
    /// 과정까지 같고(화면이 스치지 않는다), 요약이 있는 종료는 도착처럼 `stop()` 직후 같은
    /// 턴에 `arrivalDest`를 대입해 시트 내용만 바뀐다. 만보계 권한이 없거나 미지원이면
    /// 누적이 nil이라 요약 없음이다(3-state의 "부재"). ⚠ 다른 세션의 claim
    /// (`GuideSessionCoordinator`)·`teardown`은 이 경로가 아니다 — 그 뒤엔 다른 시트나
    /// 다른 화면이 오므로 종료 화면을 남기지 않는다.
    @discardableResult
    private func stopLeavingSummary(playStopTone: Bool, text: String) -> Bool {
        // stop()이 dest·sessionKind를 되돌리므로 먼저 읽는다(도착 경로 동형).
        let dest = self.dest
        let wasWalkSession = isTracking && sessionKind == .walk && sessionStartedAt != nil
        // ⚠ 첫 라이브 콜백 전에 중지하면 누적이 nil이라 요약 없음이 된다 — 의도된 수용이다.
        //   50m를 걷는 데 30초 이상 걸리고 콜백은 걸음이 쌓이면 수 초 안에 오므로, 이 창에서
        //   지는 요약은 임계값 미만이거나 만보계가 실제로 죽어 있는 세션이다. 여기서 사후
        //   질의를 태우면 판정이 비동기가 되어 이 함수가 없앤 깜빡임이 되돌아온다.
        let sample = liveHealthSample
        let prewalk = prewalkTarget != nil  // stop() 앞 캡처(A25 §4.2) — 승차 전 도보는 종료 화면 없음
        stop(playStopTone: playStopTone)
        guard !prewalk, wasWalkSession, let dest, let sample,
              WalkHealth.isMeaningfulWalk(steps: sample.steps, distanceMeters: sample.distance)
        else { return false }
        presentEndScreen(dest: dest, text: text, sample: sample)
        return true
    }

    private func presentEndScreen(
        dest: BeaconDest, text: String, sample: (steps: Int, distance: Double?)
    ) {
        arrivalDest = dest
        endKind = .stopped
        endText = text
        commitArrivalHealth(sample)
    }

    /// 같은 세션의 경로 재획득 공통부(목적지 전환·경유지 추가/변경이 공유). 세션(톤·위치
    /// 스트림·워치독)은 유지하고 경로·목적지 종속 상태만 내려놓는다 — 다음 수용 fix가
    /// fetchGuideRoute를 트리거한다(start()와 같은 기계). 토큰 둘을 여기서 올리므로
    /// 같은 값으로 되돌아온 A→B→A 경합도 값 비교가 아니라 세대가 가른다(설계 리뷰 #8).
    private func reacquireRoute() {
        // — 경로 종속 상태 초기화(stop()의 부분집합, §3.1 목록) —
        routeFetchTask?.cancel(); routeFetchTask = nil
        fixWaitTask?.cancel(); fixWaitTask = nil
        routeOriginBest = nil; routeOriginBestAt = nil   // 옛 목적지 세션의 최선값이 새 origin으로 새지 않게(게이트 우연 일치에 의존하지 않는다)
        rerouteToken += 1   // in-flight 재조회 응답 폐기(latest-wins)
        routeFetchToken += 1
        isRerouting = false
        isSwitchingVariant = false
        offRoute = false
        // 진행 중 자동 재조회는 옛 목적지의 경로다 — 폐기(회차 카운터는 세션당이라 유지, E10ⓑ).
        clearProposal()
        resetAlternativePreview()
        // 유도기 버퍼는 위치 종속이라 승계한다(§3.1, 재조회 §2.9 동형) — 다음
        // fetchGuideRoute 성공이 1회 소비한다.
        carriedCourseDerivation = guideState?.courseDerivation
        guideRoute = nil
        guideRouteDurationSeconds = nil
        guideState = nil
        lastGuidance = nil
        remainingText = nil
        bandDistanceMeters = nil
        currentRoadText = nil
        clearLiveRows()
        displayUnits = []
        liveSteps = []
        liveBaselineD = 0
        roadSpans = []
        etaTask?.cancel(); etaTask = nil
        etaSeconds = nil; etaUpdatedAt = nil; etaCallCount = 0
        pendingRecovery = nil
        pendingRecoveryEntered = nil
        pendingStepFreeNotice = nil
        lastStepFree = nil
        resetFinalApproach(geometry: nil)
        mode = .brief
        statusText = ""
        // — 목적지 종속 추세 초기화(간략 접근/이탈 추세·톤 계층은 옛 목적지 기준.
        //   motionState(도플러)는 위치 종속이라 승계) —
        beaconState = .initial
        gateState = .initial
        toneState = .initial
    }

    /// 경유지 추가·변경(N4 spec §4.2). 세션이 죽었으면 false(호출부는 폼도 건드리지 않는다).
    /// 같은 좌표 재선택은 라벨만 갱신하고 "그대로" 통지 — 일어나지 않는 재조회를 예고하지
    /// 않는다(설계 리뷰 #12). 그 외엔 목적지 전환과 같은 경로 재획득.
    @discardableResult
    func setWaypoint(dest newDest: BeaconDest, label: String) -> Bool {
        guard isTracking else { return false }
        if waypoint?.dest == newDest {
            waypoint = Waypoint(dest: newDest, label: label)
            syncStartRequestWithSession()
            announceNow(appLocalized("ios.guide.waypointKept", label),
                        highPriority: true, bypassSuppression: true)
            return true
        }
        waypoint = Waypoint(dest: newDest, label: label)
        syncStartRequestWithSession()
        // ⚠ 재조회는 전 로케일이다(E16 축3으로 ko 게이트 삭제 — 남기면 목적지·경유지를
        // 바꿔도 경로가 갱신되지 않은 채 새 목적지를 안내한다). 항상 참인 상수를 남기지
        // 않는 것이 이 repo의 플래그 졸업 방식이라 조건 자체를 지웠다.
        reacquireRoute()
        announceNow(appLocalized("ios.guide.waypointSet", label), highPriority: true, bypassSuppression: true)
        awaitingRoute = true
        startFixWaitWatch(token: routeFetchToken)
        return true
    }

    /// 안내 중 경유지 삭제(N4 잔여, K2 §6.5). `setWaypoint`의 재획득 경로 동형 — 경유지만
    /// 비우고 출발→도착으로 다시 조회한다. 통지는 `.high`(버튼이 사라지며 포커스가 옮겨간다).
    @discardableResult
    func removeWaypoint() -> Bool {
        guard isTracking, let removed = waypoint else { return false }
        waypoint = nil
        syncStartRequestWithSession()
        // 자동 재조회·프리뷰 소거는 reacquireRoute()가 한다(setWaypoint 동형). 폼의 `via`는 사용자 질의라
        // 도착과 같은 이유로 건드리지 않는다 — 다음 조회 전에 폼에서 지우는 것은 사용자 몫(spec §6.5).
        reacquireRoute()
        announceNow(appLocalized("ios.guide.waypointRemoved", removed.label),
                    highPriority: true, bypassSuppression: true)
        awaitingRoute = true
        startFixWaitWatch(token: routeFetchToken)
        return true
    }

    /// 목적지 전환(스펙 2026-08-12 §3.1) — 같은 세션의 경로 재획득. 세션(톤·위치
    /// 스트림·워치독)은 유지하고 경로·목적지 종속 상태만 내려놓은 뒤, 다음 수용
    /// fix가 fetchGuideRoute를 트리거한다(start()와 같은 기계 — 조회 왕복 동안
    /// 옛 경로의 회전·도착 신호가 나갈 창을 `awaitingRoute` 보류가 구조적으로 막는다).
    /// 반환 false = 세션이 이미 죽어 선택을 폐기(§3.2 — 호출부는 폼도 건드리지 않는다).
    @discardableResult
    func changeDestination(dest newDest: BeaconDest, label: String, labelRoman: String?) -> Bool {
        guard isTracking else { return false }
        // 확인 통지의 이름은 통지 언어로(A55 — 대중교통 목적지 변경과 같은 판정). en이고 라틴 표기가 없으면 이름 없는 문구.
        let changed = { [self] in
            spokenDestinationName.map { appLocalized("ios.guide.destChanged", $0) }
                ?? appLocalized("ios.guide.destChangedNoName")
        }
        if dest == newDest {
            // 같은 좌표 재선택(§3.2): 재조회 없이 확인 통지만. 라벨은 최신본으로.
            destinationLabel = label
            destinationRoman = labelRoman
            syncStartRequestWithSession()
            announceNow(changed(), highPriority: true, bypassSuppression: true)
            return true
        }
        dest = newDest
        destinationLabel = label
        destinationRoman = labelRoman
        // 새 목적지는 새 여정이다 — 지난 경유지의 "목적지 {dest}까지" 행 유지를 잇지 않는다(코드 리뷰 L4).
        waypointPassedInSession = false
        syncStartRequestWithSession()
        reacquireRoute()
        // 즉시 확인 통지(§3.1: 조회 완료에 결박하지 않는 활성화 응답, 억제 우회).
        let ack = changed() + " " + appLocalized("ios.guide.destChangedFetching")
        announceNow(ack, highPriority: true, bypassSuppression: true)
        awaitingRoute = true
        startFixWaitWatch(token: routeFetchToken)
        return true
    }

    // MARK: - 앱 생명주기

    func handleScenePhaseChange(to phase: ScenePhase) {
        switch phase {
        case .background:
            wasBackgrounded = true
            UIApplication.shared.isIdleTimerDisabled = false
        case .active:
            // 복귀 처리를 마쳤다는 신호는 이 분기의 **끝**(조기 반환 포함)이다 — 시트의 복귀 착지가 상환 게시 뒤에 시작한다(E57).
            defer { foregroundReturnSeq += 1 }
            // 백그라운드 경유 플래그는 **맨 앞에서 소비**한다(설계 리뷰 MAJOR ②). 종전엔 추적 가드 뒤에서만
            // 소비해 종료 화면 상태(비추적)에서 플래그가 영영 남았고, 그러면 제어센터 `.inactive` 왕복이
            // 백그라운드 복귀로 오인된다.
            let returnedFromBackground = wasBackgrounded
            wasBackgrounded = false
            // 복귀 인계(E53 §4.2 ⑥): 이 모델이 말하던 기기 음성·대기 칸의 문장 중 채널이 VoiceOver로 바뀐 것을 받아
            // 아래 상환과 **한 통지**로 낸다(두 통지를 잇달아 내면 뒤의 것이 앞의 것을 자른다 — 구현 리뷰 M-2). 백그라운드를
            // 거치지 않은 복귀엔 넘길 것이 없다(기기 음성은 백그라운드 전용). 정식판은 늘 빈 목록이다.
            let handed = returnedFromBackground ? deviceSpeech.handOver() : .empty
            // 오래된 종료 화면 소거(A31 축 ②, spec 2026-09-02 §3): 종료 뒤 30분이 지나 **백그라운드를 거쳐**
            // 돌아왔으면 화면·띠바 요약·미뤄진 종료 통지를 함께 버린다(맥락 밖 낭독 금지 — 헌장 §6 ⑨ 동형).
            // 상환 블록보다 앞이다: `clearArrival()`이 종료 문장을 지우면 아래 상환은 남은 실패 문장만
            // 읽는다(권한 상실 뒤 돌아온 사용자가 들어야 할 것은 종료 사실이 아니라 권한 문장이다).
            if returnedFromBackground, !isTracking, arrivalDest != nil, let endedAt {
                let age = endedAt.duration(to: .now)
                let seconds = Double(age.components.seconds) + Double(age.components.attoseconds) / 1e18
                if isEndScreenStale(secondsSinceEnd: seconds) {
                    guideDiagLog("endScreenExpired age=\(Int(seconds))")
                    pendingFinalApproachIntro = nil
                    pendingStepFreeNotice = nil
                    clearArrival()
                }
            }
            // 도착 종료 화면이 열린 채 조회가 실패했으면 1회 재조회(spec 2026-08-17 §3 —
            // 도착 직후 정지·권한 응답 지연 구제). `.unavailable`은 다시 보지 않는다.
            if arrivalDest != nil, arrivalHealthLoad == .failed { loadArrivalHealth() }
            // ⚠ **추적 가드보다 앞이다.** 백그라운드에서 세션이 *끝나는* 경로들이 있고
            // (권한 철회·목적지 변경·다른 세션의 claim) 그때 status가 내려가므로,
            // 가드 뒤에 두면 종료 통지가 통째로 유실된다. 같은 순간 정지 톤도 없어
            // (stop 기본값이 playStopTone: false) "조용히 죽은 것"과 "정상인데 데드밴드를
            // 못 넘은 것"이 구분되지 않는다. 종료 통지는 추적 중이 아닐 때야말로 필요하다.
            let repaying = missedAnnouncement || pendingStepFreeNotice != nil
                || pendingFinalApproachIntro != nil
            if repaying || !handed.isEmpty {
                missedAnnouncement = false
                // 두 문장을 연속으로 내보내지 않는다 — 경합하면 앞의 것이 잘린다.
                // 경고가 앞이다(세션 전체에 걸린 조건).
                // ⚠ 진입 배치 서술은 `statusText`와 같은 문장일 수 있다(억제 직후 복귀).
                //   중복 낭독을 막으려고 statusText 쪽을 떨어뜨린다.
                let intro = pendingFinalApproachIntro
                // 상태 행이 비어 있으면(실행 안내 직후 — 역할 분리로 statusText에 실행
                // 안내가 남지 않는다) car는 지금 할 일(하단 2행 윗줄)이 곧 현재 상태다 — 도로 이름만으로는 놓친 행동을 갚지 못하고,
                // 무명 링크 위 복귀면 비어 침묵한다(E56 설계 리뷰 M2). walk엔 이 폴백이 없다(종전 그대로).
                let carState = sessionKind == .car ? (liveTopText ?? currentRoadText) : nil
                let current = statusText.isEmpty ? (carState ?? "") : statusText
                // 현재 상태 꼬리는 버린 문장이 있을 때만(인계만 있으면 마지막 상태는 인계 문장이다), 인계와 같은 문장이면 뺀다.
                // 인계 문장은 낭독 정정(`spokenUnits`)을 지난 뒤라 같은 층끼리 비교한다(검증 리뷰 N2 — "300m" ≠ "300 미터").
                let tail = !repaying || current.isEmpty || current == intro
                    || handed.texts.contains(spokenUnits(current)) ? nil : current
                // 순서: 인계(끊긴 옛 발화 → 칸의 새 문장) → 세션 경고 → 진입 서술 → 현재 상태.
                let owed = (handed.texts + [pendingStepFreeNotice, intro, tail].compactMap { $0 })
                    .joined(separator: " ")
                if !owed.isEmpty {
                    // 먼저 지우고, 게시하지 못하면(억제 잔류 등) onDropped가 복원한다
                    // — "성공 시에만 지운다"의 등가 형태(§4-6 반환값 폐지 이관). 인계받은 문장도 되돌린다: 인계는
                    // 전달로 쳐서 칸이 장부를 풀었으므로, 합본째 버려지면 그 1회성 경고가 장부 없이 사라진다(횡단 리뷰 F6).
                    let notice = pendingStepFreeNotice
                    pendingStepFreeNotice = nil
                    pendingFinalApproachIntro = nil
                    // `.high`: 앱 활성화 순간 기본 우선순위 통지는 VoiceOver의 화면 낭독에 잠식되고 복구 경로가 없다(E53 구현
                    // 리뷰 M-3, CLAUDE.md 통지 우선순위 판별선 — 갚는 1회성 경고는 착지 라벨로 대체될 수 없다). 인계 유무와 무관하다:
                    // 정식판(인계 없음)도 같은 잠식에 걸리고, 잠식되면 시트의 복귀 착지가 끝 신호를 상한까지 기다렸다(E57 후속,
                    // 설계 리뷰 MAJOR 1).
                    announce(owed, highPriority: true, speechClass: .actionable) { [weak self] in
                        self?.pendingStepFreeNotice = notice
                        self?.pendingFinalApproachIntro = intro
                        handed.undelivered()
                    }
                }
            }
            guard isTracking else { return }
            UIApplication.shared.isIdleTimerDisabled = true
            // `.background`를 거친 복귀에서만 앵커를 버린다. 제어센터를 잠깐 여는
            // `.inactive` 왕복까지 리셋하면 추세가 계속 초기화되고 절대거리가 재발화된다.
            guard returnedFromBackground else { return }
            // 백그라운드 위치가 선언된 빌드는 공백이 없다 — 스트림이 계속 흘러 상태가
            // 이미 최신이므로, 리셋하면 사용자가 화면을 확인하는 순간 누적 추세
            // (가까워지는 중/멀어지는 중)를 오히려 버린다(독립 리뷰 MAJOR). 이 리셋은
            // "백그라운드 동안 fix가 안 온다"는 전경 전용 전제의 산물이라 미선언
            // 빌드에만 남긴다. 선언 빌드의 fix 공백은 워치독 약신호 채널이 잡는다.
            guard !LocationService.backgroundLocationDeclared else { return }
            beaconState = .initial
            gateState = .initial
            // 래치를 지웠으니 간략 창 에피소드도 함께(다음 fix가 다시 연다). 최종 접근 창은 이 리셋과
            // 무관하다 — 지우면 `beginFinalApproach`가 다시 돌지 않는 에피소드 안에서 추정 도착이 영구 침묵한다.
            if !inFinalApproach { resetArrivalWindow() }
            lastFixAt = nil
            startedAt = ProcessInfo.processInfo.systemUptime
            suppressNextNotice = true
        default:
            break
        }
    }

    // MARK: - 톤 계층 배선 (판정은 전부 Kit — 여기는 입력 조립뿐)

    /// 상세 모드 추세 축 데드밴드(m). 웹 `DETAIL_DEAD_BAND_M` 미러.
    ///
    /// **간략 비콘의 `baseDeadBand`(15)와 값을 나눈 이유는 축이 다르기 때문이다.**
    /// 간략은 직선거리라 GPS 지터가 그대로 실리지만, 상세의 잔여 거리는 구속 창
    /// 투영 + `max(state.d, proj.d)` 단조 전진(`RouteGuide` 3단계)을 거치고
    /// `phase` 게이트·리듀서의 투영 점프 판정(`GuideOutput.projectionJumped`)이
    /// 이탈·튐 fix를 앞서 버린다. 실보행 로그
    /// 5세션 6,047 스텝에서 진행 거리 역행이 0건인 것이 그 계약의 관측이다
    /// (`docs/superpowers/specs/logs/`). 즉 이 축에서 데드밴드는 지터 방어가
    /// 아니라 **빈도 노브**다. 15(중위 17.5초)→10(11.5초)을 거쳐 위원장 실보행
    /// 판정(2026-08-12)으로 6 — 10m 간격도 성기게 느껴져 "6m 간격" 직접 지정.
    /// 자동차는 주행 속도(5.4km/h 이상)에서 `closerIntervalSeconds` 10초가 병목이라
    /// 영향이 없고, 그 아래 정체·신호 대기에서만 도보와 같은 기제로 잦아진다.
    /// 정체 중 진행 신호가 더 자주 나는 것은 해롭지 않아 수단을 가르지 않는다.
    /// ⚠ 감쇠 하한(5)보다 커야 감쇠가 산다(웹 드리프트 테스트가 강제).
    private static let detailDeadBand = 6.0

    /// 상세 모드 데드밴드 감쇠의 하한(m). 경로 투영은 정확도와 무관하게 몇 미터씩
    /// 흔들리므로, 이보다 작은 잔여 거리 변화는 이동이 아니라 투영 지터로 본다.
    private static let detailDeadBandFloor = 5.0

    /// 수단별 물리 상한(정지 판정 폴백의 산출 속도 가드 + 투영 점프 가드).
    private var maxSpeedMps: Double {
        sessionKind == .car ? MotionConstants.maxCarSpeedMps : MotionConstants.maxWalkSpeedMps
    }

    /// 수단별 closer 최소 간격. 차량은 데드밴드를 매 fix 넘어 2초 창에 매번 걸린다
    /// (30분 주행에 약 900회).
    private var closerIntervalSeconds: Double {
        sessionKind == .car
            ? ToneLayerConstants.carCloserIntervalSeconds
            : ToneLayerConstants.walkCloserIntervalSeconds
    }

    /// 이 fix의 이동 상태(양 모드 공용).
    ///
    /// ⚠ **신선하지 않은 fix는 판정에 넣지 않는다**(코드 리뷰 2026-08-08). 캐시 좌표가
    /// 현재 위치 근처면(마지막 알려진 위치라 흔하다) 산출 속도가 0에 가까워 **걷는 중에
    /// 거짓 정지**가 난다. 표본 시각이 측정 시각이 아니라 수신 시각이라 dt도 실제 간격이
    /// 아니어서 폴백 상·하한이 제 역할을 못 한다. 낡은 표본은 기준으로도 두지 않는다.
    private func judgeMotion(
        fix: LocationService.BeaconFixPayload, ageSeconds: Double, now: Double
    ) -> MotionState {
        guard abs(ageSeconds) <= BeaconConstants.freshnessWindow else { return .speedUnknown }
        let out = motionStep(
            state: motionState,
            sample: MotionSample(lat: fix.lat, lng: fix.lng, accuracy: fix.accuracy, at: now),
            speed: fix.speed,
            speedAccuracy: fix.speedAccuracy,
            maxSpeedMps: maxSpeedMps
        )
        motionState = out.state
        return out.motion
    }

    /// 지금 도착 상태인가. 간략은 리듀서의 존 래치가 정본이고, 상세는 `arrived`
    /// 이벤트가 세션을 끝내는 축이라 여기서 주장하지 않는다(스펙 §4.3 도착 판정 분리).
    private var arrivedNow: Bool { mode == .brief && beaconState.nearby }

    /// 톤 계층 통과 + 재생. 계층 순서·간격·재기준화는 Kit이 소유한다.
    private func routeTone(_ input: ToneLayerInput, now: Double) {
        let out = toneLayerStep(state: toneState, input: input, now: now)
        toneState = out.state
        if let tone = out.tone { playTone(tone) }
    }

    // MARK: - fix 처리

    private func handle(fix: LocationService.BeaconFixPayload) {
        guard isTracking, let dest else { return }
        let now = uptimeNow
        let age = Date().timeIntervalSince(fix.timestamp)
        let motion = judgeMotion(fix: fix, ageSeconds: age, now: now)

        // 경로 조회 대기·진행 중엔 발화를 보류한다(간략 첫 거리 → 곧바로 상세 시작의
        // 이중 발화 차단). 첫 **수용** fix가 조회 트리거이자 origin이다(8번). ⚠ 여기의
        // 술어는 `isUsableFix`(정확도 상한 없음)가 아니다 — 세션 시작 fix는 대개 그
        // 세션에서 가장 나쁜 fix라 그대로 쓰면 경로가 다른 곳에서 출발한다(A18,
        // 2026-08-16 실보행 115m). 미달 fix는 최선값으로 보관하고 대기 상한에 쓴다.
        if awaitingRoute {
            lastFixAt = now
            // 세션 안전망의 진행 관측은 조회 대기 중에도 센다 — 대기가 길어지는 동안 걷고
            // 있는 사용자를 "정지"로 읽지 않게(리뷰 INFO 2026-08-26).
            noteSessionProgress(lat: fix.lat, lng: fix.lng, now: now)
            if routeFetchTask == nil {
                let candidate = RouteOriginFix(
                    lat: fix.lat, lng: fix.lng, accuracy: fix.accuracy, ageSeconds: age
                )
                switch routeOriginStep(best: routeOriginBest, fix: candidate) {
                case .fetch(let origin):
                    fixWaitTask?.cancel()
                    fixWaitTask = nil
                    startRouteFetch(origin: origin, reason: "accepted", dest: dest, token: routeFetchToken)
                case .wait(let best):
                    if best != routeOriginBest { routeOriginBestAt = now }
                    routeOriginBest = best
                    // 대기 동안 버린 fix도 남긴다 — "정확한 fix를 기다리는 침묵"이
                    // 얼마나 긴지, 정확도가 어떻게 수렴하는지가 상수 판정의 근거다
                    // (상한 15초라 부피는 유한).
                    guideDiagLog(
                        "routeOriginWait acc=\(String(format: "%.1f", fix.accuracy)) "
                            + "age=\(String(format: "%.1f", age)) "
                            + "best=\(best.map { String(format: "%.1f", $0.accuracy) } ?? "-")"
                    )
                }
            }
            return
        }
        // 최종 접근은 모드보다 앞이다 — 이 국면의 발화 소유자는 이 층 하나뿐이라
        // 경로 리듀서도 비콘 리듀서도 이 fix를 보지 않는다(§3.0 소유권 계약).
        if inFinalApproach {
            handleFinalApproach(fix: fix, motion: motion, age: age, now: now)
            return
        }
        if mode == .detail, let route = guideRoute {
            handleDetail(fix: fix, route: route, motion: motion, age: age, now: now)
            return
        }
        // 간략 경로 계측(spec 2026-08-31 §5): 거부되는 fix까지 fix당 1줄. 종전엔 이 경로가 무계측이라
        // 08-29 자동차 세션이 진입 뒤 몇 시간을 산 채로도 로그 0줄이었다. `nearby`는 이 fix 처리 전 값.
        let usable = isUsableFix(accuracy: fix.accuracy, ageSeconds: age)
        guideDiagLog(
            "brief t=\(String(format: "%.1f", now)) "
                + "lat=\(String(format: "%.6f", fix.lat)) lng=\(String(format: "%.6f", fix.lng)) "
                + "acc=\(String(format: "%.1f", fix.accuracy)) motion=\(motion) "
                + "age=\(String(format: "%.1f", age)) usable=\(usable) "
                + "dist=\(String(format: "%.1f", haversineMeters(lat1: fix.lat, lng1: fix.lng, lat2: dest.lat, lng2: dest.lng))) "
                + "nearby=\(beaconState.nearby)"
        )
        // 캐시 위치와 무효 좌표는 앵커에서 배제한다(판정은 Kit 순수 함수). ⚠ 종전에는
        // 여기서 조용히 버렸는데, 그 침묵도 커버리지 대상이다 — 워치독(8초)이 잡기
        // 전까지의 공백을 신뢰 불가 톤이 메운다.
        guard usable else {
            routeTone(
                ToneLayerInput(unreliable: true, arrived: arrivedNow), now: now
            )
            return
        }

        lastFixAt = now
        lastStaleNoticeAt = nil
        lastFixCoord = (fix.lat, fix.lng)
        lastFixCoordAt = now
        noteSessionProgress(lat: fix.lat, lng: fix.lng, now: now)
        // 간략 모드 띠바 거리 = 직선 거리(경로가 없다).
        updateBandDistance(Int(haversineMeters(lat1: fix.lat, lng1: fix.lng, lat2: dest.lat, lng2: dest.lng).rounded()))

        let stepped = beaconStep(
            state: beaconState,
            fix: BeaconFix(lat: fix.lat, lng: fix.lng, accuracy: fix.accuracy),
            dest: dest
        )
        beaconState = stepped.state

        // 도착 창(간략, spec 2026-09-02 §2.2): 자격은 Kit 리듀서(래치 ∧ 정확도 ≤ 30m)가 정하고 여기는
        // 그 결과로만 에피소드 상태를 만진다. 자격 없는 fix는 "무시"가 아니라 "창 밖"이라 이탈이 상태를
        // 지운다 — 무시하면 두절 축이 그 fix들을 건너뛰고 계속 센다. 창 진입 순간의 재초기화가
        // 불변식이라, 래치가 다른 경로로 초기화돼 이탈 로그 없이 남은 상태도 다음 진입이 덮는다.
        let window = briefArrivalWindowStep(
            active: briefWindowActive, nearby: stepped.state.nearby, accuracy: fix.accuracy
        )
        let straightDistance = stepped.announce.distance
        if window.entered {
            resetArrivalWindow()
            arrivalWindowEnteredAt = now
            lastUsableDistanceToDest = straightDistance
            guideDiagLog(
                "arrivalWindowEnter mode=brief dist=\(String(format: "%.1f", straightDistance)) "
                    + "acc=\(String(format: "%.1f", fix.accuracy))"
            )
        } else if window.exited {
            guideDiagLog("arrivalWindowExit reason=\(stepped.state.nearby ? "accuracy" : "released")")
            resetArrivalWindow()
        }
        briefWindowActive = window.active
        if window.active {
            // 최종 접근 `handleFinalApproach`와 같은 갱신: 거리 캡 입력 + 앵커 기준 누적 변위.
            lastUsableDistanceToDest = straightDistance
            let anchorStep = advanceProgressAnchor(
                anchor: progressAnchor, fix: RoutePoint(lat: fix.lat, lng: fix.lng)
            )
            progressAnchor = anchorStep.anchor
            if anchorStep.progressed { lastProgressAt = now }
        }

        let gated = beaconGateStep(state: gateState, announce: stepped.announce)
        gateState = gated.state

        // 톤 계층 입력 조립(간략 3단계: 신뢰 불가 → 도착 → 추세).
        let weak = stepped.announce.kind == .weak
        routeTone(
            ToneLayerInput(
                unreliable: weak,
                priorityTone: gated.nearbyTone ? .nearby : nil,
                trend: weak
                    ? nil
                    : TrendInput(
                        distance: stepped.announce.distance,
                        deadBand: max(BeaconConstants.baseDeadBand, fix.accuracy),
                        // 감쇠 하한은 그 fix의 정확도다 — 정확도보다 작은 변화는
                        // 아무리 오래 기다려도 추세가 아니라 지터다.
                        deadBandFloor: fix.accuracy,
                        motion: motion,
                        closerIntervalSeconds: closerIntervalSeconds
                    ),
                arrived: beaconState.nearby
            ),
            now: now
        )
        if let notice = gated.notice {
            let text = self.text(for: notice)
            statusText = text
            // 반복 버튼 대상은 거리 통지만(weak는 상태라 제외, 스펙 §4.2).
            if case .weak = notice {} else { lastGuidance = text }
            if suppressNextNotice {
                suppressNextNotice = false  // 복귀 직후 1회만 삼킨다
            } else {
                announce(text, speechClass: beaconNoticeSpeechClass(notice))
            }
        }
        // 도착 추정(간략 창, stationary 모양) — 통지 처리 **뒤**. 창 진입 fix에서는 진행 기준이 0이라
        // 발동할 수 없고, 발동하는 fix의 비콘 통지는 hold(무발화)라 `.high` 도착 낭독과 겹치지 않는다.
        maybePresumeArrival(now: now)
    }

    // MARK: - 상세 모드 fix 처리·이벤트 배선 (판정은 전부 Kit guideStep)

    private func handleDetail(
        fix: LocationService.BeaconFixPayload, route: GuideRoute, motion: MotionState,
        age: Double, now: Double
    ) {
        guard let state = guideState else { return }
        // 캐시 fix만 거른다. 정확도 악화(50m 초과)는 버리지 않고 리듀서에 넘긴다 —
        // uncertain 전이(진입·회복 1회 통지)가 그 정보의 소비자다(스펙 §5.0).
        guard fix.accuracy > 0, age <= 10 else {
            // stale fix 폐기는 `lastFixAt`을 갱신하지 않으므로 워치독도 잡지만,
            // 발동(8초)까지의 공백을 여기서 메운다.
            routeTone(ToneLayerInput(unreliable: true), now: now)
            return
        }

        lastFixAt = now
        lastStaleNoticeAt = nil
        lastFixCoord = (fix.lat, fix.lng)
        lastFixCoordAt = now
        noteSessionProgress(lat: fix.lat, lng: fix.lng, now: now)

        // 방위 관측은 넘기지 않는다 — 리듀서 내부 유도기가 fix 이력에서 직접 만든다
        // (spec §2.9 재설계. 기기 course는 보행 속도에서 방위를 제공하지 않는다 —
        // 실사용 로그 courseAcc 중위 83°, §3.0.1).
        let out = guideStep(
            state: state,
            // 멈추면 침묵(E62 판정 3) — `.speedUnknown`은 정지가 아니다(E55 3-state).
            fix: GuideFix(lat: fix.lat, lng: fix.lng, accuracy: fix.accuracy, stopped: motion == .stopped),
            route: route,
            now: now,
            tuning: tuning
        )
        guideState = out.state
        // 돌아가기 국면의 상태 행 문장(E63) — 아래 하단 2행 갱신보다 먼저(같은 fix의 윗줄이 이 문장이어야 한다). 운전자 채널은
        // 현행 상태 전문, 보류는 말하지 않으므로 벗어난 쪽만(시계 11~1을 "돌아가세요"로 쓰지 않는다).
        if case let .offRoute(_, _, guidance, side, returnRelDeg, _) = out.event {
            offRouteLine = driverChannel
                ? appLocalized("guide.carOffRoute")
                : GuideText.offRoute(guidance: guidance, side: side, returnRelDeg: returnRelDeg, kind: sessionKind)
                    ?? GuideText.offRouteSide(side)
        }
        // 지난 임박 문장은 상태 행에 남기지 않는다(전경 복귀 재생이 지난 회전을 다시 읽는다, a11y 감사 M1).
        if let pending = imminentStatus, out.state.stepIndex >= pending.target {
            if statusText == pending.text { statusText = "" }
            imminentStatus = nil
        }
        // 하단 2행(spec 2026-08-11, car 확장 K2 §4): 이탈 복귀·재획득은 리듀서가 d를 재구성한
        // 지점이다 — 투영이 새 기준에 정렬됐으므로 램프인 기준점·클램프를 리셋한다.
        switch out.event {
        case .backOnRoute, .reacquired:
            liveBaselineD = out.state.d
            liveRowsState = nil
        default:
            break
        }
        // 매 fix 갱신 — 상태 국면(uncertain·offRoute)도 리듀서가 행을 소유한다.
        refreshLiveRows(state: out.state)
        if sessionKind == .car, out.state.phase == .following || out.state.phase == .bundle {
            // car "현재 도로" 행(E56) — 진행거리를 믿을 수 있는 국면에서만 옮긴다.
            refreshCurrentRoad(state: out.state)
        }

        let voteCounts = out.state.courseVotes.reduce(into: (mismatch: 0, match: 0, unknown: 0)) {
            switch $1.vote {
            case .mismatch: $0.mismatch += 1
            case .match: $0.match += 1
            case .unknown: $0.unknown += 1
            }
        }
        guideDiagLog(
            "fix t=\(String(format: "%.1f", now)) "
                + "lat=\(String(format: "%.6f", fix.lat)) lng=\(String(format: "%.6f", fix.lng)) "
                + "acc=\(String(format: "%.1f", fix.accuracy)) "
                + "course=\(String(format: "%.1f", fix.course)) "
                + "courseAcc=\(String(format: "%.1f", fix.courseAccuracy)) "
                + "speed=\(String(format: "%.2f", fix.speed)) "
                + "speedAcc=\(String(format: "%.2f", fix.speedAccuracy)) "
                + "motion=\(motion) age=\(String(format: "%.1f", age)) "
                + "phase=\(out.state.phase) d=\(String(format: "%.1f", out.state.d)) "
                + "event=\(out.event.map { "\($0)" } ?? "-")"
                // A18 2선(심층 방어)의 근거 축 — 첫 fix가 창 끝에 걸렸는지(edgeHits)와
                // 수직거리(perp). 세션 시작 직후 이 둘이 함께 크면 경로가 내 위치와
                // 안 맞는 신호인데, 다음 fix에서 카운터가 0으로 돌아가 증거가 스스로
                // 지워진다. 자동 재조회는 실보행 값 없이 임계를 못 정하니 로그만 남긴다.
                + " perp=\(out.perpMeters.map { String(format: "%.1f", $0) } ?? "-")"
                + " edgeHits=\(out.state.windowEdgeHits)"
                // ⚠ 판정 결과를 남기는 것이 이 로그의 핵심이다. 실보행에서 "왜 안
                // 잡혔나"·"왜 헛경고가 났나"를 위 원시값과 함께 되짚어야 파라미터를
                // 정할 수 있다(spec §7 3단계). 기기 course·courseAcc 원시 필드는 위에
                // 그대로 남긴다 — 유도 방위와 기기 방위를 같은 로그에서 대조하는 것이
                // 다음 검증 보행의 분석 축이다.
                + " derived=\(out.derivedCourse.map { String(format: "%.1f±%.1f", $0.bearing, $0.uncertaintyDeg) } ?? "-")"
                + " perp=\(out.perpMeters.map { String(format: "%.1f", $0) } ?? "-")"
                + " vote=\(out.courseVote?.rawValue ?? "-")"
                + " axes=d:\(out.state.offRouteAxes.distance)/c:\(out.state.offRouteAxes.course)"
                // ⚠ 표 개수만으로는 "표가 없어서 unknown"과 "회색지대라서 unknown"이
                // 구분되지 않는다. 창의 분포를 그대로 남긴다 — 이 구분이 §6 상수를
                // 정하는 핵심 질문이다.
                + " votes=m:\(voteCounts.mismatch)/k:\(voteCounts.match)/u:\(voteCounts.unknown)"
                + " verdict=\(courseAxisVerdict(out.state.courseVotes).rawValue)"
                // 돌아가기 국면 계측(E63 spec §6): 부호 있는 수직(오른쪽 +, following은 구속 창·돌아가기는 확정 지점 창),
                // 돌아가기 상태(최솟값/연속 수/복귀 후보 초), 접근 표 제외.
                + " sperp=\(out.signedPerpMeters.map { String(format: "%.1f", $0) } ?? "-")"
                + " ret=\(out.state.phase == .offRoute ? returnDiag(out.state, lat: fix.lat, lng: fix.lng, now: now) : "-")"
                + (out.approachExcluded == true ? " appr=1" : "")
        )

        // 최종 접근 진입은 **톤 조립 앞에서** 갈라진다. 이 fix의 소유권이 통째로
        // 넘어가므로 상세 톤 입력을 조립하면 안 된다 — `routeTone`은 톤 상태를 전진시켜서
        // 한 fix에 두 번 부르면 전이가 두 번 일어난다.
        //
        // 투영 점프 판정은 리듀서 소유다(A10 — `GuideTuning.maxSpeedMps` 주석). 튄 fix의
        // 진입 확정은 리듀서가 6b에서 이미 한 fix 미뤘으므로 여기서 사후 거부하지 않는다 —
        // 종전의 커밋 후 거부는 phase만 finalApproach로 잠긴 세션 영구 정지를 만들었다
        // (2026-08-11 하교 실사고: 잔여 4m 동결·도착 무통지).
        let remaining = max(0, route.totalMeters - out.state.d)
        let jumped = out.projectionJumped == true
        if case .finalApproachEnter = out.event {
            beginFinalApproach()
            // 진입이 소유권을 넘겼으면 **같은 fix로** 첫 발화를 낸다. 다음 fix를
            // 기다리면 종점에 선 채 수 초 침묵하고, 그 침묵이 이번에 고치려는 증상이다.
            if inFinalApproach {
                handleFinalApproach(fix: fix, motion: motion, age: age, now: now)
            }
            return
        }
        updateRemaining(route: route, state: out.state)

        // 톤 계층 입력 조립(상세 4단계). ⚠ 종전의 "무이벤트 fix마다 3초 tick 하트비트"는
        // 폐기됐다 — 같은 소리가 간략에서는 정체를 뜻해 한 소리에 두 뜻이 있었다.
        // 그 자리를 추세 축이 대신하므로 별도 중재가 필요 없다.
        let phase = out.state.phase
        // 추세 축은 정상 추종에서만 유효하다. 이탈 중 잔여 거리는 낡은 투영이라
        // 추세로 읽으면 거짓이고, 투영이 튄 fix도 버린다.
        let trendable = (phase == .following || phase == .bundle) && !jumped
        routeTone(
            ToneLayerInput(
                unreliable: phase == .uncertain || phase == .reacquiring,
                priorityTone: out.tone.map(BeaconTone.init(guide:)),
                eventOwned: out.event != nil,
                trend: trendable
                    ? TrendInput(
                        distance: remaining,
                        deadBand: Self.detailDeadBand,
                        // 상세는 정확도 축이 아니라 투영 안정성 축이라 고정 하한을 쓴다.
                        deadBandFloor: Self.detailDeadBandFloor,
                        motion: motion,
                        closerIntervalSeconds: closerIntervalSeconds
                    )
                    : nil
            ),
            now: now
        )
        guard let event = out.event else {
            syncStatusTextWithPhase(out.state.phase)
            return
        }
        consume(event: event, route: route, prev: state, signedPerp: out.signedPerpMeters, now: now)
    }

    /// 이벤트 없이 **국면만** 바뀐 fix의 상태 텍스트를 되돌린다(백로그 D12).
    ///
    /// 왜 필요한가: `statusText`는 이벤트 소비 시점에만 대입되는 **래치**다. 재획득
    /// 국면에서 위치는 되찾았는데 방위가 확인되지 않으면 리듀서가 국면을 `.offRoute`로
    /// 되돌리면서 **이벤트는 내지 않는다**(이탈은 이미 통지한 상태라 재통지가 아니라는
    /// 판정이며 그 판정은 옳다). 그 결과 `offRoute` 플래그와 재조회 버튼은 정확한데
    /// 화면·복귀 재생만 "현재 위치를 다시 파악하는 중"에 머문다 — walk 기준 최대 60초.
    ///
    /// ⚠ **통지하지 않는다.** 이벤트가 없다는 것은 새로 알릴 일이 없다는 뜻이고, 여기서
    /// 발화하면 이탈 재통지 주기(60초)를 우회해 fix마다 같은 문장을 말한다.
    /// ⚠ 되돌리는 것은 **재획득 문구일 때뿐**이다. 다른 문구는 그 자리의 최신 사실이다.
    private func syncStatusTextWithPhase(_ phase: GuidePhase) {
        guard phase == .offRoute, statusText == appLocalized("guide.reacquiring") else { return }
        statusText = offRouteLine ?? appLocalized(sessionKind == .car ? "guide.carOffRoute" : "guide.offRoute")
    }

    // MARK: - 최종 접근 (spec 2026-08-08 §3.3·§3.4·§4)

    /// 세션의 최종 접근 상태를 새 경로 기준으로 되돌린다(시작·재조회 공용).
    /// 도착 창 에피소드 소거(両창 공용). 경로 커밋·재획득·`stop()`은 `resetFinalApproach` 경유, 간략
    /// 인계·간략 강등·래치 초기화는 직접 부른다 — 옛 에피소드의 타임스탬프가 새 에피소드로 새면
    /// 조기 종료다(spec 2026-08-13 §4 상태 초기화 계약, 2026-09-02 §2.2로 간략 창까지).
    private func resetArrivalWindow() {
        briefWindowActive = false
        arrivalWindowEnteredAt = nil
        progressAnchor = nil
        lastProgressAt = nil
        lastUsableDistanceToDest = nil
    }

    private func resetFinalApproach(geometry: FinalApproachPayload?) {
        inFinalApproach = false
        finalApproachGeometry = geometry
        finalApproachIntroSpoken = false
        pendingFinalApproachIntro = nil
        lastFinalTickAt = nil
        resetArrivalWindow()
    }

    /// 진입 처리 — 플래그와 거리 축만 바꾸고 **말하지 않는다.** 첫 발화는
    /// `handleFinalApproach`가 같은 fix로 내며, 그래야 "도착이 진입 서술을 이긴다"가
    /// 한 곳에서 성립한다(두 군데서 말하면 목적지 코앞에서 배치 서술과 도착 통지가 겹친다).
    private func beginFinalApproach() {
        // 자동 재조회의 트리거·채택은 최종 접근 진입 전에만 성립한다(spec §6 활성
        // 조건, spec 리뷰 MAJOR 2026-08-12). 여기서 토큰을 올리면 진행 중 조회의
        // 채택이 막혀 그 조건이 이 한 줄로 성립한다(진입 후 새 트리거는
        // maybeFetchProposal 가드 몫).
        clearProposal()
        resetAlternativePreview()
        remainingText = nil  // 경로 잔여는 이 국면에서 의미가 없다(이미 종점을 지났다)
        currentRoadText = nil  // 스텝은 전부 소화됐다 — 남은 것은 직선 안내뿐
        // 하단 2행: 윗줄 소유권이 최종 접근 층으로 넘어간다(§4.2 우선순위 2).
        // 아랫줄은 비운다 — 스텝 예고는 전부 소화됐다. 윗줄은 같은 fix의 진입
        // 서술(handleFinalApproach)이 즉시 채운다.
        clearLiveRows()
        etaTask?.cancel()
        etaTask = nil
        rebaseForAxisChange()  // 경로 거리 → 직선거리(축 전환, handoff와 같은 규칙)
        // ⚠ 오프셋이 하한 미만이면(`tooClose`) 종점 도달이 곧 목적지 도착이라 최종
        //   접근을 건너뛴다(§3.2). 말할 배치가 없는데 진입 서술을 내면 "약 8미터"
        //   다음에 곧바로 도착이 붙어 잉여다.
        // 기하가 없거나 너무 가까우면(도보 구버전 응답·tooClose) 말할 배치 정보가 없다.
        // 도보는 종전 인계 그대로 간략(비콘)으로 넘겨 거리 추적만 남긴다 — 침묵보다 낫다.
        // 자동차는 기하 없이도 국면에 들어간다(`GuideTuning.entersFinalApproachWithoutGeometry`,
        // spec 2026-08-31 §2): 자동차 라우트는 기하를 싣지 않아 이 분기가 곧 `carArrivalStep`
        // 도달 불가였다(K2-a 실사고 — 세션이 새벽까지 살아 있었다). 진입 서술은 기하가 있어야
        // 성립하므로 아래 handleFinalApproach의 서술 분기가 nil 기하에서 스스로 건너뛴다.
        let usableGeometry = finalApproachGeometry.flatMap { $0.unavailableReason == .tooClose ? nil : $0 }
        guard usableGeometry != nil || tuning.entersFinalApproachWithoutGeometry else {
            guideDiagLog("briefHandoff reason=\(finalApproachGeometry == nil ? "noGeometry" : "tooClose")")
            resetArrivalWindow()  // 간략 창은 다음 usable fix가 Kit 리듀서로 연다(spec 2026-09-02 §2.2)
            mode = .brief
            let text = appLocalized("guide.handoff")
            statusText = text
            announce(text, speechClass: .actionable)
            return
        }
        // tooClose 기하는 "없음"으로 정규화한다 — 진입 서술 분기가 `let geometry`로 읽으므로
        // 남겨 두면 말할 배치가 없는 기하로 서술이 나간다(spec-compliance 리뷰 #3).
        finalApproachGeometry = usableGeometry
        inFinalApproach = true
        finalApproachIntroSpoken = false
        lastFinalTickAt = nil
        resetArrivalWindow()
        arrivalWindowEnteredAt = uptimeNow
        // 진입 fix가 곧 마지막 usable fix일 수 있다(2026-08-13 실사고가 정확히 그
        // 모양) — 거리 캡 입력을 진입 시점 좌표로 미리 세운다. 이후 usable fix마다
        // handleFinalApproach가 갱신한다.
        if let c = lastFixCoord, let dest {
            lastUsableDistanceToDest = haversineMeters(
                lat1: c.lat, lng1: c.lng, lat2: dest.lat, lng2: dest.lng
            )
        }
        guideDiagLog("finalEnter offset=\(usableGeometry.map { String(format: "%.1f", $0.offsetMeters) } ?? "-")")
    }

    /// 최종 접근 fix 처리(§3.4). **거리는 항상 현재 fix → 목적지 직선거리**다 —
    /// 진입 서술의 `offsetMeters`는 그 문장에서만 쓰고 이후 재사용하지 않는다.
    ///
    /// ⚠ **시간 상한을 두지 않는다.** 초판의 2분 상한은 오프셋 89m·저속 보행에서 정작
    /// 마지막 15m 직전에 루프를 껐다. 종료 조건은 거리(도착)와 사용자의 중지뿐이다.
    ///
    /// ⚠ 비콘 리듀서를 돌리지 않는다. 그 리듀서가 만드는 것은 발화와 `nearby` 플래그인데
    /// 여기서는 발화 소유권이 이 층에 있고 도착 판정도 이 층이 직접 한다 — 결과를 버릴
    /// 리듀서를 돌리는 것은 지연만 늘린다. 추세 톤은 같은 직선거리로 직접 조립한다.
    private func handleFinalApproach(
        fix: LocationService.BeaconFixPayload, motion: MotionState, age: Double, now: Double
    ) {
        guard let dest else { return }
        // 신뢰 불가 fix에서는 거리·방향을 말하지 않는다(unreliable 최우선 불변식 유지).
        // 주기 시각도 갱신하지 않는다 — 정지·유지이지 리셋이 아니다(§4).
        guard isUsableFix(accuracy: fix.accuracy, ageSeconds: age) else {
            routeTone(ToneLayerInput(unreliable: true), now: now)
            return
        }
        lastFixAt = now
        lastStaleNoticeAt = nil
        lastFixCoord = (fix.lat, fix.lng)
        lastFixCoordAt = now
        noteSessionProgress(lat: fix.lat, lng: fix.lng, now: now)

        let distance = haversineMeters(
            lat1: fix.lat, lng1: fix.lng, lat2: dest.lat, lng2: dest.lng
        )
        // 도착 추정 입력 갱신(spec 2026-08-13 §4): 거리 캡은 마지막 usable fix 기준,
        // 진행은 앵커 기준 누적 변위(직전 fix 비교 금지 — 저속 연속 보행 오판).
        lastUsableDistanceToDest = distance
        updateBandDistance(Int(distance.rounded()))
        let anchorStep = advanceProgressAnchor(
            anchor: progressAnchor, fix: RoutePoint(lat: fix.lat, lng: fix.lng)
        )
        progressAnchor = anchorStep.anchor
        if anchorStep.progressed { lastProgressAt = now }
        // 자동차는 "부근 정차"가 도착이다(K2 §6.4, 위원장 판정 ④ — 40m·정지·정확도≤30, 15m 무조건 분기 없음).
        let arrived = sessionKind == .car
            ? carArrivalStep(distance: distance, accuracy: fix.accuracy, motion: motion)
            : distance <= finalApproachArriveMeters
        // 도착 종·진동이 안 난다는 실사용 보고(2026-08-09)의 판정 근거. 원인 후보가
        // 둘인데(도착 판정 자체가 안 옴 vs 판정은 왔는데 소리가 잘림) 증상이 같아
        // 로그 없이는 갈리지 않는다 — 이 줄이 그 갈림을 남긴다.
        guideDiagLog(
            "final t=\(String(format: "%.1f", now)) "
                + "dist=\(String(format: "%.1f", distance)) "
                + "acc=\(String(format: "%.1f", fix.accuracy)) "
                + "arrived=\(arrived) introSpoken=\(finalApproachIntroSpoken)"
        )
        routeTone(
            ToneLayerInput(
                trend: TrendInput(
                    distance: distance,
                    deadBand: max(BeaconConstants.baseDeadBand, fix.accuracy),
                    // 감쇠 하한은 그 fix의 정확도다 — 정확도보다 작은 변화는 지터다.
                    deadBandFloor: fix.accuracy,
                    motion: motion,
                    closerIntervalSeconds: closerIntervalSeconds
                ),
                arrived: arrived
            ),
            now: now
        )

        // ⚠ **진입 배치 서술이 도착보다 앞이다.** 뒤에 두면 오프셋 10~15m 구간에서
        //   진입 fix가 이미 도착 반경 안이라 배치 서술이 한 번도 나가지 않은 채 세션이
        //   끝난다 — 방향을 못 들은 채 "도착했습니다"만 듣는 것이 이번 작업이 고치려던
        //   증상 그 자체다(독립 리뷰 검출). 도착은 다음 fix가 낸다.
        //   1회뿐인 발화라 억제되면 보관했다가 전경 복귀 때 갚는다(§4).
        if !finalApproachIntroSpoken, let geometry = finalApproachGeometry {
            finalApproachIntroSpoken = true
            lastFinalTickAt = now
            let text = GuideText.finalApproachEnter(
                destination: destinationLabel, geometry: geometry, accuracy: fix.accuracy
            )
            statusText = text
            lastGuidance = text
            liveTopText = text  // 하단 2행 윗줄 = 기존 최종 접근 문형(§4.2 우선순위 2)
            resultHaptic(.attention)  // 국면 진입 1회(E30 확장) — 이후 틱은 진동 없음
            announce(text, speechClass: .actionable) { [weak self] in self?.pendingFinalApproachIntro = text }
            return
        }

        if arrived {
            // prewalk(승차 전 도보)는 stop() 앞에서 캡처 — stop()이 지운다(A25 §4.2).
            let prewalk = prewalkTarget
            let text = prewalk.map {
                TransitGuideTextRenderer.render(
                    transitPrewalkArrivedLine(isEn: transitGuideIsEn, station: $0))
            } ?? appLocalized("guide.arrived")
            // 수단은 stop() **앞**에서 기록한다 — stop()이 sessionKind를 walk로 되돌린다(설계 리뷰 B10).
            arrivalSessionKind = sessionKind
            playTone(.nearby)
            pendingEndReason = .arrived
            stop()  // ⚠ dest·statusText를 지우므로 문장은 위에서 미리 만든다
            if prewalk == nil {
                // stop() **뒤에** 대입 — 이 값이 시트를 도착 종료 화면으로 유지한다
                // (presentation 바인딩이 `isTracking || arrivalDest != nil`을 본다).
                // `dest`는 함수 머리의 guard let 지역 사본이라 stop()의 소거와 무관하다.
                // prewalk는 종료 화면을 남기지 않는다 — 승차역은 여정의 끝이 아니고, 남기면
                // `screen`의 비콘 우선순위가 대중교통 시트를 영구 은폐한다.
                arrivalDest = dest
                endKind = .arrived
                loadArrivalHealth()
            } else {
                arrivalSessionKind = nil
            }
            statusText = text
            lastGuidance = text
            liveTopText = text  // 시트 dismiss 동안의 가시 상태(statusText 동형)
            announce(text, highPriority: true, speechClass: .actionable)
            return
        }

        // 확정 도착이 항상 이긴다 — 추정(.stationary 모양)은 확정 판정이 지나간
        // 뒤에만 본다(spec 2026-08-13 §4).
        if maybePresumeArrival(now: now) { return }

        // 진입 서술이 있으면 그것이 `lastFinalTickAt`을 세우고 위에서 돌아갔으므로 여기는 서술
        // 15초 뒤부터다(도보 동작 불변). 서술이 없는 진입(자동차, 기하 없음)은 nil이라 진입 fix에서
        // 곧바로 첫 통지가 난다 — 15초 침묵은 시속 36km면 150m, 국면 전체가 무음이 된다(spec 2026-08-31 §2).
        if let last = lastFinalTickAt, now - last < finalApproachIntervalSeconds { return }
        lastFinalTickAt = now
        let text = GuideText.finalApproachTick(
            distance: distance,
            direction: liveDirection(fix: fix, dest: dest, motion: motion, age: age),
            accuracy: fix.accuracy
        )
        statusText = text
        lastGuidance = text
        liveTopText = text
        announce(text, speechClass: .deferrable)
    }

    /// 도착 추정 자동 종료(spec 2026-08-13 §4) — 자동 종료의 유일한 추가 경로.
    /// 세션 안전망의 진행 관측(매 usable fix, 국면 무관). 앵커 기준 누적 변위 25m —
    /// 도착 추정의 10m 앵커와 별도인 이유는 실내 wifi 지터가 그 축을 20분 내내 "이동"으로
    /// 읽으면 안전망이 영영 안 열리기 때문이다.
    private func noteSessionProgress(lat: Double, lng: Double, now: Double) {
        let step = advanceProgressAnchor(
            anchor: sessionProgressAnchor, fix: RoutePoint(lat: lat, lng: lng),
            epsilonMeters: sessionProgressEpsilonMeters
        )
        sessionProgressAnchor = step.anchor
        if step.progressed { sessionLastProgressAt = now }
    }

    /// 국면 무관 세션 안전망(2026-08-26 위원장 실사용 — 출근 도보 안내를 끄지 않아 몇 시간이고
    /// 켜져 있었다). 도착 추정은 최종 접근 국면에 들어간 세션만 정리하므로 그 문을 못 지난
    /// 세션(GPS 두절·이탈 상태로 종점 접근·150m 밖 실내 진입·정확도 30~100m로 목적지 근처에 멈춘 간략
    /// 세션)은 이 축만이 끝낸다. 간략 강등 세션 자체는 2026-09-02 A31부터 도착 창으로 끝날 수 있다.
    /// 자동차는 두절 축만이다(`GuideTuning.sessionIdleStationaryAxis`, spec 2026-08-31 §4) — 무이동은
    /// 정체·휴게소 정차와 구분할 수 없다. 워치독이 유일한 도달 경로다(noFix는 fix가 안 와서 fix 경로에
    /// 걸 수 없다). true = 끝냈다.
    @discardableResult
    private func maybeEndIdleSession(now: Double) -> Bool {
        // 승차 전 도보(prewalk)는 제외 — fix 두절 5분은 대개 지하 역사 진입이고, 그때 끝내면 바로
        // 그 경우를 위한 "승차역 도착" 선언 버튼까지 사라진다(A25 spec §2).
        guard isTracking, prewalkTarget == nil, let startedAt else { return false }
        let fixRef = max(startedAt, lastFixAt ?? startedAt)
        let progressRef = max(startedAt, sessionLastProgressAt ?? startedAt)
        // 무이동 축은 **도착 추정이 발동할 수 있는 동안 늦게 켠다**(Kit `sessionIdleStationaryElapsed`, 나들이 spec §9,
        // 2026-09-26). 무이동 300초가 도착 추정 제자리 300초와 같아서 그대로면 25m 앵커 시계가 10m 앵커 시계보다
        // 먼저 차 목적지 앞에 선 사용자가 추정 도착 대신 안전망 종료를 듣고, 아예 끄면 실내 wifi 지터가 10m 앵커를
        // 계속 밀어 두 판정 모두 영영 끝나지 않는다. "발동할 수 있다" = 도착 창 ∧ 마지막 확인 거리가 거리 캡 안.
        // 두절 축은 그대로(도착 추정 두절이 안전망 두절보다 짧아 도착 추정이 먼저 판정한다).
        let presumedArrivalCanFire = inArrivalWindow
            && (tuning.presumedArrival.map { (lastUsableDistanceToDest ?? .infinity) <= $0.maxDistanceMeters } ?? false)
        guard let reason = sessionIdleStep(
            secondsSinceUsableFix: now - fixRef,
            secondsSinceProgress: tuning.sessionIdleStationaryAxis
                ? sessionIdleStationaryElapsed(
                    secondsSinceProgress: now - progressRef, presumedArrivalCanFire: presumedArrivalCanFire)
                : nil,
            // 두절 임계는 수단별 데이터(walk 300 · car 900, 2026-10-03 위원장 판정).
            noFixSeconds: tuning.sessionIdleNoFixSeconds
        ) else { return false }
        guideDiagLog("sessionIdleEnd reason=\(reason.rawValue)")
        let text = appLocalized("guide.endedIdle")
        // 종료 화면(요약)은 사용자 중지와 같은 모양으로 남긴다. 정지 톤은 전경에서만 —
        // 잠근 채 잊은 휴대전화가 한참 뒤 울리면 당황스럽다(도착 추정 동형).
        stopLeavingSummary(playStopTone: isForeground, text: text)
        statusText = text
        lastGuidance = text
        liveTopText = text
        announce(text, highPriority: true, speechClass: .deferrable)
        return true
    }

    /// 판정은 순수 함수가, 실행은 확정 도착(handleFinalApproach의 arrived)과 같은
    /// 모양이 맡는다(문구만 분리). true = 세션을 끝냈다.
    ///
    /// 백그라운드면 announce가 missedAnnouncement만 세우고 떨어지는데, 전경 복귀
    /// 상환(handleScenePhaseChange)이 추적 가드보다 앞이라 stop() 뒤에도 statusText
    /// 꼬리로 갚아진다 — statusText 대입이 stop() 뒤인 것이 그 전제다(설계 리뷰 M7).
    @discardableResult
    private func maybePresumeArrival(now: Double) -> Bool {
        // 국면 게이트는 **도착 창**(최종 접근 국면 ∨ 간략 근처 창, spec 2026-09-02 §2) — 간략 창은 새
        // 종료 경로가 아니라 이 함수의 게이트 확장이다. 두 창은 배타라 `window=` 로그가 갈린다.
        guard isTracking, inArrivalWindow, let thresholds = tuning.presumedArrival,
              let dest, let enteredAt = arrivalWindowEnteredAt
        else { return false }
        let fixRef = max(enteredAt, lastFixAt ?? enteredAt)
        let progressRef = max(enteredAt, lastProgressAt ?? enteredAt)
        guard let reason = presumedArrivalStep(
            inFinalApproach: true,
            secondsSinceUsableFix: now - fixRef,
            secondsSinceProgress: now - progressRef,
            lastKnownDistanceToDestMeters: lastUsableDistanceToDest,
            thresholds: thresholds
        ) else { return false }
        guideDiagLog(
            "presumedArrival reason=\(reason.rawValue) "
                + "dist=\(lastUsableDistanceToDest.map { String(format: "%.1f", $0) } ?? "-") "
                + "window=\(inFinalApproach ? "final" : "brief")"
        )
        let prewalk = prewalkTarget  // stop() 앞 캡처(A25 §4.2)
        let text = prewalk.map {
            TransitGuideTextRenderer.render(
                transitPrewalkArrivedLine(isEn: transitGuideIsEn, station: $0))
        } ?? appLocalized("guide.arrivedPresumed")
        // 도착 종은 **전경에서만**(위원장 판정 2026-08-19). 이 종료는 도착 3~5분 뒤에 오는
        // 사후 정리라, 잠근 채 두고 잊은 휴대전화가 한참 뒤 갑자기 울리면 당황스럽다 —
        // 확정 도착의 종(지금 도착 중이라는 실시간 신호)과 뜻이 다르다. 백그라운드 종료는
        // 무음이고, 복귀 시 도착 화면과 상환 낭독이 종료 사실을 알린다.
        if isForeground { playTone(.nearby) }
        // 자동차 추정 도착은 확정 도착과 같은 모양(종료 화면 + 도보 인계 버튼, spec 2026-08-31 §3.4)이라
        // 수단을 stop() **앞**에서 기록한다(B10 동형). 도보 경로는 대입을 지나지 않는다 — 종료 후
        // 상태가 종전과 같아야 한다(도보 동결).
        if sessionKind == .car { arrivalSessionKind = .car }
        pendingEndReason = .arrived
        stop()  // ⚠ dest·statusText를 지우므로 문장은 위에서 미리 만든다(확정 도착 동형)
        if prewalk == nil {
            arrivalDest = dest
            endKind = .presumed
            loadArrivalHealth()
        }
        statusText = text
        lastGuidance = text
        liveTopText = text
        // 사후 정리라 미룸(도착 3~5분 뒤, 종도 전경만). 단 승차 전 도보의 승차역 도착은 이어질 대중교통 안내의 시작이라
        // 행동 문장이다(spec §3.2 — prewalk 도착 행, 구현 리뷰 m-3).
        announce(text, highPriority: true, speechClass: prewalk == nil ? .deferrable : .actionable)
        return true
    }

    /// 도착 종료 화면의 걸음·칼로리 요약을 채운다(spec 2026-08-17 §3). 확정·추정 도착이
    /// `arrivalDest` 대입 직후 부르고, 전경 복귀가 `.failed`일 때 한 번 더 부른다. 라이브
    /// 누적이 있으면 동기 커밋, 없으면 사후 질의(커밋 조건은 세션 토큰 일치 AND 도착
    /// 화면이 아직 열려 있음). 도착 낭독 문장에는 넣지 않고, 값은 로그에 남기지 않는다.
    /// `.stopped` 종료는 여기가 아니라 `stopLeavingSummary`가 라이브 누적으로 판정한다.
    private func loadArrivalHealth() {
        // ⚠ 실제 `.car` 배제선은 `sessionStartedAt`(car면 nil)이다 — 두 도착 경로 모두 stop()이
        // sessionKind를 walk로 되돌린 뒤 여기 오므로 아래 sessionKind 검사는 항상 참이다.
        guard sessionKind == .walk, let start = sessionStartedAt, arrivalDest != nil else { return }
        guard arrivalHealthLoad == .idle || arrivalHealthLoad == .failed else { return }
        // 라이브 누적이 있으면 그것이 곧 답이다 — 동기 커밋이라 VO 착지 전에 행이 존재한다.
        // 사후 질의는 누적이 없을 때(권한 응답이 늦은 세션 등)의 폴백으로만 남는다.
        if let sample = liveHealthSample {
            commitArrivalHealth(sample)
            return
        }
        arrivalHealthLoad = .loading
        let token = arrivalSessionToken
        let requestedAt = ProcessInfo.processInfo.systemUptime
        arrivalHealthTask = Task { [weak self, pedometer] in
            let result = await pedometer.summary(from: start, to: Date())
            guard let self, !Task.isCancelled, self.arrivalSessionToken == token,
                  self.arrivalDest != nil else { return }
            switch result {
            case .sample(let steps, let distance):
                self.commitArrivalHealth((steps, distance))
            case .unavailable:
                self.arrivalHealthLoad = .unavailable
            case .failed:
                self.arrivalHealthLoad = .failed
            }
            let ms = Int((ProcessInfo.processInfo.systemUptime - requestedAt) * 1000)
            guideDiagLog("arrivalHealth load=\(self.arrivalHealthLoad) latencyMs=\(ms)")
        }
    }

    /// 표본 → 요약 행. `minMeaningfulDistanceMeters` 미만이면 행이 없다(`.negligible`,
    /// 도착·중지 공통 — 측정 성공·값 0은 3-state상 성공이지만 표시할 가치가 없다).
    private func commitArrivalHealth(_ sample: (steps: Int, distance: Double?)) {
        guard WalkHealth.isMeaningfulWalk(steps: sample.steps, distanceMeters: sample.distance) else {
            arrivalHealthLoad = .negligible
            return
        }
        arrivalHealthSample = sample
        arrivalHealth = WalkHealth.summary(
            steps: sample.steps, distanceMeters: sample.distance, weightKg: Self.storedWeight())
        arrivalHealthLoad = .loaded
    }

    private static func storedWeight() -> Double? {
        WalkHealth.normalizedWeight(
            UserDefaults.standard.object(forKey: WalkHealth.weightStorageKey) as? Double)
    }

    /// 도착 화면에서 설정 시트를 닫고 돌아왔을 때: 저장된 체중으로 같은 표본을 다시 계산한다.
    /// 표본이 없으면(미로드·실패) 아무것도 하지 않는다 — 없는 값을 만들어 내지 않는다.
    func recomputeArrivalHealth() {
        guard let sample = arrivalHealthSample else { return }
        arrivalHealth = WalkHealth.summary(
            steps: sample.steps, distanceMeters: sample.distance, weightKg: Self.storedWeight())
    }

    /// 실시간 상대 방향. 게이트를 통과하지 못하면 nil이고, 소비자는 방향 어절을
    /// 통째로 뺀다 — "모름"과 "실패"는 사용자 출력에서 같다(§3.5).
    ///
    /// ⚠ **어절이 아니라 열거형을 돌려준다.** 소비자마다 필요한 어휘가 맨몸("왼쪽")과
    /// 이동형("왼쪽으로")으로 갈리므로 어절 선택은 소비자가 진다.
    private func liveDirection(
        fix: LocationService.BeaconFixPayload, dest: BeaconDest,
        motion: MotionState, age: Double
    ) -> RelativeDirection? {
        guard case let .valid(course) = courseStep(
            course: fix.course, courseAccuracy: fix.courseAccuracy,
            speed: fix.speed, motion: motion, ageSeconds: age
        ) else { return nil }
        let toDest = bearingDegrees(
            fromLat: fix.lat, fromLng: fix.lng, toLat: dest.lat, toLng: dest.lng
        )
        let relative = (toDest - course + 540).truncatingRemainder(dividingBy: 360) - 180
        return relativeDirection(relative)
    }

    /// `prev`·`signedPerp`·`now`는 이탈 계측 로그(E63 spec §6) 재료다 — 판정에 쓰지 않는다.
    private func consume(event: GuideEvent, route: GuideRoute, prev: GuideState, signedPerp: Double?, now: Double) {
        // 문장 분류(E53 spec §3.2, 정본 Kit). 이탈은 "이 회차에 처음 말하는 문장"(`firstSpoken`)이 `.actionable`이다(E63 §3.4 —
        // 보류 뒤 첫 발화를 재통지로 분류하면 백그라운드에서 버려진다).
        let speechClass = guideEventSpeechClass(event)
        switch event {
        case let .announceSteps(indices, _), let .bundleReread(indices):
            if driverChannel {
                // 운전자 모드(K2 §6.2): 재통독은 내지 않고, 전문 대신 "{거리} 앞 {명령}" 단문.
                // 행동 없는 유닛(터널·직진 갈래)은 무발화 — 명령이 없는데 문장만 길다.
                if case .bundleReread = event { break }
                guard let gs = guideState,
                      let text = GuideText.driverNotice(route: route, indices: indices, fromD: gs.d)
                else { break }
                lastGuidance = text
                statusText = text
                announce(text, speechClass: speechClass)
                break
            }
            // 되읽기는 구간 안에서 다시 읽는 자리다 — 들어선 첫 스텝의 회전 문장을 뗀다(E62 문안 확정본).
            let text: String
            if case .bundleReread = event {
                text = GuideText.rereadUnit(route: route, indices: indices, liveSteps: liveSteps)
            } else {
                text = GuideText.unit(route: route, indices: indices)
            }
            // walk 전문은 결정 지점까지의 실위치 거리를 앞에 단다(위원장 판정 2026-10-03 — 직진 주기
            // 통지 다음에 "…에서 돌아"가 거리 없이 나오면 안내가 튄다). 재통독은 거리 없이 원문만.
            // ⚠ 거리 머리말은 그 순간에만 참이라 되읽기(`lastGuidance`·억제 복구)에는 원문을 둔다 —
            //   복귀·신호 불량 뒤에 "약 20m 앞"을 갚으면 지난 거리를 말한다.
            var spoken = text
            // ⚠ 늦은 전문(`late` — 실위치가 이미 첫 스텝에 들어섰다, E62 R4·R5)엔 머리말을 붙이지 않는다(구조 판정 —
            //   램프인 구간 산술로 가르면 "앞으로 약 5m 가다가"가 샌다).
            if case let .announceSteps(_, late) = event, !late, sessionKind == .walk, let gs = guideState,
               let first = indices.first, route.steps.indices.contains(first) {
                spoken = GuideText.announceAhead(
                    route: route, indices: indices,
                    meters: spokenRemainingMeters(route.steps[first].startD - gs.d, d: gs.d, baselineD: liveBaselineD)
                )
            }
            lastGuidance = text
            // 실행 안내 문장은 화면 행에 남기지 않는다(역할 분리 확정 2026-08-10 — 지금 할 일은
            // 하단 2행, car의 "현재 도로" 행은 도로 이름만, E56).
            // 상태 행은 **비운다** — 직전 예고("약 30m 앞 오른쪽으로…")를 남기면 이미
            // 돈 회전을 아직 남은 것처럼 읽는다. 다음 예고·임박·상태 신호가 다시 채운다.
            // ⚠ 여기서 화면 행을 쓰지 않는다(실보행 라운드1 정정) — 이 이벤트는 경계 30m 전
            //   선행 + 1회 래치라 "지금 구간"과 어긋난다. 행은 매 fix 상태 유도가 소유한다.
            // ⚠ 전경 복귀 재생의 "현재 상태" 폴백이 이 빈 값을 car의 하단 2행 윗줄(없으면
            //   "현재 도로" 행)로 대체한다(handleScenePhaseChange, walk엔 폴백이 없다).
            statusText = ""
            // 실행 안내는 억제 중이면 최신 1개를 보관해 해제 시 복구한다(스펙 §4.3).
            if outputSuppressed {
                pendingRecovery = text
                if case .announceSteps = event, let first = indices.first, route.steps.indices.contains(first) {
                    pendingRecoveryEntered = (
                        route.steps[first].startD,
                        GuideText.rereadUnit(route: route, indices: indices, liveSteps: liveSteps)
                    )
                } else {
                    pendingRecoveryEntered = nil
                }
            } else {
                announce(spoken, speechClass: speechClass)
            }
        case let .imminent(indices, action, stage):
            // 임박 큐(20m): 전문이 아니라 짧은 명령형이다. 전문은 30m에서 이미 나갔고,
            // 여기서 다시 읽으면 8초 안에 두 문장이 겹쳐 정작 행동 시점을 놓친다.
            //
            // 반복 단계(15·10m, 위원장 피드백 2026-08-26)는 소리·햅틱만이다 — 톤은 `out.tone`이
            // 이미 `routeTone`으로 흘렀고, 문장을 셋 다 내면 4초 안에 겹친다.
            if stage > 0 { break }
            //
            // ⚠ `lastGuidance`를 덮지 않는다. 이 값은 신호 불량 구간에서 "마지막으로
            //   들은 안내"로 되읽히는데, 그 자리에 "잠시 후 왼쪽으로 도세요"가 남으면
            //   무엇을 향한 회전이었는지가 사라진다.
            //
            // ⚠ 억제 중이어도 보관(`pendingRecovery`)하지 않는다. 이 문장은 그 임박
            //   구간에서만 참이라 나중에 갚으면 이미 지난 모퉁이를 돌라고 말한다.
            // 수단·청취자별 문구(K2 §6.3): walk "잠시 후 왼쪽으로 도세요" / car 동승자 "잠시 후
            // 우회전하세요" / car 운전자 명령 단어 "우회전".
            // walk 횡단 임박은 건너는 방향을 싣는다(E62 — 서버 `crossingClock`, 없으면 종전 문장).
            let clock = indices.first.flatMap { liveSteps.indices.contains($0) ? liveSteps[$0].crossingClock : nil }
            let text = sessionKind == .car
                ? (driverChannel
                    ? GuideText.carCommand(action)
                    // 지점·방면(E61)은 행동이 있는 그 결정 지점 스텝의 것.
                    : GuideText.carImminentText(
                        action, landmark: indices.first.flatMap { route.steps.indices.contains($0) ? route.steps[$0].carLandmark : nil }))
                : GuideText.imminentText(action, crossingClock: clock)
            statusText = text
            // 이 문장은 그 지점 앞에서만 참이다 — 그 스텝에 들어서면 상태 행에서 지운다(아래 `handleDetail`). 안 지우면
            // 횡단 중 침묵(E62) 동안 남아 전경 복귀 재생이 지난 회전을 "잠시 후 …"로 다시 읽는다(a11y 감사 M1).
            imminentStatus = indices.first.map { (target: $0, text: text) }
            if !outputSuppressed { announce(text, speechClass: speechClass) }
        case let .farNotice(indices, remainingMeters):
            // 원거리 예고(B1 §4.7) — 크로싱 시점 실측 잔여를 낭독(상수 금지, 리뷰 반영).
            // 실행 안내와 같은 취급(억제 복구 대상). 운전자 모드는 단문(행동 없으면 무발화).
            if driverChannel {
                // 원거리 예고는 크로싱 시점이라 첫 스텝이 아직 앞이다 — 같은 필터가 통과시킨다.
                guard let gs = guideState,
                      let text = GuideText.driverNotice(route: route, indices: indices, fromD: gs.d)
                else { break }
                lastGuidance = text
                statusText = text
                announce(text, speechClass: speechClass)
                break
            }
            let text = GuideText.farNotice(
                route: route, indices: indices, remainingMeters: remainingMeters
            )
            lastGuidance = text
            statusText = text
            if outputSuppressed {
                pendingRecovery = text
                pendingRecoveryEntered = nil
            } else {
                announce(text, speechClass: speechClass)
            }
        case let .periodic(stepIndex, remainingMeters, accuracy):
            // walk 직진 구간 반복 통지는 단문이다(위원장 실보행 피드백 2026-08-12) —
            // 조망은 30m 선행 전문 1회로 충분하고, 반복은 "{target}까지 … 직진하세요"만.
            // car도 단문이다(K2 §6.3 — "{거리} 앞 우회전"). 운전자 모드는 주기 통지를 내지 않는다
            // (낮은 빈도 — 전문·예고·임박·이탈·도착만, §6.2).
            if driverChannel { break }
            // walk 낭독 숫자는 실위치 잔여다(위원장 판정 2026-10-03 — 하단 2행과 같은 기준).
            let spokenMeters = guideState.map {
                max(0, Int(spokenRemainingMeters(
                    Double(remainingMeters), d: $0.d, baselineD: liveBaselineD
                ).rounded()))
            } ?? remainingMeters
            let text = sessionKind == .walk
                ? GuideText.periodicWalk(
                    route: route, stepIndex: stepIndex, remainingMeters: spokenMeters,
                    accuracy: accuracy, destinationLabel: destinationLabel,
                    target: liveSteps.indices.contains(stepIndex)
                        ? liveSteps[stepIndex].target : nil
                )
                : GuideText.periodicCar(
                    route: route, stepIndex: stepIndex, remainingMeters: remainingMeters,
                    accuracy: accuracy, destinationLabel: destinationLabel
                )
            lastGuidance = text
            // 상태 행에 원문을 두고 "다음 안내," 라벨은 플래그로 뷰가 붙인다(표시 전용
            // — 상태 행이 예고와 상태를 오가서 라벨 없이는 종류를 알 수 없다는 실보행
            // 판정 2026-08-10 ②. 특히 마지막 구간의 "…까지 약 91m"는 남은 거리 행과
            // 숫자만 어긋난 채 나란히 보였다). 발화·복귀 재생은 원문 그대로.
            statusText = text
            statusIsNextPreview = true
            announce(text, speechClass: speechClass)
        case .waypointReached:
            // 경유지 도착(N4 spec §4.3): 도착 종 + 통지, 그리고 **계속**(경로·상태 불변).
            // `waypoint`만 비워 이후 재조회가 출발→도착으로 가게 한다. 옛 경유지 기반
            // 파생물(자동 재조회·프리뷰·왕복 중 재조회)은 폐기(설계 리뷰 #9) — 이탈 상태는 남아
            // 버튼으로 다시 누를 수 있다. 재시작 요청에서도 지운다(#11).
            guard let reached = waypoint else { break }
            waypoint = nil
            waypointPassedInSession = true
            syncStartRequestWithSession()
            clearProposal()
            resetAlternativePreview()
            rerouteToken += 1
            playTone(.nearby)
            // 도착 문장은 다음 목표(목적지)까지 말한다(N4 spec 2026-09-24 §3). ko는 목적지에 방향
            // 조사를 붙이고, 받침을 모르는 이름은 `로`로 물러난다 — 조사를 빼면 문장이 깨진다.
            let text = appLocalized(
                "directions.viaArrivedContinue", reached.label,
                destinationWithDirectionParticle(destinationLabel))
            statusText = text
            // 지나간 사실이라 억제 해제 뒤에 갚아도 참이다(실행 안내와 같은 취급).
            if outputSuppressed {
                pendingRecovery = text
                pendingRecoveryEntered = nil
            } else {
                announce(text, speechClass: speechClass)
            }
        case let .waypointApproaching(meters):
            // 경유지 접근 예고(N4 spec 2026-09-24 §4.1): 1회, 톤 없음. 실행 안내가 아니라 `lastGuidance`는
            // 덮지 않고, 억제 중이면 보관하지 않는다(거리 문장은 시간이 지나면 거짓 — 주기 통지와 같은 취급).
            // `statusText`에도 두지 않는다: 같은 정보를 남은 거리 행이 실시간으로 보이고, 전경 복귀 재생이
            // 낡은 거리를 읽게 된다(코드 리뷰 M3).
            guard let label = routeWaypointLabel else { break }
            announce(appLocalized("directions.viaRemaining", label, formatDistance(meters)), speechClass: speechClass)
        case .finalApproachEnter:
            // 여기서는 처리하지 않는다. 진입은 **fix를 쥔 `handleDetail`이** 톤 조립 앞에서
            // 가른다 — 소유권 전환과 같은 fix의 첫 발화가 한 묶음이어야 하고, 이 함수는
            // fix를 받지 않아 그 발화를 낼 수 없다. 반쪽 처리를 여기 두면 진입 직후
            // 침묵(정확히 이번에 고치려는 증상)이 되므로 비워 둔다.
            break
        case let .offRoute(notice, reason, guidance, side, returnRelDeg, firstSpoken):
            // 확정(`confirm`)은 돌아가기 국면의 시작이다 — 재조회가 아니다(E63). 재조회는 리듀서 `rerouteNeeded`가 연다.
            // 자동 조회·표시 상태의 회차 시작은 `notice == confirm`, 문장 분류·톤의 "처음 말함"은 `firstSpoken`(§4.1).
            if notice == .confirm {
                offRouteNoticePosted = false
                rerouteTriggerCount = 0
                offRouteConfirmedAt = now
                offRouteConfirmCoord = lastFixCoord
            }
            offRoute = true
            if driverChannel {
                // 운전자 모드(E63 §3.8): 방향 문장(마)을 말하지 않고 현행 상태 전문을 말하며 확정 즉시 조회·채택한다.
                let text = appLocalized("guide.carOffRoute")
                statusText = text
                offRouteNoticePosted = true
                announce(text, speechClass: speechClass) { [weak self] in self?.offRouteNoticePosted = false }
                logOffRouteNotice(notice, reason, guidance, side, returnRelDeg, firstSpoken, spoken: true)
                if notice == .confirm { maybeFetchProposal(source: "driver") }
                break
            }
            let text = GuideText.offRoute(guidance: guidance, side: side, returnRelDeg: returnRelDeg, kind: sessionKind)
            // 보류는 말하지 않는다 — 상태 행은 `handleDetail`이 먼저 정한 문장(벗어난 쪽만, §3.3).
            statusText = offRouteLine ?? ""
            logOffRouteNotice(notice, reason, guidance, side, returnRelDeg, firstSpoken, spoken: text != nil)
            guard let text else { break }
            offRouteNoticePosted = true
            announce(text, speechClass: speechClass) { [weak self] in self?.offRouteNoticePosted = false }
        case let .backOnRoute(spoken):
            offRouteEndedByReroute = false
            offRoute = false
            offRouteLine = nil
            // 이탈 복귀 = 자동 재조회 근거 소멸(진행 중 조회의 채택 차단).
            clearProposal()
            // 리듀서가 이 회차에 이탈 문장을 냈고 ∧ 실제로 게시했을 때만 말한다(E63 §3.4). 아니면 이벤트만 — 상태 행은 현행 안내.
            let say = spoken && offRouteNoticePosted
            offRouteNoticePosted = false
            guideDiagLog(
                "backOnRoute via=\(prev.offRouteReason?.rawValue ?? "-")"
                    + " perp=\(signedPerp.map { String(format: "%.1f", $0) } ?? "-")"
                    + " hold=\(prev.returnCandidateSince.map { String(format: "%.1f", now - $0) } ?? "-")"
                    + " spoken=\(say ? 1 : 0)")
            guard say else {
                statusText = lastGuidance ?? ""
                break
            }
            let text = appLocalized("guide.backOnRoute")
            statusText = text
            // 이탈은 warning 톤이 진동을 동반하는데 복귀는 무신호였다 — 짝을 맞춘다(E30 확장).
            resultHaptic(.success)
            announce(text, speechClass: speechClass)
        case let .rerouteNeeded(reason):
            // 돌아가기 국면에서 계속 멀어지거나 나란히 계속 걸었다(E63 §3.5·판정 J4) — 자동 조회·채택. 운전자 채널은 확정 즉시
            // 조회가 실패·신선도 미달로 끝난 뒤의 재시도로만 쓴다(§3.8 — 이미 조회 중이면 아래 가드가 무시한다).
            rerouteTriggerCount += 1
            let ignored = maybeFetchProposal(source: driverChannel ? "driver" : "auto")
            let moved: String = if let a = offRouteConfirmCoord, let b = lastFixCoord {
                String(format: "%.0f", haversineMeters(lat1: a.lat, lng1: a.lng, lat2: b.lat, lng2: b.lng))
            } else { "-" }
            // 리듀서는 요청 fix에서 최솟값을 그 fix 값으로 다시 놓는다 — `min`은 직전 최솟값, `perp`는 이 fix 값(확정 지점 창).
            guideDiagLog(
                "rerouteTrigger reason=\(reason.rawValue) n=\(rerouteTriggerCount)"
                    + " min=\(prev.offRouteMinPerp.map { String(format: "%.1f", $0) } ?? "-")"
                    + " perp=\(signedPerp.map { String(format: "%.1f", abs($0)) } ?? "-")"
                    + " sinceConfirm=\(offRouteConfirmedAt.map { String(format: "%.0f", now - $0) } ?? "-")"
                    + " moved=\(moved)"
                    + " anchor=\(prev.offRouteAnchor.flatMap { a in lastFixCoord.map { String(format: "%.0f", haversineMeters(lat1: a.lat, lng1: a.lng, lat2: $0.lat, lng2: $0.lng)) } } ?? "-")"
                    + " ignored=\(ignored ?? "-")")
        case .uncertainEnter:
            statusText = appLocalized("guide.uncertain")
            if !driverChannel { announce(statusText, speechClass: speechClass) }  // 운전자 모드: GPS 상태는 말하지 않는다(§6.2)
        case .uncertainExit, .reacquired:
            statusText = appLocalized("guide.uncertainRecovered")
            if driverChannel { break }
            // car는 **재획득** 뒤 "지금 구간" 전문을 함께 읽는다 — 전역 재투영 뒤라 stepIndex가
            // 현재이고, restateAt이 그 유닛을 낭독 완료로 두어 이대로면 다음 경계까지 안내가 없다
            // (K2 §3.4). ⚠ uncertainExit에는 붙이지 않는다 — 복귀 fix는 d를 갱신하지 않아
            // stepIndex가 공백 전 스텝이고, 따라잡기 뒤 6c가 현재 유닛을 어차피 읽는다(spec 리뷰 B2).
            if case .reacquired = event, sessionKind == .car, let gs = guideState {
                let current = GuideText.unit(route: route, indices: unitAt(route: route, index: gs.stepIndex))
                announce("\(statusText) \(current)", speechClass: .actionable)
            } else {
                announce(statusText, speechClass: speechClass)
            }
        case .reacquiring:
            statusText = appLocalized("guide.reacquiring")
            if !driverChannel { announce(statusText, speechClass: speechClass) }
        case .speedSuggest:
            // 전환 버튼 폐지(위원장 판정 2026-08-11)로 실행 가능한 조언이 아니다 —
            // 무시한다. 자동 전환도 하지 않는다(스펙 §2 모드 결정 원칙). 이벤트
            // 자체는 Kit 공유 계약(웹 미러)이라 남는다.
            break
        }
    }


    /// 거리 축이 바뀔 때(상세 경로 거리 ⇄ 간략 직선거리)의 재기준화.
    ///
    /// 값이 **불연속으로** 줄어든다(경로 500m가 직선 120m가 되는 식). 추세 방향만
    /// 승계하고 `anchorDistance`와 `lastSpokenDistance`를 **둘 다** 새 축의 현재값으로
    /// 재설정한다. ⚠ `lastSpokenDistance`를 옛 축 값으로 두면 차이 380m가 즉시
    /// 마일스톤을 넘겨 **전환 직후 거짓 closer 음성**이 나가고, 반대 방향 전환에서는
    /// 필요한 음성이 장기 억제된다.
    ///
    /// 새 축의 현재값을 모르면(낡은 fix) nil로 두는 것이 정직한 폴백이다 — 다음 fix가
    /// first 경로를 타서 절대거리를 1회 발화하고 다시 추세를 잡는다.
    private func rebaseForAxisChange() {
        beaconState = rebaseBeaconState(beaconState, distance: freshStraightLineMeters())
        gateState = .initial
        // 톤 축도 같은 규칙 — 다음 추세 fix가 재기준화 후 현재 상태를 1회 알린다.
        toneState.needsRebase = true
    }

    // MARK: - 시트 컨트롤 (반복·진행 상황·재조회)

    /// 낡은 fix로는 직선거리를 단정하지 않는다(3-state — 웹 PROGRESS_FIX_MAX_AGE_S 미러).
    private func freshStraightLineMeters() -> Double? {
        guard let c = lastFixCoord, let at = lastFixCoordAt, let dest,
              uptimeNow - at <= 15
        else { return nil }
        return haversineMeters(lat1: c.lat, lng1: c.lng, lat2: dest.lat, lng2: dest.lng)
    }

    /// 진행 상황 문장 조립(발화 없음). 간략·경로 미보유 세션의 버튼 낭독과 조망
    /// 모달 헤더가 같은 문장을 쓴다(위원장 판정 개정 2026-08-10 — 모달 전환).
    func progressText() -> String {
        let text: String
        if mode == .detail, let route = guideRoute, let state = guideState {
            // 직선거리가 정본인 두 국면(스펙 §4.2 + 2026-08-08 §3.4): 이탈 중 경로 잔여는
            // 낡은 투영이라 거짓이고, 최종 접근에서는 이미 종점을 지나 잔여가 0에 붙는다.
            let straight = state.phase == .offRoute || state.phase == .finalApproach
                ? freshStraightLineMeters() : nil
            let base = GuideText.progress(
                route: route, state: state,
                destinationLabel: destinationLabel, lastGuidance: lastGuidance,
                straightLineMeters: straight,
                etaMinutes: etaMinutesNow(route: route, state: state),
                currentBody: liveSteps.indices.contains(state.stepIndex) ? liveSteps[state.stepIndex].body : nil,
                walk: sessionKind == .walk
            )
            if sessionKind == .car, state.phase == .following || state.phase == .bundle {
                // car(§4.7): 현재 링크 도로명 + 진행 + ETA 오래됨 병기(3-state).
                let road = roadNameAt(spans: roadSpans, d: state.d)
                let etaAge = etaUpdatedAt.map { uptimeNow - $0 }
                text = joinText(
                    road.map { appLocalized("guide.carRoadNow", $0) },
                    base,
                    (etaAge ?? 0) > 660
                        ? appLocalized("guide.etaStale", String(Int(((etaAge ?? 0) / 60).rounded())))
                        : nil
                )
            } else {
                text = base
            }
        } else if let straight = freshStraightLineMeters() {
            // 간략: 목적지 직선거리 하나(웹과 동일 문구 — 반복 버튼과 역할이 갈라진다).
            text = appLocalized("beacon.first", formatDistance(Int(straight.rounded())))
        } else {
            text = lastGuidance ?? appLocalized("guide.noGuidanceYet")
        }
        return text
    }

    /// 경로 미보유·간략 세션의 진행 상황 발화. 상세(경로 보유) 세션은 이 경로를
    /// 타지 않는다 — 조망 모달 표시와 Announcement가 경합하므로(시트 착지 낭독이
    /// 통지를 잠식) 문장 전달은 모달 헤더 착지가 맡는다.
    func announceProgress() {
        let text = progressText()
        statusText = text  // 비-VO 사용자에게도 보여야 한다(2.1(a) 계약)
        announce(text, highPriority: true, speechClass: .actionable)
    }

    /// 이탈 중 수동 재조회 — 자동 재조회(maybeFetchProposal)가 실패·만료·상한 도달로
    /// 채택하지 못했을 때의 예비 출구(스펙 §5.6의 버튼이 2026-09-02부터 이 역할이다).
    /// 진행 중 자동 조회는 폐기한다(토큰 증가) — 수동 조회가 이긴다. 안 하면 두 응답이
    /// 잇달아 커밋돼 첫 안내가 두 번 나간다.
    func requestReroute() {
        guard isTracking, mode == .detail, offRoute, !rerouteInFlight else { return }
        clearProposal()
        rerouteInFlight = true
        isRerouting = true
        rerouteToken += 1
        let token = rerouteToken
        Task { [weak self] in
            await self?.performReroute(token: token, intent: .keepVariant)
        }
    }

    /// 재조회 의도(M3): 이탈 재조회·자동 재조회는 세션 축 유지, 수동 전환만 조회 화면의 다른 줄(E42).
    private enum RerouteIntent {
        case keepVariant
        case switchTo(WalkLineKind)
    }

    /// 안내 중 수동 전환(M3 spec §5): **현위치 기준으로 다른 줄(`alternateLine`) 재조회**. 정상
    /// 추종 중에도 가능(offRoute 조건 없음 — requestReroute와의 유일한 가드 차이).
    /// walk 전용(variant는 도보 축, car는 M3 범위 밖). 그 외 토큰·latest-wins·커밋은
    /// performReroute 기존 계약 그대로. 출발 전에 받아 둔 대안을 재사용하지 않는
    /// 이유: 걷는 중이라 그 경로의 출발점이 낡았다.
    func requestVariantSwitch() {
        guard sessionKind == .walk, isTracking, mode == .detail, !rerouteInFlight,
              let target = alternateLine else { return }
        // 진행 중 자동 재조회(이탈 확정 회차)는 폐기한다 — 자동 채택이 능동 커밋자가 된
        // 뒤로 두 커밋이 잇달아 나갈 수 있다(리뷰 MAJOR 2026-09-02, requestReroute 동형).
        clearProposal()
        rerouteInFlight = true
        // busy 신호는 누른 버튼에만 귀속한다(isRerouting과 분리 — 공유하면 이탈 중
        // 두 버튼이 동시에 "조회 중"이 되어 어느 조회가 도는지 라벨이 오귀속된다).
        isSwitchingVariant = true
        rerouteToken += 1
        let token = rerouteToken
        Task { [weak self] in
            await self?.performReroute(token: token, intent: .switchTo(target))
        }
    }

    private func performReroute(token: Int, intent: RerouteIntent) async {
        defer {
            rerouteInFlight = false
            isRerouting = false
            isSwitchingVariant = false
        }
        guard let dest else { return }
        // 전환은 fetch 성공 커밋 전까지 세션 축을 건드리지 않는다(실패 시
        // 기존 경로·기존 축 유지 — 라벨·다음 전환 방향이 실제 경로와 어긋나지 않게).
        let fetchVariant: WalkRouteVariant?
        let fetchAccessible: Bool
        switch intent {
        case .keepVariant: (fetchVariant, fetchAccessible) = (sessionVariant, accessible)
        case .switchTo(let target): (fetchVariant, fetchAccessible) = (target.variant, target.accessible)
        }
        do {
            let origin = try await LocationService.shared.currentCoordinate()
            guard token == rerouteToken, isTracking, mode == .detail, self.dest == dest else { return }
            let waypointAtFetch = waypoint
            let fetched = try await fetchDetailData(
                origin: origin, dest: dest, variant: fetchVariant, accessible: fetchAccessible,
                waypoint: waypointAtFetch)
            // latest-wins: 왕복 중 중지·전환·목적지 변경·경유지 변경/도착이면 도착 응답 폐기.
            guard token == rerouteToken, isTracking, mode == .detail, self.dest == dest,
                  self.waypoint == waypointAtFetch else { return }
            guard let fetched else {
                // 경로가 없으면 경로 기반 계단 판정도 없다(3-state) — 폴백과 동형.
                lastStepFree = nil
                statusText = appLocalized("guide.rerouteFailed")
                resultHaptic(.failure)
                announce(statusText, highPriority: true, speechClass: .actionable)
                return
            }
            // 재조회 출발지가 현재 위치이므로 새 경로의 d=0이 곧 현 위치다(전역 재투영 불요).
            // 전환 커밋: 경로 교체와 같은 원자 블록에서만 세션 축·줄 종류가 바뀐다(세션 수명 불변식).
            if case .switchTo(let target) = intent { commitLineSwitch(to: target) }
            let firstIndices = commitReroutedRoute(fetched)
            // 재조회는 출발지가 달라 계단 회피 판정이 바뀔 수 있다 — 열화로 전이하면
            // 그 조회의 발화에 결합해 1회 통지한다(spec §2.3).
            let notice = consumeStepFreeNotice(
                fetched.stepFreeRaw, fetched.stepFree, fetched.stepFreeNotice
            )
            // 전환은 variant를 밝히는 문장으로 시작한다(spec §5 — 새 경로 요약 구조는
            // 재조회와 동일, 첫 문장만 교체).
            let summary: String
            switch intent {
            case .keepVariant:
                summary = GuideText.reroute(route: fetched.route, firstIndices: firstIndices)
            case .switchTo(let target):
                // 이름은 받은 경로의 성질(E42 설계 리뷰 MAJOR 1) — 계단 회피를 요청했는데 큰길이 오면
                // "큰길 경로로 전환"이고, 서버가 이름을 못 주면 요청한 줄 이름 + 경고 문장이 말한다.
                summary = GuideText.variantSwitch(
                    route: fetched.route, firstIndices: firstIndices, to: fetched.lineKind ?? target)
            }
            let text = notice.map { "\($0) \(summary)" } ?? summary
            statusText = text
            // ⚠ **`.high`가 아니면 이 발화는 도달하지 않는다.** 성공하면 위 `offRoute = false`가
            // 재조회 버튼(커서를 쥔 버튼)을 없애 VoiceOver가 커서를 옮기며 그 자리를 낭독한다 —
            // 기본 우선순위 통지는 그 VO 처리에 잠식된다(헌장 §6 실기기 확정). 시트의 첫 정보 행 착지는
            // 이 통지가 끝난 뒤다(E57 spec §3.3).
            // 바로 아래 실패 경로만 `.high`였던 비대칭이 실사용 무발화의 원인이었다.
            resultHaptic(.success)
            announce(text, highPriority: true, speechClass: .actionable) { [weak self] in
                if let notice { self?.pendingStepFreeNotice = notice }
            }
            // 전환 성공은 채택 완료 세대를 올린다(프리뷰 낡음 폴백 경로 포함 —
            // 시트 연쇄 닫힘 트리거. keepVariant 재조회는 시트 밖 버튼이라 무관).
            if case .switchTo = intent { variantAdoptedSeq += 1 }
        } catch {
            guard token == rerouteToken, isTracking else { return }
            lastStepFree = nil
            statusText = appLocalized("guide.rerouteFailed")
            resultHaptic(.failure)
            announce(statusText, highPriority: true, speechClass: .actionable)
        }
    }

    /// 재조회·전환·자동 재조회 채택 공통의 성공 커밋(spec §6 리뷰 #4 — 별도 채택 전이 신설
    /// 금지). 경로·기준선·이탈 표결·finalApproach·표시 유닛을 한 지점에서 원자
    /// 교체한다. 발화 문구는 호출부 몫이라 첫 안내 유닛 인덱스를 돌려준다.
    private func commitReroutedRoute(_ fetched: DetailFetchResult) -> [Int] {
        // 경로 교체는 진행 중 자동 재조회의 근거를 무효화한다(새 경로 기준의 이탈
        // 확정이 새 조회를 만든다) — 자동 채택 경로는 토큰 일치를 확인한 뒤라 무해하다.
        clearProposal()
        // 경로 교체는 프리뷰 비교 기준(잔여·대안)도 무효화한다(spec 2026-08-14 §3).
        resetAlternativePreview()
        guideRoute = fetched.route
        // 경로에 결박된 경유지 라벨: 이 경로가 경유지를 담았으면 그 라벨(fetch 스냅샷과
        // 커밋 가드가 같은 값임을 보장한다), 아니면 nil.
        routeWaypointLabel = fetched.route.waypointStepIndex == nil ? nil : waypoint?.label
        guideRouteDurationSeconds = fetched.durationSeconds
        roadSpans = fetched.spans
        if sessionKind == .car {
            // 수동 재조회도 ETA 캡에 포함(§4.6) + 새 경로 기준 원자 교체.
            etaCallCount = min(6, etaCallCount + 1)
            if let dur = fetched.durationSeconds, dur > 0 {
                etaSeconds = Double(dur)
                etaUpdatedAt = uptimeNow
            }
        }
        // 새 경로는 새 종점·새 오프셋이다 — 진입 래치·주기 타이머·진입 서술 래치를
        // 전부 초기화한다(spec §4 "사용자 재조회 성공").
        resetFinalApproach(geometry: fetched.finalApproach)
        // 재조회는 같은 세션의 새 경로다 — 유도기 버퍼를 잇는다(spec §2.9. 비우면
        // 갈림 직후 재조회에서 축이 ~10m 냉시동돼 "이탈 → 재조회 → 다시 잘못된
        // 길" 시나리오에서 이 축의 이점이 사라진다).
        let initial = initialGuideState(
            route: fetched.route, now: uptimeNow,
            hasFinalApproachGeometry: fetched.finalApproach != nil,
            courseDerivation: guideState?.courseDerivation ?? initialDerivationState,
            // 진행 방위 관측도 궤적의 사실이다 — 새 경로의 돌아가기·재통지 판정이 냉시동하지 않게(E63 spec §4.2).
            lastHeading: guideState?.lastHeading
        )
        guideState = initial.state
        offRouteEndedByReroute = true
        offRoute = false
        offRouteLine = nil
        updateRemaining(route: fetched.route, state: initial.state)
        // 새 경로 = 새 표시 유닛 + 램프인·클램프 리셋(spec 2026-08-11 F7, car 확장 K2 §4).
        displayUnits = buildDisplayUnits(fetched.liveSteps)
        liveSteps = fetched.liveSteps
        resetLiveRowsBaseline(state: initial.state)
        if sessionKind == .car {
            refreshCurrentRoad(state: initial.state)
        }
        lastGuidance = GuideText.unit(route: fetched.route, indices: initial.firstIndices)
        return initial.firstIndices
    }

    // MARK: - 이탈 시 자동 재조회·채택 (E10ⓑ 자동 채택, spec §6 + 2026-09-02 개정)

    /// 자동 조회 트리거(E63): 리듀서 `rerouteNeeded` 소비 지점, 운전자 채널은 확정(`offRoute` confirm)에서도.
    /// 활성 조건: 상세 세션 ∧ 최종 접근 전 ∧ 진행 중 자동·수동 조회 없음 ∧ 세션 상한 미달(spec §6 리뷰 #14 —
    /// 이탈 표결이 최종 접근보다 앞이라는 기존 불변식 순서에 자동 재조회도 그대로 걸린다). 반환 = 무시한 사유(로그), nil이면 조회를 열었다.
    @discardableResult
    private func maybeFetchProposal(source: String) -> String? {
        // car도 자동 재조회한다(K2 §5) — fetchDetailData가 수단별 provider·via를 고른다.
        // 수동 재조회·전환이 도는 중이면 자동 조회를 열지 않는다(그 조회가 새 경로를 만든다).
        guard isTracking, mode == .detail, !inFinalApproach, !rerouteInFlight else { return "state" }
        guard proposalInFlightToken != proposalToken else { return "inflight" }
        guard RerouteProposalGate.mayFetch(episodeFetchCount: proposalFetchCount) else { return "budget" }
        proposalToken += 1
        proposalFetchCount += 1
        let token = proposalToken
        proposalInFlightToken = token
        Task { [weak self] in
            await self?.fetchProposal(token: token, source: source)
            if self?.proposalInFlightToken == token { self?.proposalInFlightToken = nil }
        }
        return nil
    }

    private func fetchProposal(token: Int, source: String) async {
        guard let dest else { return }
        do {
            // 출발점은 확정 시점의 최신 세션 fix(연속 수신 중이라 currentCoordinate가
            // 그 값이다 — 싱글턴 TTL 함정과 다른 층, spec §6 리뷰 #3 명시).
            let origin = try await LocationService.shared.currentCoordinate()
            // 취득 시각은 좌표와 같은 시점에 캡처한다(신선도 기준값은 한 쌍 — fetch
            // 완료 후 시각을 쓰면 왕복이 긴 만큼 실제보다 신선하게 판정된다.
            // 같은 호스트 71초 hang 실사고 전례, spec 리뷰 MINOR 2026-08-12).
            let acquiredAt = uptimeNow
            guard token == proposalToken, offRoute, isTracking, mode == .detail,
                  self.dest == dest else { return }
            let waypointAtFetch = waypoint
            let fetched = try await fetchDetailData(
                origin: origin, dest: dest, variant: sessionVariant, accessible: accessible,
                waypoint: waypointAtFetch)
            // 채택 가드: 토큰 일치 ∧ 이탈 지속 중 ∧ 수동 조회 비진행일 때만(복귀 후 늦은
            // 응답이 경로를 갈아치우는 경로 차단 — latest-wins, spec §6 리뷰 #1. 수동
            // 재조회·전환과의 이중 커밋은 양방향으로 막는다 — 리뷰 MAJOR 2026-09-02).
            guard token == proposalToken, offRoute, isTracking, mode == .detail, !rerouteInFlight,
                  self.dest == dest, self.waypoint == waypointAtFetch else { return }
            // 경로 없음은 통지 없이 돌아가기 국면을 잇는다 — 리듀서가 문턱을 다시 채우면 또 요청한다(E63 §3.5 재무장).
            guard let fetched else {
                guideDiagLog("rerouteAdopt source=\(source) result=none headClock=-")
                return
            }
            // 채택 시점 신선도 — 자동 채택의 유일한 안전망. 현재 좌표를 단정할 수 없거나
            // (fix 15초 공백) 취득점에서 30m·120초를 넘겼으면 채택하지 않는다(그 회차
            // 종결, 수동 버튼이 예비). 서버 hang 동안 걸어 낡아진 출발점의 경로를
            // 채택하는 §5.6 실사고 경로를 이 검사가 막는다.
            let proposal = RerouteProposal(
                originLat: origin.lat, originLng: origin.lng, acquiredAt: acquiredAt)
            guard let c = lastFixCoord, let at = lastFixCoordAt, uptimeNow - at <= 15,
                  RerouteProposalGate.isFresh(
                      proposal, nowUptime: uptimeNow, currentLat: c.lat, currentLng: c.lng,
                      maxDriftMeters: tuning.rerouteMaxDriftM)
            else {
                guideDiagLog("rerouteAdopt source=\(source) result=stale headClock=-")
                return
            }
            // 새 경로 첫 문장의 방향 머리말(E63 §3.7): 교체 **전** 세션의 진행 방위 기준 새 경로 첫 15m의 시. 자동차는 없음.
            let headClock: Int? = sessionKind == .walk
                ? guideState.flatMap { rerouteHeadClock(state: $0, route: fetched.route, now: uptimeNow, tuning: tuning) }
                : nil
            guideDiagLog("rerouteAdopt source=\(source) result=adopted headClock=\(headClock.map(String.init) ?? "-")")
            // 채택은 performReroute의 성공 커밋 경로 그대로(spec §6 리뷰 #4 — 별도 전이
            // 신설 금지). 통지는 `.high`: 커밋이 `offRoute = false`로 재조회 버튼을 지워
            // 커서가 옮겨갈 수 있고, 기본 우선순위는 그 착지 낭독에 잠식된다(수동 재조회
            // 성공 통지와 같은 근거). 시트의 첫 정보 행 착지는 이 통지 뒤다(E57).
            let firstIndices = commitReroutedRoute(fetched)
            let notice = consumeStepFreeNotice(
                fetched.stepFreeRaw, fetched.stepFree, fetched.stepFreeNotice
            )
            let summary = GuideText.autoReroute(
                route: fetched.route, firstIndices: firstIndices, liveSteps: liveSteps, headClock: headClock)
            let text = notice.map { "\($0) \(summary)" } ?? summary
            statusText = text
            resultHaptic(.success)
            announce(text, highPriority: true, speechClass: .actionable) { [weak self] in
                if let notice { self?.pendingStepFreeNotice = notice }
            }
        } catch {
            // 조회 실패는 통지 없이 돌아가기 국면을 잇는다 — 더 멀어지면 리듀서가 또 요청한다(세션 예산 5회가 상한, E63 §3.5).
            guideDiagLog("rerouteAdopt source=\(source) result=failed headClock=-")
        }
    }

    /// `ret=` 열(E63 spec §6): 최솟값/자격 fix 연속 수/복귀 후보 유지 초/나란히 걷기 기준점까지 직선 m(0이면 그 fix에서 다시 놓였다).
    private func returnDiag(_ s: GuideState, lat: Double, lng: Double, now: Double) -> String {
        let minPerp = s.offRouteMinPerp.map { String(format: "%.1f", $0) } ?? "-"
        let hold = s.returnCandidateSince.map { String(format: "%.0f", now - $0) } ?? "-"
        let anchor = s.offRouteAnchor.map {
            String(format: "%.0f", haversineMeters(lat1: $0.lat, lng1: $0.lng, lat2: lat, lng2: lng))
        } ?? "-"
        return "\(minPerp)/\(s.offRouteAwayRun?.count ?? 0)/\(hold)/\(anchor)"
    }

    /// 이탈 통지 계측 한 줄(E63 spec §6). `spoken`은 말할 문장을 냈는가(보류·운전자 채널 구분 — 게시 실패는 `bgSpeech` 줄).
    private func logOffRouteNotice(
        _ notice: OffRouteNotice, _ reason: OffRouteReason, _ guidance: OffRouteGuidance, _ side: OffRouteSide?,
        _ returnRelDeg: Double?, _ firstSpoken: Bool, spoken: Bool
    ) {
        let heading = guideState?.lastHeading
        let headAge: String = if let heading { String(format: "%.1f", uptimeNow - heading.at) } else { "-" }
        guideDiagLog(
            "offRouteNotice notice=\(notice.rawValue) first=\(firstSpoken ? 1 : 0) reason=\(reason.rawValue)"
                + " guidance=\(guidance.rawValue) side=\(side?.rawValue ?? "-")"
                + " rel=\(returnRelDeg.map { String(format: "%.0f", $0) } ?? "-")"
                + " clock=\(returnRelDeg.map { String(clockHour($0)) } ?? "-")"
                + " heading=\(heading.map { String(format: "%.0f±%.0f", $0.bearing, $0.uncertaintyDeg) } ?? "-")"
                + " headAge=\(headAge)"
                + " perp=\(guideState?.offRouteMinPerp.map { String(format: "%.1f", $0) } ?? "-")"
                + " d=\(guideState?.offRouteConfirmD.map { String(format: "%.1f", $0) } ?? "-")"
                + " spoken=\(spoken ? 1 : 0)")
    }

    /// 진행 중 자동 조회 폐기(이탈 복귀·경로 교체·세션 종료·목적지 변경·수동 재조회) —
    /// 토큰 증가로 늦게 도착한 응답의 채택을 차단한다. 통지 없음.
    private func clearProposal() {
        proposalToken += 1
    }

    // MARK: - 대안 경로 프리뷰 조회·채택 (spec 2026-08-14 §3·§4)

    /// 프리뷰 헤더 문장. 시트 헤더 착지가 낭독하고(조망 선례), 이후 갱신은 조용하다
    /// (조회형 정보). 결과 커밋 시 polite 통지 1회가 완료 신호(fetch 쪽 책임).
    func alternativePreviewHeaderText() -> String {
        switch alternativePreviewState {
        case .idle, .fetching:
            return appLocalized("guide.altPreviewLoading")
        case .noRoute:
            return appLocalized("guide.altPreviewNone")
        case .failed:
            return appLocalized("guide.altPreviewFailed")
        case .ready(_, let fetched):
            // 대안 = 다른 줄의 이름(조회 화면과 같은 이름 — 다른 이름 금지).
            // 이름은 받은 경로의 성질이 우선(E42 설계 리뷰 MAJOR 1 — 계단 회피를 요청했는데 큰길이 오면 "큰길 경로").
            let label = (fetched.lineKind ?? alternateLine).map { appLocalized(WalkLineText.nameKey($0)) } ?? ""
            let summary = appLocalized(
                "guide.altPreviewSummary", label,
                formatDistance(Int(fetched.route.totalMeters.rounded())))
            let time = fetched.durationSeconds.flatMap { dur in
                dur > 0 ? appLocalized("guide.altPreviewTime", String(max(1, dur / 60))) : nil
            }
            // 잔여·대안 총거리가 둘 다 현위치 기준이라 비교가 성립한다(spec §3).
            // 이탈 중 잔여는 거짓이라 생략(시트 잔여 행과 같은 3-state 근거).
            let remaining: String? = if !offRoute, let route = guideRoute, let state = guideState {
                appLocalized(
                    "guide.altPreviewRemaining",
                    formatDistance(Int(max(0, route.totalMeters - state.d).rounded())))
            } else {
                nil
            }
            // 서버가 이름을 주지 못한 응답(계단 문구가 남은 계단 회피)은 요청한 줄 이름으로 부르므로
            // 경고 문장을 헤더에 함께 싣는다 — 착지 첫 문장에 경고가 없으면 계단 사실이 스텝 원문을
            // 훑어야만 드러난다(E42 접근성 감사 M2). 이름이 참인 응답에는 붙이지 않는다.
            let notice = fetched.lineKind == nil ? fetched.stepFreeNotice : nil
            return joinText(summary, time, remaining, notice)
        }
    }

    /// 프리뷰 열림 — 열리는 즉시 최신 세션 fix 기준으로 반대 variant를 조회한다.
    /// 출발 전에 받아 둔 대안을 재사용하지 않는 이유: 걷는 중이라 출발점이 낡았다.
    func openAlternativePreview() {
        guard alternativePreviewAvailable, let dest else { return }
        alternativePreviewToken += 1
        let token = alternativePreviewToken
        alternativePreviewState = .fetching(token: token)
        Task { [weak self] in await self?.fetchAlternativePreview(token: token, dest: dest) }
    }

    /// 프리뷰 닫힘 — 진행 중 조회의 도착 응답을 폐기한다(latest-wins, spec §3).
    func closeAlternativePreview() {
        resetAlternativePreview()
    }

    private func resetAlternativePreview() {
        alternativePreviewToken += 1
        alternativePreviewState = .idle
    }

    private func fetchAlternativePreview(token: Int, dest: BeaconDest) async {
        guard let target = alternateLine else { return }
        do {
            let origin = try await LocationService.shared.currentCoordinate()
            // 신선도 기준값은 좌표와 한 쌍(E10ⓑ 동형 — fetch 완료 후 시각을 쓰면
            // 왕복이 긴 만큼 실제보다 신선하게 판정된다).
            let acquiredAt = uptimeNow
            guard token == alternativePreviewToken, isTracking, mode == .detail,
                  self.dest == dest else { return }
            let waypointAtFetch = waypoint
            let fetched = try await fetchDetailData(
                origin: origin, dest: dest, variant: target.variant, accessible: target.accessible,
                waypoint: waypointAtFetch)
            // 커밋 가드: 닫힘·재열림·세션 변화 후 도착한 응답 폐기(latest-wins).
            guard token == alternativePreviewToken, isTracking, mode == .detail,
                  self.dest == dest, self.waypoint == waypointAtFetch else { return }
            guard let fetched else {
                alternativePreviewState = .noRoute
                announce(appLocalized("guide.altPreviewNone"), speechClass: .actionable)
                return
            }
            alternativePreviewState = .ready(
                RerouteProposal(originLat: origin.lat, originLng: origin.lng, acquiredAt: acquiredAt),
                fetched: fetched)
            // 완료 신호 polite 1회(nearby 결과 통지 관례) — 헤더는 조용 갱신이라
            // 이 통지가 없으면 결과 도착을 알 길이 없다.
            announce(alternativePreviewHeaderText(), speechClass: .actionable)
        } catch {
            guard token == alternativePreviewToken else { return }
            alternativePreviewState = .failed
            announce(appLocalized("guide.altPreviewFailed"), speechClass: .actionable)
        }
    }

    /// 프리뷰 채택(spec 2026-08-14 §4): 신선하면 본 경로를 즉시 채택(왕복 없음 —
    /// "본 것 = 안내받는 것"), 낡았으면 같은 목표 variant로 현위치 재조회에 조용히
    /// 폴백(requestVariantSwitch 재사용, 진행 신호는 isSwitchingVariant 라벨 병기).
    func adoptAlternativePreview() {
        guard case .ready(let proposal, let fetched) = alternativePreviewState,
              !rerouteInFlight, let target = alternateLine else { return }
        if let c = lastFixCoord, let at = lastFixCoordAt, uptimeNow - at <= 15,
           RerouteProposalGate.isFresh(
               proposal, nowUptime: uptimeNow, currentLat: c.lat, currentLng: c.lng,
               maxDriftMeters: tuning.rerouteMaxDriftM) {
            // 전환 커밋: 경로 교체와 같은 원자 블록에서만 세션 축·줄 종류가 바뀐다
            // (performReroute 동형 — commitReroutedRoute가 프리뷰도 함께 리셋).
            commitLineSwitch(to: target)
            let firstIndices = commitReroutedRoute(fetched)
            let notice = consumeStepFreeNotice(
                fetched.stepFreeRaw, fetched.stepFree, fetched.stepFreeNotice)
            let summary = GuideText.variantSwitch(
                route: fetched.route, firstIndices: firstIndices, to: fetched.lineKind ?? target)
            let text = notice.map { "\($0) \(summary)" } ?? summary
            statusText = text
            // `.high`: 채택 성공으로 조망 시트가 닫히며 시스템이 커서를 복원해 그 라벨을 낭독하고,
            // 기본 우선순위는 그 낭독에 잠식된다(자동 채택 fetchProposal 동형). 첫 정보 행 착지는 이 통지 뒤(E57).
            announce(text, highPriority: true, speechClass: .actionable) { [weak self] in
                if let notice { self?.pendingStepFreeNotice = notice }
            }
            variantAdoptedSeq += 1
            return
        }
        // 낡음 폴백: 프리뷰는 열린 채 두고(실패 시 사용자가 상태를 본다) 재조회.
        // 성공하면 performReroute가 variantAdoptedSeq를 올려 시트가 닫힌다.
        requestVariantSwitch()
    }

    /// 오류 코드를 뭉개면 "위치 서비스 꺼짐"과 "일시적 취득 실패"가 한 문구가 된다.
    private func handle(locationError code: CLError.Code) {
        guard isTracking else { return }
        switch code {
        case .denied:
            // 세션 중 권한 철회는 권한 콜백과 같은 사유·같은 해결 경로다("신호 약함"이 아니다).
            stopAndFail(with: .denied, key: "beacon.denied", resolution: .settings)
        case .locationUnknown:
            // Apple이 무시를 권하는 일시 오류. 진짜 끊김은 워치독이 잡는다.
            break
        default:
            noticeStaleIfNeeded(force: true)
        }
    }

    private func handle(authorization status: CLAuthorizationStatus) {
        guard isTracking else { return }
        switch status {
        case .denied, .restricted:
            stopAndFail(with: .denied, key: "beacon.denied", resolution: .settings)
        default:
            break
        }
    }

    /// 세션 중 "정확한 위치"가 꺼지면 즉시 멈춘다.
    ///
    /// 시작 게이트만으로는 부족하다: 걷는 도중 설정에서 꺼도 추적이 계속되고,
    /// 1~20km 오차 좌표로 "가까워지는 중"을 소리로 안내하게 된다. 사용자가 비콘
    /// 컨트롤을 조작한 게 아니므로 라벨 변화가 신호가 되지 못해 통지가 필요하다.
    private func handle(accuracy: CLAccuracyAuthorization) {
        guard isTracking, accuracy == .reducedAccuracy else { return }
        stopAndFail(with: .unavailable, key: "beacon.reduced", resolution: .precise)
    }

    /// 세션 중 권한·정밀도 상실 종료. 종료 화면(요약)을 남기고 실패 상태·통지를 낸다 —
    /// 화면의 첫 문장이 실패 사유라, 시트가 인라인 상태 줄을 덮는 동안에도 사유가 들린다.
    ///
    /// 승차 전 도보(prewalk)면 "대중교통 안내는 시작하지 않았다"를 **같은 통지**에 두 문장으로 붙인다(E53 spec §3.3, 횡단 리뷰 F3,
    /// A54 위원장 판정): 대중교통
    /// 창구로 따로 내면 그 재생기는 세션을 시작한 적이 없어 백그라운드 채널이 버림이고, 대중교통 복귀 상환은 추적 가드 뒤라
    /// 어디서도 전달되지 않았다. 여기선 이 모델의 재생기가 원복 다리 동안 오디오 세션을 쥐고, 버려지면 복귀 상환(추적 가드
    /// 앞)이 `statusText` 꼬리로 갚는다.
    private func stopAndFail(with status: Status, key: String, resolution: FailResolution = .none) {
        let prewalk = prewalkTarget != nil  // stop() 앞 캡처(A25 §4.2)
        let leftEndScreen = stopLeavingSummary(playStopTone: false, text: appLocalized(key))
        // 종료 화면이 남지 않으면 시트가 닫히며 VoiceOver가 아래 화면으로 커서를 옮기고 그 라벨을 읽는다 — 실패 사유는 착지
        // 라벨로 대체될 수 없어 `.high`(CLAUDE.md 통지 우선순위 판별선, 접근성 감사 L4). 종료 화면이 남으면 착지가 사유를 읽는다.
        fail(with: status, key: key, resolution: resolution,
             prewalkCancelled: prewalk, highPriority: !leftEndScreen)
    }

    // MARK: - 무-fix 감시

    /// `startUpdatingLocation()`에는 타임아웃 개념이 없다. 감시가 없으면 "추적 중인데
    /// 안 움직이는 것"과 "죽은 것"이 구분되지 않는다(시각장애 사용자에겐 치명적).
    private func startWatchdog() {
        watchdog?.cancel()
        watchdog = Task { [weak self] in
            while !Task.isCancelled {
                // 주기는 톤 임계(8초)에 맞춰 좁혔다 — 5초 주기면 최대 5초 늦게 울린다.
                try? await Task.sleep(for: .seconds(2))
                // self가 사라졌으면 루프도 끝내야 한다(무한 웨이크업 방지).
                guard let self else { return }
                guard self.isTracking else { continue }
                self.tickWatchdog()
            }
        }
    }

    /// **타이머 구동**이지 fix 구동이 아니다. fix가 안 와도 돈다는 것이 요점이다 —
    /// 권한 철회·위치 서비스 중단·Core Location 정지면 `weak`·`uncertain` 판정 경로
    /// 자체가 실행되지 않아, 톤을 fix 처리에만 걸면 **마지막 정상 톤 이후 영구 침묵**이
    /// 된다. 백그라운드에서는 톤이 유일한 채널이라 이 침묵이 곧 무고장 판정이 된다.
    private func tickWatchdog() {
        let now = uptimeNow
        // 세션 시작 후 첫 fix 대기도 같은 타이머가 덮는다(기준을 시작 시각으로).
        let reference = lastFixAt ?? startedAt ?? now
        if now - reference >= noFixSeconds {
            // 도착 종단은 여기서도 지킨다(스펙 §5.5). 목적지에서 건물로 들어가 GPS가
            // 끊기면 사용자가 직접 멈추기 전까지 "신뢰할 수 없음"이 무한 반복된다.
            routeTone(ToneLayerInput(unreliable: true, arrived: arrivedNow), now: now)
        }
        // 도착 추정(.noFix 모양)은 fix가 안 와서 fix 경로에 걸 수 없다 — 워치독이
        // 유일한 도달 경로다(spec 2026-08-13 §4). 발동하면 세션이 끝났으므로 약신호
        // 통지도 없다.
        if maybePresumeArrival(now: now) { return }
        if maybeEndIdleSession(now: now) { return }
        // 음성 통지는 별도 축이다(15초 임계·30초 재통지·원인 구분). 톤은 추가 채널이지
        // 대체가 아니다.
        noticeStaleIfNeeded(force: false)
    }

    private func noticeStaleIfNeeded(force: Bool) {
        // 첫 fix 대기 창에선 fixWaitTask가 단일 권위 신호다(8번): 같은 15초에 워치독
        // "신호 약함"과 "위치 미확인 폴백"이 연달아 발화하는 이중 통지를 막는다.
        guard !awaitingRoute else { return }
        let now = ProcessInfo.processInfo.systemUptime
        let reference = lastFixAt ?? startedAt ?? now
        guard force || now - reference >= noFixTimeout else { return }
        if let last = lastStaleNoticeAt, now - last < staleRenotifyInterval { return }
        lastStaleNoticeAt = now
        statusText = appLocalized("beacon.weak")
        announce(statusText, speechClass: .deferrable)
    }

    // MARK: - 출력

    /// 결과 진동 창구(E30 확장) — **억제 중이면 진동도 내지 않는다**. 이 모델의 문장은 `post()`의 억제 가드가
    /// 조용히 버리므로(받아쓰기 중), 진동만 나가면 뜻을 말해 줄 문장이 없는 신호가 된다(a11y 감사 검출
    /// 2026-09-13). 짝은 "문장이 나가는 조건 = 진동이 나가는 조건"이다. 호출부가 `ResultHaptic.fire`를 직접
    /// 부르지 말 것.
    private func resultHaptic(_ kind: ResultHaptic.Kind) {
        guard !outputSuppressed else { return }
        ResultHaptic.fire(kind)
    }

    private func playTone(_ tone: BeaconTone) {
        guard !outputSuppressed else { return }
        tones.play(tone)
        // 가청 상태는 세션 중에도 바뀐다(route 변경·인터럽션 복구가 재조정을 거치고,
        // 억제 해제가 미뤄진 승격을 성사시킨다).
        let degraded = isTracking && !tones.isBackgroundAudible
        if soundDegraded != degraded { soundDegraded = degraded }
        // 톤이 죽으면 hold·정지엔 통지가 없어 사용자가 침묵의 원인을 모른다.
        // GPS 약신호와 **다른 문구**여야 한다. 취해야 할 행동이 다르다.
        if tones.isSilenced {
            // 진동은 무음 **진입 1회**(E30 확장 — 소리가 죽었으니 진동이 유일한 대체 채널). 문장 가드
            // `statusText != text`는 거리 통지가 상태 행을 덮을 때마다 다시 열리므로(반복 통지) 진동의
            // 근거로 쓰지 않는다 — 리뷰 검출 2026-09-13.
            if !silencedHapticFired {
                silencedHapticFired = true
                resultHaptic(.failure)
            }
            let text = appLocalized("ios.beacon.soundUnavailable")
            guard statusText != text else { return }
            statusText = text
            announce(text, speechClass: .actionable)
        } else {
            silencedHapticFired = false
        }
    }

    /// 무음(`tones.isSilenced`) 진입 진동의 에지 래치 — 무음이 풀리면 되돌려 다음 진입에 다시 한 번.
    private var silencedHapticFired = false

    /// ⚠ 거리 3종은 `formatDistance`(Kit 정본)를 태우고 `nearby`만 원시 미터를 쓴다.
    /// nearby의 값은 거리가 아니라 **오차 반경**이라(문구가 "약 ±N m") 거리 포맷에
    /// 태우면 다음 사람이 두 축을 같은 것으로 읽는다. `maxUsableAccuracy`가 100이라
    /// 결과 문자열은 어차피 같다.
    private func text(for notice: BeaconNotice) -> String {
        switch notice {
        case .first(let meters): appLocalized("beacon.first", formatDistance(meters))
        case .closer(let meters): appLocalized("beacon.closer", formatDistance(meters))
        case .farther(let meters): appLocalized("beacon.farther", formatDistance(meters))
        case .nearby(let accuracyMeters): appLocalized("beacon.nearby", String(accuracyMeters))
        case .weak: appLocalized("beacon.weak")
        }
    }

    /// 자동 통지 창구(spec 2026-08-14 §4-6). 안내 효과음이 재생 중이면 그 소리가
    /// 끝난 뒤에 게시한다(지연·latest-wins·세대는 `DeferredAnnouncer` 소유).
    /// 버튼 활성화의 **직접 응답**만 `.high`로 — 기본 우선순위 통지는 VO 활성화
    /// 처리에 잠식되어 무발화될 수 있다(헌장 §5, HoldDictationButton 선례).
    ///
    /// 세션에 1회뿐인 통지(계단 회피 경고·최종 접근 진입 서술)는 버려지면 다음 fix가
    /// 대신 말해 주지 않는다 — 상환이 필요한 문장은 `onDropped`에 "갚기"를 담는다
    /// (억제·백그라운드로 게시하지 못한 **그 시점에** 불린다). 반환값이 없는 것이
    /// 강제 수단이다: 새 호출부가 "게시했는가"를 물어볼 방법 자체가 없다.
    ///
    /// `speechClass`(E53 spec 2026-09-30 §3)는 기본값 없는 필수 인자다 — 백그라운드에서 말하는가를 이 값이 가르므로
    /// 새 통지 경로가 분류를 빠뜨리면 컴파일이 멈춰야 한다. 경로 이벤트는 Kit `guideEventSpeechClass`가 정본이다.
    private func announce(
        _ message: String, highPriority: Bool = false, speechClass: GuideSpeechClass,
        onDropped: (() -> Void)? = nil
    ) {
        deferredAnnouncer.announce(
            message, highPriority: highPriority, speechClass: speechClass, onDropped: onDropped)
    }

    /// 사용자 활성화의 **직접 응답** 전용 즉시 창구(목적지 전환 확인 — §4-6).
    /// 즉시성이 문장의 본질이라 톤과 겹치더라도 미루지 않는다. 슬롯 무효화(§4-1)는
    /// `DeferredAnnouncer.announceNow`가 소유한다(수명 테스트가 그쪽에서 강제).
    func announceNow(
        _ message: String, highPriority: Bool = false, bypassSuppression: Bool = false
    ) {
        deferredAnnouncer.announceNow(
            message, highPriority: highPriority, bypassSuppression: bypassSuppression)
    }

    /// 실제 게시(spokenUnits 경유). 지연은 타이밍만 바꾸고 실패 처리 계약은 바꾸지
    /// 않는다(§4-4) — 대기가 끝난 게시 시도도 억제 가드 → 전경 가드 →
    /// `missedAnnouncement` → 게시의 같은 경로를 지난다. 반환 = 실제로 게시했는가.
    @discardableResult
    private func post(
        _ message: String, highPriority: Bool, bypassSuppression: Bool,
        speechClass: GuideSpeechClass, onLateDrop: (() -> Void)?
    ) -> Bool {
        // bypassSuppression은 목적지 전환 확인 통지 전용(스펙 2026-08-12 §3.1) —
        // 검색 시트 dismiss와 억제 해제의 경합에서 사용자 활성화의 직접 응답이
        // 버려지는 창을 막는다(마이크는 select 시점에 이미 닫혀 전사 오염 없음).
        guard bypassSuppression || !outputSuppressed else { return false }
        // 운전자 채널(K2 §6.2): VO 통지가 아니라 스피커 발화. 채널 술어 **앞**이다 — 토글·분류와 무관하게
        // 잠금 중 발화가 목적 그 자체이고(E53 spec §2), 오디오 세션(.playback)은 BeaconTonePlayer가 쥐고
        // 있다. 우선순위(VO 전용)는 무의미. `driverChannel`은 stop()이 지우지 않아 도착
        // 문장도 이 채널로 나간다(B10).
        if driverChannel {
            // 낭독 채널이라 거리 단위 정정(`spokenUnits`)은 같이 지난다(CLAUDE.md 거리 표기 계약).
            TtsPlayer.shared.speakGuidance(spokenUnits(message))
            return true
        }
        // 채널 선택은 게시 시점 상태로(E53 spec §2, 판정은 Kit). 백그라운드에서 버리는 문장은 **발화만** 막는다 —
        // `statusText`·`lastGuidance`는 호출부가 이미 갱신했으므로 복귀 시 화면이 최신이다(상태 갱신과 발화의 분리).
        // 정식판은 토글 실효값이 거짓이라 종전 그대로다(전경이면 VoiceOver 게시, 백그라운드면 버림).
        let channel = GuideSpeechOutput.channel(
            speechClass, foregroundDeviceSpeech: false, backgroundAudible: tones.isBackgroundAudible)
        // 계측(E53 실사용 판정 — 백그라운드 문장 빈도): 전경 VoiceOver 게시는 종전처럼 남기지 않고 백그라운드 판정만.
        if !GuideSpeechOutput.isForeground {
            guideDiagLog("bgSpeech channel=\(channel.rawValue) class=\(speechClass.rawValue) text=\(message)")
        }
        switch channel {
        case .voiceOver:
            GuideSpeechOutput.postVoiceOver(spokenUnits(message), highPriority: highPriority)
            return true
        case .device:
            // 들은 문장을 복귀 때 또 말하지 않는다(E53 §4.3): 마지막 상태를 들었으니 갚을 것이 없다. 대기 칸이
            // 나중에 버리면 상환 표식과 호출부 장부를 함께 되살린다.
            missedAnnouncement = false
            deviceSpeech.submit(
                spokenUnits(message), highPriority: highPriority, protected: false,
                bypassSuppression: bypassSuppression, speechClass: speechClass,
                onDropped: { [weak self] reason in
                    // 교체(더 새 문장이 이었다)는 상환 표식을 세우지 않는다 — 설계 리뷰 M1. 장부는 어느 쪽이든 되살린다.
                    if reason == .undelivered { self?.missedAnnouncement = true }
                    onLateDrop?()
                })
            return true
        case .drop:
            missedAnnouncement = true
            return false
        }
    }
}
