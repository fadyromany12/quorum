/* Equipment the company gave somebody and expects back.

   `Employee.assets` has been a JSON array of strings — ["Laptop","MiFi"] —
   which is enough to print on an onboarding checklist and not enough for
   anything else. It cannot say *which* laptop, when it was issued, what
   condition it came back in, or whether it came back at all.

   That matters at exactly one moment, and it is the expensive one. The exit
   clearance has a step called "IT equipment returned", it depends on the
   handover being confirmed, and somebody ticks it. What they are actually
   asserting is that they remembered what the person had. A leaver's laptop
   goes missing not because anybody stole it but because nobody could say it
   existed.

   ── Recovery is a number, not a feeling ──────────────────────────────────

   The reason this module carries a replacement cost is that "they did not
   return the headset" and "they did not return the laptop" are the same
   sentence and very different conversations. Egyptian Labour Law No. 12/2003
   caps what can be deducted from wages, so the number here is what is *owed*,
   never what is automatically taken — deducting it is a separate decision by a
   person, through the deduction rules that already exist.

   ── Nothing is ever deleted ──────────────────────────────────────────────

   "We never gave them one" and "they kept it" are different answers, and the
   second one has a cost attached. An asset ends as returned, written off or
   lost; it does not end by disappearing. */

/** Kinds of thing that get issued, and what each implies. */
export const ASSET_KINDS = {
  laptop: { label: "Laptop", labelAr: "لابتوب", serialised: true, blocksClearance: true },
  headset: { label: "Headset", labelAr: "سماعة", serialised: false, blocksClearance: true },
  /* A SIM is cheap and is the one people forget, and an unreturned one keeps
     costing money every month rather than once. */
  mifi: { label: "MiFi / dongle", labelAr: "راوتر محمول", serialised: true, blocksClearance: true },
  simCard: { label: "SIM card", labelAr: "شريحة اتصال", serialised: true, blocksClearance: true },
  accessCard: { label: "Access card", labelAr: "كارت الدخول", serialised: true, blocksClearance: true },
  monitor: { label: "Monitor", labelAr: "شاشة", serialised: true, blocksClearance: true },
  phone: { label: "Phone", labelAr: "هاتف", serialised: true, blocksClearance: true },
  /* Issued and not expected back. Recorded so an onboarding checklist is
     complete, and deliberately not a clearance blocker. */
  uniform: { label: "Uniform", labelAr: "زي العمل", serialised: false, blocksClearance: false },
  other: { label: "Other", labelAr: "أخرى", serialised: false, blocksClearance: false },
};

export const ASSET_CODES = Object.keys(ASSET_KINDS);
export const isAssetKind = (k) => Object.hasOwn(ASSET_KINDS, k);
export const needsSerial = (k) => Boolean(ASSET_KINDS[k]?.serialised);
export const blocksClearance = (k) => Boolean(ASSET_KINDS[k]?.blocksClearance);

/** Where an item can be in its life. `issued` is the only open state. */
export const ASSET_STATES = ["issued", "returned", "writtenOff", "lost"];
export const isAssetState = (s) => ASSET_STATES.includes(s);
export const isOut = (a) => a?.state === "issued";

/** Everything wrong with issuing something. */
export function checkIssue(p = {}, { serialTaken = false } = {}) {
  const problems = [];
  const warnings = [];

  if (!isAssetKind(p.kind)) problems.push("Choose what is being issued.");
  if (!String(p.holderId ?? "").trim()) problems.push("Choose who is taking it.");

  const serial = String(p.serial ?? "").trim();
  if (needsSerial(p.kind) && !serial) {
    /* The distinction the whole table exists for. Without it this is a JSON
       array again, and at offboarding "a laptop" cannot be matched against
       anything. */
    problems.push(`A ${ASSET_KINDS[p.kind]?.label ?? "device"} needs its serial number — otherwise nobody can tell which one it was.`);
  }
  if (serial && serialTaken) {
    problems.push("Something with that serial is already issued. Return it first, or check the number.");
  }

  const cost = Number(p.replacementCostMinor ?? 0);
  if (!Number.isFinite(cost) || cost < 0) problems.push("The replacement cost must be a number.");
  else if (cost === 0 && blocksClearance(p.kind)) {
    /* Not blocked — plenty of kit is genuinely written down to nothing — but
       an unpriced item is one nobody can have a conversation about later. */
    warnings.push("No replacement cost recorded. If it is not returned there will be nothing to quantify.");
  }

  if (p.issuedOn && !/^\d{4}-\d{2}-\d{2}$/.test(String(p.issuedOn))) {
    problems.push("Give the issue date as yyyy-mm-dd.");
  }

  return { problems, warnings };
}

