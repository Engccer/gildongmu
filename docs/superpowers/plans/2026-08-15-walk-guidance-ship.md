# 도보 실시간 안내 정식 출시 + 길찾기 공지 모달 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 도보 상세 실시간 안내를 정식판(Release)에 내보내고(플래그 졸업 + 백그라운드 모드·권한 문구 승격 + 화면 힌트 삭제), 길찾기 탭 1회성 공지 모달을 추가하며, 드리프트 가드 6종 + 산출물 가드로 되돌림을 차단한다.

**Architecture:** `AppConfig.realtimeGuidanceEnabled`를 `experimentalGuidanceEnabled`로 대체하고 도보 경로에서 플래그 검사를 삭제한다. 봉인의 판정 축은 플래그 참조가 아니라 `beacon.toggle` 세션 진입점 전수(spec §3.2 표)다. 공지 모달은 `.sheet` + `@AppStorage` 동형 키(`walkGuideNoticeV1`), 저장은 확인 버튼만.

**Tech Stack:** SwiftUI(iOS), Vitest 가드(웹 레인이 Swift 소스를 읽어 대조 — `format-drift.test.ts` 선례), bash 빌드 스크립트, xcstrings 파이프라인(`messages-to-xcstrings.mjs`).

**Spec:** `docs/superpowers/specs/2026-08-15-walk-guidance-ship-design.md` (확정본 — codex 적대적 리뷰 12건 반영 완료. 문안 §5.4는 위원장 확정본이라 재작성 금지)

## Global Constraints

- **문안은 §5.4 verbatim.** 재작성·윤문 금지. 인사 한 줄만 합쇼체+느낌표인 것도 판정이다.
- **`GuideTuning` 상수 일체 변경 금지**(§9). `courseAxisEnabled`(walk만 켬)도 유지.
- **웹(src/)은 범위 밖** — 단 `beacon.screenHint` 웹 사용처는 반드시 남긴다(§4.4).
- **버전 숫자를 하드코딩하지 않는다.** spec 표제 "1.4"는 낡은 표기다(repo는 1.6 제출 완료, 다음은 1.7). 코드·주석에 버전 대신 날짜(2026-08-15)나 spec 파일명으로 지칭.
- 주석·커밋 메시지 한국어, 변수·함수명 영어. 커밋 이메일 `engccer@gmail.com`.
- `git add -A` 금지 — `git commit -- <경로들>` pathspec 커밋.
- UI 문자열에 이모지·em dash 금지.
- 구현 방식은 판정 완료(재판정 금지): §4.1·§4.2·§4.4 위임(파일 겹침 없음), §3+§5 inline(같은 `DirectionsTabView.swift`), §7.1·§7.2는 구현 완료 후 위임. 리뷰는 방식과 무관하게 별도 컨텍스트.
- 서브에이전트는 커밋·push하지 않는다(부모가 검증 후 pathspec 커밋).

## 파일 구조

| 파일 | 작업 | 태스크 |
|---|---|---|
| `ios/Gildongmu/AppConfig.swift` | 플래그 교체 | 1 |
| `ios/Gildongmu/Directions/DirectionsTabView.swift` | 게이트 5곳 + 폴백 버튼 + 모달 제시 | 1, 2 |
| `ios/Gildongmu/Directions/WalkGuideNoticeSheet.swift` | 신규(모달 뷰 + 저장 키) | 2 |
| `ios/i18n/ios-extra/{ko,en,es,fr,it,ja}.json` | `ios.directions.walkNotice` 9키 × 6로케일 | 2 |
| `ios/Gildongmu/Resources/Localizable.xcstrings` | 재생성(스크립트 산출물) | 2 |
| `ios/Support/Info.plist` | UIBackgroundModes 추가 | 3 |
| `ios/Gildongmu/Resources/InfoPlist.xcstrings` | 위치 권한 문구 ko만 교체 | 4 |
| `ios/scripts/experimental-infoplist.sh` | 권한 문구 제거 + 결과 검증 가드 | 4 |
| `ios/Gildongmu/Directions/BeaconTrackingSheet.swift` | screenHint 삭제 | 5 |
| `src/lib/__tests__/guidance-gate-drift.test.ts` | 신규(가드 6종) | 6 |
| `ios/scripts/check-release-artifact.mjs` | 신규(산출물 가드) | 7 |
| `ios/scripts/asc-submit.mjs` | 제출 전 산출물 가드 호출 | 7 |
| 문서 5종(CHANGELOG·PROGRESS·BACKLOG·CLAUDE.md·release-notes) | 분배 | 10 |

새 Swift 파일은 pbxproj 편집 불필요(`PBXFileSystemSynchronizedRootGroup` — 파일 시스템 동기화 그룹이라 자동 포함).

---

### Task 1: §3 게이트 졸업 (inline)

**Files:**
- Modify: `ios/Gildongmu/AppConfig.swift:18-46`
- Modify: `ios/Gildongmu/Directions/DirectionsTabView.swift` (게이트 4곳 1011-1059, 고지 1086-1089, 폴백 버튼 606-616, 주석 950-954·1076-1078)

**Interfaces:**
- Produces: `AppConfig.experimentalGuidanceEnabled: Bool` (`realtimeGuidanceEnabled`는 소멸 — repo 전체에서 참조 0이어야 하고 Task 6 가드가 강제)

- [ ] **Step 1: AppConfig 플래그 교체**

`realtimeGuidanceEnabled` 블록(doc 주석 포함, 18-46행)을 다음으로 대체:

```swift
    /// 아직 정식 출시하지 않은 안내 수단(자동차·대중교통·간략 단독 진입점)의 봉인.
    /// 도보 상세 안내는 정식 출시(2026-08-15, spec 2026-08-15-walk-guidance-ship-design.md)로
    /// 졸업해 이 플래그를 보지 않는다 — 이탈 판정 방위 축도 켠 채로 나간다(위원장 판정:
    /// 실험판과 정식판의 안내 동작을 같게 유지해 앞으로의 실보행 판정이 정식판에 그대로
    /// 적용되게 한다. 축을 끄면 갈림길 오진 원증상(A6)이 남는데 그쪽이 헛경고보다 위험하다).
    ///
    /// **값을 손으로 고치지 않는다. 빌드 구성이 정한다**(2026-08-04 전환). 봉인의 판정
    /// 축은 플래그 참조 목록이 아니라 **세션을 시작시키는 호출 전수**다(spec §3.2 표) —
    /// 신규 진입점을 만들면 그 표와 `guidance-gate-drift.test.ts`를 함께 갱신하는 것이
    /// 계약이다. 남은 셋을 하나로 묶는 이유: 셋의 운명이 같다(실주행·실승차 판정 대기).
    /// 자동차가 먼저 졸업하는 상황이 실제로 오면 그때 쪼갠다.
    ///
    /// ⚠ 수단이 실주행·실승차 판정을 통과해 정식 출시할 때는 여기서 그 수단의 검사를
    /// 삭제한다(플래그 졸업). 플래그가 쌓이지 않게 하는 것이 이 방식의 유일한 관리 포인트다.
    #if EXPERIMENTAL
    static let experimentalGuidanceEnabled = true
    #else
    static let experimentalGuidanceEnabled = false
    #endif
```

