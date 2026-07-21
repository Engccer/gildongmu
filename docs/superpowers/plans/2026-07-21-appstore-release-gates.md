# App Store 출시 필수 요건 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** App Store 본심사 하드 게이트 5건을 갖춘다 — 채팅 AI 동의(5.1.2(i)), PrivacyInfo.xcprivacy, 웹 처리방침 페이지, 정식명·버전 승계, `/api/chat` 레이트리밋.

**Architecture:** 웹(Next.js 16)과 iOS(SwiftUI)의 독립 태스크. iOS 동의는 UI 게이트(ChatConsentView) + 전송 경로 가드(ChatModel)의 이중 방어. iOS 문자열은 `messages/*.json`+`ios/i18n/ios-extra/*.json` 정본에서 `messages-to-xcstrings.mjs`로 재생성한다(카탈로그 직접 편집 금지).

**Tech Stack:** Next.js 16(App Router, next-intl 4), Vitest 4, SwiftUI(iOS 26), String Catalog 파이프라인.

**Spec:** `docs/superpowers/specs/2026-07-21-appstore-release-gates-design.md`

## Global Constraints

- 주석·커밋 메시지·문서는 한국어, 식별자는 영어. em dash(—) 산문 금지, UI 라벨 이모지 금지.
- 커밋은 `git add <의도 파일> && git commit -m "..." -- <의도 파일들>` 원자 실행. `git add -A` 금지. 커밋 푸터 `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- iOS 로컬라이즈: 새 키는 **ios-extra 5개 로케일 전부**(`ios/i18n/ios-extra/{ko,en,es,fr,it}.json`)에 추가 → `node ios/scripts/messages-to-xcstrings.mjs all` 재생성 → `node ios/scripts/check-xcstrings-keys.mjs` 통과. 카탈로그(.xcstrings) 직접 편집 금지. Swift에서는 `appLocalized("리터럴 키")`만(동적 조립 금지).
- 웹 메시지: 새 키는 `messages/{ko,en,es,fr,it}.json` 5개 전부에 동일 구조로(비대칭은 `i18n-messages.test.ts`가 실패시킴).
- iOS 빌드 확인: `xcodebuild -project ios/Gildongmu.xcodeproj -scheme Gildongmu -destination 'generic/platform=iOS Simulator' build 2>&1 | tail -3` → `BUILD SUCCEEDED`.
- 접근성: 헌장 준수 — 한 줄=한 객체, `disabled` 금지(`aria-disabled`/핸들러 가드 대응물), 포커스를 쥔 요소가 사라지는 전이는 선점 이동.

---

### Task 1: `/api/chat` IP 레이트리밋 (비용 방어)

**Files:**
- Modify: `src/lib/rate-limit.ts`
- Modify: `src/lib/__tests__/rate-limit.test.ts`
- Modify: `src/app/api/chat/route.ts`

**Interfaces:**
- Produces: `checkChatRateLimit(ip: string, now: number): boolean` (60초 10회), `clientIpFromHeaders(headers: Headers): string`
- 기존 `evaluateRateLimit` 코어 재사용. 기존 `/api/search/web`·`/api/tts`는 수정하지 않는다(무관 리팩토링 금지).

- [ ] **Step 1: 실패하는 테스트 작성** — `src/lib/__tests__/rate-limit.test.ts`에 기존 스타일로 추가:

```ts
import { checkChatRateLimit, clientIpFromHeaders } from "../rate-limit";

describe("checkChatRateLimit", () => {
  it("같은 IP 10회까지 허용, 11회째 차단", () => {
    const ip = "203.0.113.99";
    const now = 1_700_000_000_000;
    for (let i = 0; i < 10; i++) {
      expect(checkChatRateLimit(ip, now + i)).toBe(true);
    }
    expect(checkChatRateLimit(ip, now + 10)).toBe(false);
  });

  it("윈도우(60초) 경과 후 다시 허용", () => {
    const ip = "203.0.113.98";
    const now = 1_700_000_100_000;
    for (let i = 0; i < 10; i++) checkChatRateLimit(ip, now);
    expect(checkChatRateLimit(ip, now + 60_000)).toBe(true);
  });
});

describe("clientIpFromHeaders", () => {
  it("x-forwarded-for 첫 항목을 반환", () => {
    const h = new Headers({ "x-forwarded-for": "198.51.100.1, 10.0.0.1" });
    expect(clientIpFromHeaders(h)).toBe("198.51.100.1");
  });

  it("없으면 x-real-ip, 둘 다 없으면 unknown", () => {
    expect(clientIpFromHeaders(new Headers({ "x-real-ip": "198.51.100.2" }))).toBe("198.51.100.2");
    expect(clientIpFromHeaders(new Headers())).toBe("unknown");
  });
});
```

- [ ] **Step 2: 실패 확인** — Run: `npm run test:run -- rate-limit` / Expected: FAIL (`checkChatRateLimit` 미정의)

- [ ] **Step 3: 구현** — `src/lib/rate-limit.ts` 말미에 추가:

```ts
// 채팅은 요청당 비용이 가장 크고(Gemini 다회 호출+도구 경유 Perplexity) 대화 턴 간격이
// 자연히 길어, 검색(30회)보다 강한 60초 10회로 잡는다(스펙 §5).
const CHAT_LIMIT = 10;
const chatStore = new Map<string, RateLimitEntry>();

