"use client";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/display";
import { LogoLoader } from "@/components/brand/LogoLoader";
export function OpsLoading() {
 return <LogoLoader showLabel label="Loading operations" />;
}
export function OpsErrorState({ retry }: { error: unknown; retry: () => void }) {
 return <EmptyState patch title="Couldn't load this page. Try again." action={<Button onClick={retry}>Try again</Button>} />;
}
