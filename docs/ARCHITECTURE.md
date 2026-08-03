# Quorum — architecture and roadmap

How this system is built, why, and in what order. Written to be argued with:
if a decision here turns out wrong, change it here first and then in the code.

---

## 1. The honest framing

The goal is an all-in-one employee system: intake to exit, with pay,
promotions, payslips, disciplinary action, PIPs and everything between on one
auditable record.

Two things are true at once, and both matter:

- **The domain is well understood.** Egyptian labour law, BPO shift operations
  and a disciplinary matrix are all knowable, and largely already encoded here.
- **"All features, flawless" is not a single deliverable.** Workday is twenty
  years and thousands of engineers. Anyone who promises its surface area in one
  pass is either misunderstanding the ask or lying about the estimate.

So the plan is not "build everything at once". It is:

> Build a **spine** that makes every later feature cheap, then add domains one at
> a time, each one production-grade before the next begins.

The spine is sections 3 and 4. Get those right and a new domain — expenses,
learning, recognition — is a schema addition plus a screen, not an
architecture debate. Get them wrong and every domain re-litigates approvals,
history and permissions, which is exactly how a promising internal tool becomes
twenty inconsistent spreadsheets with a login page.

**What "flawless" is taken to mean here:** every feature that ships is correct,
authorized, audited, tested and reversible. Not: every conceivable feature
exists. A narrow system that is right beats a broad one that quietly computes
the wrong leave balance.

---

## 2. Stack decision

**Keeping:** TypeScript, Next.js (App Router), PostgreSQL, Prisma, NextAuth,
Vercel.

This was reconsidered from scratch rather than assumed, because the brief gave
free choice of language and framework. The conclusion is to keep it, for
reasons that would apply to a green field too:

| Concern | Why this stack answers it |
|---|---|
| Workflow-heavy, read-heavy, moderate write volume | Postgres is exactly this shape. Nothing here needs a specialised store. |
| Correctness of money and balances | Relational constraints and real transactions. A balance ledger without transactions is a rounding error waiting to be discovered at payroll. |
| Effective-dated history (§3) | Standard SQL. Ranges, exclusion constraints, window functions. |
| One language across rules, API and UI | The pure rules modules run unchanged in tests, on the server, and in the browser. That property is load-bearing and worth protecting. |
| Small team, fast iteration | One deploy target, one type system, one dependency graph. |

And the decisive practical argument: there is already a working, deployed,
tested system here — 241 unit tests, e2e coverage, CI, a full theming layer,
RBAC, an append-only audit trail, and a correct disciplinary rules engine.
Rewriting that in another language buys nothing a customer can see and costs
weeks. **The right senior call is to harden the architecture, not restart it.**

Where the stack genuinely needs extending, it is named in §4 — background jobs,
object storage, email, encryption. Those are additions, not replacements.

**Deliberately not chosen, and why:**

- *Microservices.* One team, one database, one transaction boundary. Splitting
  now would buy distributed-systems problems and no scaling benefit.
- *A separate backend (NestJS/Go/Django) with a React SPA.* Duplicates the type
  layer and the auth story for no gain at this size.
- *NoSQL / document store.* HR data is deeply relational and needs constraints.
  A blob that cannot be constrained hides its own corruption — a lesson already
  paid for once here.
- *An off-the-shelf workflow engine (Temporal, Camunda).* Real operational
  weight. Revisit if approval chains outgrow §4.2, which they may.

---

## 3. The one idea that matters most: effective-dated records

Every mature HR system converges on this, and it is the single thing that most
distinguishes a real one from a CRUD app over a spreadsheet.

**Do not update HR facts. Insert dated versions of them.**

A salary is not a column you overwrite. It is a series:

```
employee  effective_from  base_salary  reason
EMP-1001    2024-01-01       12000     Hire
EMP-1001    2025-04-01       14500     Merit
EMP-1001    2026-02-01       18000     Promotion
```

"What is their salary?" becomes "what is their salary **as of** a date". That
one shift gives, for free, things that are otherwise each a separate feature:

- **History** — no audit table needed for the fact itself; the versions *are*
  the history.
