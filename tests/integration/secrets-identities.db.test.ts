import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { viewDto } from "@/lib/frontend/view";
import { prisma } from "@/lib/db";
import { createUser, createWorkspace, addMember, cleanup, uniqueSuffix } from "@/tests/helpers/fixtures";
import { createProject, changeSecrets, readSecrets, revealVersion } from "@/lib/secrets/service";
import { createIdentity, manageIdentity, universalLogin, identityToken } from "@/lib/secrets/identities";
import { loadSecrets } from "@/lib/secrets/queries";
import { openValue } from "@/lib/secrets/encryption";
import { requestKeyRotation, runKeyRotation } from "@/lib/secrets/rotation";
import { encryptionSummary } from "@/lib/vault/hierarchy";
import { hmacHex } from "@/lib/crypto";
import type { SecretsActor } from "@/lib/secrets/access";
const suffix = uniqueSuffix(), domain = `${suffix}@identity.test`, slugs = [`identity-${suffix}`, `identity-other-${suffix}`];
let owner: SecretsActor, member: SecretsActor, other: SecretsActor, projectId: string, devId: string, prodId: string;
async function machine(settings: Record<string, unknown> = {}) {
  const identity = await createIdentity(owner, devId, { name: "Deploy identity", ...settings });
  const issued = await manageIdentity(owner, devId, identity.id, "credential");
  return { ...identity, clientSecret: issued.issuedCredential! };
}
async function freshProof() {
  const now = new Date(), user = await prisma.user.update({ where: { id: owner.user.id }, data: { mfaEnabledAt: new Date(now.getTime() - 1000) } });
  const body = Buffer.from(JSON.stringify({ u: user.id, v: user.sessionVersion, m: user.mfaEnabledAt!.getTime(), at: now.getTime() })).toString("base64url");
  return body + "." + hmacHex(process.env.AUTH_SECRET!, `vault-step:${body}`);
}
beforeAll(async () => {
  process.env.VAULT_MASTER_KEY = Buffer.alloc(32, 19).toString("base64");
  const o = await createUser("owner-" + domain), m = await createUser("member-" + domain), w = await createWorkspace(slugs[0], o.id), w2 = await createWorkspace(slugs[1], o.id);
  await addMember(w.id, m.id);
  owner = { user: o, workspace: w, membership: { role: "OWNER" } }; member = { user: m, workspace: w, membership: { role: "MEMBER" } }; other = { ...owner, workspace: w2 };
  projectId = await createProject(owner, { name: "Community office website", slug: "office" });
  const envs = await prisma.secretEnvironment.findMany({ where: { workspaceId: w.id, projectId } }); devId = envs.find(e => e.slug === "dev")!.id; prodId = envs.find(e => e.production)!.id;
  await changeSecrets(owner, devId, [{ key: "TEST_KEY", path: "/", value: "fixture-only\nsecond-line" }]);
});
afterAll(async () => { delete process.env.VAULT_MASTER_KEYS; await cleanup(slugs, domain); await prisma.$disconnect(); });
describe("Universal authentication boundaries", () => {
  it("stores only hashes and issues short-lived, scoped, revocable tokens", async () => {
    const identity = await machine();
    const credential = await prisma.secretIdentityCredential.findFirstOrThrow({ where: { workspaceId: owner.workspace.id, identityId: identity.id } });
    expect(JSON.stringify(credential)).not.toContain(identity.clientSecret.split(".")[1]);
    const login = await universalLogin(identity.clientId, identity.clientSecret, "127.0.0.1"); expect(login.expiresIn).toBe(7200);
    const actor = await identityToken(login.accessToken, "127.0.0.1", projectId); expect(actor && "workspace" in actor).toBe(true);
    if (!actor || !("workspace" in actor)) throw new Error("Missing machine actor");
    expect(await readSecrets(actor, devId, "/", { key: "TEST_KEY" })).toEqual({ TEST_KEY: "fixture-only\nsecond-line" });
    expect(await prisma.secretAudit.count({ where: { workspaceId: owner.workspace.id, action: "revealed", actorId: "machine:" + identity.id } })).toBeGreaterThan(0);
    await expect(readSecrets(actor, devId, "/other")).rejects.toThrow("folder");
    await expect(readSecrets(actor, prodId, "/")).rejects.toThrow("access");
    expect(await identityToken(login.accessToken, "127.0.0.1", "other-project")).toBeNull();
    await manageIdentity(owner, devId, identity.id, "revoke"); expect(await identityToken(login.accessToken, "127.0.0.1", projectId)).toBeNull();
    await expect(universalLogin(identity.clientId, identity.clientSecret, "127.0.0.1")).rejects.toThrow("unavailable");
  });
  it("enforces token/client-secret uses atomically and secret TTL", async () => {
    const identity = await machine({ tokenUses: 1, secretUses: 1, secretTtl: 60 });
    const login = await universalLogin(identity.clientId, identity.clientSecret, "127.0.0.1");
    await expect(universalLogin(identity.clientId, identity.clientSecret, "127.0.0.1")).rejects.toThrow();
    const results = await Promise.all([identityToken(login.accessToken, "127.0.0.1", projectId), identityToken(login.accessToken, "127.0.0.1", projectId)]); expect(results.filter(Boolean)).toHaveLength(1);
    const expiry = await machine({ secretTtl: 60 });
    await expect(universalLogin(expiry.clientId, expiry.clientSecret, "127.0.0.1", new Date(Date.now() + 61000))).rejects.toThrow();
  });
  it("locks after three failures, resets, and separates login/use IP policies", async () => {
    const identity = await machine({ loginIps: ["10.0.0.0/8"], tokenIps: ["192.168.1.0/24"] });
    for (let i = 0; i < 3; i++) await expect(universalLogin(identity.clientId, "wrong", "10.1.2.3")).rejects.toThrow();
    await expect(universalLogin(identity.clientId, identity.clientSecret, "10.1.2.3")).rejects.toThrow();
    await manageIdentity(owner, devId, identity.id, "reset");
    await expect(universalLogin(identity.clientId, identity.clientSecret, "192.168.1.4")).rejects.toThrow();
    const login = await universalLogin(identity.clientId, identity.clientSecret, "10.1.2.3");
    expect(await identityToken(login.accessToken, "10.1.2.3", projectId)).toBeNull(); expect(await identityToken(login.accessToken, "192.168.1.4", projectId)).toBeTruthy();
  });
  it("renews with a replacement credential up to max TTL, never after expiry", async () => {
    const identity = await machine({ accessTtl: 60, maxTtl: 120 }), now = new Date();
    const login = await universalLogin(identity.clientId, identity.clientSecret, "127.0.0.1", now);
    const renewed = await identityToken(login.accessToken, "127.0.0.1", undefined, true, new Date(now.getTime() + 59000));
    if (!renewed || !("accessToken" in renewed)) throw new Error("Missing renewal");
    expect(await identityToken(login.accessToken, "127.0.0.1", projectId)).toBeNull();
    const last = await identityToken(renewed.accessToken, "127.0.0.1", undefined, true, new Date(now.getTime() + 118000));
    if (!last || !("accessToken" in last)) throw new Error("Missing renewal"); expect(last.expiresIn).toBe(2);
    expect(await identityToken(last.accessToken, "127.0.0.1", undefined, true, new Date(now.getTime() + 120000))).toBeNull();
    expect(await identityToken(login.accessToken, "127.0.0.1", projectId, false, new Date(now.getTime() + 61000))).toBeNull();
  });
  it("denies non-admin and cross-workspace management and honours live permission removal", async () => {
    await expect(createIdentity(member, devId, { name: "Denied" })).rejects.toThrow(); await expect(createIdentity(other, devId, { name: "Denied" })).rejects.toThrow();
    const identity = await machine(), login = await universalLogin(identity.clientId, identity.clientSecret, "127.0.0.1");
    await manageIdentity(owner, devId, identity.id, "permission", { path: "/", role: "NONE" });
    const actor = await identityToken(login.accessToken, "127.0.0.1", projectId);
    if (!actor || !("workspace" in actor)) throw new Error("Missing actor"); await expect(readSecrets(actor, devId, "/")).rejects.toThrow("access");
  });
  it("does not borrow a stronger permission from another path", async () => {
    const identity = await machine({ role: "KEYS" });
    await manageIdentity(owner, devId, identity.id, "permission", { path: "/api", role: "WRITE" });
    const login = await universalLogin(identity.clientId, identity.clientSecret, "127.0.0.1"), actor = await identityToken(login.accessToken, "127.0.0.1", projectId);
    if (!actor || !("workspace" in actor)) throw new Error("Missing actor");
    await expect(readSecrets(actor, devId, "/", { key: "TEST_KEY" })).rejects.toThrow("folder");
    await expect(changeSecrets(actor, devId, [{ key: "ESCALATED", path: "/", value: "fixture" }])).rejects.toThrow("folder");
  });
  it("revokes individual client secrets and their access tokens", async () => {
    const identity = await machine(), login = await universalLogin(identity.clientId, identity.clientSecret, "127.0.0.1");
    await manageIdentity(owner, devId, identity.id, "revoke-credential", { credentialId: identity.clientSecret.split(".")[0] });
    expect(await identityToken(login.accessToken, "127.0.0.1", projectId)).toBeNull();
  });
});
describe("Hierarchical encryption and reveal privacy", () => {
  it("keeps page DTOs and names-only lists free of values and wrapped keys", async () => {
    const view = await loadSecrets(owner, projectId, devId), serialized = JSON.stringify(view);
    expect(viewDto(view).identities.every(identity => Array.isArray(identity.clientSecretMetadata))).toBe(true);
    expect(serialized).not.toContain("fixture-only"); expect(serialized).not.toContain("secretEnc"); expect(serialized).not.toContain("wrappedKey"); expect(serialized).not.toContain("secretHash");
    const row = await prisma.applicationSecret.findFirstOrThrow({ where: { workspaceId: owner.workspace.id, environmentId: devId, key: "TEST_KEY" } });
    expect(row.dataKeyEnc).toMatch(/^h2:/); expect(await openValue(row)).toContain("fixture-only");
    await expect(openValue({ ...row, key: "MOVED" })).rejects.toThrow();
    await expect(openValue({ ...row, environmentId: prodId })).rejects.toThrow();
    await expect(openValue({ ...row, workspaceId: other.workspace.id })).rejects.toThrow();
  });
  it("audits copy with key and actor and requires production MFA", async () => {
    await readSecrets(owner, devId, "/", { key: "TEST_KEY", copying: true });
    const event = await prisma.secretAudit.findFirstOrThrow({ where: { workspaceId: owner.workspace.id, environmentId: devId, action: "copied" } }); expect(event.actorId).toBe(owner.user.id); expect(event.secretKey).toBe("TEST_KEY");
    await expect(readSecrets(owner, prodId, "/")).rejects.toThrow("two-step");
    const proof = await freshProof(); expect(await readSecrets({ ...owner, proof }, prodId, "/")).toEqual({});
  });
  it("resumes rotation from a committed cursor and decrypts both key versions", async () => {
    await expect(requestKeyRotation(owner, projectId, "project")).rejects.toThrow("two-step");
    const actor = { ...owner, proof: await freshProof() }, old = await prisma.applicationSecret.findFirstOrThrow({ where: { workspaceId: owner.workspace.id, environmentId: devId, key: "TEST_KEY" } });
    const before = await encryptionSummary(owner.workspace.id, projectId), job = await requestKeyRotation(actor, projectId, "project");
    await runKeyRotation(job.id, 1, 2);
    const partial = await prisma.secretKeyRotation.findUniqueOrThrow({ where: { id: job.id } }); expect(partial.status).toBe("RUNNING"); expect(partial.cursor).not.toBe("0:");
    expect(await openValue(old)).toContain("fixture-only"); // decrypt-only previous project key
    await runKeyRotation(job.id, 1);
    const after = await encryptionSummary(owner.workspace.id, projectId); expect(after.projectVersion).toBe(before.projectVersion + 1); expect(after.lastJob?.status).toBe("COMPLETE");
    const row = await prisma.applicationSecret.findFirstOrThrow({ where: { workspaceId: owner.workspace.id, id: old.id } }); expect(row.dataKeyEnc).not.toBe(old.dataKeyEnc); expect(await openValue(row)).toContain("fixture-only");
    const version = await prisma.applicationSecretVersion.findFirstOrThrow({ where: { workspaceId: owner.workspace.id, secretId: old.id } }); expect(await revealVersion(owner, devId, old.id, version.id)).toContain("fixture-only");
    await runKeyRotation(job.id); expect((await encryptionSummary(owner.workspace.id, projectId)).projectVersion).toBe(after.projectVersion);
    const workspaceJob = await requestKeyRotation(actor, projectId, "workspace"); await runKeyRotation(workspaceJob.id);
    expect((await encryptionSummary(owner.workspace.id, projectId)).workspaceVersion).toBe(before.workspaceVersion + 1); expect(await openValue(row)).toContain("fixture-only");
  }, 120000);
  it("runs the shipped root-rotation command idempotently with dual root versions", async () => {
    const roots = `2:${Buffer.alloc(32, 23).toString("base64")},1:${Buffer.alloc(32, 19).toString("base64")}`;
    const options = { env: { ...process.env, DATABASE_URL: process.env.TEST_DATABASE_URL!, DIRECT_URL: process.env.TEST_DATABASE_URL!, VAULT_MASTER_KEYS: roots }, timeout: 90000 }; // the command also re-wraps every other workspace key in the database; allow for a loaded machine
    await promisify(execFile)(process.execPath, ["scripts/rotate-root-key.mjs"], options);
    process.env.VAULT_MASTER_KEYS = roots;
    expect((await encryptionSummary(owner.workspace.id, projectId)).rootVersion).toBe(2);
    expect(await readSecrets(owner, devId, "/", { key: "TEST_KEY" })).toEqual({ TEST_KEY: "fixture-only\nsecond-line" });
    await promisify(execFile)(process.execPath, ["scripts/rotate-root-key.mjs"], options);
    expect((await encryptionSummary(owner.workspace.id, projectId)).rootVersion).toBe(2);
  }, 240000);
});
