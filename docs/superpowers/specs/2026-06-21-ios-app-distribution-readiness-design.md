# 길동무 iOS App Store 배포 준비 진단 및 실행 설계

> 조사·진단 기준일: 2026-06-21 (KST)  
> 대상 저장소: `/Users/hunyongkim/Mac-Projects/gildongmu`  
> 목표: 현재 웹 기능 전체를 유지한 공식 iOS App Store 공개 배포  
> 비교 대상: 네이티브 통합형 Capacitor와 SwiftUI 전면 재개발

## 1. 결론

현재 상태는 **App Store 제출 NO-GO**다. 웹 서비스 자체는 빌드·테스트가 안정적이지만, iOS 프로젝트, Apple Developer Program, Xcode 전체 설치, 서명 자산, App Store Connect 레코드, 개인정보 문서, 네이티브 권한 설정, 실기기 접근성 검증이 모두 준비되지 않았다.

첫 정식 출시에는 **원격 웹사이트를 그대로 여는 WKWebView가 아니라, 웹 자산을 앱에 포함하고 핵심 기기 기능을 네이티브로 연결하는 Capacitor 8 방식**을 권고한다. 이 선택은 다음 이유로 현재 프로젝트에 가장 적합하다.

- 20개 서버 Route Handler와 22개 provider를 Vercel에 유지할 수 있다.
- 62개 테스트 파일, 563개 통과 테스트, 5개 언어 UI, 축적된 웹 접근성 동작을 가장 많이 보존한다.
- SwiftUI 전면 재개발보다 기능 동등성 누락 위험과 이중 유지보수 비용이 낮다.
- 위치, 마이크, 외부 지도 앱 실행, 화면 켜짐 유지, 효과음·햅틱을 네이티브로 통합하면 Apple의 단순 웹 재포장 거절 위험을 줄일 수 있다.

다만 현재 Next.js 프로젝트에 Capacitor만 설치해서는 출시할 수 없다. Capacitor의 `webDir`에는 최종 `index.html`이 있는 로컬 정적 자산이 필요하지만, 현재 앱에는 20개의 동적 Route Handler가 같은 Next.js 프로젝트에 섞여 있다. 따라서 **UI와 API의 배포 경계를 분리하고, UI가 환경별 API base URL을 사용하도록 만드는 선행 구조 변경**이 필수다.

SwiftUI는 장기적으로 가장 강한 Apple 플랫폼 경험을 제공하지만, 현재 요구인 “전체 기능 동시 출시”에는 예상 기간과 회귀 위험이 훨씬 크다. SwiftUI를 선택한다면 별도 iOS 클라이언트를 만들되 Vercel API 계약은 그대로 재사용하는 구조가 적절하다.

## 2. 조사 범위와 확정 전제

### 확정된 출시 목표

- 공개 App Store 배포
- 계정 없는 무료 앱
- 현재 기능 전체 제공
- 한국어·영어·스페인어·프랑스어·이탈리아어 UI 유지
- 시각장애인과 한국 방문 외국인을 1급 사용자로 유지
- iPhone을 첫 공식 지원 기기로 지정
- iPad는 호환 실행을 검증하되, 전용 iPad UI와 접근성 라벨은 별도 QA를 통과하기 전까지 주장하지 않음
- 최소 지원 OS 권고값은 iOS 17
- 서버 secret과 외부 API 호출은 계속 Vercel 서버에서 관리

### 조사 한계

- Apple Developer 계정이 없어 App Store Connect의 실제 입력 화면과 이름 중복 여부는 확인하지 못했다.
- 실제 iPhone 기기, iOS 버전별 VoiceOver, Dynamic Type, 네트워크 전환 시험은 아직 수행하지 못했다.
- Deepgram, Gemini, Perplexity, Vercel 및 각 공공·지도 API의 계약별 보존 기간과 iOS 앱 사용 허용 범위는 계정 약관·DPA를 별도로 확인해야 한다.
- 일정은 한 명의 숙련 개발자가 집중해서 작업한다는 가정의 범위 추정이며, Apple 심사 대기와 외부 서비스 회신 시간은 포함하지 않는다.

## 3. 2026년 Apple 배포 요구사항

### 3.1 개발자 계정

