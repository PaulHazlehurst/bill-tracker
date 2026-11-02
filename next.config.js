/** @type {import('next').NextConfig} */
const nextConfig = {
  // The PDF reader for board documents runs as plain Node code rather than
  // being bundled; it's only loaded when a new document needs reading.
  serverExternalPackages: ["unpdf"],
};
module.exports = nextConfig;
