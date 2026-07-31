#!/bin/bash
# 연결된 iPhone에 CLI만으로 빌드·설치·실행(Xcode UI 불필요, Xcode 15+ devicectl).
# 워크스페이스 공통 제네릭 판: 같은 폴더의 *.xcodeproj를 자동 탐지한다
# (gildongmu·dodo-planet·webfortd 세 repo 동일본 — 수정 시 셋 다 반영).
# 사용: ./deploy-device.sh [UDID]  — UDID 생략 시 페어링된 첫 기기 자동 선택.
set -euo pipefail
cd "$(dirname "$0")"

PROJ=$(ls -d *.xcodeproj | head -1)
SCHEME="${PROJ%.xcodeproj}"

# 기기 상태 문자열은 Xcode 버전에 따라 다르다("available (paired)" 또는 "connected", 2026-07-18 실측)
UDID="${1:-$(xcrun devicectl list devices 2>/dev/null \
  | awk '/available \(paired\)|connected/{for(i=1;i<=NF;i++) if ($i ~ /^[0-9A-F]{8}-/) print $i}' | head -1)}"
[ -n "$UDID" ] || { echo "페어링된 iOS 기기가 없습니다. USB 연결과 신뢰 설정을 확인하세요." >&2; exit 1; }
echo "대상: $SCHEME → $UDID"

xcodebuild -project "$PROJ" -scheme "$SCHEME" \
  -destination "platform=iOS,id=$UDID" -allowProvisioningUpdates build

# 번들 ID는 pbxproj 파싱 대신 빌드 산출물의 Info.plist에서 읽는다(타깃 다중일 때 오파싱 방지)
APP=$(ls -dt ~/Library/Developer/Xcode/DerivedData/"$SCHEME"-*/Build/Products/Debug-iphoneos/*.app | head -1)
BUNDLE_ID=$(defaults read "$APP/Info" CFBundleIdentifier)

# repo가 서명 검증 훅을 두었으면 설치 전에 게이트로 건다(없는 repo에선 조용히 건너뜀).
# 공용본의 제네릭성을 유지하려고 존재 여부로 분기한다.
if [ -x scripts/verify-aps-environment.sh ]; then
  ./scripts/verify-aps-environment.sh "$APP"
fi
xcrun devicectl device install app --device "$UDID" "$APP"

xcrun devicectl device process launch --device "$UDID" "$BUNDLE_ID" \
  || echo "설치 완료 — 기기가 잠겨 있어 자동 실행만 실패했습니다. 잠금 해제 후 홈 화면에서 여세요."