- [ ] **Step 2: DirectionsTabView 게이트 처리 (§3.2 표대로)**

`walkGuideStartable`(1011): 플래그 검사 삭제 —

```swift
    private var walkGuideStartable: Bool {
        guard AppLanguage.dataLocale == "ko", let results = model.results,
              case .walk = results.outcomes[.walk] else { return false }
        return true
    }
```

`carGuideStartable`(1019)·`transitGuideStartable`(1031)·`altTransitGuideStartable`(1042)·`briefFallbackVisible`(1056): `AppConfig.realtimeGuidanceEnabled` → `AppConfig.experimentalGuidanceEnabled` 단순 치환(guard 구조 불변).

`manualOriginNoticeText`(1086): 플래그 검사 삭제 —

```swift
    private var manualOriginNoticeText: String? {
        guard model.resultsUsedManualOrigin else { return nil }
        return appLocalized("manualLocation.guideNeedsRealLocation")
    }
```

같은 property의 doc 주석 중 "⚠ 봉인 플래그도 여기서 재확인한다…" 문단(1076-1078)을 다음으로 교체:

```swift
    /// ⚠ 봉인 플래그를 보지 않는다(도보 졸업, spec 2026-08-15 §3.2) — 정식판에서 도보
    /// 안내를 시작할 수 있게 된 순간부터 이 고지는 정식판 사용자에게 필요한 문장이다.
    /// `experimentalGuidanceEnabled`로 치환하면 그 사용자만 고지 없이 안내를 시작한다.
```

- [ ] **Step 3: 간략 단독 시작 버튼 봉인 (§3.3)**

606-616행의 버튼을 조건으로 감싼다(라벨 삼항·액션·accessibilityFocused는 그대로):

```swift
                        // 이 버튼은 두 얼굴이다: 추적 중엔 중지 이중 방어(항상 유효),
                        // 비추적이면 간략 단독 시작(실험판 전용 — 정식판의 간략 상태는
                        // 세션이 경로를 잃었을 때의 내부 강등뿐이다, spec §3.3). 정식판
                        // 실패 상태 화면에 이 버튼이 남으면 봉인이 뚫린다.
                        if beacon.isTracking || AppConfig.experimentalGuidanceEnabled {
                            Button(beacon.isTracking
                                ? appLocalized("beacon.stop")
                                : appLocalized("beacon.briefGuideStart")
                            ) {
                                lastGuideStart = .fallback
                                beacon.toggle(
                                    dest: tracked.dest, label: tracked.label, kind: .walk,
                                    accessible: model.stepFreeEnabled
                                )
                            }
                            .accessibilityFocused($guideStartFocused, equals: .fallback)
                        }
```

`633`(정밀 위치 허용 후 재시작)은 **그대로 둔다**(§3.3 — 도달 조건이 "이미 실패한 도보 세션"이라 정당).

- [ ] **Step 4: 낡은 주석 2곳 정리**

`startWalkHandoff` doc 주석(950-954)의 "세션 자체가 realtimeGuidanceEnabled ∧ ko 게이트 안에서만 존재"를 "이 핸드오프는 대중교통 세션 안에서만 호출되고 그 세션이 `experimentalGuidanceEnabled ∧ ko` 게이트 안에서만 존재한다(spec §3.2 964행)"로 교체.

- [ ] **Step 5: 참조 잔존 확인**

Run: `grep -rn "realtimeGuidanceEnabled" ios/ src/`
Expected: 0건 (문서 제외 — `--include='*.swift'`로 한정)

- [ ] **Step 6: Commit**

```bash
git commit -m "feat(ios): 도보 실시간 안내 게이트 졸업 — experimentalGuidanceEnabled로 봉인 재편(spec §3)" -- ios/Gildongmu/AppConfig.swift ios/Gildongmu/Directions/DirectionsTabView.swift
```

---

### Task 2: §5 길찾기 탭 공지 모달 (inline)

**Files:**
- Create: `ios/Gildongmu/Directions/WalkGuideNoticeSheet.swift`
- Modify: `ios/Gildongmu/Directions/DirectionsTabView.swift` (상태 1개 + `.sheet` 1개 + `.task` 확장, 858행 부근)
- Modify: `ios/i18n/ios-extra/{ko,en,es,fr,it,ja}.json` (`ios.directions.walkNotice` 9키)
- Regenerate: `ios/Gildongmu/Resources/Localizable.xcstrings`

**Interfaces:**
- Produces: `WalkGuideNotice.key = "walkGuideNoticeV1"`, `WalkGuideNotice.confirmed: Bool`, `WalkGuideNoticeSheet(onConfirm: () -> Void)`

- [ ] **Step 1: i18n 9키 × 6로케일**

각 `ios/i18n/ios-extra/{locale}.json`의 `ios.directions` 아래에 `walkNotice` 객체를 추가한다. **키 순서는 화면 순서**(§5.5): `title` · `intro` · `head1` · `body1` · `head2` · `body2` · `body3` · `body4` · `confirm`.

ko (§5.4 verbatim — 한 글자도 바꾸지 말 것):

```json
"walkNotice": {
  "title": "도보 안내 기능이 추가되었어요.",
  "intro": "길동무 앱을 이용해 주셔서 감사합니다!",
  "head1": "바뀐 것",
  "body1": "이제 길찾기 탭에서 경로를 조회하면 도보 섹션에 \"도보 안내 시작\" 버튼이 나와요. 버튼을 누르면 실시간 안내가 시작돼요. 안내를 받는 동안 도착지까지 남은 거리, 현재 구간의 남은 거리, 다음 안내 등을 화면에서 바로 확인하실 수 있어요. 안내 중에는 화면을 잠가도 백그라운드에서 작동해요.",
  "head2": "유의해야 할 것",
  "body2": "안내는 API가 주는 지도 데이터와 GPS를 기반으로 이루어져요. 따라서 실제 상황과는 차이가 있을 수 있어요.",
  "body3": "횡단보도 등에서는 특별히 유의해 주세요. 이 앱의 안내를 보조 정보로만 사용하시고, 익숙한 길에서 먼저 테스트해 주세요.",
  "body4": "대중교통과 자동차 실시간 안내는 준비 중이에요.",
  "confirm": "확인"
}
```

비한국어 5로케일(노출은 ko 전용이지만 파이프라인 키 수 정합 + 장래 게이트 해제 대비, §5.5). 버튼·탭 명칭은 각 로케일의 실제 라벨을 인용한다(탭: Directions·Cómo llegar·Itinéraire·Indicazioni·経路 / 버튼: `beacon.guideStartWalk`의 각 로케일 값):

en:

```json
"walkNotice": {
  "title": "Walking guidance is here.",
  "intro": "Thank you for using Gildongmu!",
  "head1": "What's new",
  "body1": "When you look up a route in the Directions tab, the walking section now shows a \"Start walking guidance\" button. Tap it to begin real-time guidance. While guidance is active, the screen shows the remaining distance to your destination, the distance left in the current segment, and the next instruction. Guidance keeps working in the background even when the screen is locked.",
  "head2": "Things to keep in mind",
  "body2": "Guidance is based on map data from external APIs and on GPS, so it may differ from actual conditions.",
  "body3": "Take special care at crosswalks. Use this app's guidance only as supplementary information, and try it first on routes you already know.",
  "body4": "Real-time transit and driving guidance are on the way.",
  "confirm": "OK"
}
```

