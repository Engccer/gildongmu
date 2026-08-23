import type { Metadata } from "next";
import { setRequestLocale, getTranslations } from "next-intl/server";
import { PlaceSearch } from "@/components/PlaceSearch";
import { Link } from "@/i18n/navigation";
import { dataLocale } from "@/lib/data-locale";
import { routing } from "@/i18n/routing";
import { activeProviderName } from "@/lib/providers/places";
import { softwareApplicationJsonLd, serializeJsonLd } from "@/lib/structured-data";
import {
  hasKakaoKey,
  hasCarRouteKey,
  hasDataGoKrKey,
  hasSeoulOpenDataKey,
  hasSeoulSubwayRealtimeKey,
  hasOdsayKey,
  hasJusoKey,
  hasGeminiKey,
  hasPerplexityKey,
  hasWalkRouteKeyFor,
  hasNaverLocalKeys,
} from "@/lib/env";

// 홈이 로케일의 대표 URL — canonical·hreflang을 여기서만 선언한다
// (layout에 두면 /privacy·/about까지 홈 canonical로 오염).
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  return {
    alternates: {
      canonical: `/${locale}`,
      languages: {
        ...Object.fromEntries(routing.locales.map((l) => [l, `/${l}`])),
        "x-default": `/${routing.defaultLocale}`,
      },
    },
  };
}

export default async function HomePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("privacy");
  const tApp = await getTranslations("app");
  const tAbout = await getTranslations("about");

  return (
    <>
      <PlaceSearch
        isMockMode={activeProviderName() === "mock"}
        canBriefCarRoute={hasCarRouteKey()}
        canShowBus={hasDataGoKrKey()}
        canShowBike={hasSeoulOpenDataKey()}
        canShowSubway={hasSeoulSubwayRealtimeKey()}
        canShowClinic={hasDataGoKrKey()}
        canShowBarrierFree={hasDataGoKrKey()}
        canShowAir={hasDataGoKrKey()}
        canShowKids={hasKakaoKey()}
        canShowEvents={hasSeoulOpenDataKey()}
        canShowAround={hasKakaoKey()}
        canShowTransit={hasOdsayKey()}
        canSearchAddress={hasJusoKey()}
        canSearchWeb={hasPerplexityKey()}
        canShowChat={hasGeminiKey()}
        canShowWalk={hasWalkRouteKeyFor(dataLocale(locale) === "ko" ? "ko" : "en")}
        canSortByReview={hasNaverLocalKeys()}
      />
      <p className="mt-8 flex justify-center gap-6">
        <Link href="/about" className="underline min-h-11 inline-flex items-center">
          {tAbout("title")}
        </Link>
        <Link href="/privacy" className="underline min-h-11 inline-flex items-center">
          {t("title")}
        </Link>
      </p>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: serializeJsonLd(
            softwareApplicationJsonLd({
              name: tApp("title"),
              description: tAbout("summary"),
              locale,
              languages: routing.locales,
            })
          ),
        }}
      />
    </>
  );
}
