// swift-tools-version:6.0
import PackageDescription

let package = Package(
    name: "KV",
    platforms: [.macOS(.v13)],
    dependencies: [
        .package(path: "../../targets/swift-runtime"),
    ],
    targets: [
        .target(
            name: "KVGenerated",
            dependencies: [.product(name: "ExecSpecRuntime", package: "swift-runtime")]
        ),
        .target(
            name: "KVImplementation",
            dependencies: [
                "KVGenerated",
                .product(name: "ExecSpecRuntime", package: "swift-runtime"),
            ]
        ),
        .target(
            name: "KVBrokenImplementation",
            dependencies: [
                "KVGenerated",
                .product(name: "ExecSpecRuntime", package: "swift-runtime"),
            ]
        ),
        .executableTarget(
            name: "KVHost",
            dependencies: [
                "KVImplementation",
                "KVGenerated",
                .product(name: "ExecSpecRuntime", package: "swift-runtime"),
            ]
        ),
        .executableTarget(
            name: "KVBrokenHost",
            dependencies: [
                "KVBrokenImplementation",
                "KVGenerated",
                .product(name: "ExecSpecRuntime", package: "swift-runtime"),
            ]
        ),
        .testTarget(
            name: "KVImplementationTests",
            dependencies: [
                "KVImplementation",
                "KVGenerated",
                .product(name: "ExecSpecRuntime", package: "swift-runtime"),
            ]
        ),
    ]
)
