/* The one button that can end the company's afternoon.

   `/api/admin/reset` erases every case, every user, every audit row and every
   employee record, then reseeds the demo baseline. Until now the only thing
   standing in front of it was `requireRole("admin")` and a browser confirm().

   That is not enough, for a reason that has nothing to do with trust:

     · Preview deployments are publicly reachable and point at the same
       database as production. Anyone signed in as a Super Admin on any
       preview URL — including one built from a branch nobody reviewed — can
       wipe live data from a link in a pull request.

     · There is exactly one Super Admin, so the confirm() dialog is the entire
       control. A mis-click at the bottom of Settings is indistinguishable from
       a decision.

     · It is not recoverable in the product. Audit immutability is waived here
       by design, so there is no trail left behind that could rebuild anything.

   So the gate is an environment variable that is not set anywhere by default.
   Not a second password — a password is something you can be tricked into
   typing on a preview URL at 11pm, whereas an environment variable is
   something you must go and set on the deployment you actually mean, and then
   go and unset again.

   ── Why it defaults open in development ────────────────────────────────────

   A local database of made-up people is *supposed* to be resettable, and a
   guard that makes developers work around it is a guard that gets worked
   around in production too. NODE_ENV is set by the framework rather than by us,
   so "development" here means `next dev`, which cannot be what a deployment is
   running.

   Vercel builds previews with NODE_ENV=production, which is exactly right:
   a preview is a deployment, and this refuses on deployments. */

/** The env var an operator sets to arm the reset. Deliberately verbose. */
export const RESET_FLAG = "ALLOW_FACTORY_RESET";

/**
 * Whether a factory reset may run, and what to say when it may not.
 *
 * Pure, and takes the environment as an argument, so the interesting cases —
 * production without the flag, preview with it, the string "false" — are
 * testable without a deployment.
 *
 * @param {Record<string, string|undefined>} env
 * @returns {{allowed: boolean, reason: string, environment: string}}
 */
export function factoryResetGate(env = {}) {
  const flag = String(env[RESET_FLAG] ?? "").trim().toLowerCase();
  /* Vercel names the deployment; NODE_ENV only distinguishes `next dev` from
     everything else. Prefer the specific name when there is one, because
     "preview" is the case worth naming out loud in the refusal. */
  const environment = String(env.VERCEL_ENV || env.NODE_ENV || "production");

  /* An explicit "no" wins over anything else, including development. Somebody
     who set it to false meant it, and a local guard that ignores the setting
     teaches you nothing about how the deployed one behaves. */
  if (["false", "0", "no", "off"].includes(flag)) {
    return { allowed: false, reason: `${RESET_FLAG} is set to "${flag}" on this deployment.`, environment };
  }

  if (["true", "1", "yes", "on"].includes(flag)) {
    return { allowed: true, reason: `${RESET_FLAG} is set on this ${environment} deployment.`, environment };
  }

  /* Only `next dev` is open by default. Not preview, which is a deployment
     against the same database as production and reachable by anyone with the
     link. */
  if (environment === "development") {
    return { allowed: true, reason: "Running locally in development.", environment };
  }

  return {
    allowed: false,
    reason:
      `The factory reset is switched off on ${
        environment === "preview" ? "preview deployments" : `this ${environment} deployment`
      }. ` +
      `It erases every case, user, employee and audit row in the database this deployment is pointed at — ` +
      `and previews share that database with production. ` +
      `To run it deliberately, set ${RESET_FLAG}=true on the deployment, run the reset, then remove it again.`,
    environment,
  };
}
