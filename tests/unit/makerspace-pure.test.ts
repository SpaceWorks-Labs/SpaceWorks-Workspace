import { describe, expect, it } from "vitest";
import { signoffStatus } from "@/lib/makerspace/certStatus";
import { crossedIntoLow, isLow, movementDelta } from "@/lib/makerspace/stock/quantity";
import { isDownAt, overlapHours } from "@/lib/makerspace/downtimeMath";
import { reportPeriod } from "@/components/assets/ops/period";

const now = new Date("2026-06-15T00:00:00Z");
const days = (n: number) => new Date(now.getTime() + n * 86_400_000);

describe("signoffStatus", () => {
  it("is missing with no grants, and revoked grants do not count", () => {
    expect(signoffStatus([], now).status).toBe("missing");
    expect(signoffStatus([{ expiresAt: null, revokedAt: days(-1) }], now).status).toBe("missing");
  });
  it("treats a grant without expiry as valid", () => {
    expect(signoffStatus([{ expiresAt: null, revokedAt: null }], now).status).toBe("valid");
  });
  it("is valid when expiry is far, expiring inside 30 days, expired once past", () => {
    expect(signoffStatus([{ expiresAt: days(90), revokedAt: null }], now).status).toBe("valid");
    expect(signoffStatus([{ expiresAt: days(10), revokedAt: null }], now).status).toBe("expiring");
    expect(signoffStatus([{ expiresAt: days(-1), revokedAt: null }], now)).toEqual({ status: "expired", expiresAt: days(-1) });
  });
  it("uses the latest expiry across renewals", () => {
    const grants = [{ expiresAt: days(-100), revokedAt: null }, { expiresAt: days(200), revokedAt: null }];
    expect(signoffStatus(grants, now).status).toBe("valid");
  });
});

describe("stock quantity", () => {
  it("applies signed deltas per kind", () => {
    expect(movementDelta("RECEIVE", "5").toString()).toBe("5");
    expect(movementDelta("ISSUE", "2.5").toString()).toBe("-2.5");
    expect(movementDelta("SALE", "1").toString()).toBe("-1");
    expect(movementDelta("ADJUST", "-3").toString()).toBe("-3");
  });
  it("is low at or below the level and never low without one", () => {
    expect(isLow("5", "5")).toBe(true);
    expect(isLow("5.001", "5")).toBe(false);
    expect(isLow("0", null)).toBe(false);
  });
  it("fires only on the transition into low, and re-arms after restock", () => {
    const level = "5";
    expect(crossedIntoLow({ onHand: "6", reorderLevel: level }, { onHand: "4", reorderLevel: level })).toBe(true);
    expect(crossedIntoLow({ onHand: "4", reorderLevel: level }, { onHand: "3", reorderLevel: level })).toBe(false);
    expect(crossedIntoLow({ onHand: "3", reorderLevel: level }, { onHand: "10", reorderLevel: level })).toBe(false);
    expect(crossedIntoLow({ onHand: "10", reorderLevel: level }, { onHand: "2", reorderLevel: level })).toBe(true);
  });
});

describe("downtime maths", () => {
  it("clips to the period and runs open downtime until now", () => {
    expect(overlapHours({ from: days(-2), to: days(-1) }, days(-3), days(0), now)).toBe(24);
    expect(overlapHours({ from: days(-10), to: days(-5) }, days(-3), days(0), now)).toBe(0);
    expect(overlapHours({ from: days(-1), to: null }, days(-3), days(5), now)).toBe(24);
  });
  it("detects current downtime", () => {
    expect(isDownAt({ from: days(-1), to: null }, now)).toBe(true);
    expect(isDownAt({ from: days(-2), to: days(-1) }, now)).toBe(false);
    expect(isDownAt({ from: days(1), to: null }, now)).toBe(false);
  });
  it("defaults the report period to 90 days and treats `to` as inclusive", () => {
    const p = reportPeriod(undefined, "2026-06-30", now);
    expect(p.toInput).toBe("2026-06-30");
    expect(p.to.toISOString()).toBe("2026-07-01T00:00:00.000Z");
    expect(reportPeriod("junk", "also junk", now).fromInput).toBe("2026-03-17");
  });
});
