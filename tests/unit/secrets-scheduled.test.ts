import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Prisma } from "@prisma/client";

const mocks = vi.hoisted(() => ({
  transaction: vi.fn(), raw: vi.fn(), dispatch: vi.fn(), access: vi.fn(), afterCommit: vi.fn(),
  shares: vi.fn(), leases: vi.fn(), membership: vi.fn(), resume: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ prisma: {
  cliDeviceCode: { deleteMany: vi.fn() },
  workspace: { findMany: async () => [{ id: "workspace", slug: "crew", archivedAt: null }] },
  $transaction: mocks.transaction,
} }));
vi.mock("@/lib/notify/dispatch", () => ({ dispatch: mocks.dispatch }));
vi.mock("@/lib/secrets/access", () => ({ environmentAccess: mocks.access }));
vi.mock("@/lib/secrets/rotation", () => ({ resumeRotations: mocks.resume }));
vi.mock("@/lib/secrets/mutations", () => ({ audit: vi.fn() }));
vi.mock("@/lib/modules-server", () => ({ workspacesWithoutModule: async () => [] }));
import { run } from "@/lib/scheduled/secrets";

beforeEach(() => vi.resetAllMocks());
describe("Secrets rotation reminders", () => {
  it("selects overdue metadata in SQL and traverses past 2,000 keys in bounded committed batches", async () => {
    const now = new Date("2026-10-21T12:00:00Z");
    const rows = Array.from({ length: 2201 }, (_, i) => ({
      id: `key-${String(i).padStart(5, "0")}`, ownerId: "owner", environmentId: "environment", rotatedAt: new Date(0),
    }));
    const cursors: string[] = [];
    let committed = false;
    const tx = {
      $queryRaw: mocks.raw,
      secretIdentityToken: { deleteMany: mocks.leases },
      secretShare: { findMany: mocks.shares },
      membership: { findFirst: mocks.membership },
    };
    mocks.shares.mockResolvedValue([]);
    mocks.membership.mockResolvedValue({ status: "ACTIVE" });
    mocks.dispatch.mockImplementation(async () => ({ afterCommit: () => {
      expect(committed).toBe(true);
      mocks.afterCommit();
    } }));
    mocks.transaction.mockImplementation(async callback => {
      committed = false;
      const result = await callback(tx);
      committed = true;
      return result;
    });
    mocks.raw.mockImplementation(async (query: Prisma.Sql | TemplateStringsArray) => {
      if (Array.isArray(query)) return [{ locked: true }];
      const sql = query as Prisma.Sql;
      expect(sql.text).toContain('"deletedAt" IS NULL');
      expect(sql.text).toContain('"rotateEveryDays" > 0');
      expect(sql.text).toContain('"rotatedAt" + "rotateEveryDays" * INTERVAL \'1 day\' <=');
      expect(sql.text).toContain('ORDER BY "id" ASC');
      expect(sql.text).toContain("LIMIT 200");
      expect(sql.text).not.toContain("secretEnc");
      expect(sql.values.slice(0, 2)).toEqual(["workspace", now]);
      const cursor = String(sql.values[2]);
      cursors.push(cursor);
      return rows.filter(row => row.id > cursor).slice(0, 200);
    });
    // Inaccessible and inactive owners must not be notified, without stalling traversal.
    mocks.membership.mockResolvedValueOnce(null);
    mocks.access.mockRejectedValueOnce(new Error("Access removed"));
    await run(now);
    expect(cursors).toEqual(["", ...Array.from({ length: 11 }, (_, i) => rows[(i + 1) * 200 - 1].id)]);
    expect(mocks.transaction).toHaveBeenCalledTimes(12);
    expect(mocks.shares).toHaveBeenCalledTimes(1);
    expect(mocks.leases).toHaveBeenCalledTimes(1);
    expect(mocks.dispatch).toHaveBeenCalledTimes(2199);
    expect(mocks.afterCommit).toHaveBeenCalledTimes(2199);
    expect(mocks.dispatch).toHaveBeenLastCalledWith("workspace", expect.objectContaining({
      recipients: ["owner"], data: { secretId: rows.at(-1)!.id, environmentId: "environment" },
      dedupeKey: `secrets-rotation:${rows.at(-1)!.id}:${new Date(0).toISOString()}:2026-10-21`,
    }), { tx });
  });
});