- **Future-dated changes** — enter April's raise in February. It applies itself.
- **Retroactive correction** — insert a correction effective from the original
  date; payroll can compute the arrears difference because both versions exist.
- **Point-in-time reporting** — "headcount and paybill as of 31 December" is a
  query, not a restored backup.
- **Explainability** — "why is my balance 12.5 days?" is answerable by showing
  the rows.

Applies to: compensation, job/position, org placement, reporting lines, cost
centre, employment terms, leave-policy assignment.

Does *not* apply to: correcting a typo in a phone number. That is not history.
The discipline is knowing which is which — **a change a payslip or a tribunal
might ask about is dated; a correction is not.**

Consequences accepted deliberately:

- Reads need an as-of predicate. Wrapped in one query helper, never hand-rolled.
- Overlapping ranges must be impossible. Postgres exclusion constraints, not
  application checks.
- `EmployeeEvent` (already built) stays the *narrative* timeline. The dated
  tables are the *authority*. Two different jobs: one is what happened, the
  other is what is true.

---

## 4. Cross-cutting foundations

### 4.1 Authorization as one function

Already the pattern here (`canViewEmployee`), and it stays: one pure, tested
function per question, reused by every route. Never re-derived per endpoint.
Authorization written five times is authorization that disagrees with itself in
at least one place, and the place it disagrees is the one nobody audited.

To add: **field-level** policy (who may see salary vs who may see a phone
number), and **delegation** (§4.4).

### 4.2 One approval engine, not one per feature

Leave, overtime, transfers, promotions, pay changes, exits, expenses, letter
requests and shift swaps all need: multi-stage approval, an ordered chain,
delegation, escalation on SLA breach, withdrawal, an audit trail, and a
"what's waiting on me" inbox.

Building that per feature produces N inconsistent implementations, and the
authorization gap always turns up in the one written last.

So: **one generic engine.** A request has a type, a payload, a computed
approval chain, a current step, and a status. Per-type configuration supplies
the chain rule, the SLA, and the validation. Everything else is shared —
including the inbox, the escalation job, and the delegation logic.

This is the highest-leverage thing left to build. Every workflow feature after
it is configuration plus a form.

### 4.3 Everything explainable

Any computed number a person might dispute must be able to show its work:
leave balance, deduction, adherence percentage, entitlement tier, final
settlement. The rules engine is already pure and testable, which is the
precondition. What is missing is surfacing the derivation in the UI.

This is not polish. "The system says so" is not an answer to an employee, and
in a labour dispute it is not a defence.

### 4.4 Delegation and absence of approvers

The most common real-world complaint about HR tools: an approver goes on leave
and everything silently stalls behind them. Needed from the start, not bolted
on:

- explicit delegation with a date range
- automatic escalation to the next level on SLA breach
- a named fallback when a role is vacant
- visibility: "this is waiting on X, who is on leave until Y"

### 4.5 Jobs, storage, notifications, secrets

The current gaps, plainly:

| Need | Why | Approach |
|---|---|---|
| Scheduled jobs | Monthly accrual, SLA sweeps, probation reminders, document expiry | Vercel Cron → idempotent handlers. Every job must be safe to run twice, because it will be. |
| Object storage | Documents, medical certificates, payslips, contracts. Currently only URL pointers. | Vercel Blob or S3, private by default, access brokered through the app and audited. |
| Email / notification | Nothing can chase anyone today | One provider (Resend), digest-batched by default. Per-event email trains people to ignore it. |
| Field-level encryption | Salary, national ID, IBAN are plaintext today | AES-GCM via a KMS-held key, on the PII and compensation tables. Blind index where lookup is genuinely needed. |
| Observability | Errors are currently invisible in production | Error tracking plus a health endpoint. |

### 4.6 Three tiers of editability

A record has fields with three different owners, and collapsing them into
"editable" and "read-only" is what makes an HR portal either a data-quality
disaster or a helpdesk queue.

