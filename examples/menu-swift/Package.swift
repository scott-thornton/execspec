// swift-tools-version:6.0
import PackageDescription

let package = Package(
    name: "Menu",
    platforms: [.macOS(.v13)],
    dependencies: [
        .package(path: "../../targets/swift-runtime"),
    ],
    targets: [
        .target(
            name: "MenuGenerated",
            dependencies: [.product(name: "ExecSpecRuntime", package: "swift-runtime")]
        ),
        .target(
            name: "MenuImplementation",
            dependencies: [
                "MenuGenerated",
                .product(name: "ExecSpecRuntime", package: "swift-runtime"),
            ]
        ),
        .executableTarget(
            name: "MenuHost",
            dependencies: [
                "MenuImplementation",
                "MenuGenerated",
                .product(name: "ExecSpecRuntime", package: "swift-runtime"),
            ]
        ),
        .testTarget(
            name: "MenuImplementationTests",
            dependencies: [
                "MenuImplementation",
                "MenuGenerated",
                .product(name: "ExecSpecRuntime", package: "swift-runtime"),
            ]
        ),
    ]
)
