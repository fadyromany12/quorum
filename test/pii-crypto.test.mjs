/* Field-level encryption for identity documents and payment details.

   The cases worth reading are the ones about *binding*. Encrypting an IBAN
   stops an outsider reading it; it does nothing about someone with UPDATE
   rights copying one employee's encrypted IBAN into another's row. The AAD
   tests below are the ones that prove that attack fails. */

process.env.PII_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
const C = await import("../src/lib/pii-crypto.js");

let pass = 0, fail = 0;
const eq = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; console.log(`  ok   ${label}`); }
  else { fail++; console.log(`  FAIL ${label}\n         got:  ${JSON.stringify(got)}\n         want: ${JSON.stringify(want)}`); }
};
const throws = (label, fn, match) => {
  try { fn(); fail++; console.log(`  FAIL ${label} — did not throw`); }
  catch (e) {
    if (!match || match.test(e.message)) { pass++; console.log(`  ok   ${label}`); }
    else { fail++; console.log(`  FAIL ${label} — wrong message: ${e.message}`); }
  }
};

const ctx = { employeeId: "emp_1", field: "iban" };

console.log("\n── Round trip ──");
{
  const ct = C.encryptField("EG380003000123456789", ctx);
  eq("ciphertext is not the plaintext", ct === "EG380003000123456789", false);
  eq("it carries the version prefix", ct.startsWith("q1."), true);
  eq("it has three parts", ct.split(".").length, 3);
  eq("it decrypts back", C.decryptField(ct, ctx), "EG380003000123456789");
}
eq("a 14-digit national ID round-trips",
  C.decryptField(C.encryptField("29801011234567", { employeeId: "e", field: "nationalId" }),
                 { employeeId: "e", field: "nationalId" }), "29801011234567");
eq("Arabic round-trips (UTF-8, not Latin-1)",
  C.decryptField(C.encryptField("محمد", ctx), ctx), "محمد");
eq("a long value round-trips",
  C.decryptField(C.encryptField("x".repeat(500), ctx), ctx), "x".repeat(500));

console.log("\n── The same value encrypts differently every time ──");
{
  const a = C.encryptField("29801011234567", ctx);
  const b = C.encryptField("29801011234567", ctx);
  eq("two encryptions of one value differ", a === b, false);
  eq("but both decrypt to it", [C.decryptField(a, ctx), C.decryptField(b, ctx)],
    ["29801011234567", "29801011234567"]);
  eq("the IVs differ", a.split(".")[1] === b.split(".")[1], false);
}

console.log("\n── Empty means empty ──");
eq("empty string stays empty", C.encryptField("", ctx), "");
eq("null becomes empty, not ciphertext", C.encryptField(null, ctx), "");
eq("undefined becomes empty", C.encryptField(undefined, ctx), "");
eq("decrypting empty gives empty", C.decryptField("", ctx), "");

console.log("\n── Values are bound to the employee and the column ──");
{
  const mine = C.encryptField("EG380003000123456789", { employeeId: "emp_1", field: "iban" });
  eq("the owner can read it", C.decryptField(mine, { employeeId: "emp_1", field: "iban" }),
    "EG380003000123456789");
  throws("moving it to another employee fails",
    () => C.decryptField(mine, { employeeId: "emp_2", field: "iban" }), /Could not decrypt/);
  throws("moving it to another column fails",
    () => C.decryptField(mine, { employeeId: "emp_1", field: "accountNumber" }), /Could not decrypt/);
}

console.log("\n── Tampering is detected, not decrypted around ──");
{
  const ct = C.encryptField("29801011234567", ctx);
  const [p, iv, payload] = ct.split(".");
  // Flip a bit in the ciphertext body.
  const bytes = Buffer.from(payload, "base64url");
  bytes[0] ^= 0x01;
  throws("a modified body fails authentication",
    () => C.decryptField([p, iv, bytes.toString("base64url")].join("."), ctx), /Could not decrypt/);

  const ivBytes = Buffer.from(iv, "base64url");
  ivBytes[0] ^= 0x01;
  throws("a modified IV fails too",
    () => C.decryptField([p, ivBytes.toString("base64url"), payload].join("."), ctx), /Could not decrypt/);

  throws("a truncated value is rejected", () => C.decryptField("q1.abc.def", ctx), /malformed/);
  throws("a missing part is rejected", () => C.decryptField("q1.abc", ctx), /malformed/);
}

console.log("\n── Legacy plaintext keeps working ──");
/* Rows written before this existed have no prefix. They must read back
   unchanged, or the feature needs a backfill and a flag day. */
eq("plaintext passes through untouched", C.decryptField("29801011234567", ctx), "29801011234567");
eq("plaintext that looks like a version is still plaintext",
  C.decryptField("q2.something.else", ctx), "q2.something.else");
