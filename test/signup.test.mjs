/* Self sign-up.

   This is the only unauthenticated form in the application, so the assertions
   that earn their place are the ones about what a stranger can do with it:
   whether the door is shut by default, whether the thing it creates can sign
   in, and whether an application can be approved by somebody it was not
   addressed to.

   The rest is about not stranding an applicant. They have no account and no
   colleague to ask, so a refusal that does not say why is a person who never
   joins. */

const S = await import("../src/lib/signup.js");
const { STAGES } = await import("../src/lib/employee.js");
const { ROLES } = await import("../src/lib/auth.js");

let pass = 0, fail = 0;
const ok = (label, cond, detail = "") => {
  if (cond) { pass++; console.log(`  ok   ${label}`); }
  else { fail++; console.log(`  FAIL ${label}${detail ? `\n         ${detail}` : ""}`); }
};
const eq = (label, got, want) =>
  ok(label, JSON.stringify(got) === JSON.stringify(want), `got:  ${JSON.stringify(got)}\n         want: ${JSON.stringify(want)}`);

const CODE = "konecta-joining-2026";
const managers = [{ id: "m1", name: "Nour Adel" }, { id: "m2", name: "Karim Fouad" }];
const ctx = { managers, takenEmails: ["taken@konecta.com"], today: "2026-08-04" };
const good = {
  fullNameEn: "Mariam Hassan", fullNameAr: "مريم حسن", email: "mariam@konecta.com",
  password: "Joining@2026", confirm: "Joining@2026", phone: "01001234567",
  managerId: "m1", birthDate: "1998-03-11",
};

console.log("\n── The door is shut unless somebody opened it ──");
eq("an unconfigured deployment has sign-up closed", S.signupGate({}).open, false);
ok("and says what to set to open it", S.signupGate({}).reason.includes(S.SIGNUP_CODE_VAR));
ok("a short code does not count as a gate",
  S.signupGate({ [S.SIGNUP_CODE_VAR]: "join" }).open === false);
ok("and says so rather than silently accepting it",
  /too short/.test(S.signupGate({ [S.SIGNUP_CODE_VAR]: "join" }).reason));
ok("a real code opens it", S.signupGate({ [S.SIGNUP_CODE_VAR]: CODE }).open);
eq("domains are optional and parsed forgivingly",
  S.signupGate({ [S.SIGNUP_CODE_VAR]: CODE, [S.SIGNUP_DOMAINS_VAR]: "@konecta.com, Konecta.eg " }).domains,
  ["konecta.com", "konecta.eg"]);

console.log("\n── The code comparison ──");
ok("the right code matches", S.codeMatches(CODE, CODE));
ok("a wrong one does not", S.codeMatches("something-else-entirely", CODE) === false);
ok("a prefix of the code does not", S.codeMatches(CODE.slice(0, 8), CODE) === false);
ok("an empty expectation never matches, even against empty input", S.codeMatches("", "") === false);
ok("surrounding whitespace is forgiven — people paste", S.codeMatches(`  ${CODE} `, CODE));

console.log("\n── What sign-up creates cannot sign in ──");
{
  const fx = S.signupEffects(good, { empId: "EMP-1042" });
  eq("the login is created disabled", fx.user.active, false);
  eq("as an Agent and nothing more", fx.user.role, "Agent");
  ok("which is a role the app defines", ROLES.includes(fx.user.role));
  eq("the person is an Applicant, not an employee", fx.employee.stage, "Applicant");
  ok("which is a stage the lifecycle knows", STAGES.includes(fx.employee.stage));
  eq("the chosen manager is recorded as the reporting line", fx.employee.directManagerId, "m1");
  ok("no password hash is invented in a pure module", !("passHash" in fx.user));
  /* A HIRED event for somebody who might be rejected tomorrow is a lie the
     timeline never takes back. */
  eq("and nothing is written to the timeline yet", fx.events, []);
  eq("the address is stored lowercased so the duplicate check holds",
    S.signupEffects({ ...good, email: "Mariam@Konecta.com" }).user.email, "mariam@konecta.com");
  eq("and the same address is the record's work email — one identity, not two",
    S.signupEffects({ ...good, email: "Mariam@Konecta.com" }).employee.workEmail, "mariam@konecta.com");
  eq("and the phone loses its spacing", S.signupEffects({ ...good, phone: "010 0123 4567" }).employee.phone, "01001234567");
}

