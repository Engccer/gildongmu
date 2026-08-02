import { describe, it, expect } from "vitest";
import {
  softwareApplicationJsonLd,
  faqPageJsonLd,
  serializeJsonLd,
} from "../structured-data";
import { SITE_ORIGIN, APP_STORE_URL } from "../site";

describe("softwareApplicationJsonLd", () => {
  const jsonLd = softwareApplicationJsonLd({
    name: "길동무",
    description: "설명",
    locale: "ko",
    languages: ["ko", "en"],
  });

  it("schema.org 필수 골격과 로케일 URL을 갖는다", () => {
    expect(jsonLd["@context"]).toBe("https://schema.org");
    expect(jsonLd["@type"]).toBe("SoftwareApplication");
    expect(jsonLd.url).toBe(`${SITE_ORIGIN}/ko`);
    expect(jsonLd.installUrl).toBe(APP_STORE_URL);
  });

  it("무료임을 Offer price 0으로 선언한다", () => {
    expect(jsonLd.offers).toEqual({ "@type": "Offer", price: "0", priceCurrency: "KRW" });
  });

  it("전달받은 언어 목록을 그대로 싣는다", () => {
    expect(jsonLd.inLanguage).toEqual(["ko", "en"]);
  });

  it("접근성 속성은 W3C 통제 어휘를 축에 맞게 싣는다", () => {
    expect(jsonLd.accessMode).toEqual(["textual"]);
    expect(jsonLd.accessibilityFeature).toEqual(["structuralNavigation", "readingOrder"]);
    expect(jsonLd.accessibilityControl).toEqual(["fullKeyboardControl", "fullTouchControl"]);
  });
});

describe("faqPageJsonLd", () => {
  it("문답 쌍을 Question/Answer 노드로 변환한다", () => {
    const jsonLd = faqPageJsonLd([
      { question: "무료인가요?", answer: "네." },
      { question: "지도가 없나요?", answer: "텍스트가 정본입니다." },
    ]);
    expect(jsonLd["@type"]).toBe("FAQPage");
    expect(jsonLd.mainEntity).toHaveLength(2);
    expect(jsonLd.mainEntity[0]).toEqual({
      "@type": "Question",
      name: "무료인가요?",
      acceptedAnswer: { "@type": "Answer", text: "네." },
    });
  });
});

describe("serializeJsonLd", () => {
  it("`<`를 이스케이프해 </script> 조기 종료를 차단한다", () => {
    const out = serializeJsonLd({ x: "</script><script>alert(1)</script>" });
    expect(out).not.toContain("<");
    expect(JSON.parse(out).x).toBe("</script><script>alert(1)</script>");
  });
});
