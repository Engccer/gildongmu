// swift-tools-version: 6.2
import PackageDescription

let package = Package(
    name: "GildongmuKit",
    defaultLocalization: "ko",
    platforms: [.iOS(.v26), .macOS(.v26)],
    products: [.library(name: "GildongmuKit", targets: ["GildongmuKit"])],
    targets: [
        .target(name: "GildongmuKit"),
        .testTarget(
            name: "GildongmuKitTests",
            dependencies: ["GildongmuKit"],
            resources: [.copy("Fixtures")]
        ),
    ]
)
