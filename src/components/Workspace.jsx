"use client";

/* The staff workspace — the tabbed app, now server-backed.

   Ported from the localStorage-era App.jsx: same views, same role gates, but
   every mutation goes through the API (which re-settles deduction caps and
   audits), and the state shown is always the server's post-write truth.
   The glass restyle of these inner views rides on the shared kit later; the
   workspace keeps its proven light look for now, painted over the dark shell. */

import { useEffect, useMemo, useState } from "react";
import { flushSync } from "react-dom";
import { signOut } from "next-auth/react";
import {
  LayoutDashboard,
  ClipboardPlus,
  UploadCloud,
  Inbox,
  CheckCheck,
  Users,
  IdCard,
  MonitorPlay,
  Table2,
  UserCog,
  Settings2,
  ScrollText,
  Clock3,
  Scale,
  ShieldAlert,
  TriangleAlert,
  Plus,
  CircleCheck,
  CircleAlert,
  LogOut,
  X,
  UserPlus,
  UserMinus,
  Gauge,
  TrendingUp,
  KeyRound,
} from "lucide-react";

import { useServerData } from "../hooks/useServerData.js";
import { useCountUp } from "../hooks/useCountUp.js";
import { P, accColor, alpha } from "../lib/tokens.js";
import { BRAND } from "../lib/brand";
import Logo from "./Logo";
import ThemeToggle from "./ThemeToggle";
import { todayStr, daysAgo, monthOf } from "../lib/dates.js";
import { fmtMin } from "../lib/format.js";
import { statusOf, computeEscalations, countsForDiscipline } from "../lib/engine.js";
import { downloadCsv } from "../lib/csv.js";
import { TABS_FOR, ROLE_LABEL, can } from "../lib/auth.js";

import { TInput, BtnPrimary, BtnGhost, SectionTitle, Muted } from "./ui/index.jsx";
import Tip from "./ui/Tip.jsx";
import GuideButton from "./GuideButton.jsx";
import LogForm from "./LogForm.jsx";
import EntryCard from "./EntryCard.jsx";
import Dashboard from "./Dashboard.jsx";
import TriageGate from "./TriageGate.jsx";
import RtaUploader from "./RtaUploader.jsx";
import AgentProfiles from "./AgentProfiles.jsx";
import DcmEditor from "./DcmEditor.jsx";
import UserManagement from "./UserManagement.jsx";
import SettingsView from "./SettingsView.jsx";
import AuditTrail from "./AuditTrail.jsx";
import People from "./People.jsx";
import FloorView from "./FloorView.jsx";
import RequestInbox from "./RequestInbox.jsx";
import WfmPlanner from "./WfmPlanner.jsx";
import Insights from "./Insights.jsx";
import HelpDesk from "./HelpDesk.jsx";
import { navFor, sectionOfTab, stagesOf } from "../lib/journey.js";

/* What each screen is called and what it looks like. Where it sits is decided
   by journey.js — this map is only the label and the icon, so renaming a screen
   is one edit and moving it is another, independently. */
const TAB_META = {
  dashboard: { label: "Overview", icon: LayoutDashboard },
  joining: { label: "New joiners", icon: UserPlus },
  floor: { label: "Live floor", icon: MonitorPlay },
  requests: { label: "Requests", icon: Scale },
  approvals: { label: "My approvals", icon: CheckCheck, badge: "approvals" },
  log: { label: "Log an event", icon: ClipboardPlus },
  rta: { label: "Import adherence", icon: UploadCloud },
  wfm: { label: "Planning", icon: Gauge },
  triage: { label: "Case review", icon: Inbox, badge: "review" },
  agents: { label: "Scorecards", icon: Users },
  leaving: { label: "Leavers", icon: UserMinus },
  people: { label: "Directory", icon: IdCard },
  roster: { label: "All employees", icon: Table2 },
  insights: { label: "Insights", icon: TrendingUp },
  audit: { label: "Audit trail", icon: ScrollText },
  helpdesk: { label: "Help desk", icon: KeyRound },
  matrix: { label: "Discipline matrix", icon: Table2 },
  users: { label: "Accounts", icon: UserCog },
  settings: { label: "Settings", icon: Settings2 },
};

