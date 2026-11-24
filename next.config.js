const withBundleAnalyzer = require('@next/bundle-analyzer')({
  enabled: process.env.ANALYZE === 'true',
});

module.exports = withBundleAnalyzer({
  reactStrictMode: false,
  // Emit a self-contained server build for Docker. Enabled only when
  // NEXT_OUTPUT_STANDALONE=true (set in the Docker build), so the normal
  // from-source `next build` / `next start` is unchanged.
  output: process.env.NEXT_OUTPUT_STANDALONE === 'true' ? 'standalone' : undefined,
});