App Store 공개 배포에는 Apple Developer Program 가입이 필요하며 비용은 연 **미화 99달러**다. 개인 가입에는 법적 이름의 Apple Account, 2단계 인증, 성년 요건, 실제 주소·전화·이메일이 필요하다. 개인 계정은 법적 이름이 App Store 판매자명으로 노출된다. 조직 가입에는 계약 권한, 법인 실체, 조직 도메인 이메일·웹사이트와 D-U-N-S 번호가 추가로 필요하다. [Apple Developer Program 가입 안내](https://developer.apple.com/programs/enroll/)

현재 별도 조직 출시 요구가 없으므로 첫 버전은 **개인 계정**이 가장 빠르다. 판매자명에 개인 법적 이름이 표시되는 것이 부적절하다면 개발 전에 조직 계정과 D-U-N-S 준비로 전환해야 한다.

### 3.2 필수 개발 환경

2026년 4월 28일부터 App Store Connect 업로드는 **Xcode 26 이상과 iOS 26 SDK**로 빌드해야 한다. [Apple Upcoming Requirements](https://developer.apple.com/news/upcoming-requirements/)

현재 Mac 진단 결과는 다음과 같다.

| 항목 | 현재 상태 | 판정 |
|---|---|---|
| macOS | 26.5.1 | 충족 |
| Xcode 전체 앱 | 미설치, `xcode-select`가 CommandLineTools를 가리킴 | 차단 |
| Swift | 6.3.2 명령줄 도구 | 참고용, iOS archive 불가 |
| CocoaPods | 미설치 | Capacitor 의존성 방식에 따라 필요 |
| Node/npm | Node 26.0.0, npm 11.12.1 | 웹 빌드 가능 |
| 실제 iPhone | 미확인 | 실기기 QA 차단 |

Xcode 26을 설치한 뒤 `sudo xcode-select -s /Applications/Xcode.app/Contents/Developer`, 라이선스 동의, Simulator runtime 설치, Apple Account 연결이 필요하다. Capacitor 8은 iOS 15 이상과 Xcode 26 이상을 지원한다. [Capacitor 8 iOS 요구사항](https://capacitorjs.com/docs/ios)

### 3.3 식별자와 서명

- 명시적 App ID와 Bundle ID를 등록한다.
- 권고 Bundle ID: `space.dodoplanet.gildongmu`
- 이 값은 현재 `NEXT_PUBLIC_APP_IDENTIFIER` 기본값과 일치한다.
- App Store Connect에 최초 build를 올린 뒤 Bundle ID는 변경할 수 없으므로 먼저 소유권과 장기 명명 규칙을 확정한다.
- Xcode의 Automatically Manage Signing을 사용하고 개인 계정의 Team을 지정한다.
- Development/Distribution 인증서와 provisioning profile은 Xcode 관리형을 우선 사용한다.

명시적 App ID의 Bundle ID는 Xcode target 값과 정확히 같아야 한다. [App ID 등록](https://developer.apple.com/help/account/identifiers/register-an-app-id/)

### 3.4 현재 제출 SDK 기준

- Xcode 26+
- iOS 26 SDK+
- 앱의 최소 실행 OS는 별도로 선택 가능하며 본 문서는 iOS 17을 권고
- Capacitor 8 사용 시 WKWebView 기반이며 폐기된 UIWebView는 사용하지 않음
- HTTPS만 사용하고 App Transport Security 예외를 추가하지 않음

## 4. 현재 저장소 진단

### 4.1 강점

| 영역 | 확인 결과 |
|---|---|
| 웹 품질 기준선 | `npm run lint`, `npm run build` 통과 |
| 자동 테스트 | 62개 파일, 563개 테스트 모두 통과 |
| PWA | manifest, standalone 표시, 서비스워커, 로케일별 오프라인 페이지 존재 |
| 아이콘 | 180, 192, 512, maskable 512와 SVG 원본 존재 |
| 국제화 | ko/en/es/fr/it 5개 UI 메시지와 정적 로케일 경로 존재 |
| 서버 보안 경계 | 외부 API key가 Route Handler와 server provider에 유지됨 |
| 접근성 | 텍스트/리스트 정본, live 통지, 44px target, heading·region 정책, reduced motion, focus-visible 정책 존재 |
| 이식성 | 다수의 `src/lib` 순수 TypeScript 로직과 fixture 테스트 존재 |

### 4.2 현재 기능 표면

첫 iOS 버전은 아래 기능을 모두 보존해야 한다.

1. 장소·주소·우편번호 통합 검색과 카테고리 필터
2. 장소 상세와 한·영 주소
3. 현재 위치 기반 거리 정렬
4. 내 주변 지하철, 버스, 따릉이, 소아 진료, 아이 놀 곳, 주변 장소
5. 역 메타, 실시간 도착, 교통약자 시설
6. 자동차·대중교통 경로 텍스트 브리핑
7. 네이버지도·카카오맵 딥링크와 웹 폴백
8. 날씨와 공기질
9. 음성 녹음과 Deepgram 받아쓰기
10. Gemini 기반 에이전틱 채팅과 Perplexity 웹 검색
11. 거리 비콘, 화면 켜짐 유지, 효과음
12. 5개 언어, 오프라인 앱 셸, 전체 접근성 흐름

### 4.3 네이티브 출시 차단 항목

| 차단 항목 | 증거 | 필요한 조치 |
|---|---|---|
| Apple 계정 없음 | 사용자 확인 | Developer Program 가입 |
| iOS 프로젝트 없음 | `ios/`, `.xcodeproj`, `.xcworkspace` 없음 | Capacitor 또는 SwiftUI target 생성 |
| Capacitor 미설치 | package dependency 없음 | 선택 시 Capacitor 8 추가 |
| Xcode 전체 앱 없음 | `xcodebuild` 실행 실패 | Xcode 26 설치·선택 |
| App Store용 아이콘 없음 | 최대 512px | 불투명 1024×1024 App Icon 제작 |
| 개인정보처리방침 없음 | repo/public에 privacy 문서 없음 | 공개 URL과 앱 내부 링크 작성 |
| 지원 페이지 없음 | support/contact 문서 없음 | 실제 연락처가 있는 지원 URL 작성 |
| 권한 문구 없음 | Info.plist 자체가 없음 | 위치·마이크 usage description 작성 |
| privacy manifest 없음 | iOS target 없음 | `PrivacyInfo.xcprivacy` 생성·검증 |
| iOS 접근성 QA 없음 | 웹 회귀 테스트만 존재 | 실기기 VoiceOver/Dynamic Type 검사 |
| CORS 정책 없음 | API에 Access-Control 헤더 없음 | 로컬 Capacitor origin allowlist 추가 |
| API 남용 방어 없음 | rate limiter·client attestation 없음 | 비용성 endpoint rate limit 적용 |
| 위치 즉시 요청 | `PlaceSearch` mount에서 `requestLocation()` 호출 | 사용자가 위치 기능을 선택할 때 요청 |
| 정적 앱 번들 불가 | 동일 Next 앱에 20개 동적 Route Handler | UI/API 배포 경계 분리 |
| 네이티브 배포 자동화 없음 | iOS CI·Fastlane/Xcode Cloud 없음 | 첫 수동 출시 뒤 CI 설계 |

### 4.4 현재 구조와 Capacitor의 충돌

현재 build는 로케일 페이지 10개를 정적으로 만들지만, `/api/*` 20개는 Vercel 동적 함수다. Capacitor의 `webDir`은 최종 `index.html`이 있는 로컬 빌드 디렉터리를 기대한다. 따라서 현재 Next build 전체를 그대로 iOS bundle에 넣을 수 없다.

`capacitor.config.ts`의 `server.url`로 `https://gildongmu.vercel.app`을 여는 방법은 개발 시연에는 가능하지만 정식 출시에는 사용하지 않는다. Capacitor 문서도 외부 URL 로딩을 live-reload용이며 **production 용도가 아니라고 명시**한다. [Capacitor server 설정](https://capacitorjs.com/docs/config)

Apple은 앱이 재포장한 웹사이트를 넘어서는 기능·콘텐츠·UI를 제공해야 한다고 규정한다. [App Review Guidelines 4.2 Minimum Functionality](https://developer.apple.com/app-store/review/guidelines/)

## 5. 접근 방식 비교

점수는 5점이 가장 유리하다.

| 평가 기준 | Capacitor 로컬 번들 | SwiftUI 전면 재개발 | SwiftUI+WKWebView 혼합 |
|---|---:|---:|---:|
| 현재 기능 재사용 | 5 | 2 | 3 |
| 전체 기능 동등성 달성 속도 | 5 | 2 | 3 |
| 기존 접근성 동작 보존 | 4 | 2 | 2 |
| 네이티브 UI 품질 잠재력 | 3 | 5 | 3 |
| App Review 4.2 방어력 | 4 | 5 | 3 |
| 웹과 동시 유지보수 | 5 | 2 | 2 |
| 순수 TypeScript 자산 재사용 | 5 | 1 | 2 |
| 장기 Apple 플랫폼 확장 | 3 | 5 | 4 |
| 초기 개발 위험 | 4 | 2 | 2 |
| **총점** | **38/45** | **26/45** | **24/45** |

### 5.1 권고안: 네이티브 통합형 Capacitor

#### 목표 구조

```text
웹/Capacitor 공용 React UI
  ├─ Web Platform Adapter
  └─ iOS Platform Adapter
       ├─ Core Location / Capacitor Geolocation
       ├─ native audio recorder
       ├─ AppLauncher / Browser
       ├─ keep awake / haptics / system bars
       └─ native lifecycle
                │
                ▼ HTTPS + CORS
Vercel API service (/api/mobile/v1 또는 안정화된 기존 /api)
  ├─ 기존 provider 22개
  ├─ Gemini / Perplexity / Deepgram
  └─ 외부 지도·공공 API
```

#### 필수 구조 변경

1. UI와 API route를 서로 독립적으로 build·deploy할 수 있게 분리한다.
2. 상대 경로 `fetch('/api/...')`를 단일 `ApiClient`의 환경별 base URL로 교체한다.
3. API는 웹 origin과 `capacitor://localhost`만 허용하고 OPTIONS preflight를 처리한다.
4. NDJSON 채팅 streaming은 WKWebView 표준 `fetch`를 유지한다. native HTTP override는 streaming 동작 검증 전 사용하지 않는다.
5. 모바일 API 계약에 버전 경계를 두고, 오류 shape와 timeout을 고정한다.
6. Service Worker는 웹에서만 등록하고 Capacitor native에서는 비활성화한다. 앱 셸 자체가 로컬 번들이므로 오프라인 시작은 native bundle이 담당한다.
7. 브라우저 API 직접 호출을 platform adapter 뒤로 이동한다.

#### 네이티브 전환 항목

| 현재 웹 기능 | iOS 구현 |
|---|---|
| `navigator.geolocation.getCurrentPosition` | When In Use 위치 권한 + 단일 공유 location service |
| `watchPosition` 거리 비콘 | foreground 위치 갱신, 정확도·배터리 정책, 명시적 중지 |
| `MediaRecorder/getUserMedia` | 안정성 검증 후 web recorder 유지 또는 AVAudioRecorder custom plugin |
| `navigator.wakeLock` | keep-awake native plugin, 비콘 종료 시 반드시 해제 |
| Web Audio 효과음 | 기존 합성음 유지, 필요 시 햅틱 병행 |
| `nmap://`, `kakaomap://` | AppLauncher와 `LSApplicationQueriesSchemes`, 미설치 시 HTTPS 폴백 |
| `target=_blank` 외부 링크 | SFSafariViewController 또는 system browser |
| browser history | iOS lifecycle·back 상태와 충돌 없는 앱 내 navigation adapter |
| PWA service worker | native build에서 등록 안 함 |
| CSS viewport | safe-area inset, 키보드, 상태바, 회전·큰 글자 검증 |

Capacitor AppLauncher에서 `canOpenUrl`을 쓰려면 조회할 scheme을 `LSApplicationQueriesSchemes`에 선언해야 한다. [Capacitor AppLauncher](https://capacitorjs.com/docs/apis/app-launcher)

#### App Review 4.2 대응 설명

심사 메모에는 다음 네이티브 가치를 실제 구현과 함께 명시한다.

- 사용자가 선택한 시점의 native 위치 권한과 현재 위치 기반 실시간 주변 정보
- foreground 지속 위치를 이용한 접근성 거리 비콘
- native 마이크 녹음·취소·권한 복구
- 네이버지도·카카오맵 설치 감지와 안전한 네이티브 handoff
- 오프라인에서도 실행되는 로컬 앱 셸과 명확한 네트워크 오류 상태
- VoiceOver 전용 heading·region·포커스 흐름과 오디오·햅틱 피드백

단순히 화면 하단에 native tab 하나를 추가하는 정도로는 충분한 방어가 아니다. 기능 전체가 로컬 bundle에서 실행되고 핵심 기기 기능이 플랫폼 규칙에 맞게 통합되어야 한다.

#### 예상 범위

- 1인 개발 기준 약 8~12주
- UI/API 분리 2~3주
- platform adapter와 iOS target 2~3주
- 권한·딥링크·오디오·거리 비콘 2~3주
- 실기기 접근성·개인정보·TestFlight·심사 보완 2~3주

### 5.2 대안: SwiftUI 전면 재개발

#### 목표 구조

```text
SwiftUI App
  ├─ NavigationStack + feature views
  ├─ AppState / feature view models
  ├─ CoreLocation service
  ├─ AVAudioRecorder / AVAudioSession
  ├─ URLSession API client + NDJSON stream parser
  ├─ external app launcher
  └─ accessibility focus/rotor/announcements
                │
                ▼ HTTPS
동일 Vercel API service와 provider
```

#### 재사용 가능한 것

- Vercel Route Handler와 외부 provider
- API JSON shape와 도메인 지식
- 번역 문구의 의미와 기능 요구사항
- fixture와 기대 결과
- 접근성 정책과 실사용자 피드백 기록

#### 다시 구현해야 하는 것

- 모든 React 컴포넌트와 hook
- next-intl runtime과 화면 navigation
- TypeScript 도메인 계산을 Swift로 이식하거나 서버 API로 이동
- 채팅 NDJSON streaming과 markdown 렌더링
- 검색·상세·overlay·focus 복귀 상태기계
- 효과음·거리 비콘·wake lock
- 5개 언어 Localizable String Catalog
- Swift unit/UI test와 접근성 자동 감사

#### SwiftUI 접근성 원칙

- 기본 SwiftUI control과 semantic heading을 우선한다.
- `@AccessibilityFocusState`로 검색 결과·상세·채팅 완료 포커스를 관리한다.
- 자동 등장 정보는 heading과 rotor 탐색 가능성을 실제 VoiceOver로 검증한다.
- Dynamic Type 접근성 크기에서 가로 배치를 세로로 재배치하고 truncate를 피한다.
- 오디오 신호에는 시각 상태와 햅틱을 함께 제공한다.
- 지도는 계속 보조 레이어로만 사용하고, 모든 정보와 동작을 리스트·텍스트로 제공한다.

Apple의 Larger Text 라벨은 주요 UI가 기본 대비 200% 이상 확대되어도 핵심 작업을 수행할 수 있어야 한다. [Larger Text 평가 기준](https://developer.apple.com/help/app-store-connect/manage-app-accessibility/larger-text-accessibility-evaluation-criteria/)

#### 예상 범위

- 1인 개발 기준 약 16~24주
- API 계약 안정화 2~3주
- 검색·상세·주변·경로 6~8주
- 채팅·음성·비콘 4~6주
- 5개 언어·접근성·UI test 3~5주
- TestFlight·심사 보완 2주 이상

#### SwiftUI 선택 조건

아래 중 둘 이상이 확정되면 SwiftUI가 더 적합하다.

- 웹보다 iOS가 주력 제품이 된다.
- Widgets, App Intents, Live Activities, Apple Watch 등 Apple 전용 로드맵이 있다.
- Dynamic Type와 native navigation의 완성도를 출시 속도보다 우선한다.
- 웹과 별도 iOS 팀 또는 장기 유지보수 예산이 있다.

### 5.3 비권고 최종안: SwiftUI+WKWebView 혼합

혼합 방식은 기능별 점진 이식용 임시 branch로는 유용하지만 첫 정식 제품의 목표 구조로 삼지 않는다. SwiftUI와 웹 사이에서 위치·언어·선택 장소·채팅 기록·뒤로가기·VoiceOver focus를 동기화해야 하고, 사용자가 native와 web accessibility tree를 오갈 때 경험이 불연속적이다. 또한 웹뷰 비중이 높으면 4.2 심사 설명도 약해진다.

## 6. 개인정보와 보안

### 6.1 실제 데이터 흐름

| 데이터 | 현재 흐름 | 용도 |
|---|---|---|
| 정밀 위치 | iPhone → Vercel → 지도·교통·날씨·공기질·Gemini 도구 | 주변 정보·경로·채팅 |
| 검색어·주소 | iPhone → Vercel → Kakao/Naver/Juso/TourAPI | 장소·주소 검색 |
| 채팅 자유문 | iPhone → Vercel → Gemini, 필요 시 Perplexity | 답변 생성·웹 검색 |
| 음성 녹음 | iPhone → Vercel → Deepgram | 받아쓰기 |
| IP·요청 메타 | iPhone → Vercel 및 외부 provider | 전송·운영 로그 가능성 |

### 6.2 App Privacy 라벨 후보

최종 라벨은 vendor 보존 정책과 Vercel 로그 설정을 감사한 뒤 확정해야 한다. 현재 코드 흐름만으로는 “데이터를 수집하지 않음”으로 신고하면 안 된다. 보수적 후보는 다음과 같다.

- Precise Location
- Search History
- Other User Content
- Audio Data
- 필요 시 Diagnostics 또는 Product Interaction

각 항목의 목적은 우선 `App Functionality`, 추적은 `No`, 사용자 연결 여부는 계정·로그·vendor 보존 구조 확인 후 결정한다. Apple은 위치·음성·자유문을 각각 Precise Location, Audio Data, Other User Content 등으로 분류하며 제3자 partner의 처리도 신고에 포함하도록 한다. [App Privacy 데이터 유형과 정의](https://developer.apple.com/app-store/app-privacy-details/)

Apple 정의상 요청을 실시간 처리하는 데 필요한 시간보다 오래 접근 가능한 형태로 보관하지 않으면 일부 전송은 “collect”에 해당하지 않을 수 있다. 그러나 이를 적용하려면 다음 증거가 있어야 한다.

1. Vercel request/body 로그에 민감 데이터가 남지 않음
2. 애플리케이션 로그에 query·좌표·음성·채팅 본문을 기록하지 않음
3. Gemini·Perplexity·Deepgram의 해당 API 제품이 요청 데이터를 얼마나 보관하는지 계약으로 확인
4. 장애 추적 도구를 추가할 경우 payload redaction 확인

### 6.3 개인정보처리방침 필수 내용

App Store metadata와 앱 내부 설정/정보 화면 양쪽에 쉽게 접근 가능한 개인정보처리방침 링크가 있어야 한다. [App Review Guidelines 5.1.1](https://developer.apple.com/app-store/review/guidelines/)

문서에는 최소한 아래를 명시한다.

- 운영 주체와 연락처
- 정밀 위치, 검색어, 채팅, 음성의 처리 목적
- Deepgram, Google Gemini, Perplexity, Vercel과 외부 지도·공공 API 전달
- 저장 여부와 보존 기간
- 권한 거부 시 가능한 기능과 불가능한 기능
- 사용자가 개인정보 문의·삭제를 요청하는 방법
- 국외 이전이 있다면 대상, 국가, 목적, 시점·방법, 보존 기간
- 아동 대상 서비스 여부
- 정책 변경 고지

법률 문구는 출시 전 한국 개인정보보호법 및 서비스 지역 규정에 맞춰 법률 검토를 권고한다.

### 6.4 권한 설계

#### 위치

- `NSLocationWhenInUseUsageDescription`만 실제로 요청한다.
- 권고 한국어 문구: `현재 위치에서 가까운 교통, 날씨, 공기질과 장소를 찾기 위해 위치를 사용합니다.`
- 권고 영어 문구: `Your location is used to find nearby transit, weather, air quality, and places.`
- 앱 시작 즉시 묻지 않고 사용자가 “내 주변”, 현재 위치 정렬, 경로, 거리 비콘 중 하나를 선택할 때 요청한다.
- Always/background 위치는 사용하지 않는다.
- 권한 거부 후에도 장소·주소 검색과 수동 출발지 검색은 작동해야 한다.

Apple은 위치가 필요한 동작을 사용자가 시작한 직전에 요청하고 When In Use를 우선하도록 안내한다. [Core Location 권한 안내](https://developer.apple.com/documentation/CoreLocation/requesting-authorization-to-use-location-services)

Capacitor Geolocation plugin은 현재 Always-and-When-In-Use 문구도 plist에 요구하지만 background 권한 prompt를 실제로 요청하지 않는다. 선택한 plugin 버전의 요구사항을 build 시 다시 확인한다. [Capacitor Geolocation](https://capacitorjs.com/docs/apis/geolocation)

#### 마이크

- `NSMicrophoneUsageDescription` 필수
- 권고 한국어 문구: `검색어와 질문을 음성으로 입력하기 위해 마이크를 사용합니다.`
- 권고 영어 문구: `The microphone is used to enter searches and questions by voice.`
- 녹음 버튼을 누를 때만 권한을 요청한다.
- 녹음 중 상태, 취소, 최대 60초, 업로드·처리 상태를 명확히 표시한다.
- 거부 시 설정으로 이동하는 설명과 텍스트 입력 대안을 제공한다.

마이크 usage description이 없으면 앱이 종료될 수 있다. [NSMicrophoneUsageDescription](https://developer.apple.com/documentation/bundleresources/information-property-list/nsmicrophoneusagedescription)

#### 추적

현재 광고, IDFA, cross-app tracking은 없다. 따라서 App Tracking Transparency prompt를 추가하지 않는다. 향후 광고·추적 SDK를 넣으면 별도 검토한다.

### 6.5 Privacy Manifest와 SDK 공급망

- app target에 `PrivacyInfo.xcprivacy`를 둔다.
- app과 모든 Swift package/plugin의 privacy manifest를 archive에서 합산 확인한다.
- UserDefaults, file timestamp, disk space 등 required reason API 사용을 scan한다.
- 선언 이유는 실제 코드 사용과 일치해야 하며 예제 reason code를 복사하지 않는다.
- invalid manifest는 App Store Connect가 거절한다.

Apple은 required reason API와 특정 제3자 SDK에 유효한 privacy manifest를 요구한다. [Apple Privacy Manifest](https://developer.apple.com/documentation/bundleresources/adding-a-privacy-manifest-to-your-app-or-third-party-sdk) [Capacitor Privacy Manifest](https://capacitorjs.com/docs/ios/privacy-manifest)

### 6.6 API 보안 보강

App Store 출시 전 아래를 적용한다.

- `/api/chat`, `/api/speech-to-text`, 검색·경로 endpoint에 IP/device-session 기반 rate limit
- request body와 음성 크기 제한 유지·강화
- CORS allowlist를 web production origin과 Capacitor local origin으로 제한
- 모든 response에서 secret·provider 원문 오류를 제거
- 로그에서 좌표, 채팅, 음성, API key redaction
- 비용성 API 예산 alert와 차단 정책
- API version과 최소 지원 app version 정책
- App Attest는 1차 출시 필수는 아니지만 남용이 발생하면 도입

## 7. App Store 자산과 메타데이터

### 7.1 필수 웹 페이지

아래 URL은 로그인 없이 공개되고 모바일에서 읽을 수 있어야 한다.

- `/privacy`: 개인정보처리방침
- `/support`: 이메일 등 실제 연락 수단, FAQ, 권한 복구, 장애 문의
- `/accessibility`: VoiceOver·큰 글자·키보드 지원 범위와 알려진 제한

Privacy Policy URL은 모든 iOS 앱에 필수이며, Support URL도 version metadata의 필수 항목이다. [App privacy 관리](https://developer.apple.com/help/app-store-connect/manage-app-information/manage-app-privacy/) [플랫폼 버전 정보](https://developer.apple.com/help/app-store-connect/reference/app-review-information)

### 7.2 앱 자산

- 1024×1024 App Store icon, alpha 없음
- Xcode AppIcon asset catalog의 필요한 slot
- launch screen 또는 launch storyboard
- iPhone 필수 크기의 실제 앱 screenshot
- ko/en App Store localization부터 시작하고 es/fr/it은 번역 QA 뒤 추가
- screenshot에는 실제 기능, 실제 데이터 상태, VoiceOver 친화적 텍스트 UI를 보여준다.
- 앱 preview video는 1.0 필수 아님

현재 512px 아이콘을 단순 확대하지 말고 SVG 원본에서 1024px를 다시 export하고, 작은 크기에서 핀 형태와 대비를 확인한다.

### 7.3 권고 App Store 정보

| 항목 | 권고 초안 |
|---|---|
| 이름 | 길동무 Gildongmu |
| subtitle | 접근성 중심 한국 길찾기 |
| primary category | Navigation |
| secondary category | Travel |
| 가격 | 무료 |
| 계정 | 없음 |
| 광고/IAP | 없음 |
| 판매 지역 | 1차 대한민국, 운영 안정 후 확대 |
| release | 수동 release |
| copyright | `2026 <법적 개인명 또는 법인명>` |

앱 이름은 30자, subtitle은 30자 제한이며 description은 4,000자, keywords는 100 bytes 제한이다. [App 정보](https://developer.apple.com/help/app-store-connect/reference/app-information) [버전 정보](https://developer.apple.com/help/app-store-connect/reference/app-review-information)

### 7.4 연령 등급

새 2026 연령 등급 questionnaire에 실제 기능대로 응답한다. 앱은 자체 커뮤니티나 사용자 공개 게시물이 없지만 AI 채팅과 web search 결과가 외부 콘텐츠를 표시한다. 이를 숨기지 말고 unrestricted web access 및 생성 콘텐츠 관련 질문을 실제 동작에 맞게 답한다. `Made for Kids`는 선택하지 않는다. 설문 결과를 임의로 4+로 가정하지 않는다. [연령 등급 설정](https://developer.apple.com/help/app-store-connect/manage-app-information/set-an-app-age-rating)

### 7.5 접근성 Nutrition Labels

App Store에서 주장할 기능은 실기기 평가 기준을 모두 통과한 것만 선택한다.

- VoiceOver
- Voice Control
- Larger Text
- Dark Interface
- Differentiate without Color Alone
- Sufficient Contrast
- Reduced Motion

현재 웹 정책만으로 위 라벨을 즉시 주장할 수는 없다. iOS build의 공통 작업 전체를 검증한 뒤 공개한다. Apple은 iOS 26 계열 App Store에서 기기별 accessibility label을 표시하며, 미응답도 “지원 정보 미제공”으로 나타낸다. [Accessibility Nutrition Labels](https://developer.apple.com/help/app-store-connect/manage-app-accessibility/overview-of-accessibility-nutrition-labels)

## 8. 접근성 출시 게이트

### 8.1 공통 작업 시나리오

아래 작업을 화면을 보지 않고 VoiceOver로 완료해야 한다.

1. 앱 실행, 언어 확인·변경
2. 텍스트 장소 검색과 결과 수 통지
3. 결과 heading 탐색, 장소 상세 진입, 목록 복귀
4. 주소 검색과 상세 진입
5. 위치 권한 허용·거부·재시도
6. 내 주변 6종 패널 열기·닫기·패널 전환
7. 날씨·공기질 자동 등장 섹션 발견
8. 역 도착·시설·메타 탐색
9. 자동차·대중교통 브리핑
10. 지도 앱 설치/미설치 각각의 길찾기
11. 마이크 권한, 녹음, 취소, 전사, 오류
12. 채팅 질문, 진행 통지, markdown 목록, 카드·출처, 닫기
13. 거리 비콘 시작·중지와 background 전환
14. 오프라인 실행, 네트워크 복귀, 재시도

### 8.2 조합 시험

- iPhone 작은 화면과 큰 화면 각 1종 이상
- iOS 17과 최신 iOS 26
- VoiceOver on/off
- Dynamic Type 기본, 200%, 최대 접근성 크기
- Bold Text, Increase Contrast, Reduce Motion
- portrait와 landscape
- ko/en, 장문 확인은 de 계열이 없으므로 es/fr/it 중 가장 긴 번역도 포함
- Wi-Fi, cellular, offline, 느린 네트워크
- 위치·마이크 각각 허용/거부/설정에서 변경
- 네이버지도·카카오맵 설치/미설치

### 8.3 도구

- 실제 iPhone VoiceOver
- Xcode Accessibility Inspector
- XCTest/XCUITest
- Instruments: Leaks, Network, Energy
- App Privacy Report로 예상하지 않은 domain 접근 확인
- TestFlight 외부 시각장애인 tester 피드백

Apple은 앱이 접근하는 사용자 데이터와 network resource가 예상 범위인지 App Privacy Report 등으로 확인하도록 안내한다. [앱 활동 데이터 검사](https://developer.apple.com/documentation/network/privacy_management/inspecting_app_activity_data)

## 9. 테스트 전략

### 9.1 공통 API 계약

- 기존 563개 test를 계속 web/API 회귀 게이트로 유지
- 각 Route Handler의 success/error JSON schema를 고정
- mobile client fixture를 실제 API test fixture와 공유
- NDJSON chat event `status/done/error` 계약 test
- timeout, abort, stale response, partial provider failure test
- API version compatibility test

### 9.2 Capacitor

- platform adapter는 web/native mock으로 unit test
- local bundle에서 relative asset과 locale route test
- `capacitor://localhost` CORS integration test
- native permission denied/limited/granted UI test
- external URL scheme allowlist test
- native build에서 service worker 미등록 test
- iOS archive의 privacy report와 signing 검사

### 9.3 SwiftUI

- Codable contract fixture test
- URLSession mock과 NDJSON incremental parser test
- CoreLocation/recording protocol mock
- ViewModel state transition test
- XCUITest로 검색→상세→길찾기·채팅·녹음 흐름
- accessibility identifier는 test용으로만 사용하고 VoiceOver label과 혼동하지 않음

## 10. 실행 로드맵

### Phase 0. 계정과 환경

완료 조건:

- 개인/조직 판매자명 결정
- Apple Developer Program 활성화
- Xcode 26 설치와 실제 iPhone 개발 실행
- Bundle ID `space.dodoplanet.gildongmu` 등록
- App Store Connect app record 생성

### Phase 1. 개인정보·API 계약

완료 조건:

- 데이터 inventory와 vendor 보존 정책 증거 확보
- `/privacy`, `/support`, `/accessibility` 공개
- App Privacy 라벨 답변 초안 확정
- API error/stream 계약 문서화
- rate limit·로그 redaction·CORS 적용

### Phase 2. 아키텍처 spike와 최종 선택

Capacitor spike는 다음을 실제 iPhone에서 증명해야 한다.

- 로컬 bundled ko/en 앱 실행
- Vercel 검색 API 호출
- chat NDJSON streaming
- 위치 권한과 nearby 호출
- 마이크 녹음과 STT
- VoiceOver heading/focus
- nmap/kakaomap handoff

**GO 기준:** 7개 항목 모두 통과하고 치명적 WKWebView 접근성 회귀가 없음.  
**NO-GO 기준:** streaming, VoiceOver focus, audio capture 중 하나가 안정적으로 해결되지 않음.  
NO-GO이면 SwiftUI 전면 재개발로 전환한다.

### Phase 3A. Capacitor 전체 이식

- UI/API 배포 경계 분리
- platform adapter 완성
- 모든 브라우저 API native 처리
- safe area·keyboard·lifecycle·offline 처리
- icon, launch screen, plist, privacy manifest
- 전체 기능 동등성 회귀

### Phase 3B. SwiftUI 전체 재개발

- API client와 model
- 검색·상세·주변·교통·환경
- 채팅·markdown·source card
- 음성·비콘·딥링크
- 5개 언어·접근성·UI test

### Phase 4. TestFlight

- Xcode archive와 validation
- internal tester
- 외부 tester용 beta 설명·feedback email·review 정보 입력
- 시각장애인 tester 포함 외부 TestFlight
- crash, energy, permission, network, accessibility issue 수정

TestFlight build는 90일간 시험할 수 있고 내부 tester는 최대 100명, 외부 tester는 최대 10,000명이며 첫 외부 build는 review가 필요하다. [TestFlight 개요](https://developer.apple.com/help/app-store-connect/test-a-beta-version/testflight-overview)

### Phase 5. App Review와 출시

- privacy·age rating·content rights·export compliance 응답
- screenshot, description, keywords, support URL
- review contact와 상세 review notes
- 로그인 불필요함과 위치 거부 대체 흐름 설명
- 네이버·카카오 앱 미설치에서도 시험 가능하도록 폴백 제공
- build를 Add for Review 후 Submit for Review
- 승인 후 수동 release, 초기 crash/API 비용 monitoring

App Review 제출에는 metadata와 build를 연결한 뒤 별도로 `Submit for Review` 해야 한다. [앱 제출 절차](https://developer.apple.com/help/app-store-connect/manage-submissions-to-app-review/submit-an-app)

## 11. 제출 체크리스트

### 계정·계약

- [ ] Apple Account 2FA와 법적 이름 확인
- [ ] 개인/조직 seller name 결정
- [ ] Apple Developer Program 결제·활성화
- [ ] 유료 앱 계약은 불필요함 확인, 무료 앱 계약 상태 확인
- [ ] 세금·은행 정보가 필요한 기능을 추가하지 않았는지 확인

### 개발·서명

- [ ] Xcode 26+와 iOS 26 SDK
- [ ] explicit App ID와 Bundle ID 일치
- [ ] version `1.0.0`, build number 증가 정책
- [ ] automatic signing 성공
- [ ] Release logging에서 민감 정보 제거
- [ ] archive validation 무경고 또는 경고 근거 기록

### 권한·개인정보

- [ ] 위치는 When In Use, 사용자 동작 시 요청
- [ ] 마이크는 녹음 버튼에서 요청
- [ ] 한국어·영어 usage description
- [ ] privacy manifest와 plugin manifest 검증
- [ ] App Privacy 답변과 실제 network traffic 일치
- [ ] 개인정보처리방침 앱 내부 링크
- [ ] tracking 없음, ATT prompt 없음

### 기능·접근성

- [ ] 현재 웹 기능 14개 시나리오 동등성
- [ ] VoiceOver 공통 작업 전체 통과
- [ ] Dynamic Type 200% 이상 통과
- [ ] Reduce Motion·Increase Contrast
- [ ] 44×44pt 주요 target
- [ ] 위치·마이크 거부 상태에서도 앱 핵심 접근 가능
- [ ] 지도 앱 미설치 폴백
- [ ] 오프라인·느린 망·API 부분 장애

### App Store Connect

- [ ] name, subtitle, category, SKU
- [ ] privacy/support/accessibility URL
- [ ] age rating questionnaire
- [ ] content rights 확인
- [ ] export compliance 응답
- [ ] ko/en description·keywords·screenshots
- [ ] review contact와 notes
- [ ] TestFlight 외부 검증 완료
- [ ] accessibility labels는 검증한 항목만 선택
- [ ] 수동 release 선택

## 12. App Review notes 초안

```text
Gildongmu is an accessibility-first navigation and local information app for Korea.
No sign-in or account is required.

Core test flow:
1. Search for “강남역” and open a result.
2. Review transit, accessibility facilities, weather, and air-quality information.
3. Use the nearby buttons after granting When In Use location permission.
4. Use the microphone button to dictate a search or chat question.
5. Navigation buttons open Naver Map or KakaoMap when installed and otherwise open an HTTPS fallback.

Location is optional. If permission is denied, text search and manual origin search remain available.
Microphone access is requested only after the user activates voice input; text input remains available.

The app provides native location, audio recording, external-app handoff, offline app startup,
and VoiceOver-focused navigation. All map information is also available in accessible text lists.
```

실제 build와 일치하도록 최종 제출 전에 문구를 다시 검증한다.

## 13. 비용과 운영

확정 비용:

- Apple Developer Program: 연 99 USD, 지역별 현지 가격 가능

예산에 포함해야 할 항목:

- 실제 시험용 iPhone이 없다면 기기 비용
- App Store artwork·screenshot 제작
- 개인정보 법률 검토
- 기존 Vercel, Gemini, Perplexity, Deepgram, 지도·교통 API 사용량 증가
- 선택 시 Ionic Appflow, Xcode Cloud 또는 CI macOS runner

첫 출시는 Xcode Organizer 수동 archive/upload로 충분하다. 배포가 안정된 뒤 CI와 자동 metadata 업로드를 추가한다. 과도한 배포 자동화는 첫 심사 전에는 우선순위가 아니다.

TLS를 포함한 앱은 export compliance 질문에 답해야 한다. 표준 OS 암호화만 사용해 문서 면제가 가능한지는 App Store Connect 설문으로 확정하고, 근거에 따라 `ITSAppUsesNonExemptEncryption`을 설정한다. [Export compliance 개요](https://developer.apple.com/help/app-store-connect/manage-app-information/overview-of-export-compliance/)

## 14. 최종 의사결정

### 현재 판정

**NO-GO: App Store 제출 준비 미완료**

### 권고 경로

1. 개인 Apple Developer 계정과 Xcode 26 환경을 먼저 준비한다.
2. 개인정보·지원 문서와 API 보안 경계를 준비한다.
3. Capacitor 로컬 번들 spike로 위치·마이크·채팅 streaming·VoiceOver를 실제 iPhone에서 검증한다.
4. spike가 GO이면 Capacitor로 전체 기능을 이식한다.
5. spike가 NO-GO일 때만 SwiftUI 전면 재개발로 전환한다.
6. 전체 기능 동등성, 실기기 접근성, 외부 TestFlight를 통과한 뒤 App Review에 제출한다.

이 경로는 출시 속도만을 이유로 웹사이트 wrapper를 제출하지 않으면서도, 현재 프로젝트가 축적한 접근성·국내 API·다국어 자산을 가장 많이 보존한다.

## 15. 공식 자료

- [Apple Developer Program 가입](https://developer.apple.com/programs/enroll/)
- [Apple Upcoming Requirements](https://developer.apple.com/news/upcoming-requirements/)
- [App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/)
- [App Store Connect 앱 제출](https://developer.apple.com/help/app-store-connect/manage-submissions-to-app-review/submit-an-app)
- [App Privacy Details](https://developer.apple.com/app-store/app-privacy-details/)
- [Privacy Manifest](https://developer.apple.com/documentation/bundleresources/privacy-manifest-files)
- [Core Location 권한](https://developer.apple.com/documentation/CoreLocation/requesting-authorization-to-use-location-services)
- [App Store Accessibility Labels](https://developer.apple.com/help/app-store-connect/manage-app-accessibility/overview-of-accessibility-nutrition-labels)
- [TestFlight 개요](https://developer.apple.com/help/app-store-connect/test-a-beta-version/testflight-overview)
- [Capacitor 8 iOS](https://capacitorjs.com/docs/ios)
- [Capacitor configuration](https://capacitorjs.com/docs/config)
- [Capacitor privacy manifest](https://capacitorjs.com/docs/ios/privacy-manifest)

