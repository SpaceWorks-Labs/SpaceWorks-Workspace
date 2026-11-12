/** Provider cards for /admin/observability. Pure data, safe to import from client components. */
import { ALL_PROVIDERS, WORKSPACE_PROVIDERS, type ProviderId } from "@/lib/observability/config";

export type { ProviderId };

export type FieldDef = { key: string; label: string; secret?: boolean; multiline?: boolean; help?: string; placeholder?: string };

export type ProviderDef = {
  id: ProviderId;
  title: string;
  blurb: string;
  privacy: string;
  /** Instance setting that turns it on. Grafana has none: it is a link-out that is "on" when a URL is set. */
  enableKey: string | null;
  fields: FieldDef[];
  /** Keys that must hold a value before the provider may be enabled. */
  required: string[];
  note?: string;
};

export const PROVIDERS: ProviderDef[] = [
  {
    id: "sentry", title: "Sentry", enableKey: "obs.sentry.enabled",
    blurb: "Error reports from the server and the browser. Browser events go through a same-origin tunnel, so no extra host is contacted by the page.",
    privacy: "Errors only, no personal data: cookies, auth headers, bodies, query strings and URL tokens are stripped. Not gated by consent. Instance-only.",
    fields: [
      { key: "obs.sentry.dsn", label: "DSN", secret: true, help: "Write-only." },
      { key: "obs.sentry.environment", label: "Environment", placeholder: "production" },
      { key: "obs.sentry.tracesSampleRate", label: "Traces sample rate", help: "0 to 1. Leave empty for no tracing.", placeholder: "0" },
    ],
    required: ["obs.sentry.dsn"],
    note: "A DSN change needs a restart of the app, worker and beat before the server picks it up.",
  },
  {
    id: "posthog", title: "PostHog", enableKey: "obs.posthog.enabled",
    blurb: "Product analytics through a same-origin tunnel. Pageviews are manual with templated paths; autocapture and session recording are off.",
    privacy: "Pseudonymous ids only: never email, name, workspace slug or raw ids. Honours Do Not Track and Global Privacy Control, consent mode and the route deny-list.",
    fields: [
      { key: "obs.posthog.key", label: "Project key", help: "Public project API key (phc_...)." },
      { key: "obs.posthog.host", label: "Host", help: "https URL, e.g. https://eu.i.posthog.com.", placeholder: "https://eu.i.posthog.com" },
    ],
    required: ["obs.posthog.key"],
  },
  {
    id: "clarity", title: "Microsoft Clarity", enableKey: "obs.clarity.enabled",
    blurb: "Session heatmaps. Loads only for workspaces whose owner has opted in, and never on sensitive routes or under /admin.",
    privacy: "The app shell is masked. No identify call. Set masking to Strict in the Clarity dashboard. Honours Do Not Track, Global Privacy Control and consent.",
    fields: [{ key: "obs.clarity.projectId", label: "Project ID" }],
    required: ["obs.clarity.projectId"],
  },
  {
    id: "firebase", title: "Firebase Analytics", enableKey: "obs.firebase.enabled",
    blurb: "Google Analytics for Firebase through a nonce'd gtag loader (no SDK).",
    privacy: "Consent Mode starts denied, ad personalisation and Google signals are off, IP is anonymised, no user id. Honours Do Not Track, Global Privacy Control and consent.",
    fields: [
      { key: "obs.firebase.measurementId", label: "Measurement ID", placeholder: "G-XXXXXXXXXX" },
      { key: "obs.firebase.config", label: "Web app config (JSON)", multiline: true, help: "Optional. Public web config only." },
    ],
    required: ["obs.firebase.measurementId"],
  },
  {
    id: "metrics", title: "Prometheus metrics", enableKey: "obs.metrics.enabled",
    blurb: "A scrape endpoint at /api/metrics for Prometheus and Grafana, plus /metrics on the worker and beat health ports. The same bearer token protects all of them.",
    privacy: "Instance-wide counts and timings only. No workspace, user or email labels, ever.",
    fields: [],
    required: ["obs.metrics.token"],
  },
  {
    id: "grafana", title: "Grafana", enableKey: null,
    blurb: "Link-out to your Grafana dashboard. Nothing is embedded.",
    privacy: "A link only. No data is sent to Grafana from the browser.",
    fields: [
      { key: "obs.grafana.url", label: "Grafana URL", help: "https URL.", placeholder: "https://grafana.example.org" },
      { key: "obs.grafana.dashboardPath", label: "Dashboard path", help: "e.g. /d/spaceworks-overview", placeholder: "/d/spaceworks-overview" },
    ],
    required: ["obs.grafana.url"],
  },
  {
    id: "metabase", title: "Metabase", enableKey: "obs.metabase.enabled",
    blurb: "Signed embedding of reports built on the read-only reporting views. Instance dashboards appear in the section below.",
    privacy: "Tokens are signed on the server, last at most 10 minutes and lock workspace_id. Cards must filter on that locked parameter: see docs/OBSERVABILITY.md.",
    fields: [
      { key: "obs.metabase.siteUrl", label: "Site URL", help: "https URL of your Metabase.", placeholder: "https://metabase.example.org" },
      { key: "obs.metabase.secretKey", label: "Embedding secret key", secret: true, help: "Write-only." },
      { key: "obs.metabase.adminDashboardIds", label: "Instance dashboard ids", help: "Comma separated numbers. Only these can be embedded here.", placeholder: "1, 2" },
    ],
    required: ["obs.metabase.siteUrl", "obs.metabase.secretKey"],
  },
];

export const PROVIDER_IDS = ALL_PROVIDERS;
export const OVERRIDABLE_PROVIDERS = WORKSPACE_PROVIDERS;
export const CONSENT_MODES = ["opt-in", "opt-out", "none"] as const;
export const CONSENT_LABELS: Record<(typeof CONSENT_MODES)[number], string> = {
  "opt-in": "Opt-in: a banner asks first",
  "opt-out": "Opt-out: on until declined",
  none: "None: no banner",
};
export const GLOBAL_KEYS = ["obs.consentMode", "obs.workspaceOverrides.allowed", "obs.workspaceOverrides.providers", "obs.workspaceOverrides.hostAllowlist"] as const;
export const ADMIN_KEYS: string[] = [...PROVIDERS.flatMap((p) => [...(p.enableKey ? [p.enableKey] : []), ...p.fields.map((f) => f.key)]), ...GLOBAL_KEYS];
