"use client";

/* One employee, whole.

   The point of the whole build: everything that has happened to a person, in
   one reverse-chronological record — hire, promotion, transfer, leave,
   violation, coaching, PIP, exit. In the spreadsheet this replaces, that story
   was scattered across twenty tabs and could only be reassembled by hand.

   PII is not loaded with the profile. It sits behind a button, a separate
   permission and an audit row, so opening someone's record is not the same act
   as reading their bank details. */

import { useCallback, useEffect, useState } from "react";
import {
  ArrowLeft, RefreshCw, Mail, Phone, Building2, CalendarDays, ShieldCheck,
  IdCard, Eye, Lock, GitBranch, Clock, AlertTriangle, Award, ArrowRightLeft, Banknote, Plus,
  UserMinus, StickyNote, Briefcase, GraduationCap, Landmark, Users2,
} from "lucide-react";
import { Card, Pill, Muted, BtnGhost, BtnPrimary, TInput, TSelect, Field } from "./ui/index.jsx";
import { P } from "../lib/tokens.js";
import { fmtStamp, plural } from "../lib/format.js";
import { todayStr } from "../lib/dates.js";
import {
  displayName, completedYears, nextStages, probationDue, isHeadcount, canTransition,
} from "../lib/employee.js";
import {
  EXIT_TYPES, EXIT_TYPE_CODES, EXIT_REASONS, exitReasonsFor,
  isVoluntaryExit, attritionClass,
} from "../lib/taxonomy.js";
import { TRAINING_TYPES } from "../lib/taxonomy.js";
import { Avatar, StageChip } from "./People.jsx";

/* Each timeline type gets an icon and a colour so the record can be skimmed —
   a promotion and a termination should not look alike at a glance. */
const EVENT_STYLE = {
  HIRED: { icon: Briefcase, color: P.green, label: "Hired" },
  STAGE_CHANGED: { icon: GitBranch, color: P.petrol, label: "Stage" },
  PROMOTED: { icon: Award, color: P.green, label: "Promotion" },
  PAY_CHANGED: { icon: Landmark, color: P.green, label: "Pay" },
  TRANSFERRED: { icon: ArrowRightLeft, color: P.petrol, label: "Transfer" },
  MANAGER_CHANGED: { icon: Users2, color: P.petrol, label: "Reporting" },
  LEAVE_APPROVED: { icon: CalendarDays, color: P.petrol, label: "Leave" },
  VIOLATION_LOGGED: { icon: AlertTriangle, color: P.brick, label: "Violation" },
  COACHING_LOGGED: { icon: GraduationCap, color: P.amber, label: "Coaching" },
  TRAINING_COMPLETED: { icon: GraduationCap, color: P.green, label: "Training" },
  PIP_OPENED: { icon: AlertTriangle, color: P.amber, label: "PIP opened" },
  PIP_CLOSED: { icon: ShieldCheck, color: P.green, label: "PIP closed" },
  ASSET_ISSUED: { icon: IdCard, color: P.sub, label: "Asset" },
  ASSET_RETURNED: { icon: IdCard, color: P.sub, label: "Asset" },
  EXITED: { icon: UserMinus, color: P.brick, label: "Exit" },
  NOTE: { icon: StickyNote, color: P.sub, label: "Note" },
};

function Facts({ children }) {
  return <div className="grid gap-2.5" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))" }}>{children}</div>;
}

function Fact({ icon: Icon, label, value, title }) {
  return (
    <div title={title}>
      <div className="ao-disp uppercase tracking-wide" style={{ fontSize: 10, color: P.sub, letterSpacing: 0.6 }}>
        {label}
      </div>
      <div className="flex items-center gap-1.5 mt-0.5" style={{ fontSize: 12.5, color: P.ink, overflowWrap: "anywhere" }}>
        {Icon && <Icon size={12} color={P.sub} style={{ flexShrink: 0 }} />}
        {value || <span style={{ color: P.sub }}>—</span>}
      </div>
    </div>
  );
}

/* PII panel. Deliberately empty until asked for: rendering it on load would
   make every profile view a bank-details read, and the audit log would stop
   meaning anything. */
