/* Exit clearance — pure rules for a sequenced checklist.

   Some steps cannot start until others finish: IT and Facilities cannot collect
   equipment before the manager confirms the handover, and HR's final sign-off
   means nothing while anything else is open. Dependencies are data, not code,
   so the list can change without changing the gate. */

export const DEFAULT_CLEARANCE = [
  { key: "handover", label: "Work handover confirmed", owner: "Manager", dependsOn: "" },
  { key: "it-assets", label: "IT equipment returned", owner: "IT", dependsOn: "handover" },
  { key: "facilities", label: "Access cards & facilities cleared", owner: "Facilities", dependsOn: "handover" },
  { key: "finance", label: "Advances & dues settled", owner: "Finance", dependsOn: "" },
  // "*" = every other step: the final sign-off is a seal, not a task.
  { key: "hr-final", label: "HR final sign-off", owner: "HR", dependsOn: "*" },
];

const done = (steps, key) => steps.some((s) => s.key === key && s.state === "done");

/**
 * May this step be completed now? Returns the blocking reason otherwise, so the
 * refusal explains the sequence instead of just enforcing it.
 * @param {Array<{key: string, label: string, state: string, dependsOn: string}>} steps
 * @param {string} key
 * @returns {{ok: true} | {ok: false, reason: string}}
 */
export function canComplete(steps, key) {
  const step = steps.find((s) => s.key === key);
  if (!step) return { ok: false, reason: "No such clearance step." };
  if (step.state === "done") return { ok: false, reason: "Already completed." };
  if (step.dependsOn === "*") {
    const open = steps.filter((s) => s.key !== key && s.state !== "done");
    if (open.length) {
      return { ok: false, reason: `Waiting on: ${open.map((s) => s.label).join(", ")}.` };
    }
  } else if (step.dependsOn && !done(steps, step.dependsOn)) {
    const dep = steps.find((s) => s.key === step.dependsOn);
    return { ok: false, reason: `${dep?.label ?? step.dependsOn} must be completed first.` };
  }
  return { ok: true };
}

export const allDone = (steps) => steps.length > 0 && steps.every((s) => s.state === "done");