es:

```json
"walkNotice": {
  "title": "Llega la guía a pie.",
  "intro": "¡Gracias por usar Gildongmu!",
  "head1": "Novedades",
  "body1": "Ahora, al consultar una ruta en la pestaña Cómo llegar, la sección a pie muestra el botón \"Iniciar guía a pie\". Púlsalo para comenzar la guía en tiempo real. Durante la guía, la pantalla muestra la distancia restante hasta tu destino, la distancia que queda del tramo actual y la siguiente indicación. La guía sigue funcionando en segundo plano aunque la pantalla esté bloqueada.",
  "head2": "A tener en cuenta",
  "body2": "La guía se basa en datos de mapas de APIs externas y en el GPS, por lo que puede diferir de la situación real.",
  "body3": "Ten especial cuidado en los pasos de peatones. Usa la guía de esta app solo como información complementaria y pruébala primero en caminos que ya conozcas.",
  "body4": "La guía en tiempo real de transporte público y coche está en preparación.",
  "confirm": "Aceptar"
}
```

fr:

```json
"walkNotice": {
  "title": "Le guidage à pied est arrivé.",
  "intro": "Merci d'utiliser Gildongmu !",
  "head1": "Nouveautés",
  "body1": "Désormais, lorsque vous recherchez un itinéraire dans l'onglet Itinéraire, la section à pied affiche le bouton \"Démarrer le guidage à pied\". Appuyez dessus pour lancer le guidage en temps réel. Pendant le guidage, l'écran affiche la distance restante jusqu'à votre destination, la distance restante du tronçon en cours et la prochaine instruction. Le guidage continue de fonctionner en arrière-plan même lorsque l'écran est verrouillé.",
  "head2": "À garder à l'esprit",
  "body2": "Le guidage repose sur les données cartographiques d'API externes et sur le GPS ; il peut donc différer de la situation réelle.",
  "body3": "Soyez particulièrement vigilant aux passages piétons. Utilisez le guidage de cette application uniquement comme information complémentaire et essayez-le d'abord sur des trajets que vous connaissez déjà.",
  "body4": "Le guidage en temps réel pour les transports en commun et la voiture est en préparation.",
  "confirm": "OK"
}
```

it:

```json
"walkNotice": {
  "title": "La guida a piedi è arrivata.",
  "intro": "Grazie per usare Gildongmu!",
  "head1": "Novità",
  "body1": "Ora, quando cerchi un percorso nella scheda Indicazioni, la sezione a piedi mostra il pulsante \"Avvia guida a piedi\". Toccalo per avviare la guida in tempo reale. Durante la guida, lo schermo mostra la distanza rimanente fino alla destinazione, la distanza che resta del tratto corrente e la prossima indicazione. La guida continua a funzionare in background anche con lo schermo bloccato.",
  "head2": "Da tenere presente",
  "body2": "La guida si basa sui dati cartografici di API esterne e sul GPS, quindi può differire dalla situazione reale.",
  "body3": "Presta particolare attenzione agli attraversamenti pedonali. Usa la guida di questa app solo come informazione complementare e provala prima su percorsi che già conosci.",
  "body4": "La guida in tempo reale per i mezzi pubblici e l'auto è in preparazione.",
  "confirm": "OK"
}
```

ja:

```json
"walkNotice": {
  "title": "徒歩案内機能が追加されました。",
  "intro": "ギルドンムをご利用いただきありがとうございます!",
  "head1": "変わったこと",
  "body1": "経路タブでルートを検索すると、徒歩セクションに「徒歩案内を開始」ボタンが表示されるようになりました。ボタンを押すとリアルタイム案内が始まります。案内中は、目的地までの残り距離、現在区間の残り距離、次の案内などを画面ですぐに確認できます。案内中は画面をロックしてもバックグラウンドで動作します。",
  "head2": "ご注意いただきたいこと",
  "body2": "案内はAPIが提供する地図データとGPSに基づいています。そのため、実際の状況とは異なる場合があります。",
  "body3": "横断歩道などでは特にご注意ください。このアプリの案内は補助情報としてのみ使用し、慣れた道で先にお試しください。",
  "body4": "公共交通機関と自動車のリアルタイム案内は準備中です。",
  "confirm": "OK"
}
```

⚠ ja `intro`의 느낌표는 반각 `!`(전각 `！` 아님 — ko 원문과 같은 문자). ja 앱 명칭 표기는 기존 ja 로케일의 자기 지칭 관례를 따른다(작업 시 `ja.json`에서 앱 이름 등장 표기를 확인해 맞춘다 — 없으면 위 그대로).

- [ ] **Step 2: xcstrings 재생성 + 키 검사**

Run: `node ios/scripts/messages-to-xcstrings.mjs app && node ios/scripts/check-xcstrings-keys.mjs`
Expected: 재생성 성공. 키 검사는 아직 Swift 참조가 없어 통과(참조 추가는 Step 3 뒤 재실행).

- [ ] **Step 3: WalkGuideNoticeSheet.swift 신규**

```swift
import SwiftUI

/// 도보 안내 정식 출시 1회성 공지의 저장 키(spec 2026-08-15 §5). `AIChatConsent` 동형 —
/// 뷰는 상태로, 표시 판정은 `confirmed`로 같은 키를 읽는다. 키의 V1은 공지 버전이다:
/// 자동차·대중교통을 추가할 때 V2 키로 새 공지를 낸다.
enum WalkGuideNotice {
    static let key = "walkGuideNoticeV1"
    static var confirmed: Bool { UserDefaults.standard.bool(forKey: key) }
}

/// 길찾기 탭 진입 시 1회 공지 시트(spec §5). 계약은 "한 번 뜨면 다시 안 뜬다"가 아니라
/// **"확인을 누르면 다시 뜨지 않는다"**다 — 드래그·VoiceOver 탈출은 막지 않되(1급
/// 사용자의 표준 탈출 수단이라 `interactiveDismissDisabled` 금지) 저장하지 않아 다음
/// 탭 진입에 다시 뜬다. 저장은 호출부의 onConfirm이 한다.
///
/// 접근성(§5.3): 제목·소제목 2개는 별도 Text + `.isHeader`(마크다운 `###`은 렌더되지
/// 않는다 — 본문 문자열에 합치면 헤딩이 성립하지 않는다). 본문은 문단마다 별도 Text
/// (블록별 접근성 객체, 헌장 §6). 모달 등장 자체가 발화되므로 별도 통지 없음.
struct WalkGuideNoticeSheet: View {
    let onConfirm: () -> Void

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                Text(appLocalized("ios.directions.walkNotice.title"))
                    .font(.title2.bold())
                    .accessibilityAddTraits(.isHeader)
                Text(appLocalized("ios.directions.walkNotice.intro"))
                Text(appLocalized("ios.directions.walkNotice.head1"))
                    .font(.headline)
                    .accessibilityAddTraits(.isHeader)
                Text(appLocalized("ios.directions.walkNotice.body1"))
                Text(appLocalized("ios.directions.walkNotice.head2"))
                    .font(.headline)
                    .accessibilityAddTraits(.isHeader)
                Text(appLocalized("ios.directions.walkNotice.body2"))
                Text(appLocalized("ios.directions.walkNotice.body3"))
                Text(appLocalized("ios.directions.walkNotice.body4"))
                Button(appLocalized("ios.directions.walkNotice.confirm"), action: onConfirm)
                    .buttonStyle(.borderedProminent)
                    .frame(minHeight: 44)
            }
            .padding()
        }
    }
}
```

- [ ] **Step 4: DirectionsTabView 제시 배선**

상태 추가(485행 `beacon` 부근):

```swift
    /// 도보 안내 1회성 공지(spec 2026-08-15 §5). 저장은 확인 버튼만 — 시스템 닫기는
    /// 저장하지 않아 다음 탭 진입(.task 재실행)에 다시 뜬다.
    @State private var walkNoticePresented = false
