import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import type { OpsActor } from "@/lib/approvals/context";
import { listStock, recordMovement, saveStockItem, stockCsv } from "@/lib/makerspace/stock";
import { addMember, cleanup, createUser, createWorkspace, uniqueSuffix } from "../helpers/fixtures";

const suffix = uniqueSuffix();
const domain = `@stock-${suffix}.test`;
const slugA = `sta-${suffix}`;
const slugB = `stb-${suffix}`;
type Actor = OpsActor & { user: { id: string } };
let admin: Actor;
let member: Actor;
let other: Actor;
let itemId: string;

const reorderEvents = () => prisma.notificationEventRecord.findMany({ where: { workspaceId: admin.workspace.id, type: "stock.reorder" } });
const onHand = async () => (await prisma.stockItem.findUniqueOrThrow({ where: { id: itemId } })).onHand.toString();

describe.sequential("stock", () => {
  beforeAll(async () => {
    const owner = await createUser(`owner${domain}`, "Owner");
    const ws = await createWorkspace(slugA, owner.id);
    const base = { id: ws.id, slug: ws.slug, name: ws.name, timezone: ws.timezone, currency: "INR" };
    admin = { user: { id: owner.id, name: "Owner" }, workspace: base, membership: { role: "OWNER" } };
    const m = await createUser(`member${domain}`, "Meera");
    await addMember(ws.id, m.id, "MEMBER");
    member = { user: { id: m.id, name: "Meera" }, workspace: base, membership: { role: "MEMBER" } };
    const o = await createUser(`other${domain}`, "Other");
    const wsB = await createWorkspace(slugB, o.id);
    other = { user: { id: o.id, name: "Other" }, workspace: { id: wsB.id, slug: wsB.slug, name: wsB.name, timezone: wsB.timezone, currency: "INR" }, membership: { role: "OWNER" } };
    itemId = await saveStockItem(admin, { name: "=SUM(1) tape", unit: "rolls", reorderLevel: "5", reorderQty: "20", cost: "120.50", openingQty: "100" });
  });
  afterAll(async () => {
    await cleanup([slugA, slugB], domain);
    await prisma.$disconnect();
  }, 60_000);

  it("creates an item with an opening balance and cost in minor units", async () => {
    const item = await prisma.stockItem.findUniqueOrThrow({ where: { id: itemId } });
    expect(item.onHand.toString()).toBe("100");
    expect(item.costMinor).toBe(12050);
    expect(await prisma.stockMovement.count({ where: { itemId, kind: "ADJUST" } })).toBe(1);
  });

  it("keeps on-hand exact under concurrent issues and refuses to go negative", async () => {
    const results = await Promise.allSettled(Array.from({ length: 12 }, () => recordMovement(admin, { itemId, kind: "ISSUE", quantity: "10" })));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(10);
    expect(await onHand()).toBe("0");
    await expect(recordMovement(admin, { itemId, kind: "ISSUE", quantity: "0.001" })).rejects.toThrow(/on hand/);
    expect(await prisma.stockMovement.count({ where: { itemId, kind: "ISSUE" } })).toBe(10);
  });

  it("fires the reorder event once on crossing, and again only after a restock above the level", async () => {
    expect(await reorderEvents()).toHaveLength(1); // crossed 10 -> 0 inside the burst above, once
    await recordMovement(admin, { itemId, kind: "RECEIVE", quantity: "3" }); // still low
    await recordMovement(admin, { itemId, kind: "ISSUE", quantity: "1" });
    expect(await reorderEvents()).toHaveLength(1);
    await recordMovement(admin, { itemId, kind: "RECEIVE", quantity: "50" }); // re-armed
    await recordMovement(admin, { itemId, kind: "SALE", quantity: "48" });
    expect(await reorderEvents()).toHaveLength(2);
    expect(await onHand()).toBe("4");
  });

  it("supports signed adjustments and rejects bad quantities", async () => {
    await recordMovement(admin, { itemId, kind: "ADJUST", quantity: "-1.5" });
    expect(await onHand()).toBe("2.5");
    await expect(recordMovement(admin, { itemId, kind: "ISSUE", quantity: "-2" })).rejects.toThrow();
    await expect(recordMovement(admin, { itemId, kind: "RECEIVE", quantity: "0" })).rejects.toThrow();
  });

  it("lists low stock for members, blocks member writes, and neutralises CSV formulas", async () => {
    expect((await listStock(member, { low: true })).map((i) => i.id)).toEqual([itemId]);
    await expect(recordMovement(member, { itemId, kind: "ISSUE", quantity: "1" })).rejects.toThrow();
    await expect(saveStockItem(member, { name: "x", unit: "pcs" })).rejects.toThrow();
    const csv = await stockCsv(member, {}, false);
    expect(csv).toContain("'=SUM(1) tape");
    expect(csv).not.toContain("Unit cost");
    expect(await stockCsv(admin, {}, true)).toContain("12050");
  });

  it("isolates tenants", async () => {
    expect(await listStock(other)).toEqual([]);
    await expect(recordMovement(other, { itemId, kind: "RECEIVE", quantity: "1" })).rejects.toThrow(/unavailable/);
    await expect(saveStockItem(other, { id: itemId, name: "Hijack", unit: "pcs" })).rejects.toThrow(/unavailable/);
    expect((await prisma.stockItem.findUniqueOrThrow({ where: { id: itemId } })).name).toBe("=SUM(1) tape");
  });
});