/** /api/chat 전용 레이트 리밋(60초 10회). 허용이면 true. */
export function checkChatRateLimit(ip: string, now: number): boolean {
  return evaluateRateLimit(chatStore, ip, now, CHAT_LIMIT, WINDOW_MS).allowed;
}

/** Vercel은 클라이언트 IP를 x-forwarded-for(첫 항목)·x-real-ip로 전달한다. */
export function clientIpFromHeaders(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]?.trim() || "unknown";
  return headers.get("x-real-ip") ?? "unknown";
}
```

- [ ] **Step 4: 통과 확인** — Run: `npm run test:run -- rate-limit` / Expected: PASS(기존 케이스 포함 전부)

- [ ] **Step 5: 라우트 적용** — `src/app/api/chat/route.ts`의 `POST` 함수, `const ai = getGeminiClient();` **바로 앞**에 삽입 + import 추가:

```ts
import { checkChatRateLimit, clientIpFromHeaders } from "@/lib/rate-limit";
```

```ts
  // 무인증 공개 API의 유료 호출(Gemini·Perplexity) 비용 방어 — 스펙 §5.
  if (!checkChatRateLimit(clientIpFromHeaders(request.headers), Date.now())) {
    return new Response(JSON.stringify({ error: "rate_limited" }), {
      status: 429, headers: { "Content-Type": "application/json" },
    });
  }
```

클라이언트는 웹·iOS 모두 비-2xx를 기존 오류 표면으로 처리하므로 추가 변경 없음(3-state: 실패는 실패로).

- [ ] **Step 6: lint·전체 테스트** — Run: `npm run lint && npm run test:run` / Expected: PASS

- [ ] **Step 7: 커밋**

```bash
git add src/lib/rate-limit.ts src/lib/__tests__/rate-limit.test.ts src/app/api/chat/route.ts && \
git commit -m "feat(chat): /api/chat IP 레이트리밋(60초 10회) — 공개 배포 전 유료 API 비용 방어

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>" -- src/lib/rate-limit.ts src/lib/__tests__/rate-limit.test.ts src/app/api/chat/route.ts
```

---

### Task 2: 웹 개인정보 처리방침 페이지 (5개 언어)

**Files:**
- Modify: `messages/ko.json`, `messages/en.json`, `messages/es.json`, `messages/fr.json`, `messages/it.json` (최상위 `privacy` 네임스페이스 추가)
- Create: `src/app/[locale]/privacy/page.tsx`
- Modify: `src/app/[locale]/page.tsx` (하단 처리방침 링크)

**Interfaces:**
- Produces: 경로 `/{locale}/privacy` (5개 로케일 정적 페이지). Task 4·5의 iOS 링크 대상 URL: `https://gildongmu.vercel.app/{locale}/privacy`.
- Consumes: `src/i18n/navigation.ts`의 `Link`(로케일 자동 prefix), `offline/page.tsx`의 정적 페이지 패턴.

- [ ] **Step 1: 메시지 키 추가** — 5개 파일 각각 최상위에 `privacy` 오브젝트 추가(알파벳 위치는 파일 기존 관례를 따르되 최상위 레벨이면 어디든 무방, 5개 파일 모두 동일 키 집합):

`messages/ko.json`:
```json
"privacy": {
  "title": "개인정보 처리방침",
  "intro": "길동무는 계정 없이 사용하는 서비스이며, 자체 데이터베이스에 개인정보를 저장하지 않습니다.",
  "useHeading": "데이터 사용",
  "location": "현재 위치는 주변 장소, 교통, 길찾기 정보를 실시간으로 조회하는 데에만 사용하며 저장하지 않습니다. 요청 처리 과정에서 서버 인프라의 요청 기록에 일시적으로 남을 수 있습니다.",
  "chat": "AI 채팅에서는 질문과 대화 내용, 함께 보는 장소 정보, 현재 위치가 답변 생성을 위해 Google Gemini에 전송되며, 웹 검색이 필요한 질문은 Perplexity에도 전달됩니다. 답변은 AI가 생성하며 부정확할 수 있습니다.",
  "search": "검색어는 결과 조회를 위해 카카오, 네이버 등 검색 제공자에 전달되고, 장소와 주소 결과가 모두 없을 때는 Perplexity 웹 검색에 전달됩니다.",
  "dictation": "iOS 앱의 받아쓰기는 기기 안에서 처리되어 음성이 기기를 떠나지 않습니다. 웹의 받아쓰기는 음성을 Deepgram에 전송해 텍스트로 변환하며, 변환 후 저장하지 않습니다.",
  "contactHeading": "문의",
  "contact": "서비스와 개인정보 처리에 관한 문의는 engccer@gmail.com 으로 보내 주세요."
}
```