```

`.task`(858행) 확장 — 조건(미확인 ∧ 한국어, §5.2)을 await보다 먼저 평가해 진입 즉시 띄운다:

```swift
            .task {
                if !WalkGuideNotice.confirmed, AppLanguage.dataLocale == "ko" {
                    walkNoticePresented = true
                }
                await model.loadCurrentAddressIfAuthorized()
            }
```

시트 추가(대중교통 시트 `.sheet` 뒤, 780행 부근):

```swift
            // 도보 안내 정식 출시 1회성 공지(spec §5). 다른 두 시트와 달리 세션 상태에
            // 묶이지 않는다 — 첫 진입에는 어느 시트도 떠 있지 않아 경합이 없다.
            .sheet(isPresented: $walkNoticePresented) {
                WalkGuideNoticeSheet {
                    UserDefaults.standard.set(true, forKey: WalkGuideNotice.key)
                    walkNoticePresented = false
                }
            }
```

- [ ] **Step 5: 키 검사 재실행**

Run: `node ios/scripts/check-xcstrings-keys.mjs`
Expected: `[app]` 누락 0건

- [ ] **Step 6: Commit**

```bash
git commit -m "feat(ios): 길찾기 탭 도보 안내 1회성 공지 모달 — 확인 버튼만 저장(spec §5)" -- ios/Gildongmu/Directions/WalkGuideNoticeSheet.swift ios/Gildongmu/Directions/DirectionsTabView.swift ios/i18n/ios-extra/ko.json ios/i18n/ios-extra/en.json ios/i18n/ios-extra/es.json ios/i18n/ios-extra/fr.json ios/i18n/ios-extra/it.json ios/i18n/ios-extra/ja.json ios/Gildongmu/Resources/Localizable.xcstrings
```

---

### Task 3: §4.1 정식 Info.plist 백그라운드 모드 (위임)

**Files:**
- Modify: `ios/Support/Info.plist`

**Interfaces:**
- Produces: 정식판 `UIBackgroundModes = [location, audio]` (Task 6 가드 4번·Task 7 산출물 가드가 검증)

- [ ] **Step 1: dict 안에 키 추가** (기존 `NSLocationTemporaryUsageDescriptionDictionary` 뒤)

```xml
	<!-- 백그라운드 위치·오디오(도보 안내 정식 출시, spec 2026-08-15 §4.1): 잠금 화면에서
	     세션 생존 + 톤 재생. 역할이 갈린다 — 앱을 깨어 있게 유지하는 것은 location이고
	     audio는 재생만 허용한다(위치만 승격 시 무음, 2026-08-07 실측). When In Use로
	     충분(전경 시작 세션). 심사 노트에 백그라운드 오디오 용도를 명시할 것(§6). -->
	<key>UIBackgroundModes</key>
	<array>
		<string>location</string>
		<string>audio</string>
	</array>
```

`Info-Experimental.plist`는 그대로 둔다(두 파일 수동 동기화가 기존 계약 — 그 파일의 "졸업하면 옮긴다" 주석 문단은 이행됐으므로 "정식판도 동일 선언(2026-08-15 졸업)"으로 한 줄 정리).

- [ ] **Step 2: 문법 검증**

Run: `plutil -lint ios/Support/Info.plist ios/Support/Info-Experimental.plist`
Expected: 둘 다 OK

- [ ] **Step 3: Commit** (부모가 수행)

```bash
git commit -m "feat(ios): 정식판 UIBackgroundModes(location·audio) 승격 — 잠금 화면 안내 생존(spec §4.1)" -- ios/Support/Info.plist ios/Support/Info-Experimental.plist
```

---

### Task 4: §4.2 위치 권한 문구 ko 교체 + 스크립트 개정 (위임)

**Files:**
- Modify: `ios/Gildongmu/Resources/InfoPlist.xcstrings` (`NSLocationWhenInUseUsageDescription`의 ko만)
- Modify: `ios/scripts/experimental-infoplist.sh`

**Interfaces:**
- Produces: ko 권한 문구에 거리 안내 절 포함(마커 문자열 "남은 거리를 소리로"), 스크립트는 표시 이름 접미사 전용 + 결과 검증(Task 6 가드 5번·Task 7이 검증)

- [ ] **Step 1: xcstrings ko 값 교체**

`NSLocationWhenInUseUsageDescription`의 ko `value`를 스크립트 `location_purpose()` ko 문구로:

> 현재 위치에서 가까운 교통, 장소와 생활 정보를 찾고, 목적지까지 남은 거리를 소리로 안내하기 위해 위치를 사용합니다.

en·es·fr·it·ja는 **현행 유지**(도보 안내가 ko 게이트 안이라 비한국어 정식판에는 없는 기능 — 설명하면 안 된다, 리뷰 #6).

- [ ] **Step 2: 스크립트 개정** — `location_purpose()` 함수와 purpose 처리 블록을 삭제하고, `changed` 파일-존재 카운트를 결과 검증으로 교체. for 루프 이후 전문:

```bash
#!/bin/bash
# Experimental 구성에서만 앱 표시 이름에 " 실험" 접미사를 붙인다.
#
# 왜 빌드 후처리인가: `InfoPlist.xcstrings`의 로컬라이제이션이 빌드 설정
# `INFOPLIST_KEY_*`를 **이긴다**(실측 2026-08-04). 그래서 구성별로 다른 값을 주려면
# 컴파일된 `*.lproj/InfoPlist.strings`를 고치는 수밖에 없다. 서명 전에 돈다.
#
# 표시 이름만 다루는 이유(2026-08-15 개정, spec 2026-08-15-walk-guidance-ship §4.2):
#  - 표시 이름: 아이콘 표식은 시각 구분이라 VoiceOver 사용자에겐 **이름이 유일한
#    구분 수단**이다. 공식판과 실험판이 홈 화면에서 같은 이름이면 못 고른다.
#  - 위치 권한 문구는 더 이상 여기서 만지지 않는다: 도보 안내 정식 출시로 거리 안내
#    절이 정식 문구(InfoPlist.xcstrings ko)에 들어갔다. 같은 값을 두 곳이 관리하면
#    다음 개정 때 갈린다(실험판 비한국어 문구가 한 절 부족한 것은 과소 설명이라
#    심사 위험이 아니다).
set -uo pipefail