/** Everything wrong with closing an item off. */
export function checkReturn(asset = {}, p = {}) {
  const problems = [];
  if (!isAssetState(p.state)) problems.push("Say what happened to it.");
  else if (p.state === "issued") problems.push("That is where it already is.");
  if (!isOut(asset)) problems.push("That item is not currently issued to anybody.");

  if (p.state === "lost" || p.state === "writtenOff") {
    /* A write-off with no reason is a hole in a reconciliation somebody will
       have to explain to finance. */
    if (!String(p.note ?? "").trim()) problems.push("Say what happened — a write-off with no reason cannot be reconciled.");
  }
  if (p.returnedOn && !/^\d{4}-\d{2}-\d{2}$/.test(String(p.returnedOn))) {
    problems.push("Give the date as yyyy-mm-dd.");
  }
  return { problems, warnings: [] };
}

/**
 * What somebody still has, and what it is worth.
 *
 * The number that matters at offboarding: not "did they have a laptop" but
 * "what is still out and what would it cost to replace".
 */
export function outstanding(assets = []) {
  const out = assets.filter(isOut);
  const blocking = out.filter((a) => blocksClearance(a.kind));
  return {
    items: out,
    count: out.length,
    blocking,
    /* Minor units throughout, like every other money value here. */
    valueMinor: out.reduce((n, a) => n + (Number(a.replacementCostMinor) || 0), 0),
    /* What the clearance step should actually be gated on. Uniform going
       missing is not a reason to hold somebody's final settlement. */
    clearanceReady: blocking.length === 0,
  };
}

/**
 * Whether the IT clearance step can honestly be ticked, and why not.
 *
 * Returned as a sentence rather than a boolean because the person ticking it
 * needs to know what to chase, and "IT equipment returned: no" tells them
 * nothing they can act on.
 */
export function clearanceState(assets = []) {
  const o = outstanding(assets);
  if (o.clearanceReady) {
    /* Two different clean states, and `outstanding().count` cannot tell them
       apart because it counts what is still out — which is zero in both.
       "Nothing was ever issued" and "everything came back" mean different
       things to somebody signing off a clearance, and reporting the first when
       the second is true quietly claims that no equipment was ever involved. */
    return {
      ready: true,
      reason: assets.length ? "Everything that has to come back is back." : "Nothing was ever issued.",
    };
  }
  const names = o.blocking.map((a) => {
    const label = ASSET_KINDS[a.kind]?.label ?? a.kind;
    return a.serial ? `${label} (${a.serial})` : label;
  });
  return {
    ready: false,
    reason: `Still out: ${names.join(", ")}.`,
    /* Named so the conversation can be about a number rather than a feeling. */
    valueMinor: o.blocking.reduce((n, a) => n + (Number(a.replacementCostMinor) || 0), 0),
  };
}

/** Everything wrong with this module's own wiring. */
export function checkAssetConfig() {
  const problems = [];
  for (const [code, meta] of Object.entries(ASSET_KINDS)) {
    if (!meta.label) problems.push(`${code} has no label.`);
    if (!meta.labelAr) problems.push(`${code} has no Arabic label.`);
    /* A serialised item that does not block clearance is a contradiction: the
       serial exists so it can be matched back, and nothing matches it back. */
    if (meta.serialised && !meta.blocksClearance) {
      problems.push(`${code} carries a serial but does not block clearance, so nothing ever checks it came back.`);
    }
  }
  return problems;
}
