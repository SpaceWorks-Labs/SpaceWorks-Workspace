import type { NextRequest } from "next/server";
import { handlers } from "@/lib/auth";
import { withMetrics } from "@/lib/observability/metrics/http";

// Auth.js handlers take a NextRequest; the route always receives one, so the cast only widens the metrics wrapper's type.
export const GET = withMetrics((request: Request) => handlers.GET(request as NextRequest));
export const POST = withMetrics((request: Request) => handlers.POST(request as NextRequest));
