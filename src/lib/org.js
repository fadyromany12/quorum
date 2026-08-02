/* Accounts and their lines of business — pure rules, no I/O.

   An account is a client (Hertz, Lenovo, Beko). A line of business is a
   division of work inside one of them — EMEA support, North America sales.
   They were modelled as two unrelated flat lists: accounts in the database,
   LOBs as a hard-coded constant shared by every account. That is wrong in both
   directions. It offers Hertz a LOB that only exists on Lenovo, and it makes
   adding a line of business a code change.

   The nesting is the fix, and it has to arrive without a migration, because
   `accounts` already holds a live list. So both shapes are accepted on read:

     legacy   ["Hertz", "Lenovo"]
     current  [{ name: "Hertz", lobs: ["EMEA"] }, …]

   Read old, write new — the same pattern the encrypted columns and the coded
   exit reasons use. Nothing needs backfilling and nothing breaks in between. */

/** Names that must not be used, because they are filter sentinels in the UI. */
const RESERVED = ["all", "none", ""];

const clean = (s) => String(s ?? "").trim();

/**
 * Normalise whatever is stored into the current shape.
 *
 * Always returns an array — a corrupt or absent config yields an empty org
 * rather than throwing, because a settings screen that cannot render is a
 * settings screen that cannot be used to fix the problem.
 *
 * @param {unknown} raw
 * @returns {Array<{name: string, lobs: string[]}>}
 */
export function normaliseAccounts(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  const seen = new Set();
  for (const entry of raw) {
    const name = clean(typeof entry === "string" ? entry : entry?.name);
    if (!name || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());

    const lobs = [];
    const lobSeen = new Set();
    for (const l of Array.isArray(entry?.lobs) ? entry.lobs : []) {
      const v = clean(l);
      if (!v || lobSeen.has(v.toLowerCase())) continue;
      lobSeen.add(v.toLowerCase());
      lobs.push(v);
    }
    out.push({ name, lobs });
  }
  return out;
}

/** Just the account names, for the many places that only need those. */
export const accountNames = (raw) => normaliseAccounts(raw).map((a) => a.name);

/**
 * The lines of business under one account.
 *
 * An unknown account yields none rather than everything: offering every LOB for
 * an account nobody configured is how a form ends up writing a line of business
 * that does not exist there.
 */
export function lobsFor(raw, account) {
  const a = normaliseAccounts(raw).find((x) => x.name === clean(account));
  return a ? a.lobs : [];
}

/** Every LOB across every account, deduplicated — for a fleet-wide filter. */
export function allLobs(raw) {
  const seen = new Set();
  const out = [];
  for (const a of normaliseAccounts(raw)) {
    for (const l of a.lobs) {
      if (seen.has(l.toLowerCase())) continue;
      seen.add(l.toLowerCase());
      out.push(l);
    }
  }
  return out;
}

/** Whether this account/LOB pairing is one the org actually has. */
export const isValidPairing = (raw, account, lob) =>
  !clean(lob) || lobsFor(raw, account).includes(clean(lob));

/**
 * Check a proposed org structure before it is saved.
 *
 * @param {unknown} raw
 * @returns {{ok: true, accounts: Array<{name: string, lobs: string[]}>} | {ok: false, reason: string}}
 */
export function checkAccounts(raw) {
  if (!Array.isArray(raw)) return { ok: false, reason: "Accounts must be a list." };

  const names = raw.map((e) => clean(typeof e === "string" ? e : e?.name));
  if (names.some((n) => !n)) return { ok: false, reason: "An account cannot have an empty name." };
  if (names.some((n) => RESERVED.includes(n.toLowerCase()))) {
    return { ok: false, reason: `"All" and "None" are reserved — the filters use them.` };
  }

  const lower = names.map((n) => n.toLowerCase());
  const dup = lower.find((n, i) => lower.indexOf(n) !== i);
  if (dup) return { ok: false, reason: `"${names[lower.indexOf(dup)]}" is listed twice.` };

  for (const e of raw) {
    if (typeof e === "string") continue;
    const lobs = Array.isArray(e?.lobs) ? e.lobs.map(clean) : [];
    if (lobs.some((l) => !l)) {
      return { ok: false, reason: `A line of business under "${clean(e?.name)}" has no name.` };
    }
    const ll = lobs.map((l) => l.toLowerCase());
    const ldup = ll.find((l, i) => ll.indexOf(l) !== i);
    if (ldup) {
      return { ok: false, reason: `"${lobs[ll.indexOf(ldup)]}" is listed twice under "${clean(e?.name)}".` };
    }
  }

  const accounts = normaliseAccounts(raw);
  if (!accounts.length) return { ok: false, reason: "At least one account is required." };
  return { ok: true, accounts };
}

/**
 * What would break if this account or LOB were removed.
 *
 * Deleting a line of business that people are assigned to does not delete them
 * — it orphans them, and they vanish from every filtered view while still being
 * on the payroll. The caller decides whether to proceed; this only makes the
 * consequence visible first.
 *
 * @param {Array<{account?: string, lob?: string}>} employees
 * @param {string} account
 * @param {string} [lob] omit to check the whole account
 */
export function impactOfRemoving(employees, account, lob = "") {
  const a = clean(account);
  const l = clean(lob);
  const affected = (employees ?? []).filter(
    (e) => clean(e?.account) === a && (!l || clean(e?.lob) === l),
  );
  return {
    count: affected.length,
    names: affected.slice(0, 5).map((e) => e.fullNameEn ?? e.empId ?? "").filter(Boolean),
    safe: affected.length === 0,
  };
}
