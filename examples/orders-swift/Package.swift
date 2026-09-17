// swift-tools-version:6.0
import PackageDescription

let package = Package(
    name: "Orders",
    platforms: [.macOS(.v13)],
    dependencies: [
        .package(path: "../../targets/swift-runtime"),
    ],
    targets: [
        .target(
            name: "OrdersGenerated",
            dependencies: [.product(name: "ExecSpecRuntime", package: "swift-runtime")]
        ),
        .target(
            name: "OrdersImplementation",
            dependencies: [
                "OrdersGenerated",
                .product(name: "ExecSpecRuntime", package: "swift-runtime"),
            ]
        ),
        .executableTarget(
            name: "OrdersHost",
            dependencies: [
                "OrdersImplementation",
                "OrdersGenerated",
                .product(name: "ExecSpecRuntime", package: "swift-runtime"),
            ]
        ),
        .testTarget(
            name: "OrdersImplementationTests",
            dependencies: [
                "OrdersImplementation",
                "OrdersGenerated",
                .product(name: "ExecSpecRuntime", package: "swift-runtime"),
            ]
        ),
    ]
)
