/* The formal warning letter, as a structured model.

   Kept pure and free of any PDF library so it can be unit-tested and reused:
   the API route (src/app/api/cases/[id]/letter) renders this into a PDF. Every
   figure comes from the finalized case, so the letter and the ledger never
   disagree. */

import { LAW_CITATION, PER_INCIDENT_CAP, PER_MONTH_CAP } from "./constants.js";
import { todayStr } from "./dates.js";
import { days } from "./format.js";

export function letterModel(e, { org = "Konecta GDC", date = todayStr() } = {}) {
  const investigation = e.severity === "Serious" || e.severity === "Zero Tolerance";
  const applied = e.deductionApplied || 0;
  const prescribed = e.deductionDays || 0;
  const occ = e.occurrence ? `occurrence No. ${e.occurrence}` : "this occurrence";

  const body = [];
  body.push(
    `This notice confirms that a disciplinary case has been recorded against you and finalized in accordance with the Disciplinary Consequences Matrix.`
  );
  body.push(
    `On ${e.date}, the following was recorded: "${e.violation}"${
      e.reclassifiedFrom ? ` (reclassified from ${e.reclassifiedFrom})` : ""
    }${e.severity ? `, classified as ${e.severity}` : ""}. As ${occ} of this violation, the prescribed action is: ${e.action}.`
  );
  if (applied > 0) {
    body.push(
      `A wage deduction of ${days(applied)} applies. Under ${LAW_CITATION}, deductions are capped at ${PER_INCIDENT_CAP} days per incident and ${PER_MONTH_CAP} days per calendar month; ${
        prescribed > applied ? `the prescribed ${days(prescribed)} was reduced to ${days(applied)} accordingly.` : `this figure is within those limits.`
      }`
    );
  }
  if (investigation) {
    body.push(
      `Given the severity of this matter, you are entitled to respond in writing within 3–5 working days of receiving this notice, and may be accompanied by a colleague during any related meeting.`
    );
  }
  body.push(
    `A copy of this notice is retained in your record. Continued or repeated violations may lead to further disciplinary action up to and including termination of employment.`
  );

  return {
    org,
    title: "Disciplinary Warning Notice",
    ref: e.hrRef || "—",
    issued: e.actionDate || date,
    employee: {
      name: e.agentName || e.email || e.empId || "—",
      empId: e.empId || "—",
      email: e.email || "—",
      account: e.account || "—",
      lob: e.lob || "—",
    },
    subject: `${e.violation}${e.occurrence ? ` — occurrence No. ${e.occurrence}` : ""}`,
    action: e.action,
    deductionDays: applied,
    body,
    lawCitation: LAW_CITATION,
    investigation,
    acknowledged: e.agentAcknowledgedAt
      ? { at: e.agentAcknowledgedAt, signature: e.agentSignature || "" }
      : null,
  };
}

/** Safe filename for the downloaded letter. */
export function letterFilename(e) {
  const who = (e.empId || e.email || e.agentName || "case").replace(/[^\w.-]+/g, "_");
  return `warning-letter-${who}-${e.date || ""}.pdf`;
}
