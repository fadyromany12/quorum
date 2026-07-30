/* Field-level encryption for the identity documents and payment details in
   EmployeePII. Server-only — it reads a key from the environment and must never
   be imported into a client bundle.

   Why application-layer and not just "Postgres encrypts the disk": disk
   encryption protects against someone stealing the drive, which is not the
   threat. The realistic ones are a leaked connection string, a database backup
   copied somewhere convenient, a read-replica handed to an analyst, or a query
   run by someone with legitimate SQL access and no legitimate need for a
   national ID. In every one of those the disk is already decrypted. Encrypting
   in the application means the database only ever holds ciphertext, and the key
   lives somewhere the database does not.

   AES-256-GCM, so every value is authenticated as well as hidden — a modified
   ciphertext fails to decrypt instead of decrypting to something else.

   The detail that matters most here is the AAD. Each value is bound to the
   employee it belongs to *and* the column it sits in:

       aad = "<employeeId>:<field>"

   Without that binding, encryption stops an outsider reading an IBAN but does
   nothing about someone with UPDATE rights copying one employee's encrypted
   IBAN into another's row — the application would decrypt it happily and pay
   the wrong person. With it, a moved ciphertext fails authentication. That is
   the difference between encryption and encryption that holds up.

   Migration is transparent. Values written before this existed are plaintext
   and have no version prefix; decrypt returns them unchanged, and the next
   write encrypts them. No backfill, no downtime, no flag day. */

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/* A version tag, so the format can change without guessing what old rows are.
   "q1" is deliberately short — this prefix is stored on every encrypted value. */
const PREFIX = "q1";
const ALGO = "aes-256-gcm";
const IV_BYTES = 12; // 96 bits, the size GCM is defined for
const TAG_BYTES = 16;
const KEY_BYTES = 32;

/** The columns that get encrypted, and the reason each one is on the list.

    Bank *name* is deliberately absent: "CIB" identifies nobody and excluding it
    keeps the field usable for grouping and reporting. Marital status and the
    emergency contact are personal but are not identity documents or payment
    destinations, and encrypting the emergency phone would make it unreadable in
    exactly the situation it exists for. The test for inclusion is the same one
    the editability tiers use: does this field identify a person to a government,
    or move money? */
export const ENCRYPTED_PII_FIELDS = [
  "nationalId",        // identifies a person to the state
  "passportNumber",    // same, internationally
  "socialInsuranceNo", // statutory filings
  "accountNumber",     // payment destination
  "iban",              // payment destination
  "swiftCode",         // payment destination
];

const isEncrypted = (v) => typeof v === "string" && v.startsWith(`${PREFIX}.`);
export { isEncrypted };

/* ── The key ────────────────────────────────────────────────────────────────
   Read at call time rather than at import, so a process can be started, have
   the key set, and be tested without module-cache games. */

/**
 * Parse PII_ENCRYPTION_KEY into 32 raw bytes. Accepts base64 or hex, because
 * both are what people actually paste out of a key manager.
 *
 * @returns {{key: Buffer} | {key: null, problem: string}}
 */
export function loadKey(raw = process.env.PII_ENCRYPTION_KEY) {
  const s = String(raw ?? "").trim();
  if (!s) return { key: null, problem: "PII_ENCRYPTION_KEY is not set." };

  let buf = null;
  if (/^[0-9a-fA-F]{64}$/.test(s)) {
    buf = Buffer.from(s, "hex");
  } else {
    try {
      const b = Buffer.from(s, "base64");
      // Buffer.from is famously forgiving — verify it round-trips before trusting it.
      if (b.length === KEY_BYTES) buf = b;
    } catch {
      buf = null;
    }
  }
  if (!buf || buf.length !== KEY_BYTES) {
    return { key: null, problem: `PII_ENCRYPTION_KEY must be ${KEY_BYTES} bytes, as base64 or hex.` };
  }
  return { key: buf };
}

/**
 * Whether encryption is active, for a health panel.
 *
 * Worth surfacing rather than leaving implicit: "we encrypt PII" and "we
 * encrypt PII when someone remembered to set the variable" are different
 * claims, and only one of them is checkable.
 *
 * @returns {{active: boolean, problem: string|null}}
 */
export function encryptionStatus() {
  const { key, problem } = loadKey();
  return { active: !!key, problem: key ? null : (problem ?? null) };
}

/** The additional data each value is bound to. Changing this breaks every
    existing ciphertext, which is why it is one function and not a template
    repeated at each call site. */
