import crypto from "node:crypto";
import { describe, expect, it } from "vitest";
import { parsePostmark } from "@/lib/campaigns/bounce/postmark";
import { isTrustedCertUrl, parseSesNotification, stringToSign, verifySnsSignature, type SnsMessage } from "@/lib/campaigns/bounce/ses";

describe("postmark parser", () => {
  it("maps bounce types and complaints, ignores the rest", () => {
    expect(parsePostmark({ RecordType: "Bounce", TypeCode: 1, Email: "a@x.org", ID: 7 })).toMatchObject({ kind: "HARD", providerEventId: "postmark:7" });
    expect(parsePostmark({ RecordType: "Bounce", TypeCode: 4096, Email: "a@x.org", ID: 8 })?.kind).toBe("SOFT");
    expect(parsePostmark({ RecordType: "SpamComplaint", Email: "a@x.org", ID: 9 })?.kind).toBe("COMPLAINT");
    expect(parsePostmark({ RecordType: "Bounce", TypeCode: 64, Email: "a@x.org" })).toBeNull();
    expect(parsePostmark("nope")).toBeNull();
  });
});

describe("SES / SNS", () => {
  it("only trusts SNS certificate hosts", () => {
    expect(isTrustedCertUrl("https://sns.eu-west-1.amazonaws.com/cert.pem")).toBe(true);
    expect(isTrustedCertUrl("https://sns.eu-west-1.amazonaws.com.evil.test/cert.pem")).toBe(false);
    expect(isTrustedCertUrl("http://sns.eu-west-1.amazonaws.com/cert.pem")).toBe(false);
    expect(isTrustedCertUrl("https://evil.test/sns.us-east-1.amazonaws.com/cert.pem")).toBe(false);
  });
  it("verifies a fixture-signed message and rejects tampering", async () => {
    const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
    const base: SnsMessage = { Type: "Notification", MessageId: "m1", TopicArn: "arn:t", Message: "{}", Timestamp: "2026-01-01T00:00:00Z", SignatureVersion: "2", SigningCertURL: "https://sns.us-east-1.amazonaws.com/c.pem" };
    const signature = crypto.createSign("RSA-SHA256").update(stringToSign(base)).sign(privateKey, "base64");
    const pem = publicKey.export({ type: "spki", format: "pem" }).toString();
    const fetchCert = async () => pem;
    expect(await verifySnsSignature({ ...base, Signature: signature }, fetchCert)).toBe(true);
    expect(await verifySnsSignature({ ...base, Message: "{\"x\":1}", Signature: signature }, fetchCert)).toBe(false);
    expect(await verifySnsSignature({ ...base, Signature: signature, SigningCertURL: "https://evil.test/c.pem" }, fetchCert)).toBe(false);
  });
  it("parses bounces and complaints per recipient", () => {
    const bounce = { notificationType: "Bounce", bounce: { bounceType: "Permanent", bouncedRecipients: [{ emailAddress: "A@x.org" }] } };
    expect(parseSesNotification("m1", bounce)).toEqual([{ email: "A@x.org", kind: "HARD", source: "SES", diagnostic: null, providerEventId: "ses:m1:a@x.org" }]);
    expect(parseSesNotification("m2", { notificationType: "Bounce", bounce: { bounceType: "Transient", bouncedRecipients: [{ emailAddress: "b@x.org" }] } })[0].kind).toBe("SOFT");
    expect(parseSesNotification("m3", { notificationType: "Complaint", complaint: { complainedRecipients: [{ emailAddress: "c@x.org" }] } })[0].kind).toBe("COMPLAINT");
  });
});
