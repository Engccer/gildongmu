import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { routing } from "@/i18n/routing";
import { faqPageJsonLd, serializeJsonLd } from "@/lib/structured-data";
import { APP_STORE_URL } from "@/lib/site";

// 소개·FAQ — 사람 방문자와 AI 답변 엔진(GEO) 공용 사실 페이지.
// FAQ 질문은 h4 heading(발견 경로: 정적 정보 리스트 항목 이름은 heading 관례),
// 같은 문답을 FAQPage JSON-LD로도 노출한다(단일 소스 = 번역 카탈로그).
const FAQ_COUNT = 5;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "about" });
  return {
    title: t("title"),
    description: t("summary"),
    alternates: {
      canonical: `/${locale}/about`,
      languages: {
        ...Object.fromEntries(routing.locales.map((l) => [l, `/${l}/about`])),
        "x-default": `/${routing.defaultLocale}/about`,
      },
    },
  };
}

export default async function AboutPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("about");
  const featureKeys = ["feature1", "feature2", "feature3", "feature4", "feature5"] as const;
  const faq = Array.from({ length: FAQ_COUNT }, (_, i) => ({
    question: t(`faq${i + 1}q`),
    answer: t(`faq${i + 1}a`),
  }));

  return (
    <>
      <h2 className="text-xl font-semibold">{t("title")}</h2>
      <p className="mt-2">{t("summary")}</p>

      <h3 className="mt-6 text-lg font-semibold">{t("featuresHeading")}</h3>
      <ul className="mt-2 list-disc space-y-2 pl-5">
        {featureKeys.map((key) => (
          <li key={key}>{t(key)}</li>
        ))}
      </ul>

      <h3 className="mt-6 text-lg font-semibold">{t("howHeading")}</h3>
      <p className="mt-2">{t("howWeb")}</p>
      <p className="mt-2">
        <a href={APP_STORE_URL} className="underline min-h-11 inline-flex items-center">
          {t("howIosLink")}
        </a>
      </p>
      <p className="mt-2">{t("howCli")}</p>

      <h3 className="mt-6 text-lg font-semibold">{t("faqHeading")}</h3>
      {faq.map((f) => (
        <div key={f.question} className="mt-4">
          <h4 className="font-semibold">{f.question}</h4>
          <p className="mt-1">{f.answer}</p>
        </div>
      ))}

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: serializeJsonLd(faqPageJsonLd(faq)) }}
      />
    </>
  );
}