[ "${CONFIGURATION:-}" = "Experimental" ] || exit 0

RES="${TARGET_BUILD_DIR:?}/${UNLOCALIZED_RESOURCES_FOLDER_PATH:?}"
SUFFIX=" 실험"

# 결과 검증 가드(리뷰 #9): 종전 카운트는 파일 존재만 세서 추출 실패·replace 실패를
# 성공으로 계산했다. 접미사가 실제로 붙었는지 **다시 읽어** 확인하고, 한 로케일이라도
# 실패하면 빌드를 멈춘다 — 스크린 리더 사용자에게 표시 이름은 두 앱을 구분하는
# 유일한 수단이라, 공식판 이름 그대로 나가는 실험판은 조용한 접근성 결함이다.
verified=0
for f in "$RES"/*.lproj/InfoPlist.strings; do
  [ -f "$f" ] || continue
  lang=$(basename "$(dirname "$f")" .lproj)

  name=$(plutil -extract CFBundleDisplayName raw -o - "$f" 2>/dev/null) || name=""
  if [ -z "$name" ]; then
    echo "error: ${lang} InfoPlist.strings에서 CFBundleDisplayName을 읽지 못했습니다 ($f)" >&2
    exit 1
  fi
  # 증분 빌드에서 접미사가 겹치지 않게 한다(alwaysOutOfDate라 매 빌드 실행된다).
  case "$name" in
    *"$SUFFIX") : ;;
    *) plutil -replace CFBundleDisplayName -string "${name}${SUFFIX}" "$f" ;;
  esac

  final=$(plutil -extract CFBundleDisplayName raw -o - "$f" 2>/dev/null) || final=""
  case "$final" in
    *"$SUFFIX") verified=$((verified + 1)) ;;
    *)
      echo "error: ${lang} 표시 이름에 접미사가 붙지 않았습니다 (현재: ${final:-읽기 실패})" >&2
      exit 1
      ;;
  esac
done

# 리소스가 하나도 안 잡히면 조용히 통과하지 않는다. 경로 상수가 바뀌면 표시 이름이
# 공식판 값 그대로 나가는데, 빌드는 성공하므로 알아챌 방법이 없다.
if [ "$verified" -eq 0 ]; then
  echo "error: InfoPlist.strings를 찾지 못했습니다 ($RES)" >&2
  exit 1
fi

# ⚠ 메인 Info.plist는 여기서 후처리할 수 없다: `ProcessInfoPlistFile`이 이 스크립트
# **뒤에** 매 빌드 실행되어 덮어쓴다(실측 2026-08-06 — 스크립트가 만진 산출물이
# 다음 재처리를 유발해 영원히 진다). 구성별로 달라야 하는 **비로컬라이즈** plist
# 키(UIBackgroundModes 등)는 `Support/Info-Experimental.plist`(부분 plist 입력
# 분기)가 정본이고, 이 스크립트는 로컬라이즈 문자열(InfoPlist.strings) 전용이다.
echo "실험판 InfoPlist 후처리: ${verified}개 로케일 표시 이름 검증 통과"
```

- [ ] **Step 3: 검증**

Run: `bash -n ios/scripts/experimental-infoplist.sh && grep -c "NSLocationWhenInUseUsageDescription" ios/scripts/experimental-infoplist.sh; python3 -c "import json; d=json.load(open('ios/Gildongmu/Resources/InfoPlist.xcstrings')); locs=d['strings']['NSLocationWhenInUseUsageDescription']['localizations']; assert '남은 거리를 소리로' in locs['ko']['stringUnit']['value']; assert all('distance' not in locs[l]['stringUnit']['value'].lower() or l=='ko' for l in locs); print('OK')"`
Expected: 문법 OK, grep 0(exit 1이지만 카운트 0), python OK

- [ ] **Step 4: Commit** (부모)

```bash
git commit -m "feat(ios): 위치 권한 문구 ko에 거리 안내 절 + 실험판 스크립트 표시 이름 전용·결과 검증(spec §4.2)" -- ios/Gildongmu/Resources/InfoPlist.xcstrings ios/scripts/experimental-infoplist.sh
```

---

### Task 5: §4.4 안내 시트 화면 힌트 삭제 (위임)

**Files:**
- Modify: `ios/Gildongmu/Directions/BeaconTrackingSheet.swift` (49-53행 상태·키, 158-171행 UI)

**Interfaces:**
- Produces: iOS 소스에서 `beacon.screenHint`·`beaconScreenHintDismissed` 참조 0 (Task 6 가드 6번이 검증). 웹(`src/components/DistanceBeacon.tsx`)은 **건드리지 않는다** — 브라우저 탭은 실제로 백그라운드에서 멈추므로 그 문장이 참이다.

- [ ] **Step 1: 삭제**

- 49-53행: `screenHintDismissedKey` 상수·`screenHintDismissed` 상태와 그 doc 주석 삭제.
- 158-171행: `if !screenHintDismissed { … }` 블록 전체 삭제(Text + "다시 보지 않음" Button). 그 자리에 삭제 근거 주석 한 줄:

```swift
                // 화면 켜기 힌트는 정식 백그라운드 승격으로 삭제(spec 2026-08-15 §4.4) —
                // 진짜 무음 상황은 위 soundDegraded 행이 런타임 판정으로, 더 정확한
                // 문구로 알린다. 상시 문장을 재도입하지 말 것(런타임 판정이 있는 자리에
                // 언제나 참인 척하는 문장을 얹으면 플랫폼 능력이 바뀔 때 거짓만 남는다).
```

- `landStopFocus()` 함수 자체는 남긴다(재조회 성공 경로가 계속 쓴다).

- [ ] **Step 2: 검증**

Run: `grep -rn "screenHint\|beaconScreenHintDismissed" ios/`
Expected: 0건

- [ ] **Step 3: Commit** (부모)

```bash
git commit -m "fix(ios): 안내 시트 화면 켜기 힌트 삭제 — 백그라운드 승격으로 거짓 문장화(spec §4.4)" -- ios/Gildongmu/Directions/BeaconTrackingSheet.swift
```

---

### Task 6: §7.1 소스 드리프트 가드 6종 (구현 완료 후 위임)

**Files:**
- Create: `src/lib/__tests__/guidance-gate-drift.test.ts`

**Interfaces:**
- Consumes: Task 1-5의 최종 소스 상태. `AppConfig.experimentalGuidanceEnabled`, `beacon.toggle(` 6곳, `ios/Support/Info.plist`의 UIBackgroundModes.

- [ ] **Step 1: 테스트 작성** (전문)

```ts
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * 도보 안내 정식 출시 게이트 드리프트 가드(spec 2026-08-15 §7.1).
 *
 * 판정 축은 플래그 참조 목록이 아니라 **세션을 시작시키는 호출 전수**다(spec §3.2 표).
 * 플래그 참조만 세면 "진입점인데 플래그를 안 보는 자리"를 놓친다 — 가드 3(진입점 수
 * 감시)이 그 실패를 막는 유일한 자동 장치다.
 */