| Tier | Who writes it | Mechanism |
|---|---|---|
| **HR-held** | HR only | Employee sees it read-only and disputes it via a ticket, never edits it. Job title, salary, contract term, hire date. |
| **Self-service, immediate** | The employee | Applies at once and is recorded. Address, mobile, emergency contact, qualification. |
| **Self-service, verified** | The employee proposes; HR confirms | Submitted as a request, checked against a document, then applied. |

The tier a field belongs to is decided by **what it controls**, not by how
personal it feels:

> **Any field that drives a computed entitlement or a payment destination is
> verified, never immediate.**

That test puts three fields in the verified tier that intuition would leave in
the immediate one:

- **Date of birth.** Art. 47 makes age 50 an independent route to the 30-day
  annual-leave tier. A self-editable birth date is a self-service pay rise of
  nine days' leave.
- **Social insurance number** and **passport** — government identifiers that
  appear on statutory filings.
- **Bank account and IBAN** — the payment destination, and the obvious target
  for anyone who compromises an account.

Note that "verified" is not "slow". The employee submits once and sees the
pending state; what it prevents is a silent, unattributed change to something
that moves money.

### 4.7 Workflow patterns that must be in the engine, not per feature

Each of these is a real operational need that a naive "approve / reject"
implementation cannot express:

- **Partial approval.** An approver may grant fewer days than requested, and the
  balance of the request stays available to the employee rather than being
  consumed or lost.
- **Co-approval with a timeout default.** Two managers must *agree* a value —
  neither can overrule the other. If they have not agreed within a set window,
  a stated default applies automatically. Without the default, a disagreement
  deadlocks forever; without the equality, seniority silently decides.
- **Withdrawal windows.** The requester may withdraw unilaterally for a period,
  after which withdrawal itself needs approval.
- **Delegation, including standing and open-ended.** With dates, or with no end
  date until explicitly revoked.
- **Sequenced clearance with dependencies.** Some steps cannot start until
  others finish — equipment cannot be collected before handover is confirmed.
- **Third-party initiation.** Some requests are raised by someone who is neither
  the subject nor their manager. A no-show report is the clear case: whoever
  noticed should be able to raise it.
- **Consequence disclosure.** Any action with a side effect beyond itself states
  that side effect at the point of submission — "this puts their payment on hold
  and opens clearance". A confirmation dialogue that does not say what will
  happen is not consent.

### 4.8 Completeness as an incentive

Rather than nagging people to complete their record, compute a completeness
percentage from the fields that actually matter and attach a consequence to the
ones that block downstream processing — an incomplete bank record genuinely
cannot be paid, so saying so is accurate rather than coercive.

Requirements: name the specific missing fields, never just the percentage; and
only hold on fields that truly block, or the mechanism loses its credibility.

### 4.9 Dispute channels on every computed number

Every derived figure gets an explicit "this looks wrong" route that opens a
ticket with the derivation attached. Leave balance, adherence, deduction,
entitlement, final settlement.

This is the practical companion to §4.3: explainability is what the employee
reads, the dispute channel is what they do when they disagree. Without it the
only escalation path is a message to a manager, which leaves no record and no
trend.

### 4.10 The agent clock is event-sourced

Login, logout and every AUX change are append-only events. There is no "current
status" column; the current state is derived from the last event.

Three reasons, in order of how expensive they are to get wrong:

- **Concurrency.** A double-tap, a request retried after a timeout, or a second
  browser tab cannot corrupt a state they only append to. A read-modify-write on
  a status column loses one of them silently — and at shift change that is
  hundreds of agents writing in the same minute.
- **Disputes.** "You were on break for forty minutes" has to be answerable with
  the actual sequence months later, not with a number nobody can re-derive.
- **Rule changes.** When a break policy changes, history is replayed under the
  new rule rather than being wrong or needing a migration.

Two rules follow from it:

- **Instants are server-assigned.** A client clock can be wrong by hours, and it
  can be set deliberately. The server stamps every punch.
- **Local days are derived, never offset.** Egypt observes DST again, so a fixed
  UTC offset is an hour out twice a year and mis-buckets any overnight shift
  crossing the change. A shift is a pair of instants; the calendar day it belongs
  to is computed in the operating time zone from the *session start*, so a night
  shift stays one shift instead of splitting at midnight.