`messages/en.json`:
```json
"privacy": {
  "title": "Privacy Policy",
  "intro": "Gildongmu works without an account and does not store personal data in any database of its own.",
  "useHeading": "How data is used",
  "location": "Your current location is used only to look up nearby places, transit, and directions in real time, and is not stored. It may appear temporarily in server infrastructure request logs while a request is processed.",
  "chat": "In AI chat, your questions, the conversation, the place you are viewing, and your current location are sent to Google Gemini to generate answers. Questions that need a web search are also sent to Perplexity. Answers are AI-generated and may be inaccurate.",
  "search": "Search terms are sent to search providers such as Kakao and Naver, and to Perplexity web search only when there are no place or address results.",
  "dictation": "Dictation in the iOS app is processed on your device, so audio never leaves it. Dictation on the web sends audio to Deepgram for transcription and does not store it afterwards.",
  "contactHeading": "Contact",
  "contact": "For questions about the service or this policy, email engccer@gmail.com."
}
```

`messages/es.json`:
```json
"privacy": {
  "title": "Política de privacidad",
  "intro": "Gildongmu funciona sin cuenta y no guarda datos personales en ninguna base de datos propia.",
  "useHeading": "Uso de los datos",
  "location": "Su ubicación actual se usa solo para consultar en tiempo real lugares cercanos, transporte e indicaciones, y no se guarda. Puede aparecer temporalmente en los registros de solicitudes de la infraestructura del servidor.",
  "chat": "En el chat con IA, sus preguntas, la conversación, el lugar que está viendo y su ubicación actual se envían a Google Gemini para generar respuestas. Las preguntas que requieren búsqueda web también se envían a Perplexity. Las respuestas son generadas por IA y pueden ser inexactas.",
  "search": "Los términos de búsqueda se envían a proveedores como Kakao y Naver, y a la búsqueda web de Perplexity solo cuando no hay resultados de lugares ni direcciones.",
  "dictation": "El dictado en la app de iOS se procesa en el dispositivo, así que el audio nunca sale de él. El dictado en la web envía el audio a Deepgram para transcribirlo y no lo guarda después.",
  "contactHeading": "Contacto",
  "contact": "Para consultas sobre el servicio o esta política, escriba a engccer@gmail.com."
}
```

`messages/fr.json`:
```json
"privacy": {
  "title": "Politique de confidentialité",
  "intro": "Gildongmu fonctionne sans compte et ne conserve aucune donnée personnelle dans une base de données propre.",
  "useHeading": "Utilisation des données",
  "location": "Votre position actuelle sert uniquement à consulter en temps réel les lieux à proximité, les transports et les itinéraires, et n'est pas conservée. Elle peut apparaître temporairement dans les journaux de requêtes de l'infrastructure serveur.",
  "chat": "Dans le chat IA, vos questions, la conversation, le lieu consulté et votre position actuelle sont envoyés à Google Gemini pour générer les réponses. Les questions nécessitant une recherche web sont aussi transmises à Perplexity. Les réponses sont générées par IA et peuvent être inexactes.",
  "search": "Les termes de recherche sont transmis à des fournisseurs comme Kakao et Naver, et à la recherche web Perplexity uniquement lorsqu'il n'y a aucun résultat de lieu ni d'adresse.",
  "dictation": "La dictée dans l'app iOS est traitée sur l'appareil : l'audio ne le quitte jamais. La dictée sur le web envoie l'audio à Deepgram pour transcription et ne le conserve pas ensuite.",
  "contactHeading": "Contact",
  "contact": "Pour toute question sur le service ou cette politique, écrivez à engccer@gmail.com."
}
```

`messages/it.json`:
```json
"privacy": {
  "title": "Informativa sulla privacy",
  "intro": "Gildongmu funziona senza account e non conserva dati personali in alcun database proprio.",
  "useHeading": "Uso dei dati",
  "location": "La posizione attuale viene usata solo per consultare in tempo reale luoghi vicini, trasporti e indicazioni, e non viene conservata. Può comparire temporaneamente nei log delle richieste dell'infrastruttura server.",
  "chat": "Nella chat IA, le domande, la conversazione, il luogo visualizzato e la posizione attuale vengono inviati a Google Gemini per generare le risposte. Le domande che richiedono una ricerca web vengono inviate anche a Perplexity. Le risposte sono generate dall'IA e possono essere imprecise.",
  "search": "I termini di ricerca vengono inviati a fornitori come Kakao e Naver, e alla ricerca web Perplexity solo quando non ci sono risultati di luoghi o indirizzi.",
  "dictation": "La dettatura nell'app iOS viene elaborata sul dispositivo: l'audio non lo lascia mai. La dettatura sul web invia l'audio a Deepgram per la trascrizione e non lo conserva.",
  "contactHeading": "Contatto",
  "contact": "Per domande sul servizio o su questa informativa, scrivere a engccer@gmail.com."
}
```

- [ ] **Step 2: 키 대칭 확인** — Run: `npm run test:run -- i18n-messages` / Expected: PASS

- [ ] **Step 3: 페이지 생성** — `src/app/[locale]/privacy/page.tsx` (offline 페이지 패턴, heading 계층 h2→h3, 과잉 landmark 없음):