const REPO = join(__dirname, "../../..");
const TAB_PATH = "ios/Gildongmu/Directions/DirectionsTabView.swift";
const TAB = readFileSync(join(REPO, TAB_PATH), "utf8");

function swiftFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) swiftFiles(p, out);
    else if (name.endsWith(".swift")) out.push(p);
  }
  return out;
}

/** 선언 지점부터 다음 멤버 선언 전까지(간이 절단 — 게이트 property는 전부 한 화면 안). */
function memberBody(source: string, decl: string): string {
  const start = source.indexOf(decl);
  if (start === -1) throw new Error(`${decl} 선언을 찾지 못했다`);
  const rest = source.slice(start + decl.length);
  const end = rest.search(/\n    (?:private |@|\/\/\/)*(?:var|func|struct) /);
  return rest.slice(0, end === -1 ? undefined : end);
}

/** 마커 문자열 직전 window(간이 — 게이트 조건은 버튼 선언 바로 위 if에 있다). */
function windowBefore(source: string, marker: string, size = 700): string {
  const i = source.indexOf(marker);
  if (i === -1) throw new Error(`${marker}를 찾지 못했다`);
  return source.slice(Math.max(0, i - size), i);
}

describe("봉인 유지 (spec §3.2 표의 차단 행)", () => {
  it("자동차·대중교통·간략 폴백 게이트가 experimentalGuidanceEnabled를 참조한다", () => {
    for (const decl of [
      "private var carGuideStartable",
      "private var transitGuideStartable",
      "private func altTransitGuideStartable",
      "private var briefFallbackVisible",
    ]) {
      expect(memberBody(TAB, decl)).toContain("AppConfig.experimentalGuidanceEnabled");
    }
  });

  it("간략 단독 시작 버튼(611)이 isTracking ∨ experimental 조건 안에 있다", () => {
    expect(windowBefore(TAB, '"beacon.briefGuideStart"')).toMatch(
      /if beacon\.isTracking \|\| AppConfig\.experimentalGuidanceEnabled/,
    );
  });

  it("자동차 시작 버튼(684)이 carGuideStartable 게이트 안에 있다", () => {
    expect(windowBefore(TAB, '"beacon.guideStartCar"')).toContain("carGuideStartable");
  });
});

describe("졸업 완료 (spec §3.2 표의 도달 행)", () => {
  it("walkGuideStartable·manualOriginNoticeText 본문에 봉인 플래그 참조가 없다", () => {
    for (const decl of [
      "private var walkGuideStartable",
      "private var manualOriginNoticeText",
    ]) {
      // doc 주석까지 끌려오지 않게 본문만: `{` 이후를 본다.
      const body = memberBody(TAB, decl);
      const impl = body.slice(body.indexOf("{"));
      expect(impl).not.toContain("GuidanceEnabled");
    }
  });

  it("구 플래그 realtimeGuidanceEnabled가 iOS 소스에 없다", () => {
    for (const f of swiftFiles(join(REPO, "ios"))) {
      expect(readFileSync(f, "utf8"), f).not.toContain("realtimeGuidanceEnabled");
    }
  });
});

