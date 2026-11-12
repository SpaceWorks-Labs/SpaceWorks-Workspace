/** The only PostHog events the app sends. Names are fixed; properties are not accepted. */
export const OBS_EVENTS = ["$pageview", "search_used", "export_requested", "consent_granted"] as const;
export type ObsEvent = (typeof OBS_EVENTS)[number];
export const isObsEvent = (name: string): name is ObsEvent => (OBS_EVENTS as readonly string[]).includes(name);
