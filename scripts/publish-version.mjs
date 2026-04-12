export function resolvePublishVersion(rootPackage) {
  const override = process.env.NODE_WREQ_PUBLISH_VERSION?.trim();

  if (override) {
    return override;
  }

  return rootPackage.version;
}
