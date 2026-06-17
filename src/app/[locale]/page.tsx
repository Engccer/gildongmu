import { setRequestLocale } from "next-intl/server";
import { PlaceSearch } from "@/components/PlaceSearch";
import { activeProviderName } from "@/lib/providers/places";
import {
  hasKakaoKey,
  hasDataGoKrKey,
  hasSeoulOpenDataKey,
  hasSeoulSubwayRealtimeKey,
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
    />
  );
}
