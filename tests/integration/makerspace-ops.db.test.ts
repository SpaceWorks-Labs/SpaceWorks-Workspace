import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import type { OpsActor } from "@/lib/approvals/context";
import { downtimeCostReport, downtimesFor, endDowntime, runMaintenanceReminders, setCertRequirements, signoffMatrices, startDowntime } from "@/lib/makerspace";
import { addMember, cleanup, createUser, createWorkspace, uniqueSuffix } from "../helpers/fixtures";

const suffix = uniqueSuffix();
const domain = `@makerspace-${suffix}.test`;
const slugA = `msa-${suffix}`;
const slugB = `msb-${suffix}`;
let admin: OpsActor & { user: { id: string } };
let member: OpsActor & { user: { id: string } };
let otherAdmin: OpsActor & { user: { id: string } };
let assetId: string;
let memberId: string;
let wsId: string;

const events = (type: string, ws = wsId) => prisma.notificationEventRecord.findMany({ where: { workspaceId: ws, type } });

describe.sequential("makerspace downtime, reminders and inductions", () => {
  beforeAll(async () => {
    const owner = await createUser(`owner${domain}`, "Owner");
    const ws = await createWorkspace(slugA, owner.id);
    wsId = ws.id;
    const base = { id: ws.id, slug: ws.slug, name: ws.name, timezone: ws.timezone, currency: "INR" };
    admin = { user: { id: owner.id, name: "Owner" }, workspace: base, membership: { role: "OWNER" } };
    const m = await createUser(`member${domain}`, "Meera");
    memberId = m.id;
    await addMember(ws.id, m.id, "MEMBER");
    member = { user: { id: m.id, name: "Meera" }, workspace: base, membership: { role: "MEMBER" } };
    const other = await createUser(`other${domain}`, "Other");
    const wsB = await createWorkspace(slugB, other.id);
    otherAdmin = { user: { id: other.id, name: "Other" }, workspace: { id: wsB.id, slug: wsB.slug, name: wsB.name, timezone: wsB.timezone, currency: "INR" }, membership: { role: "OWNER" } };
    assetId = (await prisma.asset.create({ data: { workspaceId: ws.id, tag: `t${suffix}`, name: "Laser cutter", category: "Machine" } })).id;
  });
  afterAll(async () => {
    await cleanup([slugA, slugB], domain);
    await prisma.$disconnect();
  }, 60_000);

  it("marks a machine out of service, dispatches once, and rejects overlap and member writes", async () => {
    await expect(startDowntime(member, { assetId, reason: "Tube dead" })).rejects.toThrow();
    const id = await startDowntime(admin, { assetId, reason: "Tube dead" });
    expect(await events("asset.downtime_started")).toHaveLength(1);
    await expect(startDowntime(admin, { assetId, reason: "Again" })).rejects.toThrow(/already has downtime/);
    const map = await downtimesFor(member, [assetId]);
    expect(map.get(assetId)?.current?.id).toBe(id);
    await endDowntime(admin, { downtimeId: id });
    expect((await downtimesFor(member, [assetId])).get(assetId)?.current).toBeNull();
    const rows = await downtimeCostReport(admin, { from: new Date(Date.now() - 86_400_000), to: new Date(Date.now() + 86_400_000) });
    expect(rows.find((r) => r.assetId === assetId)?.downtimeCount).toBe(1);
    await expect(downtimeCostReport(member, { from: new Date(), to: new Date() })).rejects.toThrow();
  });

  it("sends each maintenance reminder once and skips closed or far-off ones", async () => {
    const now = new Date();
    const due = await prisma.assetMaintenanceLog.create({ data: { assetId, type: "SERVICE", note: "Clean optics", costMinor: 5000, nextDueAt: new Date(now.getTime() + 2 * 86_400_000) } });
    await prisma.assetMaintenanceLog.create({ data: { assetId, type: "NOTE", note: "Far off", nextDueAt: new Date(now.getTime() + 60 * 86_400_000) } });
    await Promise.all([runMaintenanceReminders(now), runMaintenanceReminders(now)]);
    await runMaintenanceReminders(now);
    const sent = await events("asset.maintenance_due");
    expect(sent).toHaveLength(1);
    expect(JSON.stringify(sent[0]!.payload)).toContain(due.id);
  });

  it("skips workspaces with the services module off", async () => {
    const bId = otherAdmin.workspace.id;
    const asset = await prisma.asset.create({ data: { workspaceId: bId, tag: `b${suffix}`, name: "Router", category: "Machine" } });
    await prisma.assetMaintenanceLog.create({ data: { assetId: asset.id, type: "SERVICE", note: "Check", nextDueAt: new Date(Date.now() - 86_400_000) } });
    await prisma.workspaceLimits.create({ data: { workspaceId: bId, disabledModules: ["services"] } });
    await runMaintenanceReminders(new Date());
    expect(await events("asset.maintenance_due", bId)).toHaveLength(0);
    await prisma.workspaceLimits.delete({ where: { workspaceId: bId } });
  });

  it("builds the signed-off matrix with valid, expired and missing", async () => {
    const [laser, safety] = await Promise.all([
      prisma.certType.create({ data: { workspaceId: wsId, name: "Laser induction" } }),
      prisma.certType.create({ data: { workspaceId: wsId, name: "Fire safety" } }),
    ]);
    await expect(setCertRequirements(admin, { assetId, certTypeIds: [laser.id, "nope"] })).rejects.toThrow();
    await setCertRequirements(admin, { assetId, certTypeIds: [laser.id, safety.id] });
    await prisma.certification.create({ data: { certTypeId: laser.id, userId: memberId } });
    await prisma.certification.create({ data: { certTypeId: safety.id, userId: memberId, expiresAt: new Date(Date.now() - 86_400_000) } });
    const full = (await signoffMatrices(admin, [assetId])).get(assetId)!;
    const row = full.rows.find((r) => r.userId === memberId)!;
    expect(row.cells[laser.id]!.status).toBe("valid");
    expect(row.cells[safety.id]!.status).toBe("expired");
    expect(full.rows.find((r) => r.userId === admin.user.id)!.cells[laser.id]!.status).toBe("missing");
    const own = (await signoffMatrices(member, [assetId])).get(assetId)!;
    expect(own.rows.map((r) => r.userId)).toEqual([memberId]);
    const foreign = (await signoffMatrices(otherAdmin, [assetId])).get(assetId)!;
    expect(foreign.types).toEqual([]);
  });

  it("does not let another workspace touch this asset", async () => {
    await expect(startDowntime(otherAdmin, { assetId, reason: "x" })).rejects.toThrow();
    await expect(setCertRequirements(otherAdmin, { assetId, certTypeIds: [] })).rejects.toThrow();
  });
});
