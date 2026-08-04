/* Notifications.

   The assertions worth having are about restraint, not delivery. A push people
   turn off is worse than no push at all, so: nothing repeats, quiet hours are
   honoured for everything except the messages somebody else is blocked on, and
   every line stays true when it is read an hour late. */

const N = await import("../src/lib/notifications.js");
const { TABS_FOR } = await import("../src/lib/auth.js");

let pass = 0, fail = 0;
const ok = (label, cond, detail = "") => {
  if (cond) { pass++; console.log(`  ok   ${label}`); }
  else { fail++; console.log(`  FAIL ${label}${detail ? `\n         ${detail}` : ""}`); }
};
const eq = (label, got, want) =>
  ok(label, JSON.stringify(got) === JSON.stringify(want), `got:  ${JSON.stringify(got)}\n         want: ${JSON.stringify(want)}`);

console.log("\n── What cannot be switched off ──");
/* An approver who mutes approvals is a queue that silently stops moving, and
   the people waiting in it never find out why. */
ok("approvals are required", N.isRequired("approvalWaiting"));
ok("so are new joiners waiting on you", N.isRequired("applicationWaiting"));
ok("a decision on your own request is not — that is yours to mute", N.isRequired("requestDecided") === false);
ok("the optional list excludes every required kind",
  N.OPTIONAL_KINDS.every((k) => !N.isRequired(k)));
eq("muting a required kind is ignored rather than obeyed",
  N.readPrefs({ muted: ["approvalWaiting", "rosterPublished"] }).muted, ["rosterPublished"]);
eq("and an invented kind is dropped", N.readPrefs({ muted: ["nonsense"] }).muted, []);

console.log("\n── Quiet hours ──");
/* 22:00–07:00 is what most people mean by "not at night", and a naive
   from <= t < to comparison makes that window empty. */
const night = { quietFrom: "22:00", quietTo: "07:00" };
ok("23:00 is inside a window that crosses midnight", N.inQuietHours("23:00", night));
ok("03:00 is too", N.inQuietHours("03:00", night));
ok("07:00 is not — the end is exclusive", N.inQuietHours("07:00", night) === false);
ok("14:00 is not", N.inQuietHours("14:00", night) === false);
/* Shift workers sleep during the day, so the mirror case has to work too. */
const dayShift = { quietFrom: "09:00", quietTo: "17:00" };
ok("a daytime quiet window works the same way", N.inQuietHours("12:00", dayShift));
ok("and excludes the evening", N.inQuietHours("20:00", dayShift) === false);
ok("no window set means never quiet", N.inQuietHours("03:00", {}) === false);
ok("an equal start and end is not a 24-hour blackout", N.inQuietHours("12:00", { quietFrom: "09:00", quietTo: "09:00" }) === false);
ok("a malformed time is discarded rather than half-applied", N.readPrefs({ quietFrom: "22" }).quietFrom === "");

console.log("\n── Who gets interrupted, and when ──");
{
  const r = N.shouldNotify("caseToSign", night, { at: "23:30" });
  ok("a signature request waits until morning", r.send === false && r.deferred === true);
  ok("and says why, because 'why was I not told' is a support question", /quiet hours/i.test(r.reason));

  /* A roster change pierces quiet hours on purpose, and the reason is a
     consequence rather than a preference: if tomorrow's shift moved earlier,
     staying quiet means somebody oversleeps and *this same app* logs the
     attendance violation for it. */
  ok("a roster change gets through, because the alternative is a violation this app then logs",
    N.shouldNotify("rosterPublished", night, { at: "23:30" }).send);

  /* Somebody waiting on your approval is not served by you finding out
     politely in the morning. If that is genuinely unwelcome the answer is
     delegation, which this app already has. */
  ok("an approval gets through quiet hours", N.shouldNotify("approvalWaiting", night, { at: "23:30" }).send);
  ok("so does a new joiner", N.shouldNotify("applicationWaiting", night, { at: "03:00" }).send);
  ok("an SLA breach does not", N.shouldNotify("slaBreach", night, { at: "23:30" }).send === false);

  ok("switching notifications off stops everything", N.shouldNotify("approvalWaiting", { enabled: false }, { at: "12:00" }).send === false);
  ok("and says so plainly", /switched off/.test(N.shouldNotify("approvalWaiting", { enabled: false }).reason));
  ok("a muted optional kind stays muted", N.shouldNotify("rosterPublished", { muted: ["rosterPublished"] }).send === false);
  ok("with no preferences at all, everything sends", N.shouldNotify("caseToSign", {}, { at: "03:00" }).send);
  ok("an unknown kind is refused rather than sent blind", N.shouldNotify("invented", {}).send === false);
}

console.log("\n── Messages that are still true an hour later ──");
{
  /* "3 approvals waiting" is false the moment somebody clears one. */
  const m = N.messageFor("approvalWaiting", { subjectName: "Nour Said", summary: "Leave — 2 days from 14 Sep", id: "r1" });
  ok("names the person and what they asked for", /Nour Said/.test(m.title) && /2 days/.test(m.body));
  ok("carries a link rather than a decision", m.url.startsWith("/") && !("action" in m));
  ok("and a tag, so the same event cannot stack up twice", m.tag === "approvalWaiting:r1");

  const yes = N.messageFor("requestDecided", { decision: "approved", summary: "Leave — 2 days" });
  eq("an approval says so in one word", yes.title, "Approved");
  const no = N.messageFor("requestDecided", { decision: "rejected", summary: "Leave — 2 days", note: "14 Sep is already three short." });
  eq("a rejection is not called a decision", no.title, "Not approved");
  /* The note is the only thing that tells somebody what to do next. */
  ok("and carries the reason, which matters more than the verdict", /three short/.test(no.body));

  const roster = N.messageFor("rosterPublished", {});
  ok("a roster change warns before you plan anything", /before you plan/i.test(roster.body));

  ok("a very long summary is clipped rather than sent whole",
    N.messageFor("approvalWaiting", { summary: "x".repeat(500) }).body.length < 130);
  ok("an unknown kind throws rather than sending an empty bubble", (() => {
    try { N.messageFor("invented"); return false; } catch { return true; }
  })());
  ok("a missing name does not render 'undefined'",
    !/undefined/.test(N.messageFor("approvalWaiting", {}).title));
}

console.log("\n── The module's own wiring ──");
{
  eq("every kind points at a screen the navigation places",
    N.checkNotifications(TABS_FOR.SuperAdmin), []);
  /* A required notification that quiet hours could hold back is a promise the
     module does not keep. */
  ok("the checker catches a required kind that quiet hours could suppress", (() => {
    const saved = N.NOTIFY_KINDS.approvalWaiting.urgency;
    N.NOTIFY_KINDS.approvalWaiting.urgency = "low";
    const problems = N.checkNotifications(TABS_FOR.SuperAdmin);
    N.NOTIFY_KINDS.approvalWaiting.urgency = saved;
    return problems.some((p) => /quiet hours would hold it back/.test(p));
  })());
  ok("and catches a kind pointing at a screen that is not placed", (() => {
    const saved = N.NOTIFY_KINDS.slaBreach.tab;
    N.NOTIFY_KINDS.slaBreach.tab = "nowhere";
    const problems = N.checkNotifications(TABS_FOR.SuperAdmin);
    N.NOTIFY_KINDS.slaBreach.tab = saved;
    return problems.some((p) => /does not place/.test(p));
  })());
}

console.log(`\n${fail === 0 ? "PASS" : "FAIL"} — ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
