/**
 * schema.org JSON-LD 빌더 — AI 답변 엔진·검색 크롤러용 구조화 데이터.
 * React/Next 비의존. 소비자는 <script type="application/ld+json">에
 * serializeJsonLd() 결과를 넣는다(직접 JSON.stringify 금지 — 이스케이프 참조).
 */
import { SITE_ORIGIN, APP_STORE_URL, NPM_CLI_URL, NPM_MCP_URL } from "./site";

export function softwareApplicationJsonLd(input: {
  name: string;
  description: string;
  locale: string;
  languages: readonly string[];
}) {
  return {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: input.name,
    description: input.description,
    url: `${SITE_ORIGIN}/${input.locale}`,
    applicationCategory: "TravelApplication",
    operatingSystem: "Web, iOS",
    offers: { "@type": "Offer", price: "0", priceCurrency: "KRW" },
    inLanguage: [...input.languages],
    installUrl: APP_STORE_URL,
    sameAs: [APP_STORE_URL, NPM_CLI_URL, NPM_MCP_URL],
    // W3C a11y-metadata 통제 어휘만 사용(임의 문자열 금지):
    // feature=콘텐츠 기능, control=조작 수단, accessMode=양식.
    accessMode: ["textual"],
    accessibilityFeature: ["structuralNavigation", "readingOrder"],
    accessibilityControl: ["fullKeyboardControl", "fullTouchControl"],
  };
}

export function faqPageJsonLd(pairs: { question: string; answer: string }[]) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: pairs.map((p) => ({
      "@type": "Question",
      name: p.question,
      acceptedAnswer: { "@type": "Answer", text: p.answer },
    })),
  };
}

/** JSON-LD 직렬화 — `<` 이스케이프로 `</script>` 조기 종료(HTML 주입) 차단. */
export function serializeJsonLd(data: object): string {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}