Enforcement is reporting, not blocking: an agent already twenty minutes into a
fifteen-minute break cannot be un-broken, and refusing their return punch would
only make the overrun worse. The engine produces the evidence for a conversation.

### 4.11 Non-negotiables

- **Every mutation audited**, with actor, before/after and reason. Already true; keep it true.
- **Soft delete only.** Employment records are legal records. Already the pattern for cases.
- **Retention policy.** Egypt's Law 151/2020 has real requirements on personal data. Retention has to be designed in, not retrofitted — and "keep everything forever" is not a lawful default.
- **Idempotent imports.** Every bulk import needs a natural key and must be safely re-runnable.
- **Bilingual from the start.** Arabic is not a translation layer here; payroll, insurance and bank files are filed in Arabic and are authoritative.

---

## 5. What a great employee portal actually does

Drawn from what the established systems get right, filtered to what a BPO
operation of this shape needs. Marked by whether it exists today.

### Core HR — the spine
- ✅ Employee master record, bilingual
- ✅ Org hierarchy: direct / functional / dotted
- ✅ Lifecycle state machine, intake to exit
- ✅ Per-person timeline
- ✅ PII separated, permission-gated, audited
- ⬜ Effective-dated job, org and terms (§3)
- ⬜ Position/job architecture: grades, bands, families
- ⬜ Document vault with expiry tracking
- ⬜ Custom fields without a migration

### Self-service — the surface most people actually use
- ⬜ "My profile", employee-editable with approval on sensitive fields
- ⬜ My balances, my payslips, my documents, my team
- ⬜ Letter requests (bank letter, HR letter, salary certificate) — generated, not chased
- ⬜ HR helpdesk tickets with categories and SLAs
- ⬜ Org chart browsing
- ⬜ Mobile-first. BPO agents do not sit at desks.

### Hire to onboard
- ✅ Applicant intake, two-stage approval
- ⬜ Offer letter generation and e-signature
- ⬜ Pre-boarding portal before day one
- ⬜ Provisioning checklist: IT, assets, accesses, buddy
- ⬜ Probation review scheduled automatically from the hire date

### Time and attendance
- ✅ Login/logout and AUX state engine, event-sourced (rules only)
- ✅ Break compliance, occupancy, paid vs productive time
- ✅ Adherence with lateness, and unscheduled time reported not credited
- ✅ Overnight shifts and DST handled without special cases
- ✅ Abandoned-session detection stamped at the deadline, not at sweep time
- ⬜ Agent clock UI and real-time floor view
- ⬜ Shift schedules, patterns, bulk import
- ⬜ Adherence exception review queue
- ⬜ Overtime request → approval → payroll feed
- ⬜ Shift swaps between agents, manager-approved
- ⬜ Project / billable hours

### Absence
- ✅ Art. 47 tiered entitlement, all four tiers, both routes to the top
- ⬜ Transactional balance ledger with an explainable derivation
- ⬜ Accrual, carry-over, expiry, encashment
- ⬜ Request → two-stage approval → schedule write-back
- ⬜ Holiday calendars, blackout periods
- ⬜ Medical certificate capture and validation
- ⬜ Team absence calendar and coverage warnings

### Compensation and payroll
- ⬜ Effective-dated compensation records
- ⬜ Salary bands with out-of-band flagging
- ⬜ Allowances and recurring deductions
- ⬜ Payslip generation, bilingual, employee-visible
- ⬜ Social insurance and tax parameters
- ⬜ Salary review cycles with budget control
- ⬜ Bank transfer file export
- ⬜ Final settlement on exit

### Performance and development
- ✅ Disciplinary matrix, 90-day chains, statutory deduction caps
- ✅ Appeals / right to contest
- ⬜ Coaching sessions with configurable templates
- ⬜ Goals, review cycles, probation and 360 reviews
- ⬜ PIPs with milestones, check-ins and outcomes
- ⬜ Quality/QA scoring feeding the same record
- ⬜ Calibration and succession
- ⬜ Learning: courses, mandatory compliance training, certification expiry

