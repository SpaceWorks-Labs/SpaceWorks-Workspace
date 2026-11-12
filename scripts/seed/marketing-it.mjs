/** Manual examples for an Indian community office. No provider calls or invented proof files. */
export default async function seed(prisma, { workspaceId, workspace }) {
 const members = await prisma.membership.findMany({ where: { workspaceId, status: "ACTIVE", role: { in: ["OWNER", "ADMIN", "MEMBER"] } }, select: { userId: true, role: true } });
 const admin = members.find(m => ["OWNER", "ADMIN"].includes(m.role)); if (!admin) return;
 const person = members.find(m => m.role === "MEMBER") ?? admin;
 const slug = workspace?.slug ?? (await prisma.workspace.findUniqueOrThrow({ where: { id: workspaceId }, select: { slug: true } })).slug;
 const day = offset => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);
 async function record(key, kind, title, status, details, extra = {}) {
  const id = `seed-marketing-it-${workspaceId}-${key}`;
  const row = await prisma.marketingItRecord.upsert({ where: { workspaceId_id: { workspaceId, id } }, update: {}, create: { id, workspaceId, kind, title, status, details, ownerId: admin.userId, createdById: admin.userId, reminderDays: 7, ...extra } });
  const visible = ["CONTENT", "BRAND"].includes(kind);
  const data = { workspaceId, entityType: "marketing_it", entityId: row.id, title: row.title, url: `/w/${slug}/${visible || kind === "PROPOSAL" ? "marketing" : "it"}?tool=${kind}&edit=${row.id}`, visibility: visible ? "WORKSPACE" : "PRIVATE", ownerId: admin.userId };
  await prisma.searchDocument.upsert({ where: { entityType_entityId: { entityType: "marketing_it", entityId: row.id } }, create: data, update: {} }); return row;
 }
 await record("content", "CONTENT", "Volunteer handbook update", "DRAFT", { channel: "NEWSLETTER", publishAt: `${day(7)}T04:30:00Z`, caption: "Share the operating team's handbook changes.", socialPostId: "" }, { ownerId: person.userId, dueOn: new Date(day(7)) });
 await record("brand", "BRAND", "Space Works approved brand references", "APPROVED", { category: "TYPE", tags: "brand, typography, approved", usage: "Use Outfit for body copy. Keep the accent type for a single hero phrase.", reference: "Use the Space Works brand tokens for colour references." });
 let org = await prisma.organisation.findFirst({ where: { workspaceId, name: "Kochi Community Foundation", deletedAt: null } });
 if (!org) org = await prisma.organisation.create({ data: { workspaceId, name: "Kochi Community Foundation", ownerId: admin.userId, createdById: admin.userId } });
 const deal = await prisma.deal.findFirst({ where: { workspaceId, organisationId: org.id }, select: { id: true } });
 const funding = await prisma.fundingRecord.findFirst({ where: { workspaceId, organisationId: org.id, archivedAt: null }, select: { id: true } });
 await record("proposal", "PROPOSAL", "CSR office equipment pitch", "SENT", { organisationId: org.id, contactId: "", dealId: deal?.id ?? "", fundingId: funding?.id ?? "", amountMinor: 15000000, currency: "INR", sentOn: day(-3), outcome: "Awaiting a conversation with the foundation team." }, { dueOn: new Date(day(4)) });
 const asset = await prisma.asset.upsert({ where: { workspaceId_tag: { workspaceId, tag: "office-laptop-demo" } }, update: {}, create: { workspaceId, tag: "office-laptop-demo", name: "Community office laptop", category: "Laptop", serialNumber: "DEMO-OFFICE-01", condition: "Good", ownerUserId: person.userId, purchaseDate: new Date(day(-180)), currency: "INR" } });
 const device = await record("device", "DEVICE", "Community office laptop", "ASSIGNED", { deviceType: "LAPTOP", serial: "DEMO-OFFICE-01", purchasedOn: day(-180), warrantyOn: day(185), condition: "Good", handoverNote: "Charger and sleeve included. Demonstration record." }, { assetId: asset.id, ownerId: person.userId });
 if (!await prisma.marketingItEvent.count({ where: { workspaceId, recordId: device.id } })) await prisma.marketingItEvent.create({ data: { workspaceId, recordId: device.id, actorId: admin.userId, action: "HANDOVER", note: "Charger and sleeve included.", data: { from: null, to: person.userId, status: "ASSIGNED" } } });
 let sub = await prisma.subscription.findFirst({ where: { workspaceId, name: "Office design software", kind: "LICENSE" } });
 if (!sub) sub = await prisma.subscription.create({ data: { workspaceId, name: "Office design software", kind: "LICENSE", period: "YEARLY", amountMinor: 1200000, currency: "INR", nextRenewalAt: new Date(day(45)), ownerId: admin.userId, createdById: admin.userId } });
 const licence = await record("licence", "LICENCE", "Office design software", "ACTIVE", { seats: 3, assigneeIds: [person.userId] }, { subscriptionId: sub.id });
 await record("incident", "INCIDENT", "Suspicious office email reported", "RESOLVED", { type: "PHISHING", severity: "LOW", confidential: true, detectedAt: `${day(-4)}T04:30:00Z`, containedAt: `${day(-4)}T05:00:00Z`, resolvedAt: `${day(-4)}T07:00:00Z`, actions: "Deleted the email and checked the account session list.", lessons: "Confirm unusual payment requests with the coordinator.", deviceId: asset.id, accountId: "", serviceIncidentId: "" });
 const review = await record("review", "REVIEW", "Quarterly office access review", "OPEN", { cadence: "QUARTERLY" }, { dateOn: new Date(day(0)), dueOn: new Date(day(14)) });
 for (const m of members) await prisma.marketingItReviewItem.upsert({ where: { workspaceId_recordId_userId_sourceType_sourceId: { workspaceId, recordId: review.id, userId: m.userId, sourceType: "ROLE", sourceId: m.userId } }, create: { workspaceId, recordId: review.id, userId: m.userId, sourceType: "ROLE", sourceId: m.userId, label: `${m.role} workspace access`, path: "/settings/members" }, update: {} });
 await prisma.marketingItReviewItem.upsert({ where: { workspaceId_recordId_userId_sourceType_sourceId: { workspaceId, recordId: review.id, userId: person.userId, sourceType: "LICENCE", sourceId: licence.id } }, create: { workspaceId, recordId: review.id, userId: person.userId, sourceType: "LICENCE", sourceId: licence.id, label: "Office design software", path: `/it?tool=LICENCE&edit=${licence.id}` }, update: {} });
 await record("restore", "RESTORE", "Community office recovery drill", "PASSED", { result: "Demonstration: test database and private files verified in isolation.", runbookDocId: "", backupRunId: "" }, { dateOn: new Date(day(-35)), dueOn: new Date(day(55)), notes: "Demonstration record only. Replace with evidence from the team's actual recovery test." });
}
