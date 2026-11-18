import { isIP } from "node:net";
import type { Request } from "express";

/**
 * Render's edge overwrites CF-Connecting-IP with the visitor address.
 * Do not trust this header outside Render, where a direct caller could forge it.
 */
export function getRequestClientAddress(req: Request): string {
  if (process.env.RENDER === "true") {
    const cloudflareAddress = req.get("CF-Connecting-IP")?.trim();
    if (cloudflareAddress && isIP(cloudflareAddress) !== 0) return cloudflareAddress;
  }
  return req.ip || req.socket.remoteAddress || "unknown";
}