```tsx
import { getTranslations, setRequestLocale } from "next-intl/server";

// 개인정보 처리방침 — ASC 처리방침 URL 겸 지원 URL(스펙 §3). 내용은 매니페스트·영양
// 라벨과 3자 일치가 불변식이라, 수집 항목을 바꾸면 이 페이지도 함께 갱신해야 한다.
export default async function PrivacyPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("privacy");
  return (
    <>
      <h2 className="text-xl font-semibold">{t("title")}</h2>
      <p className="mt-2">{t("intro")}</p>
      <h3 className="mt-6 text-lg font-semibold">{t("useHeading")}</h3>
      <p className="mt-2">{t("location")}</p>
      <p className="mt-2">{t("chat")}</p>
      <p className="mt-2">{t("search")}</p>
      <p className="mt-2">{t("dictation")}</p>
      <h3 className="mt-6 text-lg font-semibold">{t("contactHeading")}</h3>
      <p className="mt-2">{t("contact")}</p>
    </>
  );
}
```

- [ ] **Step 4: 홈 하단 링크** — `src/app/[locale]/page.tsx`: `Link`를 import하고 `<PlaceSearch .../>`를 프래그먼트로 감싸 아래에 링크 추가. `getTranslations`도 import(이미 있으면 재사용):

```tsx
import { Link } from "@/i18n/navigation";
import { getTranslations } from "next-intl/server";
```

```tsx
  const t = await getTranslations("privacy");
  return (
    <>
      <PlaceSearch
        {/* 기존 props 전부 그대로 */}
      />
      <p className="mt-8 text-center">
        <Link href="/privacy" className="underline min-h-11 inline-flex items-center">
          {t("title")}
        </Link>
      </p>
    </>
  );
```

- [ ] **Step 5: 빌드 확인** — Run: `npm run lint && npm run test:run && npm run build` / Expected: PASS, `/[locale]/privacy` 라우트 생성 로그 확인

- [ ] **Step 6: 커밋**

```bash
git add messages/ko.json messages/en.json messages/es.json messages/fr.json messages/it.json "src/app/[locale]/privacy/page.tsx" "src/app/[locale]/page.tsx" && \
git commit -m "feat(privacy): 개인정보 처리방침 페이지 5개 언어 — ASC 처리방침·지원 URL 겸용(스펙 §3)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>" -- messages/ko.json messages/en.json messages/es.json messages/fr.json messages/it.json "src/app/[locale]/privacy/page.tsx" "src/app/[locale]/page.tsx"
```

---

### Task 3: iOS 동의 상태 + ChatModel 전송 가드

**Files:**
- Create: `ios/Gildongmu/Chat/AIChatConsent.swift`
- Modify: `ios/Gildongmu/Chat/ChatModel.swift` (send 가드)

**Interfaces:**
- Produces: `AIChatConsent.key: String`("aiChatConsent"), `AIChatConsent.granted: Bool` — Task 4·5가 `@AppStorage(AIChatConsent.key)`로 같은 키를 바인딩한다.
- Consumes: 없음(UserDefaults 표준).

- [ ] **Step 1: 상태 헬퍼 생성** — `ios/Gildongmu/Chat/AIChatConsent.swift`:

```swift
import Foundation

/// AI 채팅 데이터 전송 동의(App Review 5.1.2(i), 스펙 §1). 기본 false.
/// 미결정/거부를 구분하지 않는다 — 어느 쪽이든 동의 화면을 보여주므로 동작이 같다.
/// View는 @AppStorage(AIChatConsent.key)로, 모델 가드는 granted로 같은 키를 읽는다.
enum AIChatConsent {
    static let key = "aiChatConsent"
    static var granted: Bool { UserDefaults.standard.bool(forKey: key) }
}
```

- [ ] **Step 2: 전송 가드** — `ios/Gildongmu/Chat/ChatModel.swift`의 `func send(_ text: String)` 첫 가드를 확장:

기존:
```swift
        guard !trimmed.isEmpty, !isStreaming else { return }
```
변경:
```swift
        // 동의 가드(스펙 §1 이중 방어): UI 게이트가 뚫려도 미동의 전송은 구조적으로 불가.
        guard AIChatConsent.granted, !trimmed.isEmpty, !isStreaming else { return }
```

- [ ] **Step 3: 빌드 확인** — Run: Global Constraints의 xcodebuild 명령 / Expected: `BUILD SUCCEEDED` (앱 타깃에 단위 테스트 레인이 없어 가드는 빌드+Task 8 실기기 QA로 검증 — 스펙 §7 예정 사유)

- [ ] **Step 4: 커밋**

```bash
git add ios/Gildongmu/Chat/AIChatConsent.swift ios/Gildongmu/Chat/ChatModel.swift && \
git commit -m "feat(ios): AI 채팅 동의 상태 + ChatModel 전송 가드 — 미동의 전송 구조 차단(5.1.2(i))

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>" -- ios/Gildongmu/Chat/AIChatConsent.swift ios/Gildongmu/Chat/ChatModel.swift
```

---

### Task 4: iOS 인라인 동의 화면 + 채팅 탭·장소 sheet 와이어링

