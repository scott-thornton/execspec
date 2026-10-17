// swift-tools-version:6.0
import PackageDescription

let package = Package(
    name: "Billing",
    platforms: [.macOS(.v13)],
    dependencies: [
        .package(path: "../../targets/swift-runtime"),
    ],
    targets: [
        .target(
            name: "BillingGenerated",
            dependencies: [.product(name: "ExecSpecRuntime", package: "swift-runtime")]
        ),
        .target(
            name: "BillingImplementation",
            dependencies: [
                "BillingGenerated",
                .product(name: "ExecSpecRuntime", package: "swift-runtime"),
            ]
        ),
        .executableTarget(
            name: "BillingHost",
            dependencies: [
                "BillingImplementation",
                "BillingGenerated",
                .product(name: "ExecSpecRuntime", package: "swift-runtime"),
            ]
        ),
        .testTarget(
            name: "BillingImplementationTests",
            dependencies: [
                "BillingImplementation",
                "BillingGenerated",
                .product(name: "ExecSpecRuntime", package: "swift-runtime"),
            ]
        ),
    ]
)