export default function Workspace({ initial, me, themeIntent }) {
  const {
    data,
    error,
    notice,
    clearError,
    clearNotice,
    addEntry,
    commitRta,
    patchEntry,
    deleteEntry,
    restoreEntry,
    purgeEntry,
    resolveAppeal,
    decide,
    loadSamples,
    setDcm,
    setAccounts,
    setTls,
    createUser,
    resetUser,
    setUserRole,
    deleteUser,
    factoryReset,
  } = useServerData(initial);

  const allowedTabs = TABS_FOR[me.role] || [];
  const [tab, setTab] = useState(allowedTabs[0] || "dashboard");

  /* Tab changes cross-fade through the View Transitions API where it exists;
     browsers without it just get the instant switch they always had. */
  const goTab = (next) => {
    if (next === tab) return;
    if (typeof document !== "undefined" && document.startViewTransition) {
      document.startViewTransition(() => flushSync(() => setTab(next)));
    } else {
      setTab(next);
    }
  };
  const [acc, setAcc] = useState("All");
  const [range, setRange] = useState("all"); // all | 30 | month
  const [showForm, setShowForm] = useState(false);
  const [logFilter, setLogFilter] = useState("all"); // all | review | open
  const [assigneeFilter, setAssigneeFilter] = useState("All");
  const [query, setQuery] = useState("");
  const LOG_PAGE = 50;
  const [logLimit, setLogLimit] = useState(LOG_PAGE);

  useEffect(() => {
    if (!allowedTabs.includes(tab)) setTab(allowedTabs[0] || "dashboard");
  }, [me.role]); // eslint-disable-line react-hooks/exhaustive-deps

  // Any change to the filters is a fresh view — start back at the first page so
  // a stale "show more" count can't carry over.
  useEffect(() => {
    setLogLimit(LOG_PAGE);
  }, [logFilter, assigneeFilter, query, acc, range]);

  // Success toasts hang around briefly, then leave on their own.
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(clearNotice, 3800);
    return () => clearTimeout(t);
  }, [notice, clearNotice]);

  /* ── Derived views ─────────────────────────────────────────────────────── */

  const scoped = useMemo(() => {
    const inRange = (e) => {
      if (range === "30") return daysAgo(e.date) <= 30;
      if (range === "month") return monthOf(e.date) === monthOf(todayStr());
      return true;
    };
    return data.entries.filter((e) => (acc === "All" || e.account === acc) && inRange(e));
  }, [data.entries, acc, range]);

  // Escalation flags ignore the date range — a 60-day threshold can't be judged
  // through a 30-day window.
  const escalations = useMemo(
    () => computeEscalations(data.entries.filter((e) => acc === "All" || e.account === acc)),
    [data.entries, acc]
  );

  // Voided cases are excluded from every pipeline set and metric; they live only
  // in the Voided archive filter below.
  const scopedLive = useMemo(() => scoped.filter((e) => !e.voided), [scoped]);
  const voidedLog = useMemo(() => scoped.filter((e) => e.voided), [scoped]);
  const live = useMemo(() => scopedLive.filter((e) => e.stage !== "dismissed"), [scopedLive]);
  const pendingReview = useMemo(() => scopedLive.filter((e) => e.stage === "review"), [scopedLive]);
  const pendingOps = useMemo(
    () => scopedLive.filter((e) => e.stage === "active" && e.notified && !e.opsConfirmed),
    [scopedLive]
  );
  const pendingHr = useMemo(
    () => scopedLive.filter((e) => e.stage === "active" && e.hrNeeded && !e.hrConfirmed && e.opsConfirmed),
    [scopedLive]
  );
  const pendingAppeals = useMemo(() => scopedLive.filter((e) => e.appealState === "pending"), [scopedLive]);

  // Hours were lost whether or not a manager has ruled, so triage-stage cases
  // count. Deductions are only scheduled once a case is escalated.
  const hoursLost = live.reduce((s, e) => s + (e.missingMin || 0), 0);
  const disciplinaryCount = live.filter((e) => e.disciplinary).length;
  const deductionPool = scoped.filter(countsForDiscipline).reduce((s, e) => s + (e.deductionApplied || 0), 0);
  const activeEscalations = pendingOps.length + pendingHr.length;

  /* ── Mutations (server-backed; `by` comes from the session server-side) ── */

  const bulkDecide = (ids, stage, _by, assignee, comment) => decide(ids, stage, assignee, comment);
  const decideOne = (id, stage, _by, assignee, comment) => decide([id], stage, assignee, comment);

  const resetAll = async () => {
    if (!window.confirm("Factory reset: erases every case, user and audit row, then reseeds the demo baseline. Continue?")) return;
    try {
      await factoryReset();
    } catch {
      return; // error strip already shows the reason
    }
    // Seeded users carry fresh ids — this session is orphaned by design.
    signOut({ callbackUrl: "/login" });
  };

  const empty = data.entries.length === 0;
  const q = query.trim().toLowerCase();
  // The Voided filter shows the archive; every other filter works over the
  // live (non-voided) set.
  const logBase = logFilter === "voided" ? voidedLog : scopedLive;
  const visibleLog = logBase.filter((e) => {
    if (logFilter === "review" && e.stage !== "review") return false;
    if (logFilter === "open") {
      const s = statusOf(e);
      if (s === "Closed" || s === "Dismissed") return false;
    }
    if (assigneeFilter !== "All") {
      if (assigneeFilter === "Unassigned" ? (e.assignee || "") !== "" : e.assignee !== assigneeFilter) return false;
    }
    if (
      q &&
      !(e.email || "").toLowerCase().includes(q) &&
      !(e.empId || "").toLowerCase().includes(q) &&
      !(e.agentName || "").toLowerCase().includes(q)
    )
      return false;
    return true;
  });

  const badges = { review: pendingReview.length, approvals: pendingOps.length + pendingHr.length };
  /* Grouped by journey phase rather than listed flat. A flat list of fifteen
     screens with the discipline matrix in the middle teaches a new user that
     the product is about violations. */
  /* Headcount comes from the server already scoped to what this actor may see,
     so a lead's tiles and the screens they link to cannot disagree. */
  const headcount = data.headcount ?? {};
  const inPhase = (id) => stagesOf(id).reduce((n, st) => n + (headcount[st] ?? 0), 0);

  const nav = navFor(allowedTabs, TAB_META);
  const section = sectionOfTab(tab);
  // "people" is in this list for a different reason than the rest: the others
  // are admin screens, but the directory genuinely has its own data source and
  // is meaningful with an empty case ledger.
  const showEmpty = empty && !(tab === "log" && showForm) && !["settings", "matrix", "rta", "users", "people", "roster", "joining", "leaving", "floor", "requests", "wfm", "insights", "helpdesk"].includes(tab);

  return (
    <div className="ao-body" style={{ minHeight: "100vh", background: P.paper, color: P.ink }}>
      {/* ── Header band — sticky glass over the aurora ── */}
      <header
        className="ao-glass"
        style={{ background: "var(--hdr-bg)", borderBottom: `1px solid ${P.line}`, position: "sticky", top: 0, zIndex: 40 }}
      >
        <div className="mx-auto px-4 py-4" style={{ maxWidth: 1320 }}>
          <div className="flex items-center gap-3 flex-wrap">
            <Logo size={34} subtitle={`${BRAND.tagline} · ${BRAND.org}`} />
            <span className="flex-1" />
            <GuideButton role={me.role} />
            <Tip label="Switch between dark, light and following your system" side="bottom">
              <ThemeToggle initial={themeIntent} />
            </Tip>
            <UserChip me={me} onLogout={() => signOut({ callbackUrl: "/login" })} />
          </div>

          <div className="flex items-center gap-2 flex-wrap mt-3">
            {["All", ...data.accounts].map((a) => (
              <button
                key={a}
                onClick={() => setAcc(a)}
                className="ao-disp uppercase tracking-wide font-semibold transition ao-glow"
                style={{
                  fontSize: 12,
                  padding: "5px 12px",
                  borderRadius: 999,
                  cursor: "pointer",
                  color: acc === a ? "var(--chip-on-text)" : "var(--hdr-text)",
                  background: acc === a ? "var(--chip-on-bg)" : "transparent",
                  border: `1px solid ${acc === a ? "var(--chip-on-bg)" : "var(--hdr-line)"}`,
                  "--glow": a === "All" ? "color-mix(in srgb, var(--signal) 60%, transparent)" : `${alpha(accColor(a), 0.67)}`,
                }}
              >
                {a !== "All" && (
                  <span
                    className={acc === a ? "ao-pulse" : ""}
                    style={{ width: 7, height: 7, borderRadius: 999, background: accColor(a), display: "inline-block", marginRight: 6 }}
                  />
                )}
                {a}
              </button>
            ))}
            <span className="flex-1" />
            <select
              value={range}
              onChange={(e) => setRange(e.target.value)}
              className="ao-disp uppercase tracking-wide font-semibold"
              style={{ fontSize: 12, padding: "5px 8px", borderRadius: 6, background: "transparent", color: "var(--hdr-text)", border: "1px solid var(--hdr-line)" }}
            >
              <option value="all" style={{ color: P.ink }}>All time</option>
              <option value="30" style={{ color: P.ink }}>Last 30 days</option>
              <option value="month" style={{ color: P.ink }}>This month</option>
            </select>
          </div>
        </div>
      </header>

      {/* Server error strip */}
      {error && (
        <div className="mx-auto px-4" style={{ maxWidth: 1320 }}>
          <div
            className="flex items-center gap-2 mt-3 p-3"
            style={{ background: P.brickWash, border: `1px solid ${alpha(P.brick, 0.4)}`, borderRadius: 8 }}
            role="alert"
          >
            <CircleAlert size={15} color={P.brick} style={{ flexShrink: 0 }} />
            <span style={{ fontSize: 13, color: P.inkSoft, flex: 1 }}>{error}</span>
            <button onClick={clearError} aria-label="Dismiss error" style={{ border: "none", background: "none", cursor: "pointer", color: P.sub, display: "flex" }}>
              <X size={14} />
            </button>
          </div>
        </div>
      )}

      <div className="mx-auto px-4 pb-16 flex gap-5 items-start" style={{ maxWidth: 1320 }}>
        {/* ── Sidebar (sticks below the glass header) ── */}
        <nav className="hidden md:block py-4" style={{ width: 190, flexShrink: 0, position: "sticky", top: 118 }}>
          <div className="grid gap-3">
            {nav.map((s) => (
              <div key={s.id} className="grid gap-1">
                <div
                  className="ao-disp uppercase tracking-wide"
                  style={{ fontSize: 9.5, color: P.sub, letterSpacing: 0.9, padding: "0 12px 2px", opacity: 0.75 }}
                >
                  {s.label}
                </div>
                {s.items.map((n) => (
                  <NavItem key={n.id} item={n} active={tab === n.id} badge={badges[n.badge] || 0} onClick={() => goTab(n.id)} />
                ))}
              </div>
            ))}
          </div>
          {can(me, "log") && (
            <div className="mt-4">
              <BtnPrimary
                icon={Plus}
                onClick={() => {
                  goTab("log");
                  setShowForm(true);
                }}
              >
                Log case
              </BtnPrimary>
            </div>
          )}
        </nav>

        {/* ── Main ── */}
        <main className="flex-1 min-w-0 pb-4">
          {/* Mobile nav */}
          <div className="md:hidden flex gap-2 overflow-x-auto mt-4 pb-1">
            {nav.flatMap((s) => s.items).map((n) => (
              <NavChip key={n.id} item={n} active={tab === n.id} badge={badges[n.badge] || 0} onClick={() => goTab(n.id)} />
            ))}
          </div>

          {/* The journey strip belongs to whoever works the journey. Gated on
              holding the overview screen rather than on naming roles: the old
              `role !== "WFM"` check meant every role added later inherited a
              headcount and open-case count by default, and IT — an
              account-recovery desk — was shown both. */}
          {allowedTabs.includes("dashboard") && (
            <div className="grid grid-cols-2 lg:grid-cols-6 gap-3 mt-4">
              {/* Where people are in the journey, first — the strip sits above
                  every screen, so it sets what the product appears to be about.
                  Conduct keeps a tile because it is real work; it is no longer
                  the first four. */}
              <KPI label="Headcount" value={inPhase("work")} icon={Users} tone={P.petrol} hint="Everyone active on the floor right now — not counting joiners or leavers" />
              <KPI
                label="Joining"
                hint="Accepted offers, onboarding and anyone still inside probation"
                value={inPhase("join")}
                icon={UserPlus}
                tone={inPhase("join") ? P.petrol : P.sub}
                onClick={allowedTabs.includes("joining") ? () => goTab("joining") : undefined}
              />
              <KPI
                label="On a plan"
                hint="People on a performance plan or suspended — the ones needing attention"
                value={inPhase("grow")}
                icon={TriangleAlert}
                tone={inPhase("grow") ? P.amber : P.green}
                onClick={allowedTabs.includes("triage") ? () => goTab("triage") : undefined}
              />
              <KPI
                label="Leaving"
                hint="Serving notice — clearance is not finished until their last day"
                value={headcount.Notice ?? 0}
                icon={UserMinus}
                tone={(headcount.Notice ?? 0) ? P.amber : P.green}
                onClick={allowedTabs.includes("leaving") ? () => goTab("leaving") : undefined}
              />
              <KPI
                label="Open cases"
                hint="Logged conduct or attendance cases nobody has reviewed yet"
                value={pendingReview.length}
                icon={Inbox}
                tone={pendingReview.length ? P.brick : P.green}
                onClick={allowedTabs.includes("triage") ? () => goTab("triage") : undefined}
              />
              <KPI
                label="Awaiting you"
                hint="Decisions blocked on your sign-off — nothing moves until you act"
                value={activeEscalations}
                icon={CheckCheck}
                tone={activeEscalations ? P.amber : P.green}
                onClick={allowedTabs.includes("approvals") ? () => goTab("approvals") : undefined}
              />
            </div>
          )}

          {/* key={tab}: remount on tab change so the entrance animation replays */}
          <div className="mt-4 ao-rise" key={tab} style={{ viewTransitionName: "panel" }}>
            {showEmpty ? (
              <EmptyState
                canLog={can(me, "log")}
                canSamples={can(me, "admin")}
                onLog={() => {
                  goTab("log");
                  setShowForm(true);
                }}
                onSamples={loadSamples}
              />
            ) : null}

            {tab === "dashboard" && !empty && (
              <Dashboard entries={scoped} accounts={acc === "All" ? data.accounts : [acc]} escalations={escalations} />
            )}

            {tab === "log" && (
              <div className="grid gap-4">
                {showForm && can(me, "log") ? (
                  <LogForm data={data} defaultAccount={acc} onAdd={addEntry} onCancel={() => setShowForm(false)} />
                ) : (
                  !empty &&
                  can(me, "log") && (
                    <div>
                      <BtnPrimary icon={Plus} onClick={() => setShowForm(true)}>
                        Log case
                      </BtnPrimary>
                    </div>
                  )
                )}

                {!empty && (
                  <>
                    <div className="flex items-center gap-2 flex-wrap">
                      {[
                        ["all", "All"],
                        ["review", "Pending review"],
                        ["open", "Open only"],
                        ...(voidedLog.length ? [["voided", `Voided (${voidedLog.length})`]] : []),
                      ].map(([f, lbl]) => (
                        <button
                          key={f}
                          onClick={() => setLogFilter(f)}
                          className="ao-disp uppercase tracking-wide font-semibold"
                          style={{
                            fontSize: 11,
                            padding: "3px 10px",
                            borderRadius: 999,
                            cursor: "pointer",
                            border: `1px solid ${logFilter === f ? (f === "voided" ? P.sub : P.petrol) : P.line}`,
                            color: logFilter === f ? "#fff" : P.sub,
                            background: logFilter === f ? (f === "voided" ? P.sub : P.petrol) : "transparent",
                          }}
                        >
                          {lbl}
                        </button>
                      ))}
                      <select
                        value={assigneeFilter}
                        onChange={(e) => setAssigneeFilter(e.target.value)}
                        style={{ fontSize: 12, color: P.inkSoft, border: `1px solid ${P.line}`, borderRadius: 999, padding: "3px 8px", background: "var(--well)" }}
                      >
                        <option>All</option>
                        <option>Unassigned</option>
                        {data.tls.map((t) => (
                          <option key={t}>{t}</option>
                        ))}
                      </select>
                      <TInput
                        placeholder="Search agent / ID…"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        style={{ width: 170, fontSize: 12.5, padding: "4px 10px", borderRadius: 999 }}
                      />
                      <span className="ao-mono" style={{ fontSize: 11, color: P.sub }}>
                        {Math.min(logLimit, visibleLog.length)} of {visibleLog.length} in view
                      </span>
                    </div>

                    <div className="grid gap-2 ao-stagger">
                      {visibleLog.length === 0 && <Muted>Nothing matches these filters.</Muted>}
                      {visibleLog.slice(0, logLimit).map((e) => (
                        <EntryCard key={e.id} e={e} tls={data.tls} me={me} onPatch={patchEntry} onDelete={deleteEntry} onDecide={decideOne} onRestore={restoreEntry} onPurge={purgeEntry} onResolveAppeal={resolveAppeal} />
                      ))}
                    </div>

                    {/* The engine always sees the whole ledger; this only caps how
                        many rows are painted, so a long history stays responsive. */}
                    {visibleLog.length > logLimit && (
                      <div className="flex justify-center mt-1">
                        <BtnGhost onClick={() => setLogLimit((n) => n + LOG_PAGE)}>
                          Show more · {visibleLog.length - logLimit} older case{visibleLog.length - logLimit === 1 ? "" : "s"}
                        </BtnGhost>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}

            {tab === "rta" && can(me, "upload") && <RtaUploader data={data} me={me} onCommit={commitRta} />}

            {tab === "insights" && <Insights accounts={data.accounts} />}

            {tab === "helpdesk" && can(me, "issueReset") && <HelpDesk canRevoke={can(me, "revokeReset")} />}

            {tab === "wfm" && (
              <WfmPlanner
                me={me}
                accounts={data.accounts}
                canWrite={can(me, "wfmWrite")}
                canRoster={can(me, "scheduleWrite")}
              />
            )}

            {tab === "triage" && !empty && (
              <TriageGate
                rows={pendingReview}
                tls={data.tls}
                me={me}
                canAct={can(me, "triage")}
                onPatch={patchEntry}
                onDelete={deleteEntry}
                onDecide={decideOne}
                onBulk={bulkDecide}
              />
            )}

            {tab === "approvals" && !empty && (
              <div className="grid gap-5">
                <Queue
                  title="OPS review queue"
                  hint="Escalated cases awaiting operational manager sign-off."
                  rows={pendingOps}
                  tone={P.amber}
                  tls={data.tls}
                  me={me}
                  onPatch={patchEntry}
                  onDelete={deleteEntry}
                />
                <Queue
                  title="HR execution queue"
                  hint="OPS-approved cases awaiting HR: wage deductions, warning letters and investigations. Completing one requires an HR case reference — and flags the case for the agent's digital acknowledgement."
                  rows={pendingHr}
                  tone={P.brick}
                  tls={data.tls}
                  me={me}
                  onPatch={patchEntry}
                  onDelete={deleteEntry}
                />
                <Queue
                  title="Appeals queue"
                  hint="Agents who have contested a finalized case. Uphold the original decision, or overturn it — overturning dismisses the case so it stops counting."
                  rows={pendingAppeals}
                  tone={P.amber}
                  tls={data.tls}
                  me={me}
                  onPatch={patchEntry}
                  onDelete={deleteEntry}
                  onResolveAppeal={resolveAppeal}
                />
              </div>
            )}

            {/* The directory is independent of the case ledger — an org with no
                violations logged still has people in it. */}
            {tab === "people" && <People accounts={data.accounts} me={me} />}

            {/* The whole population as a table. Cards are right for browsing
                twenty people and useless for scanning two hundred. */}
            {tab === "roster" && (
              <People
                accounts={data.accounts}
                me={me}
                view="table"
                everyone
                heading="All employees"
                blurb="Everyone on record, including applicants and leavers. Sort any column; click a row to open the record."
              />
            )}

            {/* The two ends of the journey. Same directory, filtered to the
                stages that phase covers — a separate component would be a
                second implementation of search, paging and the profile view. */}
            {tab === "joining" && (
              <People
                accounts={data.accounts}
                me={me}
                stages={stagesOf("join")}
                heading="New joiners"
                blurb="Everyone between an accepted offer and a confirmed probation."
              />
            )}
            {tab === "leaving" && (
              <People
                accounts={data.accounts}
                me={me}
                stages={stagesOf("leave")}
                heading="Leavers"
                blurb="Serving notice or already gone. Clearance lives on each record."
              />
            )}

            {/* Live attendance, independent of the case ledger like the directory. */}
            {tab === "floor" && can(me, "floorView") && <FloorView accounts={data.accounts} />}

            {/* Approvals for every request type. Independent of the case ledger —
                an org with no violations still has leave to approve. */}
            {tab === "requests" && <RequestInbox people={data.people || []} />}

            {tab === "agents" && !empty && <AgentProfiles entries={data.entries} accounts={data.accounts} />}

            {tab === "audit" && can(me, "audit") && <AuditTrail />}

            {tab === "matrix" && can(me, "admin") && <DcmEditor dcm={data.dcm} onChange={setDcm} />}

            {tab === "users" && can(me, "admin") && (
              <UserManagement
                users={data.users}
                me={me}
                onCreate={createUser}
                onReset={resetUser}
                onRole={setUserRole}
                onDelete={deleteUser}
              />
            )}

            {tab === "settings" && can(me, "admin") && (
              <SettingsView
                data={data}
                onAccounts={setAccounts}
                onTls={setTls}
                onReset={resetAll}
                onExport={() => downloadCsv(data.entries.filter((e) => !e.voided))}
                onLoadSamples={loadSamples}
              />
            )}
          </div>
        </main>
      </div>

      {/* Success toast — bottom right, self-dismissing */}
      {notice && (
        <div
          className="ao-slide-in ao-glass fixed bottom-5 right-5 z-50 flex items-center gap-2.5"
          style={{
            background: "var(--toast-bg)",
            border: `1px solid ${alpha(P.green, 0.33)}`,
            borderRadius: 12,
            padding: "12px 16px",
            maxWidth: 380,
            boxShadow: `var(--elev-3), 0 0 24px -8px ${alpha(P.green, 0.4)}`,
          }}
          role="status"
        >
          <CircleCheck size={16} color={P.green} style={{ flexShrink: 0 }} />
          <span style={{ fontSize: 13, color: P.inkSoft }}>{notice}</span>
          <button
            onClick={clearNotice}
            aria-label="Dismiss"
            style={{ border: "none", background: "none", cursor: "pointer", color: P.sub, display: "flex", marginLeft: 4 }}
          >
            <X size={13} />
          </button>
        </div>
      )}

    </div>
  );
}

/* ── Chrome pieces ───────────────────────────────────────────────────────── */

function UserChip({ me, onLogout }) {
  return (
    <div className="flex items-center gap-2 pl-3" style={{ borderLeft: "1px solid var(--hdr-line)" }}>
      <div className="text-right min-w-0">
        <div className="ao-disp font-semibold truncate" style={{ fontSize: 12.5, color: "var(--hdr-strong)", lineHeight: 1.2 }}>
          {me.name}
        </div>
        <div className="ao-mono" style={{ fontSize: 10, color: "var(--sub)" }}>
          {ROLE_LABEL[me.role]}
        </div>
      </div>
      <Tip label="Sign out" side="bottom">
        <button
          onClick={onLogout}
          aria-label="Sign out"
          style={{ border: "1px solid var(--hdr-line)", background: "transparent", color: "var(--hdr-text)", borderRadius: 6, padding: 6, cursor: "pointer", display: "flex" }}
        >
          <LogOut size={13} />
        </button>
      </Tip>
    </div>
  );
}

function NavItem({ item, active, badge, onClick }) {
  const Icon = item.icon;
  return (
    <button
      onClick={onClick}
      data-active={active ? "true" : "false"}
      className="ao-disp ao-nav uppercase tracking-wide font-semibold flex items-center gap-2 transition group"
      style={{
        position: "relative",
        fontSize: 12.5,
        padding: "9px 12px",
        borderRadius: 8,
        cursor: "pointer",
        textAlign: "left",
        width: "100%",
        border: "1px solid transparent",
        background: "transparent",
        color: active ? P.ink : P.sub,
      }}
    >
      {/* The selection is its own element rather than a background on the
          button, so exactly one of them exists at a time and the browser can
          interpolate it from the old position to the new one. Painted behind
          the label, and hidden from the accessibility tree — the button's own
          state already says which is current. */}
      {active && (
        <span
          aria-hidden="true"
          className="ao-nav-marker"
          style={{
            position: "absolute",
            inset: 0,
            borderRadius: 8,
            border: `1px solid ${P.line}`,
            background: P.card,
            zIndex: 0,
          }}
        />
      )}
      <Icon
        size={15}
        color={active ? P.petrol : P.sub}
        className="transition-transform duration-200 group-hover:scale-110"
        style={{ position: "relative", zIndex: 1, flexShrink: 0 }}
      />
      <span
        className="flex-1 transition-transform duration-200 group-hover:translate-x-0.5 rtl:group-hover:-translate-x-0.5"
        style={{ position: "relative", zIndex: 1 }}
      >
        {item.label}
      </span>
      {badge > 0 && (
        <span
          className="ao-mono ao-halo"
          style={{ fontSize: 10.5, background: P.brick, color: "#fff", borderRadius: 999, padding: "1px 6px", "--halo": "rgba(242,109,95,0.55)" }}
        >
          {badge}
        </span>
      )}
    </button>
  );
}

function NavChip({ item, active, badge, onClick }) {
  const Icon = item.icon;
  return (
    <button
      onClick={onClick}
      className="ao-disp uppercase tracking-wide font-semibold flex items-center gap-1.5"
      style={{
        fontSize: 11.5,
        padding: "6px 10px",
        borderRadius: 999,
        cursor: "pointer",
        whiteSpace: "nowrap",
        border: `1px solid ${active ? P.petrol : P.line}`,
        background: active ? P.petrol : P.card,
        color: active ? "#fff" : P.sub,
      }}
    >
      <Icon size={12} />
      {item.label}
      {badge > 0 && (
        <span className="ao-mono" style={{ fontSize: 10, background: active ? "#fff" : P.brick, color: active ? P.petrol : "#fff", borderRadius: 999, padding: "0 5px" }}>
          {badge}
        </span>
      )}
    </button>
  );
}

/* A scorecard figure. `value` is the raw number so it can count up; `format`
   renders it (hours, days…). Clickable cards lift, glow and nudge their icon —
   the whole tile reads as a control, not a label. */
function KPI({ label, value, format, icon: Icon, tone, onClick, hint }) {
  const n = useCountUp(value);
  const shown = format ? format(n) : Math.round(n).toLocaleString();
  return (
    <Tip label={hint} side="bottom" fill>
    <div
      onClick={onClick}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => (e.key === "Enter" || e.key === " ") && onClick() : undefined}
      className={`p-3 ao-glass gradient-hairline group ${onClick ? "ao-lift ao-glow" : ""}`}
      style={{
        background: P.card,
        border: `1px solid ${P.line}`,
        borderRadius: 12,
        cursor: onClick ? "pointer" : "default",
        "--glow": tone || "color-mix(in srgb, var(--signal) 60%, transparent)",
      }}
    >
      <div className="flex items-center gap-2">
        <Icon
          size={13}
          color={tone || P.sub}
          className={onClick ? "transition-transform duration-200 group-hover:scale-125" : undefined}
        />
        <div className="ao-mono font-semibold ao-fluid-num" style={{ color: tone || P.ink }}>
          {shown}
        </div>
      </div>
      <div className="ao-disp uppercase tracking-wider font-semibold mt-1" style={{ fontSize: 10.5, color: P.sub }}>
        {label}
        {hint ? <span className="sr-only"> — {hint}</span> : null}
      </div>
    </div>
    </Tip>
  );
}

function Queue({ title, hint, rows, tone, tls, me, onPatch, onDelete, onResolveAppeal }) {
  return (
    <div>
      <SectionTitle count={rows.length} tone={tone}>
        {title}
      </SectionTitle>
      <div className="mb-3">
        <Muted>{hint}</Muted>
      </div>
      {rows.length === 0 ? (
        <div className="p-5 text-center" style={{ background: P.card, border: `1px dashed ${P.line}`, borderRadius: 10 }}>
          <CircleCheck size={18} color={P.green} style={{ margin: "0 auto" }} />
          <Muted>Clear — nothing waiting here.</Muted>
        </div>
      ) : (
        <div className="grid gap-2 ao-stagger">
          {rows.map((e) => (
            <EntryCard key={e.id} e={e} tls={tls} me={me} onPatch={onPatch} onDelete={onDelete} onResolveAppeal={onResolveAppeal} />
          ))}
        </div>
      )}
    </div>
  );
}

function EmptyState({ canLog, canSamples, onLog, onSamples }) {
  return (
    <div className="p-8 text-center" style={{ background: P.card, border: `1px dashed ${P.line}`, borderRadius: 12 }}>
      <div className="ao-disp font-bold uppercase tracking-wide" style={{ fontSize: 18, color: P.ink }}>
        No cases logged yet
      </div>
      <div className="mt-2 mx-auto" style={{ fontSize: 13.5, color: P.sub, maxWidth: 470 }}>
        Log the first case: the matrix prescribes the action, a TL or direct manager escalates or dismisses it with a
        comment, and the case is routed through OPS and HR confirmation.
      </div>
      <div className="flex gap-3 justify-center flex-wrap mt-5">
        {canLog && (
          <BtnPrimary onClick={onLog} icon={Plus}>
            Log first case
          </BtnPrimary>
        )}
        {canSamples && <BtnGhost onClick={onSamples}>Load sample data</BtnGhost>}
      </div>
    </div>
  );
}
