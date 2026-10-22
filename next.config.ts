import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // §88. The Claude connector's consent screen must never render inside
  // another site's frame, where an Allow button could be clickjacked.
  async headers() {
    return [
      {
        source: "/oauth/:path*",
        headers: [
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
          { key: "X-Frame-Options", value: "DENY" },
        ],
      },
      {
        source: "/login",
        headers: [{ key: "X-Frame-Options", value: "DENY" }],
      },
    ];
  },
  experimental: {
    serverActions: {
      // §50E.2. The monthly sales workbook is ~3MB and goes up through a
      // server action, twice — once to preview and once to commit. The default
      // cap is 1MB and rejects it with a 500 that says nothing useful on the
      // client. 12mb leaves room for the sheet to grow and for the multipart
      // boundaries and part headers that the raw body also carries.
      bodySizeLimit: "12mb",
    },
  },
};

export default nextConfig;