function SensitivePanel({ employeeId }) {
  const [state, setState] = useState("idle"); // idle | loading | shown | denied | error
  const [pii, setPii] = useState(null);
  const [message, setMessage] = useState("");

  const reveal = async () => {
    setState("loading");
    try {
      const res = await fetch(`/api/employees/${employeeId}/pii`);
      const json = await res.json().catch(() => ({}));
      if (res.status === 403) {
        setState("denied");
        setMessage(json.error || "Your role cannot view identifiers.");
        return;
      }
      if (!res.ok) throw new Error(json.error || "Could not load identifiers.");
      setPii(json.pii);
      setState("shown");
    } catch (err) {
      setState("error");
      setMessage(err.message);
    }
  };

  if (state === "idle" || state === "loading") {
    return (
      <div
        className="flex items-center gap-3 flex-wrap"
        style={{ background: "var(--well)", border: `1px dashed ${P.line}`, borderRadius: 12, padding: 14 }}
      >
        <Lock size={14} color={P.sub} />
        <div className="flex-1 min-w-0">
          <div style={{ fontSize: 12.5, color: P.ink, fontWeight: 500 }}>
            Identifiers, banking and next of kin
          </div>
          <div style={{ fontSize: 11.5, color: P.sub }}>
            Hidden by default. Viewing is recorded in the audit trail against your name.
          </div>
        </div>
        <BtnGhost onClick={reveal} icon={Eye} disabled={state === "loading"}>
          {state === "loading" ? "Checking…" : "Reveal"}
        </BtnGhost>
      </div>
    );
  }

  if (state === "denied" || state === "error") {
    return (
      <div
        role="alert"
        style={{
          background: state === "denied" ? P.amberWash : P.brickWash,
          border: `1px solid ${state === "denied" ? P.amber : P.brick}`,
          borderRadius: 12, padding: 12, fontSize: 12.5,
          color: state === "denied" ? P.amber : P.brick,
        }}
      >
        {message}
      </div>
    );
  }

  if (!pii) {
    return <Muted>No identifiers on file yet.</Muted>;
  }

  return (
    <div style={{ background: "var(--well)", border: `1px solid ${P.line}`, borderRadius: 12, padding: 14 }}>
      <div className="flex items-center gap-1.5 mb-3" style={{ fontSize: 11, color: P.amber }}>
        <Eye size={12} />
        This view has been recorded in the audit trail.
      </div>
      <Facts>
        <Fact icon={IdCard} label="National ID" value={pii.nationalId} />
        <Fact icon={IdCard} label="Passport" value={pii.passportNumber} />
        <Fact icon={ShieldCheck} label="Social insurance" value={pii.socialInsuranceNo} />
        <Fact icon={Landmark} label="Bank" value={pii.bankName} />
        <Fact icon={Landmark} label="IBAN" value={pii.iban} />
        <Fact icon={Landmark} label="Account" value={pii.accountNumber} />
        <Fact label="Marital status" value={pii.maritalStatus} />
        <Fact icon={Phone} label="Emergency contact" value={pii.emergencyName && `${pii.emergencyName} · ${pii.emergencyPhone}`} />
      </Facts>
    </div>
  );
}

