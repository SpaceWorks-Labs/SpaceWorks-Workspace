import "server-only";
/**
 * Public surface of the client observability layer, used by the admin console
 * and the Metabase integration.
 *
 *   resolveWorkspaceConnection(provider: WorkspaceProvider, workspaceId: string, preload?): Promise<ResolvedConnection>
 *   pseudonymize(kind: string, id: string): string
 *   pseudonymizeUser(userId) / pseudonymizeUserInWorkspace(userId, workspaceId) / pseudonymizeWorkspace(workspaceId): string
 *   testProvider(provider: ProviderId, fetchImpl?): Promise<{ ok: boolean; message: string }>
 *   getProviderStatus(provider: ProviderId): Promise<ProviderStatus>
 */
export { resolveWorkspaceConnection, type ResolvedConnection, type ConnectionConfig } from "./workspaceConfig";
export { pseudonymize, pseudonymizeUser, pseudonymizeUserInWorkspace, pseudonymizeWorkspace } from "./identity";
export { testProvider, getProviderStatus, type ProviderStatus, type TestResult } from "./status";
export { getObsSettings, type ObsSettings } from "./keys";
export { ALL_PROVIDERS, CLIENT_PROVIDERS, WORKSPACE_PROVIDERS, type ProviderId, type ClientProvider, type WorkspaceProvider } from "./config";