console.log("\n── Only the named manager decides ──");
{
  const applicant = { directManagerId: "m1" };
  ok("the manager it was addressed to can", S.canDecideSignup({ role: "OperationsLead", employeeId: "m1" }, applicant));
  ok("HR can", S.canDecideSignup({ role: "HRBusinessPartner", employeeId: "x" }, applicant));
  ok("the Super Admin can", S.canDecideSignup({ role: "SuperAdmin", employeeId: null }, applicant));
  /* The single human check in the flow is that a *named* person said yes. */
  ok("another manager cannot", S.canDecideSignup({ role: "OperationsLead", employeeId: "m2" }, applicant) === false);
  ok("an agent cannot", S.canDecideSignup({ role: "Agent", employeeId: "m2" }, applicant) === false);
  ok("and neither can somebody with no employee record at all",
    S.canDecideSignup({ role: "OperationsLead", employeeId: null }, { directManagerId: "" }) === false);
}

console.log("\n── The decision ──");
{
  const yes = S.decisionEffects("approve", { deciderName: "Nour Adel" });
  eq("approval is the only thing that enables the login", yes.user.active, true);
  eq("and moves them into Onboarding", yes.employee.stage, "Onboarding");
  ok("the timeline says who approved it", /Nour Adel/.test(yes.event.summary));

  const no = S.decisionEffects("reject", { deciderName: "Nour Adel", note: "Withdrew.", today: "2026-08-04" });
  eq("rejection leaves the login disabled", no.user.active, false);
  eq("and the record is kept rather than deleted", no.employee.stage, "Exited");
  ok("with the reason on it", no.employee.exitReason === "Withdrew.");
  ok("an unknown decision throws rather than defaulting to approval", (() => {
    try { S.decisionEffects("maybe"); return false; } catch { return true; }
  })());
}

console.log("\n── Refusals an applicant can act on ──");
const problemsOf = (patch, c = ctx) => S.checkSignup({ ...good, ...patch }, c).problems;
eq("a complete application is accepted", problemsOf({}), []);
ok("a taken address is refused, and told where to go instead",
  problemsOf({ email: "taken@konecta.com" }).some((x) => /Sign in instead/.test(x)));
ok("the address check ignores case", problemsOf({ email: "TAKEN@konecta.com" }).length > 0);
ok("a weak password is refused with the policy's own wording",
  problemsOf({ password: "abc", confirm: "abc" }).some((x) => /at least 8/.test(x)));
ok("a mistyped confirmation is caught", problemsOf({ confirm: "Joining@2027" }).some((x) => /do not match/.test(x)));
ok("no manager is refused", problemsOf({ managerId: "" }).some((x) => /Choose the manager/.test(x)));
ok("a manager who is not on the list is refused",
  problemsOf({ managerId: "m9" }).some((x) => /not on the list/.test(x)));
ok("under 18 is refused outright",
  problemsOf({ birthDate: "2012-03-11" }).some((x) => /Employment starts at 18/.test(x)));
ok("a nonsense date of birth is refused", problemsOf({ birthDate: "11-03-1998" }).length > 0);
ok("an address outside the allowed domains is refused, naming them",
  S.checkSignup({ ...good, email: "mariam@gmail.com" }, { ...ctx, domains: ["konecta.com"] })
    .problems.some((x) => /konecta\.com/.test(x)));
eq("and the allowed domain passes",
  S.checkSignup(good, { ...ctx, domains: ["konecta.com"] }).problems, []);

console.log("\n── Things worth saying but not worth blocking ──");
const warningsOf = (patch) => S.checkSignup({ ...good, ...patch }, ctx).warnings;
eq("a missing Arabic name does not stop the application", problemsOf({ fullNameAr: "" }), []);
ok("but HR is told they will need it", warningsOf({ fullNameAr: "" }).some((w) => /Arabic/.test(w)));
eq("a non-Egyptian mobile is allowed", problemsOf({ phone: "+441632960961" }), []);
ok("with a note in case it was a typo", warningsOf({ phone: "+441632960961" }).length > 0);
ok("one-word names are questioned, not refused",
  problemsOf({ fullNameEn: "Mariam" }).length === 0 && warningsOf({ fullNameEn: "Mariam" }).length > 0);

console.log("\n── Sign-in must not call a pending account a bad password ──");
{
  const src = await (await import("node:fs/promises")).readFile(new URL("../src/auth.ts", import.meta.url), "utf8");
  /* The exact bug the throttle had: null renders as "invalid email or
     password", so a person waiting on approval concludes their password broke
     and keeps trying. */
  ok("an inactive account with the right password gets its own signin code",
    /class \w*Pending\w*Signin extends CredentialsSignin/.test(src), src.match(/class \w+ extends CredentialsSignin/g)?.join(", ") ?? "no CredentialsSignin subclasses");
  ok("and the password is verified before the account state is revealed",
    src.indexOf("verifyPassword") < src.indexOf("if (!user.active)"),
    "the inactive branch must come after the password check, or it becomes an account-existence oracle");
  ok("a pending sign-in still counts against the throttle",
    /if \(!user\.active\)[\s\S]{0,400}recordLoginFailure/.test(src));
}

console.log(`\n${fail === 0 ? "PASS" : "FAIL"} — ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