describe("진입점 증가 감시 (spec §3.2·§7.1-3)", () => {
  it("beacon.toggle 호출 전수가 §3.2 표와 같다 (늘면 표를 갱신하고 도달 여부를 판정할 것)", () => {
    // 611 간략 단독(차단) · 633 정밀 재시작(도달 — 실패한 도보 세션의 재개) ·
    // 684 자동차(차단) · 964 대중교통→도보 인계(차단 — 봉인된 세션 안) ·
    // 1258 도보 추천(도달) · 1283 도보 최단(도달)
    let count = 0;
    for (const f of swiftFiles(join(REPO, "ios/Gildongmu"))) {
      count += (readFileSync(f, "utf8").match(/beacon\.toggle\(/g) ?? []).length;
    }
    expect(count).toBe(6);
  });
});

describe("백그라운드 모드 (spec §4.1·§7.1-4)", () => {
  it("정식 Info.plist의 UIBackgroundModes에 location·audio가 둘 다 있다", () => {
    const plist = readFileSync(join(REPO, "ios/Support/Info.plist"), "utf8");
    const block = /<key>UIBackgroundModes<\/key>\s*<array>([\s\S]*?)<\/array>/.exec(plist);
    expect(block, "UIBackgroundModes 블록 부재").not.toBeNull();
    expect(block![1]).toContain("<string>location</string>");
    expect(block![1]).toContain("<string>audio</string>");
  });
});

describe("권한 문구 단일 관리 (spec §4.2·§7.1-5)", () => {
  it("experimental-infoplist.sh가 권한 문구를 더 이상 만지지 않는다", () => {
    const sh = readFileSync(join(REPO, "ios/scripts/experimental-infoplist.sh"), "utf8");
    expect(sh).not.toContain("NSLocationWhenInUseUsageDescription");
  });

  it("정식 ko 권한 문구에 거리 안내 절이 있고 비한국어에는 없다", () => {
    const catalog = JSON.parse(
      readFileSync(join(REPO, "ios/Gildongmu/Resources/InfoPlist.xcstrings"), "utf8"),
    );
    const locs = catalog.strings.NSLocationWhenInUseUsageDescription.localizations;
    expect(locs.ko.stringUnit.value).toContain("남은 거리를 소리로");
    for (const locale of ["en", "es", "fr", "it", "ja"]) {
      // 거리 안내 절이 들어간 실험판 구문(remaining distance 계열)이 새어들지 않았는지.
      expect(locs[locale].stringUnit.value, locale).not.toMatch(
        /remaining distance|distancia restante|distance restante|distanza rimanente|残り距離/,
      );
    }
  });
});

describe("화면 힌트 부재 (spec §4.4·§7.1-6)", () => {
  it("iOS 소스에 screenHint 참조가 없다 (웹 src/는 참이라 스캔 밖)", () => {
    for (const f of swiftFiles(join(REPO, "ios"))) {
      const src = readFileSync(f, "utf8");
      expect(src, f).not.toContain("beacon.screenHint");
      expect(src, f).not.toContain("beaconScreenHintDismissed");
    }
  });
});

describe("가드 자체가 살아 있다", () => {
  it("memberBody는 없는 선언에서 조용히 통과하지 않는다", () => {
    expect(() => memberBody(TAB, "private var noSuchGate")).toThrow(/찾지 못했다/);
  });
  it("windowBefore는 없는 마커에서 조용히 통과하지 않는다", () => {
    expect(() => windowBefore(TAB, '"no.such.key"')).toThrow(/찾지 못했다/);
  });
});
```

- [ ] **Step 2: 실행 + 변이 검출력 확인**

Run: `npx vitest run src/lib/__tests__/guidance-gate-drift.test.ts`
Expected: PASS. 이어서 변이 1개(예: `walkGuideStartable`에 `AppConfig.experimentalGuidanceEnabled,` guard를 임시 삽입)로 red를 확인하고 되돌린다(변이 주입 관례 — 검출력 실측).

- [ ] **Step 3: Commit** (부모)

```bash
git commit -m "test: 도보 안내 게이트 드리프트 가드 6종 — 판정 축은 세션 진입점 전수(spec §7.1)" -- src/lib/__tests__/guidance-gate-drift.test.ts
```

---

### Task 7: §7.2 산출물 Info.plist 가드 (위임)

**Files:**
- Create: `ios/scripts/check-release-artifact.mjs`
- Modify: `ios/scripts/asc-submit.mjs` (제출 경로에 사전 점검 추가)

**Interfaces:**
- Consumes: Task 4의 마커 문자열("남은 거리를 소리로"), `InfoPlist.xcstrings`(비한국어 기대값의 정본).
- Produces: `node ios/scripts/check-release-artifact.mjs [경로]` — .app/.xcarchive를 받아 실패 시 exit 1. `asc-submit.mjs --submit`이 이 검사를 선행한다.

- [ ] **Step 1: 스크립트 작성** (전문)

```js
#!/usr/bin/env node
// Release 산출물의 최종 Info.plist·InfoPlist.strings 검사(spec 2026-08-15 §7.2).
//
// 소스 검사(guidance-gate-drift.test.ts)는 Release 대상이 다른 INFOPLIST_FILE을
// 참조하는 경우·병합 누락·Archive가 예상과 다른 구성을 쓰는 경우를 못 잡는다.
// 이 계열은 "빌드는 성공하고 전경에서는 완전히 정상"이라(§4.1) 산출물을 직접
// 읽는 것이 유일한 검출이다.
//
// 사용: node ios/scripts/check-release-artifact.mjs [.app 또는 .xcarchive 경로]
//   경로 생략 시 ios/build/*.xcarchive · /tmp/gildongmu-archive/*.xcarchive 중
//   최신을 찾는다. asc-submit.mjs --submit이 제출 직전에 호출한다(마지막 관문).
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const OFFICIAL_BUNDLE_ID = "space.dodoplanet.gildongmu";
const KO_GUIDANCE_MARKER = "남은 거리를 소리로";
const LOCALES = ["ko", "en", "es", "fr", "it", "ja"];

function plistJson(path) {
  return JSON.parse(execFileSync("plutil", ["-convert", "json", "-o", "-", path]));
}

function findApp(argPath) {
  const candidates = [];
  if (argPath) {
    candidates.push(argPath);
  } else {
    for (const dir of [join(REPO, "ios", "build"), "/tmp/gildongmu-archive"]) {
      if (!existsSync(dir)) continue;
      for (const name of readdirSync(dir)) {
        if (name.endsWith(".xcarchive")) candidates.push(join(dir, name));
      }
    }
    candidates.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
    candidates.splice(1);
  }
  const found = candidates[0];
  if (!found) {
    throw new Error(
      "검사할 산출물이 없습니다. Release 아카이브를 먼저 빌드하거나 경로를 인자로 주세요.",
    );
  }
  if (found.endsWith(".xcarchive")) {
    const appsDir = join(found, "Products", "Applications");
    const app = readdirSync(appsDir).find((n) => n.endsWith(".app"));
    if (!app) throw new Error(`${found}에 .app이 없습니다`);
    return join(appsDir, app);
  }
  return found;
}

const app = findApp(process.argv[2]);
const errors = [];
const info = plistJson(join(app, "Info.plist"));

console.log(
  `검사 대상: ${app}\n  ${info.CFBundleIdentifier} ${info.CFBundleShortVersionString} (${info.CFBundleVersion})`,
);

// 0) 실험판 산출물을 정식판으로 오검사하지 않는다.
if (info.CFBundleIdentifier !== OFFICIAL_BUNDLE_ID) {
  errors.push(`번들 ID가 정식판이 아닙니다: ${info.CFBundleIdentifier}`);
}

// 1) 백그라운드 모드(§4.1) — 없으면 잠금 화면에서 안내가 죽는데 전경은 정상이다.
const modes = info.UIBackgroundModes ?? [];
for (const mode of ["location", "audio"]) {
  if (!modes.includes(mode)) errors.push(`UIBackgroundModes에 ${mode}가 없습니다`);
}

// 2) 권한 문구(§4.2): ko에는 거리 안내 절, 비한국어는 카탈로그 정본과 일치
//    (일치 = 거리 안내 절 없는 공식 문구 그대로).
const catalog = JSON.parse(
  readFileSync(join(REPO, "ios/Gildongmu/Resources/InfoPlist.xcstrings"), "utf8"),
);
const expected = catalog.strings.NSLocationWhenInUseUsageDescription.localizations;
for (const locale of LOCALES) {
  const stringsPath = join(app, `${locale}.lproj`, "InfoPlist.strings");
  if (!existsSync(stringsPath)) {
    errors.push(`${locale}.lproj/InfoPlist.strings가 산출물에 없습니다`);
    continue;
  }
  const value = plistJson(stringsPath).NSLocationWhenInUseUsageDescription;
  if (locale === "ko") {
    if (!value?.includes(KO_GUIDANCE_MARKER)) {
      errors.push(`ko 권한 문구에 거리 안내 절이 없습니다: ${value}`);
    }
  } else if (value !== expected[locale].stringUnit.value) {
    errors.push(`${locale} 권한 문구가 카탈로그 정본과 다릅니다: ${value}`);
  }
}

if (errors.length > 0) {
  console.error("산출물 검사 실패:");
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}
console.log("산출물 검사 통과 (백그라운드 모드 + 권한 문구 6로케일)");
```

- [ ] **Step 2: asc-submit.mjs 배선**

`main()`의 SUBMIT 분기 진입 직전에(파일 구조를 읽고 정확한 위치는 작업 시 결정 — SUBMIT일 때만, `--check`·상태 조회는 제외):

```js
  if (SUBMIT) {
    // 산출물 사전 점검(spec 2026-08-15 §7.2) — 제출 직전이 마지막 관문이다.
    // 소스 검사로는 못 잡는 병합 누락·구성 오선택을 빌드 산출물에서 직접 확인한다.
    step("산출물 Info.plist 검사");
    execFileSync(
      "node",
      [join(dirname(fileURLToPath(import.meta.url)), "check-release-artifact.mjs")],
      { stdio: "inherit" },
    );
  }
```

(필요 import가 이미 있는지 확인하고 없으면 추가: `execFileSync`, `join`/`dirname`/`fileURLToPath`는 기존 import와 병합.)

- [ ] **Step 3: 검증 (Release 시뮬레이터 빌드 산출물로 실행)**

Run:
```bash
xcodebuild -project ios/Gildongmu.xcodeproj -scheme Gildongmu -configuration Release -destination 'generic/platform=iOS Simulator' -derivedDataPath /tmp/gildongmu-relcheck build
node ios/scripts/check-release-artifact.mjs /tmp/gildongmu-relcheck/Build/Products/Release-iphonesimulator/Gildongmu.app
```
Expected: "산출물 검사 통과". (이 실행이 §4.1·§4.2 결과의 산출물 수준 첫 검증이기도 하다.)

- [ ] **Step 4: Commit** (부모)

```bash
git commit -m "test(ios): Release 산출물 Info.plist 가드 + asc-submit 제출 전 배선(spec §7.2)" -- ios/scripts/check-release-artifact.mjs ios/scripts/asc-submit.mjs
```

---

### Task 8: 전체 빌드·테스트 검증 (inline)

- [ ] **Step 1: 웹 게이트 테스트 전량**

Run: `npm run test:run`
Expected: 전량 PASS (신규 가드 포함)

- [ ] **Step 2: Experimental 시뮬레이터 빌드 + 스크립트 결과 확인**

Run:
```bash
xcodebuild -project ios/Gildongmu.xcodeproj -scheme Gildongmu -configuration Experimental -destination 'generic/platform=iOS Simulator' -derivedDataPath /tmp/gildongmu-expcheck build
plutil -extract CFBundleDisplayName raw /tmp/gildongmu-expcheck/Build/Products/Experimental-iphonesimulator/Gildongmu.app/ko.lproj/InfoPlist.strings
```
Expected: 빌드 성공 + 표시 이름이 " 실험"으로 끝남(개정 스크립트의 결과 검증 통과 확인)

- [ ] **Step 3: 키 린터·xcstrings 결정론 재확인**

Run: `node ios/scripts/messages-to-xcstrings.mjs all && git status --short ios/ && node ios/scripts/check-xcstrings-keys.mjs`
Expected: 재실행이 diff 0(결정론), 키 누락 0

---

### Task 9: 리뷰 (별도 컨텍스트, 헌장 §리뷰 계층)

- [ ] **Step 1:** `superpowers:requesting-code-review` 규율대로 코드 리뷰 서브에이전트 디스패치. 넘기는 것: spec 경로 + 이 플랜 경로 + 커밋 범위(Task 1 이전 HEAD..현재). 세션 히스토리·생성 의도는 넘기지 않는다.
- [ ] **Step 2:** 지적 처리 — 즉시 지엽 패치 금지, 설계 결정과 충돌하면 기각하고 근거 기록(스펙이 이미 12건 리뷰를 반영했으므로 §11 표와 겹치는 지적은 그 판정을 인용).
- [ ] **Step 3:** 수정이 나오면 해당 가드·테스트 재실행 후 pathspec 커밋.

---

### Task 10: 문서 분배 (§8) + push

- [ ] **Step 1: `CHANGELOG.md`** — 날짜 항목: 도보 실시간 안내 정식 출시(게이트 졸업·백그라운드 승격·권한 문구·화면 힌트 삭제) + 공지 모달 + 가드 2종. 2~4줄 + spec 링크.
- [ ] **Step 2: `PROGRESS.md`** — 상태 한 줄: 도보 안내 정식판 도달, 자동차·대중교통·간략 단독 진입은 `experimentalGuidanceEnabled` 봉인 유지.
- [ ] **Step 3: `docs/BACKLOG.md`** — G3를 "자동차·대중교통·간략 단독 진입만 미도달"로 축소, F-a에 §3.5 반영(정식판 계측 로그 부재 — 원인 계측은 실험판, 시간·백그라운드 최종 판정은 정식판), A5 종결 확인(이미 2026-08-15 종결 표기됨 — 어긋나면 정정), §3.3의 재시작 variant 누락(최단 세션이 추천으로 재개) 신규 등재.
- [ ] **Step 4: `CLAUDE.md`** — 함정 4건 등재(간결히): ①봉인 축은 플래그 참조가 아니라 세션 시작 호출 전수(§3.2, 가드가 `beacon.toggle` 수를 센다 — 새 진입점은 표·가드 동시 갱신) ②간략 안내는 별도 모드가 아니라 세션 내부 상태(§3.3 — 시작 호출이 도보와 같다) ③백그라운드 모드 승격 누락은 전경에서 안 보인다(§4.1 — 산출물 가드가 정본) ④런타임 판정이 있는 자리에 상시 고지 문장을 얹지 않는다(§4.4).
- [ ] **Step 5: `docs/appstore/release-notes.md`** — 차기 버전(1.7, 빌드 13 — 1.6이 제출 완료라 spec의 "1.4"는 쓰지 않는다) What's New 초안: 도보 실시간 안내 + 공지 모달. **ko 노트에만** 도보 안내를 적는다(ko 게이트 — 1.6의 선례). `node scripts/build-release-notes.mjs` 재생성. 심사 노트(§6 백그라운드 오디오 용도)는 `1.0-submission-draft.md`의 심사 노트 절에 추가.
- [ ] **Step 6:** 문서 pathspec 커밋 + **push**(리뷰 통과 후 자동 — gildongmu 관례).

---

### Task 11: 실기기 Release 배포 + 위원장 검증 인계 (§7.3)

- [ ] **Step 1:** 기기 연결 확인(`xcrun devicectl list devices`). 병렬 세션이 있으면 배포 직전 알림(메모리 규율). 미연결이면 이 태스크를 BLOCKED로 보고하고 종료.
- [ ] **Step 2:** **권한 문구 검증이 재설치를 요구하므로 삭제를 맨 처음에**(사용자 지시): `xcrun devicectl device uninstall app --device <UDID> space.dodoplanet.gildongmu` 후 `CONFIGURATION=Release ./ios/deploy-device.sh`. 실험판도 갱신(`CONFIGURATION=Experimental ./ios/deploy-device.sh` — 両구성 기본 규율, 스크립트 개정 검증 겸용).
- [ ] **Step 3:** 위원장 실기기 판정 체크리스트 보고(§7.3 그대로): ①첫 실행 위치 권한 팝업 ko 문구에 거리 안내 절(재설치 직후 최우선 확인) ②도보 추천·최단 양쪽 시작 가능, 자동차·대중교통·간략 단독 버튼 부재(실패 상태 화면 포함) ③화면 끈 채 톤·음성 생존 + 안내 시트에 화면 힌트 없음 + `soundDegraded` 행 미노출 ④모달: 첫 진입 노출 → 확인 후 재실행에도 미노출 / 드래그·VO 탈출로 닫으면 재노출 / 제목 헤딩·문단 스와이프·열릴 때 제목 착지·확인 후 복귀 ⑤A12 체감 + 백그라운드를 정식판에서 한 번 실보행.

## Self-Review 기록

- **Spec coverage**: §3.1-3.4(Task 1), §3.5(Task 10 BACKLOG), §4.1(Task 3), §4.2(Task 4), §4.3(변경 없음 — 계획 밖), §4.4(Task 5), §5(Task 2), §6(Task 3 주석 + Task 10 심사 노트), §7.1(Task 6), §7.2(Task 7), §7.3(Task 11), §8(Task 10), §9(Global Constraints). 갭 없음.
- **버전 불일치**: spec "1.4"는 repo 현실(1.6 제출 완료)과 어긋난다 — Global Constraints에 반영, 사용자 보고 예정.
- **타입 일관성**: `experimentalGuidanceEnabled`(Task 1 정의 ↔ Task 6 가드 문자열), `walkGuideNoticeV1`(Task 2 ↔ §7.3), 마커 "남은 거리를 소리로"(Task 4 ↔ Task 6 ↔ Task 7) 일치 확인.
