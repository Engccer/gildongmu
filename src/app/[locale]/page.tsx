import { setRequestLocale } from "next-intl/server";
import { PlaceSearch } from "@/components/PlaceSearch";
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
} from "@/lib/env";

export default async function HomePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  return (
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
      canSearchAttractions={hasKakaoKey()}
      canShowTransit={hasOdsayKey()}
      canSearchAddress={hasJusoKey()}
      canSearchWeb={hasPerplexityKey()}
      canShowChat={hasGeminiKey()}
    />
  );
}