**Files:**
- Create: `ios/Gildongmu/Chat/ChatConsentView.swift`
- Modify: `ios/Gildongmu/Chat/ChatTabView.swift`, `ios/Gildongmu/Chat/ChatView.swift`
- Modify: `ios/Gildongmu/Chat/ChatConversationView.swift` (`focusDraftOnAppear` 파라미터)
- Modify: `ios/i18n/ios-extra/{ko,en,es,fr,it}.json` + 재생성된 `ios/Gildongmu/Resources/Localizable.xcstrings`

**Interfaces:**
- Consumes: Task 3의 `AIChatConsent.key`, Task 2의 `/{locale}/privacy` URL, `AppConfig.apiBaseURL: URL`, `AppLanguage.current: String`.
- Produces: `ChatConsentView(onConsent: () -> Void)`; `ChatConversationView(model:cancelsOnDisappear:focusDraftOnAppear:suggestions:)`의 신규 `focusDraftOnAppear: Bool = false`.

- [ ] **Step 1: i18n 키 추가** — `ios/i18n/ios-extra/*.json` 5개 파일의 `ios` 오브젝트에 추가(`chat`·`settings`·`common` 하위 기존 구조에 병합):

ko:
```json
"chat": { "consentTitle": "AI 채팅 사용 안내",
  "consentData": "질문과 대화 내용, 함께 보는 장소 정보, 현재 위치가 답변 생성을 위해 Google Gemini로 전송됩니다. 웹 검색이 필요한 질문은 Perplexity에도 전달됩니다.",
  "consentAiNotice": "답변은 AI가 생성하며 부정확할 수 있습니다.",
  "consentAlt": "동의하지 않아도 검색과 내 주변 탭은 그대로 사용할 수 있습니다.",
  "consentAgree": "동의하고 시작" },
"common": { "privacyPolicy": "개인정보 처리방침" }
```
en:
```json
"chat": { "consentTitle": "About AI Chat",
  "consentData": "Your questions, the conversation, the place you are viewing, and your current location are sent to Google Gemini to generate answers. Questions that need a web search are also sent to Perplexity.",
  "consentAiNotice": "Answers are AI-generated and may be inaccurate.",
  "consentAlt": "You can keep using the Search and Nearby tabs without agreeing.",
  "consentAgree": "Agree and start" },
"common": { "privacyPolicy": "Privacy Policy" }
```
es:
```json
"chat": { "consentTitle": "Acerca del chat con IA",
  "consentData": "Sus preguntas, la conversación, el lugar que está viendo y su ubicación actual se envían a Google Gemini para generar respuestas. Las preguntas que requieren búsqueda web también se envían a Perplexity.",
  "consentAiNotice": "Las respuestas son generadas por IA y pueden ser inexactas.",
  "consentAlt": "Puede seguir usando las pestañas Buscar y Cerca sin aceptar.",
  "consentAgree": "Aceptar y empezar" },
"common": { "privacyPolicy": "Política de privacidad" }
```
fr:
```json
"chat": { "consentTitle": "À propos du chat IA",
  "consentData": "Vos questions, la conversation, le lieu consulté et votre position actuelle sont envoyés à Google Gemini pour générer les réponses. Les questions nécessitant une recherche web sont aussi transmises à Perplexity.",
  "consentAiNotice": "Les réponses sont générées par IA et peuvent être inexactes.",
  "consentAlt": "Vous pouvez continuer à utiliser les onglets Recherche et À proximité sans accepter.",
  "consentAgree": "Accepter et commencer" },
"common": { "privacyPolicy": "Politique de confidentialité" }
```
it:
```json
"chat": { "consentTitle": "Informazioni sulla chat IA",
  "consentData": "Le domande, la conversazione, il luogo visualizzato e la posizione attuale vengono inviati a Google Gemini per generare le risposte. Le domande che richiedono una ricerca web vengono inviate anche a Perplexity.",
  "consentAiNotice": "Le risposte sono generate dall'IA e possono essere imprecise.",
  "consentAlt": "Puoi continuare a usare le schede Cerca e Nelle vicinanze senza accettare.",
  "consentAgree": "Accetta e inizia" },
"common": { "privacyPolicy": "Informativa sulla privacy" }
```

⚠ 각 파일에 이미 `ios.chat`·`ios.common` 오브젝트가 있으므로 **기존 오브젝트 안에 키를 병합**한다(오브젝트 통째 교체 금지).

- [ ] **Step 2: 카탈로그 재생성 + 린트** — Run: `node ios/scripts/messages-to-xcstrings.mjs all && node ios/scripts/check-xcstrings-keys.mjs` / Expected: 재생성 후 린터가 아직 미사용 키 경고 없이 종료(린터는 소스 참조→카탈로그 방향만 검사).

- [ ] **Step 3: ChatConsentView 생성** — `ios/Gildongmu/Chat/ChatConsentView.swift`:

```swift
import SwiftUI

/// AI 채팅 인라인 동의 화면(스펙 §1, App Review 5.1.2(i)). 미동의 상태에서
/// 채팅 탭·장소 채팅 sheet가 대화 UI 대신 이 화면을 보여준다. 시트·팝업이 아니라
/// 인라인이라 VoiceOver 포커스가 예측 가능하고 받아쓰기 홀드 계약과 충돌하지 않는다.
struct ChatConsentView: View {
    /// 동의 버튼 탭 시 호출 — 호출부가 AppStorage를 갱신해 채팅 UI로 전환한다.
    let onConsent: () -> Void

    private var privacyURL: URL {
        AppConfig.apiBaseURL.appending(path: "\(AppLanguage.current)/privacy")
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                Text(appLocalized("ios.chat.consentTitle"))
                    .font(.title3.bold())
                    .accessibilityAddTraits(.isHeader)
                Text(appLocalized("ios.chat.consentData"))
                Text(appLocalized("ios.chat.consentAiNotice"))
                Text(appLocalized("ios.chat.consentAlt"))
                Link(appLocalized("ios.common.privacyPolicy"), destination: privacyURL)
                    .frame(minHeight: 44)
                Button {
                    onConsent()
                } label: {
                    Text(appLocalized("ios.chat.consentAgree"))
                        .frame(maxWidth: .infinity, minHeight: 44)
                }
                .buttonStyle(.borderedProminent)
            }
            .padding()
        }
    }
}
```

- [ ] **Step 4: ChatConversationView에 진입 포커스 파라미터** — `ios/Gildongmu/Chat/ChatConversationView.swift`: init 파라미터에 `focusDraftOnAppear: Bool = false` 추가(기존 `cancelsOnDisappear` 옆, 기존 호출부는 기본값이라 무변경). `.onAppear`(없으면 최상위 컨테이너에 추가)에서:

```swift
            .onAppear {
                // 동의→채팅 전환 직후 1회: 사라진 동의 버튼에서 입력 필드로 선점 이동(헌장 §5).
                // 400ms 지연은 VO 재시도 관례(전환 렌더 안정 후 포커스).
                guard focusDraftOnAppear else { return }
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) {
                    isDraftFocused = true
                }
            }
```

⚠ 기존 파일의 프로퍼티 선언·init 순서는 파일 관례를 따르고, `isDraftFocused`는 기존 `@AccessibilityFocusState`를 그대로 사용한다(신규 상태 추가 금지).

- [ ] **Step 5: ChatTabView 게이트** — `ios/Gildongmu/Chat/ChatTabView.swift`의 `body`를:

```swift
    @AppStorage(AIChatConsent.key) private var consentGranted = false
    /// 동의 직후 전환에서만 입력 필드 선점 포커스(재실행 시 기존 낭독 흐름 유지).
    @State private var justGranted = false

    var body: some View {
        NavigationStack {
            Group {
                if consentGranted {
                    ChatConversationView(model: model, focusDraftOnAppear: justGranted) {
                        suggestionList
                    }
                } else {
                    ChatConsentView {
                        justGranted = true
                        consentGranted = true
                    }
                }
            }
            .navigationTitle(appLocalized("ios.tab.chat"))
            .navigationBarTitleDisplayMode(.inline)
            .gildongmuTitleMenu()
        }
    }
```

- [ ] **Step 6: ChatView(장소 sheet) 게이트** — `ios/Gildongmu/Chat/ChatView.swift` 동형 적용(닫기 툴바는 두 분기 공통 유지):

```swift
    @AppStorage(AIChatConsent.key) private var consentGranted = false
    @State private var justGranted = false

    var body: some View {
        NavigationStack {
            Group {
                if consentGranted {
                    ChatConversationView(model: model, cancelsOnDisappear: true,
                                         focusDraftOnAppear: justGranted) { EmptyView() }
                } else {
                    ChatConsentView {
                        justGranted = true
                        consentGranted = true
                    }
                }
            }
            .navigationTitle(model.place?.name ?? "")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(appLocalized("actions.close")) { dismiss() }
                }
            }
        }
        .presentationDetents([.large])
    }
```

- [ ] **Step 7: 린터·빌드 확인** — Run: `node ios/scripts/check-xcstrings-keys.mjs` → PASS, 이어서 Global Constraints의 xcodebuild → `BUILD SUCCEEDED`

- [ ] **Step 8: 커밋** (재생성된 두 카탈로그 포함 — Kit 카탈로그도 재생성으로 변경됐다면 함께)

```bash
git add ios/Gildongmu/Chat/ChatConsentView.swift ios/Gildongmu/Chat/ChatTabView.swift ios/Gildongmu/Chat/ChatView.swift ios/Gildongmu/Chat/ChatConversationView.swift ios/i18n/ios-extra/ko.json ios/i18n/ios-extra/en.json ios/i18n/ios-extra/es.json ios/i18n/ios-extra/fr.json ios/i18n/ios-extra/it.json ios/Gildongmu/Resources/Localizable.xcstrings && \
git commit -m "feat(ios): AI 채팅 인라인 동의 화면 — 채팅 탭·장소 sheet 게이트, 동의 후 입력 필드 선점 포커스

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>" -- ios/Gildongmu/Chat/ChatConsentView.swift ios/Gildongmu/Chat/ChatTabView.swift ios/Gildongmu/Chat/ChatView.swift ios/Gildongmu/Chat/ChatConversationView.swift ios/i18n/ios-extra ios/Gildongmu/Resources/Localizable.xcstrings
```

