import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Tx } from "@/lib/db";
import type { SecretsActor } from "@/lib/secrets/access";

const mocks = vi.hoisted(() => ({
  transaction: vi.fn(), access: vi.fn(), audit: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ prisma: { $transaction: mocks.transaction } }));
vi.mock("@/lib/approvals/ops", () => ({ guard: vi.fn() }));
vi.mock("@/lib/approvals/engine", () => ({ requestApproval: vi.fn() }));
vi.mock("@/lib/search/documents", () => ({ indexSearchDocument: vi.fn() }));
vi.mock("@/lib/secrets/access", () => ({ environmentAccess: mocks.access, requireSecretsMfa: vi.fn() }));
vi.mock("@/lib/secrets/mutations", () => ({ audit: mocks.audit }));
import { saveEnvironment } from "@/lib/secrets/service";
import { identityToken } from "@/lib/secrets/identities";
import { sha256Hex } from "@/lib/crypto";

beforeEach(() => vi.resetAllMocks());
describe("Secrets locked state", () => {
  it("preserves a promotion committed between an edit's initial read and transaction", async () => {
    const actor = { workspace: { id: "workspace", slug: "workspace" }, user: { id: "owner" }, membership: { role: "OWNER" } } as SecretsActor;
    const input = { id: "environment", projectId: "project", name: "Renamed", slug: "renamed", position: 0, production: false, protected: true };
    let production = false, locked = false;
    const update = vi.fn(async ({ data }) => ({ ...input, ...data }));
    const tx = {
      $queryRaw: vi.fn(async (sql: TemplateStringsArray, ...params: string[]) => {
        expect(sql.join("?")).toContain("FOR NO KEY UPDATE");
        expect(params).toEqual([actor.workspace.id, input.id]);
        locked = true;
        return [{ id: input.id }];
      }),
      secretProject: { findFirst: vi.fn(async () => ({ id: "project", name: "Project" })) },
      secretEnvironment: { update },
      applicationSecret: { findMany: vi.fn(async () => []) },
    };
    mocks.access.mockImplementation(async (_actor, _id, _role, client) => {
      if (client) { expect(client).toBe(tx); expect(locked).toBe(true); }
      return { ...input, production };
    });
    mocks.transaction.mockImplementation(async fn => {
      // A competing promotion commits before the edit acquires its update lock.
      production = true;
      return fn(tx);
    });
    await saveEnvironment(actor, input);
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ production: true, name: "Renamed" }) }));
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it("allows only one of two renewals that found the same bearer before locking", async () => {
    const raw = "swwu_" + "a".repeat(43), now = new Date();
    const identity = { id: "identity", workspaceId: "workspace", projectId: "project", createdById: "owner", accessTtl: 7200, tokenIps: [], workspace: { archivedAt: null, status: "ACTIVE" }, permissions: [] };
    let token = { id: "token", workspaceId: "workspace", tokenHash: sha256Hex(raw), revokedAt: null, expiresAt: new Date(+now + 60000), maxExpiresAt: new Date(+now + 86400000), remainingUses: 5, credential: { revokedAt: null, expiresAt: null }, identity };
    let readers = 0, ready!: () => void;
    const bothRead = new Promise<void>(resolve => { ready = resolve; });
    let lock = Promise.resolve();
    const update = vi.fn(async ({ data }) => {
      token = { ...token, tokenHash: data.tokenHash, expiresAt: data.expiresAt, remainingUses: token.remainingUses - 1 };
      return token;
    });
    mocks.transaction.mockImplementation(async (fn: (tx: Tx) => Promise<unknown>) => {
      let unlock: (() => void) | undefined;
      const tx = {
        $queryRaw: vi.fn(async () => {
          const previous = lock;
          lock = new Promise<void>(resolve => { unlock = resolve; });
          await previous;
          return [{ id: token.id }];
        }),
        secretIdentityToken: {
          findUnique: vi.fn(async () => {
            const found = { ...token };
            if (++readers === 2) ready();
            await bothRead;
            return found;
          }),
          findUniqueOrThrow: vi.fn(async () => ({ ...token })), update,
        },
        membership: { findFirst: vi.fn(async () => ({ userId: "owner", user: { name: "Owner" } })) },
      } as unknown as Tx;
      try { return await fn(tx); } finally { unlock?.(); }
    });
    const results = await Promise.all([
      identityToken(raw, "127.0.0.1", undefined, true, now),
      identityToken(raw, "127.0.0.1", undefined, true, now),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(results).toContain(null);
    const issued = results.find(result => result && "accessToken" in result);
    if (!issued || !("accessToken" in issued)) throw new Error("Missing renewed bearer");
    expect(sha256Hex(issued.accessToken)).toBe(token.tokenHash);
    expect(token.remainingUses).toBe(4);
    expect(update).toHaveBeenCalledTimes(1);
    expect(mocks.audit).toHaveBeenCalledTimes(1);
  });
});
