// Synthetic recovery fixture for the disposable CI deployment only.
import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";
import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { decodeAes256Key, encryptWithKey, decryptWithKey } from "../../scripts/vault-root-crypto.mjs";

assert.equal(process.env.SWW_RECOVERY_SMOKE, "1", "Explicit disposable recovery opt-in required");
const mode = process.argv[2];
assert.ok(["seed", "empty", "verify"].includes(mode), "Choose seed, empty or verify");
const prisma = new PrismaClient();
const s3 = new S3Client({ region: process.env.S3_REGION, endpoint: process.env.S3_ENDPOINT,
  forcePathStyle: true, credentials: { accessKeyId: process.env.S3_ACCESS_KEY_ID, secretAccessKey: process.env.S3_SECRET_ACCESS_KEY } });
const email = "recovery-fixture@example.test", slug = "deployment-recovery-fixture";
const plaintext = "synthetic-recovery-secret", content = "private recovery fixture bytes";
const object = { Bucket: process.env.S3_BUCKET, Key: "deployment-recovery/fixture.txt" };
try {
  const key = decodeAes256Key(process.env.MFA_ENCRYPTION_KEY, "MFA_ENCRYPTION_KEY");
  if (mode === "seed") {
    const user = await prisma.user.create({ data: { email, name: "Recovery fixture", mfaSecretEncrypted: encryptWithKey(key, plaintext) } });
    await prisma.workspace.create({ data: { slug, name: "Recovery fixture", memberships: { create: { userId: user.id, role: "OWNER" } },
      docs: { create: { title: "Recovery fixture", contentText: content, createdById: user.id } } } });
    await s3.send(new PutObjectCommand({ ...object, Body: content }));
  } else if (mode === "empty") {
    assert.equal(await prisma.user.count({ where: { email } }), 0, "The recovery target must not contain the source fixture");
    assert.equal(await prisma.workspace.count({ where: { slug } }), 0);
    await assert.rejects(s3.send(new GetObjectCommand(object)), error => error.$metadata?.httpStatusCode === 404,
      "The fresh storage volume must not already contain the backed-up object");
  } else {
    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    assert.equal(decryptWithKey(key, user.mfaSecretEncrypted), plaintext, "Restored keys must decrypt restored ciphertext");
    const workspace = await prisma.workspace.findUniqueOrThrow({ where: { slug }, include: { docs: true, memberships: true } });
    assert.equal(workspace.docs[0]?.contentText, content);
    assert.equal(workspace.memberships[0]?.userId, user.id);
    const result = await s3.send(new GetObjectCommand(object));
    assert.equal(await result.Body.transformToString(), content);
    const anonymous = await fetch(`${process.env.S3_ENDPOINT}/${object.Bucket}/${object.Key}`);
    await anonymous.body?.cancel();
    assert.equal(anonymous.status, 403, "Restored files remain private");
  }
  console.log(`Disposable recovery fixture ${mode} passed (database, ciphertext, keys and private object).`);
} catch {
  console.error("Disposable recovery verification failed; credentials and fixture content were suppressed.");
  process.exitCode = 1;
} finally {
  s3.destroy();
  await prisma.$disconnect();
}