const aadFor = (employeeId, field) => Buffer.from(`${employeeId}:${field}`, "utf8");

/**
 * Encrypt one field value.
 *
 * Empty stays empty. An encrypted empty string is indistinguishable from
 * encrypted data at a glance, and the schema uses "" to mean "not provided" —
 * turning absence into ciphertext would make every blank record look populated.
 *
 * With no key configured the value is returned unchanged, matching how
 * notifications behave without an API key: local development stays frictionless
 * and the deployment is expected to set the variable. encryptionStatus() is
 * what makes that visible rather than silent.
 *
 * @param {unknown} value
 * @param {{employeeId: string, field: string}} ctx
 * @returns {string}
 */
export function encryptField(value, { employeeId, field }) {
  const plain = String(value ?? "");
  if (plain === "") return "";
  if (isEncrypted(plain)) return plain; // already done; re-encrypting would nest

  const { key } = loadKey();
  if (!key) return plain;

  if (!employeeId || !field) {
    throw new Error("encryptField needs both employeeId and field — the value is bound to them.");
  }

  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGO, key, iv);
  cipher.setAAD(aadFor(employeeId, field));
  const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [
    PREFIX,
    iv.toString("base64url"),
    Buffer.concat([body, tag]).toString("base64url"),
  ].join(".");
}

/**
 * Decrypt one field value.
 *
 * A value with no version prefix predates encryption and is returned as-is —
 * that is the whole migration strategy: read old, write new, no backfill.
 *
 * Failure throws rather than returning a placeholder. A record that renders an
 * IBAN as "unreadable" invites someone to save the form and persist that string
 * over the real one; a loud error keeps the ciphertext intact while the key
 * problem gets fixed.
 *
 * @param {unknown} stored
 * @param {{employeeId: string, field: string}} ctx
 * @returns {string}
 */
export function decryptField(stored, { employeeId, field }) {
  const s = String(stored ?? "");
  if (s === "" || !isEncrypted(s)) return s;

  const { key, problem } = loadKey();
  if (!key) {
    throw new Error(`Cannot read encrypted ${field}: ${problem}`);
  }

  const parts = s.split(".");
  if (parts.length !== 3) throw new Error(`Encrypted ${field} is malformed.`);
  const iv = Buffer.from(parts[1], "base64url");
  const payload = Buffer.from(parts[2], "base64url");
  if (iv.length !== IV_BYTES || payload.length < TAG_BYTES + 1) {
    throw new Error(`Encrypted ${field} is malformed.`);
  }

  const body = payload.subarray(0, payload.length - TAG_BYTES);
  const tag = payload.subarray(payload.length - TAG_BYTES);

  try {
    const decipher = createDecipheriv(ALGO, key, iv);
    decipher.setAAD(aadFor(employeeId, field));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(body), decipher.final()]).toString("utf8");
  } catch {
    /* Authentication failed. Either the key is wrong, or the value was moved
       from another employee or another column — the AAD catches both, and both
       mean this value must not be shown as if it were valid. */
    throw new Error(
      `Could not decrypt ${field}. The key may be wrong, or the value may have been altered.`,
    );
  }
}

/**
 * Encrypt the sensitive columns of a PII record, leaving the rest alone.
 * Fields absent from the input stay absent — this takes partial updates.
 *
 * @param {Record<string, unknown>} record
 * @param {string} employeeId
 * @returns {Record<string, unknown>}
 */
export function encryptPii(record, employeeId) {
  const out = { ...(record ?? {}) };
  for (const field of ENCRYPTED_PII_FIELDS) {
    if (out[field] === undefined) continue;
    out[field] = encryptField(out[field], { employeeId, field });
  }
  return out;
}

/**
 * Decrypt the sensitive columns of a PII record read from the database.
 * Null passes through, because "this employee has no PII row yet" is normal for
 * an applicant and is not an error.
 *
 * @param {Record<string, unknown>|null} record
 * @param {string} employeeId
 * @returns {Record<string, unknown>|null}
 */
export function decryptPii(record, employeeId) {
  if (!record) return record;
  const out = { ...record };
  for (const field of ENCRYPTED_PII_FIELDS) {
    if (out[field] === undefined) continue;
    out[field] = decryptField(out[field], { employeeId, field });
  }
  return out;
}

/** Generate a key, for the setup instructions. Not used at runtime. */
export const generateKey = () => randomBytes(KEY_BYTES).toString("base64");
