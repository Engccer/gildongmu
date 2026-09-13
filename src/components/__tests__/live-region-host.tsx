"use client";

import { useCallback, useState } from "react";
import { DistanceBeacon } from "@/components/DistanceBeacon";
import { TransitGuidePanel } from "@/components/TransitGuidePanel";

/**
 * 테스트용 창구 숙주(A40). 안내 패널·비콘은 자기 live region을 두지 않고 화면(길찾기
 * 뷰)의 단일 창구에 게시하므로, 그 둘을 단독으로 렌더하는 테스트에는 창구가 필요하다.
 * `DirectionsView`의 창구와 같은 계약을 최소로 재현한다 — 게시 1건이 뜨고, 같은 문장을
 * 다시 게시해도 `seq` 키가 노드를 갈아 끼워 재발화한다.
 *
 * ⚠ 이 파일은 실제 창구의 사본이 아니라 **축소판**이다. 우선순위(`phaseMessage` 덮기)·
 * 대기 꼬리는 뷰의 책임이라 여기 없다 — 그 계약은 `DirectionsView.test.tsx`가 본다.
 */
function useHostChannel() {
  const [live, setLive] = useState<{ text: string; lang?: "ko"; seq: number }>({
    text: "",
    seq: 0,
  });
  const announce = useCallback((text: string, lang?: "ko") => {
    setLive((prev) => ({ text, lang, seq: prev.seq + 1 }));
  }, []);
  const region = (
    <p aria-live="polite" role="status" className="min-h-5 text-sm" lang={live.lang}>
      <span key={live.seq}>{live.text}</span>
    </p>
  );
  return { announce, region };
}

export function TransitGuidePanelHost(
  props: Omit<React.ComponentProps<typeof TransitGuidePanel>, "announce">,
) {
  const { announce, region } = useHostChannel();
  return (
    <>
      <TransitGuidePanel {...props} announce={announce} />
      {region}
    </>
  );
}

export function DistanceBeaconHost(
  props: Omit<React.ComponentProps<typeof DistanceBeacon>, "announce">,
) {
  const { announce, region } = useHostChannel();
  return (
    <>
      <DistanceBeacon {...props} announce={announce} />
      {region}
    </>
  );
}