export default function EmployeeProfile({ employeeId, onBack, onChanged, nameById = {} }) {
  const [employee, setEmployee] = useState(null);
  const [timeline, setTimeline] = useState([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setError("");
    try {
      const res = await fetch(`/api/employees/${employeeId}`);
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Could not load this record.");
      setEmployee(json.employee);
      setTimeline(json.timeline || []);
    } catch (err) {
      setError(err.message);
    }
  }, [employeeId]);

  useEffect(() => {
    load();
  }, [load]);

  const move = async (to) => {
    /* An exit needs a type and a last working day, which is more than a button
       can carry — so the quick actions offer every other transition and leave
       exits to the full form rather than writing an incomplete record. */
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/employees/${employeeId}/stage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stage: to, effectiveDate: todayStr() }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Could not change the stage.");
      await load();
      onChanged?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  if (!employee) {
    return (
      <Card title="Employee record" right={<BtnGhost onClick={onBack} icon={ArrowLeft}>Back</BtnGhost>}>
        {error ? (
          <div style={{ fontSize: 13, color: P.brick }} role="alert">{error}</div>
        ) : (
          <div className="grid gap-3" aria-busy="true">
            <div className="ao-skeleton" style={{ height: 56, borderRadius: 12 }} />
            <div className="ao-skeleton" style={{ height: 90, borderRadius: 12 }} />
            <div className="ao-skeleton" style={{ height: 200, borderRadius: 12 }} />
          </div>
        )}
      </Card>
    );
  }

  const today = todayStr();
  const years = employee.hireDate ? completedYears(employee.hireDate, today) : null;
  const entitlement = employee.entitlementDays ?? 0;
  const dueForConfirmation = probationDue(employee, today);
  const moves = nextStages(employee.stage).filter((s) => s !== "Exited");
  const canExit = canTransition(employee.stage, "Exited");

  return (
    <div className="grid gap-3">
      <Card
        title={
          <span className="inline-flex items-center gap-2">
            <IdCard size={14} />
            Employee record
          </span>
        }
        right={
          <div className="flex items-center gap-2">
            <BtnGhost onClick={load} icon={RefreshCw}>Refresh</BtnGhost>
            <BtnGhost onClick={onBack} icon={ArrowLeft}>Back to directory</BtnGhost>
          </div>
        }
      >
        {error && (
          <div className="mb-3" role="alert" style={{ fontSize: 13, color: P.brick }}>{error}</div>
        )}

        {/* ── Header ── */}
        <div className="flex items-start gap-4 flex-wrap mb-4">
          <Avatar employee={employee} size={56} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="ao-disp" style={{ fontSize: 19, fontWeight: 650, color: P.ink }}>
                {displayName(employee)}
              </span>
              <StageChip stage={employee.stage} />
              {!isHeadcount(employee.stage) && <Pill color="var(--dim)">Off headcount</Pill>}
            </div>
            {employee.fullNameAr && (
              /* dir="rtl" so bidi resolves correctly, but aligned left so the
                 name sits under the English one instead of drifting to the far
                 edge of a wide container. */
              <div dir="rtl" style={{ fontSize: 13.5, color: P.inkSoft, marginTop: 2, textAlign: "left" }}>
                {employee.fullNameAr}
              </div>
            )}
            <div style={{ fontSize: 13, color: P.inkSoft, marginTop: 3 }}>
              {employee.jobTitle || "—"}
              {employee.grade ? ` · ${employee.grade}` : ""}
            </div>
            <div className="ao-mono" style={{ fontSize: 11.5, color: P.sub, marginTop: 2 }}>
              {employee.empId}
            </div>
          </div>
        </div>

        {dueForConfirmation && (
          <div
            className="flex items-center gap-2 mb-3"
            style={{ background: P.amberWash, border: `1px solid ${P.amber}`, borderRadius: 10, padding: "9px 12px", fontSize: 12.5, color: P.amber }}
          >
            <Clock size={13} />
            Probation ended {employee.probationEnd} — confirmation is overdue.
          </div>
        )}

        {/* ── Facts ── */}
        <Facts>
          <Fact icon={Mail} label="Work email" value={employee.workEmail} />
          <Fact icon={Phone} label="Phone" value={employee.phone} />
          <Fact icon={Building2} label="Account" value={[employee.account, employee.lob].filter(Boolean).join(" · ")} />
          <Fact icon={Building2} label="Department" value={employee.department} />
          <Fact icon={CalendarDays} label="Joined" value={employee.hireDate} />
          <Fact
            icon={Clock}
            label="Service"
            value={years === null ? "" : years === 0 ? "Under a year" : plural(years, "year")}
          />
          <Fact
            icon={ShieldCheck}
            label="Annual leave"
            value={entitlement ? `${entitlement} days / yr` : "Not yet eligible"}
            title="Law 12/2003 Art. 47 — 15 days once eligible at six months, 21 after a year, 30 after ten years or at age 50"
          />
          <Fact icon={Users2} label="Reports to" value={nameById[employee.directManagerId]} />
          {employee.functionalManagerId && (
            <Fact icon={Users2} label="Functional manager" value={nameById[employee.functionalManagerId]} />
          )}
          <Fact icon={Building2} label="Site" value={employee.workSite} />
          {employee.stage === "Probation" && <Fact icon={Clock} label="Confirmation due" value={employee.probationEnd} />}
          {employee.exitDate && (
            <Fact
              icon={UserMinus}
              label="Left"
              value={`${employee.exitDate} · ${EXIT_TYPES[employee.exitType]?.label ?? employee.exitType ?? ""}`}
            />
          )}
        </Facts>

        {/* The stored value is a code; the label is what a person reads. Records
            written before the codes existed hold free text, and fall through to
            being shown as-is rather than disappearing. */}
        {employee.exitReason && (
          <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1" style={{ fontSize: 12.5, color: P.inkSoft }}>
            <span style={{ color: P.sub }}>Exit reason:</span>
            <span>{EXIT_REASONS[employee.exitReason]?.label ?? employee.exitReason}</span>
            {EXIT_REASONS[employee.exitReason] && (
              <>
                <Pill color={isVoluntaryExit(employee.exitReason) ? P.petrol : P.amber}>
                  {attritionClass(employee.exitReason)}
                </Pill>
                <Pill color={EXIT_REASONS[employee.exitReason].rehireEligible ? P.green : P.brick}>
                  {EXIT_REASONS[employee.exitReason].rehireEligible ? "rehire eligible" : "no rehire"}
                </Pill>
              </>
            )}
          </div>
        )}

        {Array.isArray(employee.assets) && employee.assets.length > 0 && (
          <div className="mt-3 flex items-center gap-2 flex-wrap">
            <span className="ao-disp uppercase tracking-wide" style={{ fontSize: 10, color: P.sub, letterSpacing: 0.6 }}>
              Assets issued
            </span>
            {employee.assets.map((a) => (
              <Pill key={String(a)} color={P.petrol}>{String(a)}</Pill>
            ))}
          </div>
        )}

        {employee.dependents?.length > 0 && (
          <div className="mt-3">
            <span className="ao-disp uppercase tracking-wide" style={{ fontSize: 10, color: P.sub, letterSpacing: 0.6 }}>
              Dependents · medical
            </span>
            <div className="flex items-center gap-2 flex-wrap mt-1">
              {employee.dependents.map((d) => (
                <Pill key={d.id} color={d.medicalCovered ? P.green : P.sub}>
                  {d.name}{d.relation ? ` · ${d.relation}` : ""}
                </Pill>
              ))}
            </div>
          </div>
        )}

        {/* ── Lifecycle actions ── */}
        {moves.length > 0 && (
          <div className="mt-4 pt-3" style={{ borderTop: `1px solid ${P.line}` }}>
            <span className="ao-disp uppercase tracking-wide" style={{ fontSize: 10, color: P.sub, letterSpacing: 0.6 }}>
              Move to
            </span>
            <div className="flex items-center gap-2 flex-wrap mt-1.5">
              {moves.map((s) => (
                <BtnPrimary key={s} onClick={() => move(s)} disabled={busy}>
                  {s === "OnPip" ? "Open a PIP" : s}
                </BtnPrimary>
              ))}
              <span style={{ fontSize: 11, color: P.sub }}>
                Only these transitions are legal from {employee.stage}.
              </span>
            </div>
          </div>
        )}
      </Card>

      <Card title={<span className="inline-flex items-center gap-2"><Lock size={14} />Sensitive details</span>}>
        <SensitivePanel employeeId={employeeId} />
      </Card>

      {/* Exits get a form, not a quick-action button: they need a type and a
          last working day, and a record missing either is one somebody has to
          reconstruct from memory later. */}
      {canExit && (
        <ExitPanel employee={employee} onDone={async () => { await load(); onChanged?.(); }} />
      )}

      {/* Clearance appears once someone is leaving; steps unlock in sequence. */}
      {/* Training sits above clearance because it belongs to the working part of
          the journey — and readiness is the answer operations wants first. */}
      <TrainingPanel employeeId={employeeId} onChanged={load} />

      {/* Pay. Behind the same reveal as the identifiers, and for the same
          reason: it is the fact most likely to be misused if it travels
          further than it needs to. */}
      <PayPanel employeeId={employeeId} onChanged={load} />

      {["Notice", "Exited"].includes(employee.stage) && <ClearancePanel employeeId={employeeId} />}

      {/* ── Timeline ── */}
      <Card
        title={<span className="inline-flex items-center gap-2"><Clock size={14} />Timeline</span>}
        right={<span className="ao-mono" style={{ fontSize: 11, color: P.sub }}>{plural(timeline.length, "event")}</span>}
      >
        {timeline.length === 0 && <Muted>Nothing recorded yet.</Muted>}
        <div className="grid gap-0">
          {timeline.map((e, i) => {
            const meta = EVENT_STYLE[e.type] || EVENT_STYLE.NOTE;
            const Icon = meta.icon;
            const last = i === timeline.length - 1;
            return (
              <div key={e.id} className="flex gap-3">
                {/* Rail: the dot plus the line that connects it to the next event. */}
                <div className="flex flex-col items-center" style={{ width: 26, flexShrink: 0 }}>
                  <div
                    className="grid place-items-center"
                    style={{
                      width: 26, height: 26, borderRadius: 999,
                      background: `color-mix(in srgb, ${meta.color} 14%, transparent)`,
                      border: `1px solid color-mix(in srgb, ${meta.color} 36%, transparent)`,
                    }}
                  >
                    <Icon size={12} color={meta.color} />
                  </div>
                  {!last && <div style={{ width: 1, flex: 1, background: P.line, minHeight: 14 }} />}
                </div>

                <div className="min-w-0 flex-1" style={{ paddingBottom: last ? 0 : 14 }}>
                  <div className="flex items-center gap-2 flex-wrap">
                    <Pill color={meta.color}>{meta.label}</Pill>
                    <span style={{ fontSize: 12.5, color: P.ink, fontWeight: 500 }}>{e.title}</span>
                    <span className="flex-1" />
                    <span className="ao-mono" style={{ fontSize: 11, color: P.sub, whiteSpace: "nowrap" }}>
                      {e.effectiveDate || fmtStamp(e.at)}
                    </span>
                  </div>
                  {(e.fromVal || e.toVal) && e.fromVal !== e.toVal && (
                    <div className="ao-mono mt-0.5" style={{ fontSize: 11.5, color: P.sub }}>
                      {e.fromVal || "—"} → {e.toVal || "—"}
                    </div>
                  )}
                  {e.detail && (
                    <div className="mt-0.5" style={{ fontSize: 12.5, color: P.inkSoft, overflowWrap: "anywhere" }}>
                      {e.detail}
                    </div>
                  )}
                  {e.actorName && (
                    <div className="mt-0.5" style={{ fontSize: 11, color: P.sub }}>
                      by {e.actorName}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
}

/* The exit form. Consequence stated up front, both required fields enforced by
   the API as well — this form exists so the refusal is never the first thing
   the user learns about the requirement. */
function ExitPanel({ employee, onDone }) {
  const [exitType, setExitType] = useState("Resignation");
  const [lastDay, setLastDay] = useState("");
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  /* The reasons that belong to the chosen type. Changing the type clears the
     reason: "Resignation — Gross misconduct" is a record that contradicts
     itself, and a dependent dropdown that keeps its old value produces exactly
     that. */
  const reasons = exitReasonsFor(exitType);
  const meta = reason ? EXIT_REASONS[reason] : null;

  const submit = async () => {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/employees/${employee.id}/stage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stage: "Exited", exitType, effectiveDate: lastDay,
          exitReason: reason, exitNote: note,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Could not record the exit.");
      onDone();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title={<span className="inline-flex items-center gap-2"><UserMinus size={14} />Record an exit</span>}>
      {error && <div className="mb-3" role="alert" style={{ fontSize: 13, color: P.brick }}>{error}</div>}
      <div className="flex items-end gap-3 flex-wrap">
        <label className="grid gap-1">
          <span className="ao-disp uppercase tracking-wide" style={{ fontSize: 10, color: P.sub, letterSpacing: 0.6 }}>Type</span>
          <select
            value={exitType}
            onChange={(e) => { setExitType(e.target.value); setReason(""); }}
            style={{ fontSize: 12.5, padding: "7px 10px", borderRadius: 9, border: `1px solid ${P.line}`, background: P.card, color: P.ink }}
          >
            {EXIT_TYPE_CODES.map((t) => (
              <option key={t} value={t}>{EXIT_TYPES[t].label}</option>
            ))}
          </select>
        </label>
        <label className="grid gap-1">
          <span className="ao-disp uppercase tracking-wide" style={{ fontSize: 10, color: P.sub, letterSpacing: 0.6 }}>Last working day</span>
          <input
            type="date"
            value={lastDay}
            onChange={(e) => setLastDay(e.target.value)}
            style={{ fontSize: 12.5, padding: "6px 9px", borderRadius: 9, border: `1px solid ${P.line}`, background: "var(--well)", color: P.ink }}
          />
        </label>
        {/* A coded reason, not a text box. Two people typing "better offer" and
            "Better pay" produce an attrition report showing two causes with one
            occurrence each, which is worse than no report because it looks like
            one. The note underneath is where the specifics go. */}
        <label className="grid gap-1" style={{ minWidth: 240 }}>
          <span className="ao-disp uppercase tracking-wide" style={{ fontSize: 10, color: P.sub, letterSpacing: 0.6 }}>Reason</span>
          <select
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            style={{ fontSize: 12.5, padding: "7px 10px", borderRadius: 9, border: `1px solid ${P.line}`, background: P.card, color: P.ink }}
          >
            <option value="">Select a reason…</option>
            {reasons.map((c) => (
              <option key={c} value={c}>{EXIT_REASONS[c].label}</option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 flex-1" style={{ minWidth: 200 }}>
          <span className="ao-disp uppercase tracking-wide" style={{ fontSize: 10, color: P.sub, letterSpacing: 0.6 }}>Note</span>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Anything specific worth keeping on the record"
            style={{ fontSize: 12.5, padding: "6px 10px", borderRadius: 9, border: `1px solid ${P.line}`, background: "var(--well)", color: P.ink }}
          />
        </label>
        <button
          type="button"
          onClick={submit}
          disabled={busy || !lastDay || !reason}
          className="ao-disp uppercase tracking-wide font-semibold"
          style={{
            fontSize: 11.5, padding: "9px 16px", borderRadius: 10,
            border: `1px solid ${P.brick}`, background: P.brickWash, color: P.brick,
            cursor: busy || !lastDay || !reason ? "not-allowed" : "pointer",
            opacity: busy || !lastDay || !reason ? 0.5 : 1,
          }}
        >
          Record exit
        </button>
      </div>
      {/* What the chosen reason commits the record to. Rehire eligibility is the
          field a hiring manager checks two years from now, and it is decided
          here whether or not anyone says so — better said out loud. */}
      {meta && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1" style={{ fontSize: 11.5, marginTop: 9, color: P.sub }}>
          <span style={{ color: isVoluntaryExit(reason) ? P.petrol : P.amber, fontWeight: 550 }}>
            {isVoluntaryExit(reason) ? "Voluntary" : "Employer-initiated"}
          </span>
          <span>·</span>
          <span>Counts as {attritionClass(reason)} attrition</span>
          <span>·</span>
          <span style={{ color: meta.rehireEligible ? P.green : P.brick }}>
            {meta.rehireEligible ? "Rehire eligible" : "Not rehire eligible"}
          </span>
          {meta.requiresEvidence && (
            <>
              <span>·</span>
              <span style={{ color: P.amber }}>Attach the evidence to the record</span>
            </>
          )}
          {EXIT_TYPES[exitType]?.statute && (
            <>
              <span>·</span>
              <span style={{ opacity: 0.85 }}>{EXIT_TYPES[exitType].statute}</span>
            </>
          )}
        </div>
      )}
      <div style={{ fontSize: 11, color: P.amber, marginTop: 9 }}>
        Exited is terminal — a returning employee gets a new record, because reusing
        this one would corrupt service years, leave accrual and disciplinary chains.
      </div>
    </Card>
  );
}


/* Training. The readiness verdict leads, because "can this person take contacts
   today" is the question the screen exists to answer — the course list is the
   evidence for it, not the point of it. */
function TrainingPanel({ employeeId, onChanged }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState("");

  const load = useCallback(async () => {
    setError("");
    try {
      const res = await fetch(`/api/employees/${employeeId}/training`);
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Could not load training.");
      setData(json);
    } catch (err) { setError(err.message); setData({ records: [] }); }
  }, [employeeId]);

  useEffect(() => { load(); }, [load]);

  const record = async (type, state) => {
    setBusy(true); setError("");
    try {
      const res = await fetch(`/api/employees/${employeeId}/training`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type, state,
          completedOn: state === "completed" ? todayStr() : "",
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Could not record it.");
      setAdding("");
      await load();
      onChanged?.();
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  };

  const STATUS = {
    completed: { color: P.green, label: "Valid" },
    expiringSoon: { color: P.amber, label: "Expiring" },
    expired: { color: P.brick, label: "Lapsed" },
    planned: { color: P.sub, label: "Planned" },
    inProgress: { color: P.petrol, label: "In progress" },
    failed: { color: P.brick, label: "Failed" },
    cancelled: { color: P.sub, label: "Cancelled" },
  };

  const ready = data?.readiness;
  const recorded = new Set((data?.records ?? []).map((r) => r.type));
  const addable = Object.keys(TRAINING_TYPES).filter((t) => !recorded.has(t));

  return (
    <Card title={<span className="inline-flex items-center gap-2"><GraduationCap size={14} />Training</span>}
      right={<BtnGhost onClick={load} icon={RefreshCw} disabled={busy}>Refresh</BtnGhost>}>
      {error && <div className="mb-3" role="alert" style={{ fontSize: 13, color: P.brick }}>{error}</div>}

      {!data && <div className="ao-skeleton" style={{ height: 64, borderRadius: 12 }} />}

      {ready && (
        <div
          className="flex items-center gap-3 flex-wrap mb-3"
          style={{
            background: ready.ready ? P.greenWash : P.amberWash,
            border: `1px solid ${ready.ready ? P.green : P.amber}`,
            borderRadius: 12, padding: "10px 13px",
          }}
        >
          {ready.ready ? <ShieldCheck size={15} color={P.green} /> : <AlertTriangle size={15} color={P.amber} />}
          <div className="flex-1 min-w-0">
            <div style={{ fontSize: 12.5, fontWeight: 600, color: ready.ready ? P.green : P.amber }}>
              {ready.ready ? "Cleared for live contacts" : "Not cleared for live contacts"}
            </div>
            <div style={{ fontSize: 11.5, color: P.inkSoft }}>{ready.reason}</div>
          </div>
        </div>
      )}

      {data?.records?.length > 0 && (
        <div className="grid gap-1.5">
          {data.records.map((r) => {
            const meta = STATUS[r.status] ?? STATUS.planned;
            return (
              <div key={r.type} className="flex items-center gap-2.5 flex-wrap"
                style={{ background: "var(--well)", border: `1px solid ${P.line}`, borderRadius: 10, padding: "8px 11px" }}>
                <Pill color={meta.color}>{meta.label}</Pill>
                <span style={{ fontSize: 12.5, color: P.ink }}>{r.label}</span>
                {r.blocksProduction && (
                  <span style={{ fontSize: 10.5, color: P.sub }}>blocks the floor</span>
                )}
                <span className="flex-1" />
                {r.completedOn && (
                  <span className="ao-mono" style={{ fontSize: 11, color: P.sub }}>
                    {r.completedOn}{r.expiresOn ? ` → ${r.expiresOn}` : ""}
                  </span>
                )}
                {r.state !== "completed" && (
                  <BtnGhost onClick={() => record(r.type, "completed")} disabled={busy}>Mark complete</BtnGhost>
                )}
                {r.status === "expired" && (
                  <BtnGhost onClick={() => record(r.type, "completed")} disabled={busy}>Renew</BtnGhost>
                )}
              </div>
            );
          })}
        </div>
      )}

      {data && !data.records?.length && <Muted>Nothing recorded yet.</Muted>}

      {addable.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap mt-3">
          <select
            value={adding}
            onChange={(e) => setAdding(e.target.value)}
            aria-label="Add a course"
            style={{ fontSize: 12, padding: "6px 10px", borderRadius: 9, border: `1px solid ${P.line}`, background: P.card, color: P.inkSoft }}
          >
            <option value="">Add a course…</option>
            {addable.map((t) => <option key={t} value={t}>{TRAINING_TYPES[t].label}</option>)}
          </select>
          <BtnGhost onClick={() => record(adding, "planned")} disabled={busy || !adding}>Plan</BtnGhost>
          <BtnGhost onClick={() => record(adding, "completed")} disabled={busy || !adding}>Record as done</BtnGhost>
        </div>
      )}
    </Card>
  );
}

/* The exit checklist. The API refuses out-of-order ticks with the reason, so
   this panel just shows state and passes refusals through verbatim. */
/* Salary: the current figure, its history, and a way to record the next one.

   Deliberately reveal-on-demand, like the identifiers above it. Someone opens
   an employee record twenty times a week to check a manager or a hire date, and
   a salary sitting in the corner of that screen is a salary read by everyone
   who has ever glanced over a shoulder in an open-plan office.

   Every change is a new version rather than an edit. "What were they earning
   last March" is a question payroll, an auditor and a labour court all ask, and
   a field that overwrites cannot answer it at all — so the history is the
   feature and the current figure is just its first row. */
function PayPanel({ employeeId, onChanged }) {
  const [state, setState] = useState("idle"); // idle | loading | shown | denied | error
  const [data, setData] = useState(null);
  const [message, setMessage] = useState("");
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ amount: "", effectiveFrom: todayStr(), reason: "Merit", note: "" });
  const [busy, setBusy] = useState(false);

  const load = async (quiet) => {
    if (!quiet) setState("loading");
    try {
      const res = await fetch(`/api/employees/${employeeId}/compensation`);
      const json = await res.json().catch(() => ({}));
      if (res.status === 403) { setState("denied"); setMessage(json.error || "Your role cannot view pay."); return; }
      if (!res.ok) throw new Error(json.error || "Could not load pay.");
      setData(json);
      setState("shown");
    } catch (e) {
      setState("error");
      setMessage(e.message);
    }
  };

  const save = async () => {
    setBusy(true);
    setMessage("");
    try {
      const res = await fetch(`/api/employees/${employeeId}/compensation`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(form),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "The change was refused.");
      setAdding(false);
      setForm({ amount: "", effectiveFrom: todayStr(), reason: "Merit", note: "" });
      await load(true);
      onChanged?.();
    } catch (e) {
      setMessage(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card
      title={<span className="inline-flex items-center gap-2"><Banknote size={14} />Pay</span>}
      right={
        state === "shown" ? (
          <span className="ao-mono" style={{ fontSize: 11, color: P.sub }}>
            {plural(data?.records?.length ?? 0, "version")}
          </span>
        ) : null
      }
    >
      {state === "idle" && (
        <div className="flex items-center gap-3 flex-wrap">
          <BtnGhost icon={Eye} onClick={() => load()}>Reveal pay</BtnGhost>
          <Muted>Hidden by default. Revealing is recorded against your name.</Muted>
        </div>
      )}
      {state === "loading" && <Muted>Loading…</Muted>}
      {(state === "denied" || state === "error") && (
        <div style={{ fontSize: 12.5, color: state === "denied" ? P.sub : P.brick }}>{message}</div>
      )}

      {state === "shown" && (
        <div className="grid gap-3">
          {!data.current && (
            <Muted>
              No salary on record. Until one is entered, this person's payslips cannot be issued — the payslip says so
              rather than showing zero.
            </Muted>
          )}

          {data.current && (
            <div className="flex items-baseline gap-3 flex-wrap">
              <span className="ao-mono font-semibold" style={{ fontSize: 22, color: P.ink }}>
                {data.current.currency} {data.current.display}
              </span>
              <span style={{ fontSize: 12, color: P.sub }}>
                per month, from {data.current.effectiveFrom} · {data.current.reason}
              </span>
            </div>
          )}

          {data.records.length > 1 && (
            <div className="grid gap-1">
              {data.records.slice(1).map((r) => (
                <div key={r.id} className="flex items-baseline gap-3" style={{ fontSize: 12, color: P.sub }}>
                  <span className="ao-mono" style={{ minWidth: 88 }}>{r.effectiveFrom}</span>
                  <span className="ao-mono">{r.display}</span>
                  <span>{r.reason}</span>
                  {r.changePct !== null && (
                    <span style={{ color: r.changePct > 0 ? P.green : P.amber }}>
                      {r.changePct > 0 ? "+" : ""}{r.changePct}%
                    </span>
                  )}
                  {r.voided && <span style={{ color: P.brick }}>voided</span>}
                </div>
              ))}
            </div>
          )}

          {!adding && (
            <div>
              <BtnGhost icon={Plus} onClick={() => setAdding(true)}>Record a change</BtnGhost>
            </div>
          )}

          {adding && (
            <div className="grid gap-2 md:grid-cols-4 ao-rise">
              <Field label="Monthly salary">
                <TInput
                  value={form.amount}
                  onChange={(e) => setForm({ ...form, amount: e.target.value })}
                  placeholder="9000"
                  inputMode="decimal"
                />
              </Field>
              <Field label="Effective from">
                <TInput type="date" value={form.effectiveFrom} onChange={(e) => setForm({ ...form, effectiveFrom: e.target.value })} />
              </Field>
              <Field label="Reason">
                <TSelect value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })}>
                  {(data.reasons ?? []).map((r) => <option key={r} value={r}>{r}</option>)}
                </TSelect>
              </Field>
              <Field label="Note (optional)">
                <TInput value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
              </Field>
              <div className="md:col-span-4 flex items-center gap-2 flex-wrap">
                <BtnPrimary onClick={save} disabled={busy || !form.amount}>Record</BtnPrimary>
                <BtnGhost onClick={() => { setAdding(false); setMessage(""); }}>Cancel</BtnGhost>
                {message && <span style={{ fontSize: 12.5, color: P.brick }}>{message}</span>}
                <Muted>
                  A decrease must be labelled a Demotion, Adjustment or Correction — an unlabelled cut is far more often
                  a dropped digit than an intended one.
                </Muted>
              </div>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

function ClearancePanel({ employeeId }) {
  const [steps, setSteps] = useState(null);
  const [complete, setComplete] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch(`/api/employees/${employeeId}/clearance`);
    const json = await res.json().catch(() => ({}));
    if (res.ok) { setSteps(json.steps); setComplete(json.complete); }
  }, [employeeId]);
  useEffect(() => { load(); }, [load]);

  const tick = async (key) => {
    setBusy(true); setError("");
    try {
      const res = await fetch(`/api/employees/${employeeId}/clearance`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Could not complete the step.");
      setSteps(json.steps); setComplete(json.complete);
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  };

  if (!steps) return null;
  return (
    <Card title={<span className="inline-flex items-center gap-2"><ShieldCheck size={14} />Exit clearance</span>}
      right={complete && <Pill color={P.green}>Complete</Pill>}>
      {error && <div className="mb-2" role="alert" style={{ fontSize: 12.5, color: P.brick }}>{error}</div>}
      <div className="grid gap-2">
        {steps.map((s) => (
          <div key={s.key} className="flex items-center gap-3 p-2.5"
            style={{ background: P.mist, borderRadius: 10, borderLeft: `3px solid ${s.state === "done" ? P.green : P.line}` }}>
            <div className="min-w-0 flex-1">
              <div style={{ fontSize: 12.5, fontWeight: 600, color: s.state === "done" ? P.sub : P.ink }}>{s.label}</div>
              <div style={{ fontSize: 11, color: P.sub }}>
                {s.state === "done" ? `Done by ${s.doneByName}` : `${s.owner}${s.dependsOn ? " · unlocks in sequence" : ""}`}
              </div>
            </div>
            {s.state !== "done" && (
              <BtnGhost onClick={() => tick(s.key)} disabled={busy}>Mark done</BtnGhost>
            )}
          </div>
        ))}
      </div>
      <div style={{ fontSize: 11, color: P.sub, marginTop: 8 }}>
        Equipment cannot be collected before the handover is confirmed; HR signs off last.
      </div>
    </Card>
  );
}