eq("re-encrypting an encrypted value does not nest it", (() => {
  const once = C.encryptField("x", ctx);
  return C.encryptField(once, ctx) === once;
})(), true);

console.log("\n── Whole records ──");
{
  const record = {
    nationalId: "29801011234567",
    iban: "EG380003000123456789",
    bankName: "CIB",
    emergencyPhone: "01000000000",
    maritalStatus: "Single",
  };
  const enc = C.encryptPii(record, "emp_9");
  eq("listed fields are encrypted", [C.isEncrypted(enc.nationalId), C.isEncrypted(enc.iban)], [true, true]);
  eq("bank name is left readable", enc.bankName, "CIB");
  eq("the emergency phone stays readable — it exists for emergencies",
    enc.emergencyPhone, "01000000000");
  eq("marital status is untouched", enc.maritalStatus, "Single");
  eq("the record round-trips", C.decryptPii(enc, "emp_9"), record);
  throws("a record decrypted as the wrong employee fails",
    () => C.decryptPii(enc, "emp_8"), /Could not decrypt/);
}
{
  const partial = { iban: "EG38" };
  const enc = C.encryptPii(partial, "emp_9");
  eq("a partial update only touches what it was given", Object.keys(enc), ["iban"]);
  eq("and round-trips", C.decryptPii(enc, "emp_9"), partial);
}
eq("a null record passes through", C.decryptPii(null, "emp_9"), null);
eq("an empty record stays empty", C.encryptPii({}, "emp_9"), {});

console.log("\n── The field list ──");
eq("identity documents are covered",
  ["nationalId", "passportNumber", "socialInsuranceNo"].every((f) => C.ENCRYPTED_PII_FIELDS.includes(f)), true);
eq("payment destinations are covered",
  ["accountNumber", "iban", "swiftCode"].every((f) => C.ENCRYPTED_PII_FIELDS.includes(f)), true);
eq("bank name is deliberately excluded", C.ENCRYPTED_PII_FIELDS.includes("bankName"), false);
eq("no duplicates", new Set(C.ENCRYPTED_PII_FIELDS).size, C.ENCRYPTED_PII_FIELDS.length);

console.log("\n── Key handling ──");
eq("a 32-byte base64 key loads", !!C.loadKey(Buffer.alloc(32, 1).toString("base64")).key, true);
eq("a 64-char hex key loads", !!C.loadKey("aa".repeat(32)).key, true);
eq("a short key is refused", C.loadKey("tooshort").key, null);
eq("and says why", /32 bytes/.test(C.loadKey("tooshort").problem), true);
eq("an empty key is refused", C.loadKey("").key, null);
eq("an absent key says so", /not set/.test(C.loadKey("").problem), true);
eq("a generated key is accepted by the loader", !!C.loadKey(C.generateKey()).key, true);
eq("status reports active when a key is set", C.encryptionStatus(), { active: true, problem: null });

console.log("\n── Without a key ──");
{
  const saved = process.env.PII_ENCRYPTION_KEY;
  delete process.env.PII_ENCRYPTION_KEY;

  eq("status reports inactive, with the reason",
    C.encryptionStatus().active, false);
  eq("and names the variable", /PII_ENCRYPTION_KEY/.test(C.encryptionStatus().problem), true);
  eq("writes pass through as plaintext so local dev still runs",
    C.encryptField("29801011234567", ctx), "29801011234567");
  eq("plaintext still reads", C.decryptField("29801011234567", ctx), "29801011234567");

  process.env.PII_ENCRYPTION_KEY = saved;
  const ct = C.encryptField("29801011234567", ctx);
  delete process.env.PII_ENCRYPTION_KEY;
  throws("but encrypted data cannot be read without the key",
    () => C.decryptField(ct, ctx), /Cannot read encrypted iban/);

  process.env.PII_ENCRYPTION_KEY = saved;
}

console.log("\n── A wrong key cannot read another key's data ──");
{
  const saved = process.env.PII_ENCRYPTION_KEY;
  const ct = C.encryptField("29801011234567", ctx);
  process.env.PII_ENCRYPTION_KEY = Buffer.alloc(32, 9).toString("base64");
  throws("decryption fails rather than returning garbage",
    () => C.decryptField(ct, ctx), /Could not decrypt/);
  process.env.PII_ENCRYPTION_KEY = saved;
  eq("the right key still reads it", C.decryptField(ct, ctx), "29801011234567");
}

console.log("\n── Misuse is refused, not silently mis-bound ──");
throws("encrypting without an employee id throws",
  () => C.encryptField("x", { employeeId: "", field: "iban" }), /employeeId and field/);
throws("encrypting without a field throws",
  () => C.encryptField("x", { employeeId: "e", field: "" }), /employeeId and field/);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
