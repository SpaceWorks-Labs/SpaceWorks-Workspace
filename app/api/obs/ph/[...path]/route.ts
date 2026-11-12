import { handlePosthogTunnel } from "@/lib/observability/posthog/tunnel";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ path: string[] }> };

export async function GET(request: Request, { params }: Ctx) {
  return handlePosthogTunnel(request, (await params).path);
}

export async function POST(request: Request, { params }: Ctx) {
  return handlePosthogTunnel(request, (await params).path);
}
