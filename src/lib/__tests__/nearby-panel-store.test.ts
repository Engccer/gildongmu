import { describe, it, expect, beforeEach } from "vitest";
import {
  claimNearbyPanel,
  releaseNearbyPanel,
  subscribeNearbyPanel,
  getActiveNearbyPanel,
  getServerActiveNearbyPanel,
  __resetNearbyPanelStore,
} from "../nearby-panel-store";

beforeEach(() => {
  __resetNearbyPanelStore();
});

describe("nearby-panel-store (홈 둘러보기 아코디언 단일 출처)", () => {
  it("초기 활성 패널은 없다(null)", () => {
    expect(getActiveNearbyPanel()).toBeNull();
  });

  it("서버 스냅샷은 항상 null(hydration 안전)", () => {
    claimNearbyPanel("a");
    expect(getServerActiveNearbyPanel()).toBeNull();
  });

  it("claim하면 그 패널이 활성이 된다", () => {
    claimNearbyPanel("a");
    expect(getActiveNearbyPanel()).toBe("a");
  });

  it("다른 패널을 claim하면 활성이 교체된다(한 번에 하나만)", () => {
    claimNearbyPanel("a");
    claimNearbyPanel("b");
    expect(getActiveNearbyPanel()).toBe("b");
  });

  it("활성 패널이 release하면 null로 돌아간다", () => {
    claimNearbyPanel("a");
    releaseNearbyPanel("a");
    expect(getActiveNearbyPanel()).toBeNull();
  });

  it("활성이 아닌 패널의 release는 무시된다(다른 패널의 점유를 빼앗지 않음)", () => {
    claimNearbyPanel("a");
    releaseNearbyPanel("b"); // a가 활성인데 b가 release → no-op
    expect(getActiveNearbyPanel()).toBe("a");
  });

  it("구독자는 claim/release 변화를 통지받는다", () => {
    let count = 0;
    const unsub = subscribeNearbyPanel(() => {
      count += 1;
    });
    claimNearbyPanel("a"); // null -> a
    claimNearbyPanel("b"); // a -> b
    releaseNearbyPanel("b"); // b -> null
    expect(count).toBe(3);
    unsub();
    claimNearbyPanel("c"); // 구독 해제 후엔 통지 없음
    expect(count).toBe(3);
  });

  it("같은 패널을 다시 claim하면 상태 변화가 없어 통지하지 않는다", () => {
    claimNearbyPanel("a");
    let count = 0;
    subscribeNearbyPanel(() => {
      count += 1;
    });
    claimNearbyPanel("a"); // 이미 a → no-op
    expect(count).toBe(0);
    expect(getActiveNearbyPanel()).toBe("a");
  });
});
