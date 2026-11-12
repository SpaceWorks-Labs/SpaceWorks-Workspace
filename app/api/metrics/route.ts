import { NextResponse } from "next/server";
import { metricsAuthorized, renderMetrics } from "@/lib/observability/metrics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Prometheus scrape endpoint. Anything but an enabled instance plus the exact token is a bodyless 404. */
export async function GET(request: Request) {
  if (!(await metricsAuthorized(request.headers.get("authorization")))) return new NextResponse(null, { status: 404 });
  try {
    const { body, contentType } = await renderMetrics();
    return new NextResponse(body, { headers: { "Content-Type": contentType, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
  } catch {
    return new NextResponse(null, { status: 503 });
  }
}
