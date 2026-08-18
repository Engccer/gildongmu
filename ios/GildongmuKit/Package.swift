// swift-tools-version: 6.2
import PackageDescription

let package = Package(
    name: "GildongmuKit",
    defaultLocalization: "ko",
    platforms: [.iOS(.v18), .macOS(.v26)],
    products: [.library(name: "GildongmuKit", targets: ["GildongmuKit"])],
    targets: [
        .target(
            name: "GildongmuKit",
            // .copy: 카탈로그를 Apple 파이프라인(.lproj 컴파일)이 아니라 원본 JSON
            // 데이터로 싣는다 — Localization.swift가 직접 파싱(swift test 호환 결정론).
            resources: [.copy("Resources/Localizable.xcstrings")]
        ),
        .testTarget(
            name: "GildongmuKitTests",
            dependencies: ["GildongmuKit"],
            resources: [.copy("Fixtures")]
        ),
    ]
)