---

### Task 5: SettingsView "AI 채팅" 섹션 (동의 토글·처리방침·문제 신고)

**Files:**
- Modify: `ios/Gildongmu/SettingsView.swift`
- Modify: `ios/i18n/ios-extra/{ko,en,es,fr,it}.json` + 재생성 카탈로그

**Interfaces:**
- Consumes: `AIChatConsent.key`(Task 3), `/{locale}/privacy` URL(Task 2), `ios.common.privacyPolicy` 키(Task 4).

- [ ] **Step 1: i18n 키 추가** — `ios-extra` 5개 파일 `ios.settings`에 병합:

| 키 | ko | en | es | fr | it |
|---|---|---|---|---|---|
| `aiSection` | AI 채팅 | AI Chat | Chat con IA | Chat IA | Chat IA |
| `aiConsentToggle` | AI 채팅 데이터 전송 동의 | AI chat data sharing consent | Consentimiento de envío de datos del chat con IA | Consentement à l'envoi des données du chat IA | Consenso all'invio dei dati della chat IA |
| `reportProblem` | 문제 신고 | Report a problem | Informar de un problema | Signaler un problème | Segnala un problema |

- [ ] **Step 2: 재생성 + 린트** — Run: `node ios/scripts/messages-to-xcstrings.mjs all && node ios/scripts/check-xcstrings-keys.mjs` / Expected: PASS

- [ ] **Step 3: 섹션 추가** — `SettingsView.swift`의 `List` 안, 언어 Picker 아래에:

```swift
                Section(appLocalized("ios.settings.aiSection")) {
                    // 해제하면 채팅이 다시 동의 화면으로 — 5.1.2(i)의 동의 재검토·철회 요건.
                    Toggle(appLocalized("ios.settings.aiConsentToggle"),
                           isOn: $aiConsentGranted)
                    Link(appLocalized("ios.common.privacyPolicy"),
                         destination: AppConfig.apiBaseURL.appending(path: "\(AppLanguage.current)/privacy"))
                    // AI 생성 콘텐츠 신고 경로의 최소 대응(스펙 §1).
                    Link(appLocalized("ios.settings.reportProblem"),
                         destination: URL(string: "mailto:engccer@gmail.com")!)
                }
```

프로퍼티에 추가:
```swift
    @AppStorage(AIChatConsent.key) private var aiConsentGranted = false
```

- [ ] **Step 4: 린터·빌드 확인** — Run: `node ios/scripts/check-xcstrings-keys.mjs` → PASS, xcodebuild → `BUILD SUCCEEDED`

- [ ] **Step 5: 커밋**

```bash
git add ios/Gildongmu/SettingsView.swift ios/i18n/ios-extra/ko.json ios/i18n/ios-extra/en.json ios/i18n/ios-extra/es.json ios/i18n/ios-extra/fr.json ios/i18n/ios-extra/it.json ios/Gildongmu/Resources/Localizable.xcstrings && \
git commit -m "feat(ios): 설정에 AI 채팅 섹션 — 동의 토글(철회 경로)·처리방침·문제 신고 링크

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>" -- ios/Gildongmu/SettingsView.swift ios/i18n/ios-extra ios/Gildongmu/Resources/Localizable.xcstrings
```

---

### Task 6: PrivacyInfo.xcprivacy

**Files:**
- Create: `ios/Gildongmu/PrivacyInfo.xcprivacy`

**Interfaces:** 없음. pbxproj는 PBXFileSystemSynchronizedRootGroup(objectVersion 77)이라 `ios/Gildongmu/` 아래 새 파일이 자동으로 앱 타깃에 포함된다 — pbxproj 수정 불요.

- [ ] **Step 1: 파일 생성** — 내용(스펙 §2: UserDefaults CA92.1, 추적 없음, 위치+사용자 콘텐츠를 App Functionality·not linked로 — ASC 영양 라벨과 문구 일치 불변식):

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>NSPrivacyTracking</key>
	<false/>
	<key>NSPrivacyTrackingDomains</key>
	<array/>
	<key>NSPrivacyAccessedAPITypes</key>
	<array>
		<dict>
			<key>NSPrivacyAccessedAPIType</key>
			<string>NSPrivacyAccessedAPICategoryUserDefaults</string>
			<key>NSPrivacyAccessedAPITypeReasons</key>
			<array>
				<string>CA92.1</string>
			</array>
		</dict>
	</array>
	<key>NSPrivacyCollectedDataTypes</key>
	<array>
		<dict>
			<key>NSPrivacyCollectedDataType</key>
			<string>NSPrivacyCollectedDataTypePreciseLocation</string>
			<key>NSPrivacyCollectedDataTypeLinked</key>
			<false/>
			<key>NSPrivacyCollectedDataTypeTracking</key>
			<false/>
			<key>NSPrivacyCollectedDataTypePurposes</key>
			<array>
				<string>NSPrivacyCollectedDataTypePurposeAppFunctionality</string>
			</array>
		</dict>
		<dict>
			<key>NSPrivacyCollectedDataType</key>
			<string>NSPrivacyCollectedDataTypeOtherUserContent</string>
			<key>NSPrivacyCollectedDataTypeLinked</key>
			<false/>
			<key>NSPrivacyCollectedDataTypeTracking</key>
			<false/>
			<key>NSPrivacyCollectedDataTypePurposes</key>
			<array>
				<string>NSPrivacyCollectedDataTypePurposeAppFunctionality</string>
			</array>
		</dict>
	</array>
