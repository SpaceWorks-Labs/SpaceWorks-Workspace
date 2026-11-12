import { REPO_URL, repoFile } from "@/components/landing/content";

export type DocLink = { title: string; body: string; href: string };

/** 06: the guides worth reading first, all on GitHub. */
export const DOCS: DocLink[] = [
  { title: "Documentation index", body: "Every area guide and engineering reference in one list.", href: repoFile("docs/README.md") },
  { title: "Configuration", body: "Environment, instance settings and the secret reference.", href: repoFile("docs/CONFIGURATION.md") },
  { title: "Architecture", body: "Services, tenancy and how data flows.", href: repoFile("docs/ARCHITECTURE.md") },
  { title: "VPS deployment", body: "Guided install, updates, backups, settings and recovery.", href: repoFile("docs/DEPLOYMENT_VPS.md") },
  { title: "Organisation governance", body: "Requests, the super-admin console, plans, limits and modules.", href: repoFile("docs/areas/org-governance.md") },
  { title: "Payments", body: "Stripe and Razorpay payment links, webhooks and refunds.", href: repoFile("docs/areas/payments.md") },
  { title: "Email campaigns", body: "Lists, double opt-in, sending, bounces and unsubscribe.", href: repoFile("docs/areas/email-campaigns.md") },
  { title: "Bank import and exports", body: "Statement matching and Tally, Xero and QuickBooks exports.", href: repoFile("docs/areas/finance-bank-export.md") },
  { title: "Makerspace operations", body: "Downtime, maintenance, inductions and stock.", href: repoFile("docs/areas/makerspace-ops.md") },
  { title: "Messaging and SMTP", body: "Notification channels and per-workspace mail servers.", href: repoFile("docs/areas/integrations-messaging.md") },
  { title: "Observability", body: "Metrics, Grafana, Metabase and client analytics with consent.", href: repoFile("docs/OBSERVABILITY.md") },
  { title: "MCP and REST API", body: "Connect AI clients and scripts with scoped access.", href: repoFile("docs/MCP.md") },
];

/** Other ways to deploy, beside the one-line installer. */
export const DEPLOY_TARGETS: DocLink[] = [
  { title: "Docker", body: "Containers with managed PostgreSQL, Redis and storage.", href: repoFile("docs/DEPLOYMENT_DOCKER.md") },
  { title: "Netlify and a VPS", body: "The website on Netlify, the server behind a private gateway.", href: repoFile("docs/DEPLOYMENT_SPLIT.md") },
  { title: "Render and Cloudflare", body: "A Blueprint with Supabase, Upstash, R2 and a cron Worker.", href: repoFile("docs/DEPLOYMENT_CLOUD.md") },
  { title: "Kubernetes", body: "A Helm chart with secrets, probes and migrations.", href: repoFile("docs/DEPLOYMENT_KUBERNETES.md") },
  { title: "AWS", body: "AWS with managed services.", href: repoFile("docs/DEPLOYMENT_AWS.md") },
  { title: "DigitalOcean", body: "An App Platform spec using the release images.", href: repoFile(".do/app.yaml") },
];

export const PROJECT_LINKS: DocLink[] = [
  { title: "Repository", body: "Source code", href: REPO_URL },
  { title: "Releases", body: "Images and notes", href: `${REPO_URL}/releases` },
  { title: "Changelog", body: "What changed", href: repoFile("CHANGELOG.md") },
  { title: "Licence", body: "AGPL-3.0-or-later", href: repoFile("LICENSE") },
  { title: "Contributing", body: "How to help", href: repoFile("CONTRIBUTING.md") },
];

export type Question = { q: string; a: string };

/** 08: questions, answered. The account answer depends on the instance's self sign-up switch. */
export function questions(allowSignup: boolean): Question[] {
  return [
    { q: "How do I get an account here?", a: allowSignup
      ? "Create an account with your email address and confirm it from the email we send, or ask a workspace admin to invite you. An invitation link signs you straight in."
      : "This workspace is invite-only. Ask a workspace admin to invite you; the invitation link signs you straight in." },
    { q: "Is Space Works Workspace free?", a: "Yes. It is free, open-source software licensed AGPL-3.0-or-later. If you modify it and host it for others, offer them the matching source." },
    { q: "Who is it for?", a: "The team that runs a maker organisation, NGO or community office. Member-facing work lives in the sibling apps: Space Works, Space Works Events and Space Works Organization." },
    { q: "How do I install it?", a: "Run the one-line installer on a 64-bit Linux server with 4 GB of memory, a hostname pointing at it and an SMTP relay. Docker, Kubernetes, Render, AWS and DigitalOcean guides cover the other routes." },
    { q: "Can one server host several organisations?", a: "Yes. Each organisation is requested and approved by the instance super admin, and gets its own members, limits, modules and, if it wants, its own mail server." },
    { q: "Does it send data anywhere else?", a: "Not by default. Every record, file and secret stays on your server. Sentry, PostHog, Clarity and Firebase Analytics stay off until the operator turns them on, and visitors see a consent banner first." },
  ];
}
