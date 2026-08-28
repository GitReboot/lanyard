import type { NextConfig } from "next";

/**
 * Next 16 blocks cross-origin requests for dev-only assets by default. A phone
 * hitting http://<lan-ip>:3000 gets the HTML but none of the JS chunks, so the
 * page loads and then does nothing at all.
 *
 * Testing rear-camera capture on a real phone is the point of this project, so
 * the dev machine's LAN IP has to be listed here.
 *
 * NOTE: this IP changes with the network. On a different wifi (the venue!), run
 * `npm run dev`, read the "Network:" URL it prints, and either update the
 * fallback below or set DEV_ORIGIN in .env.local.
 */
const devOrigins = [process.env.DEV_ORIGIN, "172.16.104.2"].filter(
  (o): o is string => Boolean(o),
);

const nextConfig: NextConfig = {
  allowedDevOrigins: devOrigins,
  /**
   * Emits .next/standalone with a self-contained server.js and only the
   * node_modules actually reachable, which keeps the Cloud Run image small.
   */
  output: "standalone",
};

export default nextConfig;
