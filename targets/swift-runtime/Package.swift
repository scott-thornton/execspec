// swift-tools-version:6.0
import PackageDescription

let package = Package(
    name: "ExecSpecRuntime",
    platforms: [.macOS(.v13)],
    targets: [
        .target(name: "ExecSpecRuntime"),
        .testTarget(name: "ExecSpecRuntimeTests", dependencies: ["ExecSpecRuntime"]),
    ]
)
