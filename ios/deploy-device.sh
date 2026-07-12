#!/bin/bash
# 연결된 iPhone에 CLI만으로 빌드·설치·실행(Xcode UI 불필요, Xcode 15+ devicectl).
# 사용: ./deploy-device.sh [UDID]  — UDID 생략 시 페어링된 첫 기기 자동 선택.
# 실행 단계는 기기가 잠겨 있으면 실패하는데, 설치는 이미 끝난 상태라 홈 화면에서 열면 된다.
set -euo pipefail
cd "$(dirname "$0")"

UDID="${1:-$(xcrun devicectl list devices 2>/dev/null \
  | awk '/available \(paired\)/{for(i=1;i<=NF;i++) if ($i ~ /^[0-9A-F]{8}-/) print $i}' | head -1)}"
[ -n "$UDID" ] || { echo "페어링된 iOS 기기가 없습니다. USB 연결과 신뢰 설정을 확인하세요." >&2; exit 1; }
echo "대상 기기: $UDID"

xcodebuild -project Gildongmu.xcodeproj -scheme Gildongmu \
  -destination "platform=iOS,id=$UDID" -allowProvisioningUpdates build

APP=$(ls -d ~/Library/Developer/Xcode/DerivedData/Gildongmu-*/Build/Products/Debug-iphoneos/Gildongmu.app | head -1)
xcrun devicectl device install app --device "$UDID" "$APP"

xcrun devicectl device process launch --device "$UDID" space.dodoplanet.gildongmu \
  || echo "설치 완료 — 기기가 잠겨 있어 자동 실행만 실패했습니다. 잠금 해제 후 홈 화면에서 여세요."
