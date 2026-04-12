export const platformTargets = [
  {
    target: "x86_64-apple-darwin",
    packageName: "@node-wreq/darwin-x64",
    binaryName: "node-wreq.darwin-x64.node",
    os: ["darwin"],
    cpu: ["x64"],
  },
  {
    target: "aarch64-apple-darwin",
    packageName: "@node-wreq/darwin-arm64",
    binaryName: "node-wreq.darwin-arm64.node",
    os: ["darwin"],
    cpu: ["arm64"],
  },
  {
    target: "x86_64-unknown-linux-gnu",
    packageName: "@node-wreq/linux-x64-gnu",
    binaryName: "node-wreq.linux-x64-gnu.node",
    os: ["linux"],
    cpu: ["x64"],
    libc: ["glibc"],
  },
  {
    target: "aarch64-unknown-linux-gnu",
    packageName: "@node-wreq/linux-arm64-gnu",
    binaryName: "node-wreq.linux-arm64-gnu.node",
    os: ["linux"],
    cpu: ["arm64"],
    libc: ["glibc"],
  },
  {
    target: "x86_64-unknown-linux-musl",
    packageName: "@node-wreq/linux-x64-musl",
    binaryName: "node-wreq.linux-x64-musl.node",
    os: ["linux"],
    cpu: ["x64"],
    libc: ["musl"],
  },
  {
    target: "x86_64-pc-windows-msvc",
    packageName: "@node-wreq/win32-x64-msvc",
    binaryName: "node-wreq.win32-x64-msvc.node",
    os: ["win32"],
    cpu: ["x64"],
  },
];

export function getPlatformTargetByTriple(target) {
  return platformTargets.find((entry) => entry.target === target);
}

export function getOptionalDependencyMap(version) {
  return Object.fromEntries(
    platformTargets.map(({ packageName }) => [packageName, version]),
  );
}
