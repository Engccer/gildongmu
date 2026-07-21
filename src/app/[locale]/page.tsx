import { setRequestLocale, getTranslations } from "next-intl/server";
import { PlaceSearch } from "@/components/PlaceSearch";
import { Link } from "@/i18n/navigation";
import { activeProviderName } from "@/lib/providers/places";
import {
  hasKakaoKey,
  hasDataGoKrKey,
  hasSeoulOpenDataKey,
  hasSeoulSubwayRealtimeKey,
  hasOdsayKey,
  hasJusoKey,
  hasGeminiKey,
  hasPerplexityKey,
  hasTmapKey,
} from "@/lib/env";

export default async function HomePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("privacy");

  return (
    <>
      <PlaceSearch
        isMockMode={activeProviderName() === "mock"}
        canBriefCarRoute={hasKakaoKey()}
        canShowBus={hasDataGoKrKey()}
        canShowBike={hasSeoulOpenDataKey()}
        canShowSubway={hasSeoulSubwayRealtimeKey()}
        canShowClinic={hasDataGoKrKey()}
        canShowBarrierFree={hasDataGoKrKey()}
        canShowAir={hasDataGoKrKey()}
        canShowKids={hasKakaoKey()}
        canShowSurroundings={hasKakaoKey()}
        canShowWhereAmI={hasKakaoKey()}
        canShowTransit={hasOdsayKey()}
        canSearchAddress={hasJusoKey()}
        canSearchWeb={hasPerplexityKey()}
        canShowChat={hasGeminiKey()}
        canShowWalk={hasTmapKey()}
      />
      <p className="mt-8 text-center">
        <Link href="/privacy" className="underline min-h-11 inline-flex items-center">
          {t("title")}
        </Link>
      </p>
    </>
  );
}