### Employee relations
- ✅ Case management, evidence, digital acknowledgement
- ⬜ Grievances, raised by the employee
- ⬜ Investigations with restricted visibility
- ⬜ Warning letters, expiry and spent-conviction handling
- ⬜ Exit interviews

### Engagement
- ⬜ Announcements, targeted by account or department
- ⬜ Pulse surveys / eNPS, genuinely anonymous
- ⬜ Recognition and peer kudos
- ⬜ Gamification, if and only if it measures something worth rewarding

### Offboarding
- ⬜ Resignation and notice-period tracking
- ⬜ Clearance checklist across departments
- ⬜ Asset return, reconciled against what was issued
- ⬜ Access revocation
- ⬜ Final settlement and certificate of service
- ⬜ Alumni record

### Analytics and admin
- ✅ Append-only audit trail, searchable
- ✅ RBAC
- ⬜ Headcount, attrition, absence, adherence, cost dashboards
- ⬜ Compliance dashboard: expiring documents, overdue probations, unsigned actions
- ⬜ Workflow and policy configuration without code
- ⬜ Integrations: payroll provider, telephony/ACD, SSO
- ⬜ Data retention and lawful-erasure tooling

---

## 6. Build order

Each phase ships production-grade — authorized, audited, tested, deployed —
before the next begins. Roughly ordered by what unblocks the most.

**Phase 0 — spine** *(mostly done)*
Employee master, org hierarchy, lifecycle, timeline, PII separation, directory.

**Phase 1 — foundations**
Effective-dated records (§3). The approval engine (§4.2). Object storage.
Field-level encryption. Scheduled jobs. Delegation.
*Nothing user-visible ships in this phase, and it is the most important one.*

**Phase 2 — absence**
The full leave engine on the balance ledger, two-stage approval through the
engine, holiday calendars, medical certificates, team calendar. First domain to
prove the foundations, and the one employees touch most.

**Phase 3 — self-service and onboarding**
Employee portal proper: my profile, my balances, my documents, letter requests,
helpdesk. Full onboarding with provisioning and automatic probation review.

**Phase 4 — time and attendance (agent clock)**
An eStart-equivalent: login/logout, AUX states, adherence, break compliance,
overtime, shift swaps, schedules. The engine is built (src/lib/attendance.js);
what remains is persistence, the agent-facing clock UI, the real-time floor view
and the schedule import.

Highest data volume in the system and the surface agents actually live in, so
it carries the concurrency risk: at shift change, hundreds of agents punch
within the same minute. That is why the model is append-only events with derived
state and no mutable status column anywhere — see §4.11.

**Phase 5 — compensation**
Effective-dated pay, bands, review cycles, payslips, bank files, final
settlement. Deliberately after Phases 1–2, because it depends on dated records
and on approvals being trustworthy — and because it carries the heaviest
compliance load.

**Phase 6 — performance**
Coaching, reviews, PIPs, QA scores, joined to the existing disciplinary engine.

**Phase 7 — engagement, analytics, integrations**

### For a presentable MVP

The demo that tells the whole story, in order: an applicant is admitted →
onboarded → appears in the directory → requests leave → it routes through two
approvers → the balance moves and shows its derivation → a violation is logged
and runs the matrix → they are put on a PIP → they exit with a clearance
checklist. **One person, one timeline, end to end.**

That is Phase 0 plus Phase 1 plus Phase 2, plus a thin slice of onboarding and
exit. It is a real target, and it demonstrates the spine rather than a menu of
half-features.

---

## 7. Decisions taken, so they are not re-argued

1. Postgres and one transaction boundary. No microservices at this size.
2. Pure rules modules stay dependency-free and I/O-free. They are the asset.
3. Calendar days are strings (`YYYY-MM-DD`); instants are `DateTime`. Never mixed.
4. No positional data access, anywhere, ever.
5. Authorization is one shared function per question, resolved server-side. Never trusted from the client.
6. Every HR-significant change is dated and audited.
7. Soft delete for anything with legal weight.
8. Jobs are idempotent.
9. Arabic and English are both first-class.
10. Each phase is finished before the next starts. Half-built domains are worse than absent ones.