</dict>
</plist>
```

- [ ] **Step 2: 빌드 + 번들 포함 확인** — Run: xcodebuild(Global Constraints) → `BUILD SUCCEEDED`. 이어 빌드 산출물에 파일이 들어갔는지:

```bash
find ~/Library/Developer/Xcode/DerivedData -path "*Gildongmu.app/PrivacyInfo.xcprivacy" -newer ios/Gildongmu/PrivacyInfo.xcprivacy 2>/dev/null | head -1
```
Expected: 경로 1건 출력(비어 있으면 타깃 포함 실패 — pbxproj 동기화 그룹 예외를 조사).

- [ ] **Step 3: 커밋**

```bash
git add ios/Gildongmu/PrivacyInfo.xcprivacy && \
git commit -m "feat(ios): PrivacyInfo.xcprivacy — UserDefaults CA92.1, 위치·채팅 콘텐츠 App Functionality/not linked 선언

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>" -- ios/Gildongmu/PrivacyInfo.xcprivacy
```

---

### Task 7: 정식명·버전 승계

**Files:**
- Modify: `ios/Gildongmu.xcodeproj/project.pbxproj` (Debug·Release 두 구성 모두: 168·172·182·195·199·209행 부근)

**Interfaces:** 없음.

- [ ] **Step 1: 값 교체** — pbxproj에서 (두 구성 각각, 총 6곳):
  - `CURRENT_PROJECT_VERSION = 1;` → `CURRENT_PROJECT_VERSION = 2;`
  - `INFOPLIST_KEY_CFBundleDisplayName = "길동무 베타";` → `INFOPLIST_KEY_CFBundleDisplayName = "길동무";`
  - `MARKETING_VERSION = 0.1.0;` → `MARKETING_VERSION = 1.0.0;`

- [ ] **Step 2: 확인** — Run: `grep -c 'MARKETING_VERSION = 1.0.0' ios/Gildongmu.xcodeproj/project.pbxproj` → `2`, `grep -c '길동무 베타' ios/Gildongmu.xcodeproj/project.pbxproj` → `0`. xcodebuild → `BUILD SUCCEEDED`.

- [ ] **Step 3: 커밋**

```bash
git add ios/Gildongmu.xcodeproj/project.pbxproj && \
git commit -m "feat(ios): 정식명 '길동무' 승계 + 1.0.0(빌드 2) — M8 잔여분(스펙 §4)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>" -- ios/Gildongmu.xcodeproj/project.pbxproj
```

---

### Task 8: 통합 검증·배포 (메인 세션 수행)

**Files:** 없음(검증·배포만). PROGRESS.md 갱신 포함.

- [ ] **Step 1: 전체 게이트** — `npm run lint && npm run test:run && npm run build`, `node ios/scripts/check-xcstrings-keys.mjs`, xcodebuild 빌드 전부 PASS 재확인.
- [ ] **Step 2: push(자동배포)** — `git push origin main` 후 Vercel 배포 완료 대기.
- [ ] **Step 3: prod 실호출 게이트**
  - 처리방침: `for l in ko en es fr it; do curl -s -o /dev/null -w "%{http_code} " "https://gildongmu.vercel.app/$l/privacy"; done` → `200 200 200 200 200`
  - 레이트리밋: 동일 IP로 `/api/chat`에 11회 연속 POST(더미 body) → 11회째 `429`. ⚠ Gemini 유료 호출 방지를 위해 body는 `{"messages":[]}` 수준의 최소로(모델이 빈 대화에 응답해도 1~10회 저비용, 필요 시 5회만 실측하고 코어는 단위 테스트가 보증).
- [ ] **Step 4: 실기기 배포** — `ios/deploy-device.sh` (기기 연결 시).
- [ ] **Step 5: PROGRESS.md 갱신** — iOS 항목에 "App Store 필수 요건 완비(동의 UI·매니페스트·처리방침·1.0.0), 실기기 QA 대기, 심사 제출은 ~1주 후 §8 체크리스트" 기록.
- [ ] **Step 6: 실기기 VoiceOver QA(위원장 게이트, BLOCKED-on-user)** — 체크리스트:
  1. 채팅 탭 최초 진입: 동의 화면 낭독 순서(제목 헤딩→전송 데이터→AI 고지→대안 안내→처리방침 링크→동의 버튼)
  2. 동의 버튼 활성화 → 채팅 UI 전환, 포커스가 입력 필드에 안착
  3. 전송·받아쓰기 홀드 플로 회귀 없음
  4. 설정 → AI 채팅 토글 off → 채팅 탭 재진입 시 동의 화면 복귀, 미동의 상태 전송 불가
  5. 장소 상세 → 채팅 sheet: 동일 게이트 동작
  6. 처리방침 링크가 현재 언어 페이지로 열림
