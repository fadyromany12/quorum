/* The org chart as a shape, not a column.

   `directManagerId` has been on the employee record from the start, and it has
   only ever been read one hop at a time: who approves this leave, who can see
   this record. Nobody could look at the tree. So the questions a manager
   actually asks — how many people are under me, how deep does it go, is anyone
   reporting to somebody who left — had no answer anywhere in the product.

   Everything here is derived from the same column. There is no second source of
   truth for the hierarchy, which is the point: an org chart stored separately
   from the reporting line is an org chart that disagrees with who approves your
   leave, and the disagreement is invisible until it matters.

   ── Cycles are a when, not an if ──────────────────────────────────────────

   The data is hand-maintained. Two people managing each other happens the first
   time somebody swaps a team over lunch, and every walk in this file has to
   survive it — not by refusing to run, but by terminating and *reporting* it.
   A tree view that hangs is a bug; a tree view that quietly drops half the
   company because of one loop is worse, because nobody notices.

   ── On manager-of-managers ────────────────────────────────────────────────

   A manager owns their reports. A manager of managers owns their reports'
   reports too — not as a separate permission but as a consequence of the
   subtree, which is exactly how `canViewEmployee` already reads it. This file
   just makes that visible and gives the skip level a name, so "escalate above
   my manager" has somewhere to go. */

import { subordinateIds, managerChain } from "./employee.js";

const idOf = (e) => String(e?.id ?? "");
const parentOf = (e) => String(e?.directManagerId ?? "") || null;

/** Name a person is best known by on a chart. */
export const nameOf = (e) => e?.preferredName || e?.fullNameEn || e?.empId || "—";

/**
 * Index employees by id, plus a parent → children map.
 * Built once and passed around: every helper below wants both, and rebuilding
 * them per call turns a tree render into an O(n²) walk.
 */
export function indexOrg(employees = []) {
  const byId = new Map();
  const children = new Map();
  for (const e of employees) {
    const id = idOf(e);
    if (!id) continue;
    byId.set(id, e);
  }
  for (const e of employees) {
    const id = idOf(e);
    const p = parentOf(e);
    /* A manager id pointing at somebody not in this list is not a parent — it
       is an orphan, and treating it as a parent silently hides the person. */
    if (!p || !byId.has(p) || p === id) continue;
    if (!children.has(p)) children.set(p, []);
    children.get(p).push(id);
  }
  for (const list of children.values()) {
    list.sort((a, b) => nameOf(byId.get(a)).localeCompare(nameOf(byId.get(b))));
  }
  return { byId, children };
}

/**
 * The forest. Roots are people with no manager inside this set — which includes
 * both the genuine top of the chart and anyone whose manager is missing, and
 * those are told apart by `orphaned` rather than by being dropped.
 *
 * Cycle-safe: a node already visited on this path becomes a leaf marked
 * `cycle`, so a loop renders as a loop rather than hanging the browser.
 *
 * @returns {{roots: Array<object>, cycles: string[][], counted: number}}
 */
export function buildTree(employees = []) {
  const { byId, children } = indexOrg(employees);
  const cycles = [];
  let counted = 0;

  const node = (id, path) => {
    const e = byId.get(id);
    counted++;
    if (path.includes(id)) {
      /* Record the loop from where it closes, so the message can name the
         people in it rather than saying "a cycle exists somewhere". */
      cycles.push([...path.slice(path.indexOf(id)), id]);
      return { id, employee: e, name: nameOf(e), children: [], cycle: true, span: 0, depth: path.length };
    }
    const kids = (children.get(id) ?? []).map((c) => node(c, [...path, id]));
    return {
      id,
      employee: e,
      name: nameOf(e),
      children: kids,
      cycle: false,
      /* Direct reports, and everyone beneath — a lead with four reports and a
         manager with four leads under them are not the same number. */
      span: kids.length,
      headcount: kids.reduce((n, k) => n + 1 + (k.headcount ?? 0), 0),
      depth: path.length,
      managerOfManagers: kids.some((k) => k.children.length > 0),
    };
  };

  const roots = [];
  const seen = new Set();
  const mark = (n) => {
    seen.add(n.id);
    for (const k of n.children) mark(k);
  };

  for (const [id, e] of byId) {
    const p = parentOf(e);
    if (p && byId.has(p) && p !== id) continue;
    const n = node(id, []);
    n.orphaned = Boolean(p) && !byId.has(p);
    roots.push(n);
    mark(n);
  }

  /* Anyone not reached from a root is inside a loop, or hanging below one.
     Walking only from roots is the obvious implementation and it makes those
     people *disappear* — two colleagues who manage each other are each other's
     parent, so neither is ever a root and neither is ever a child of one. A
     chart that quietly omits a branch is worse than one that hangs, because
     nobody notices. So the leftovers are walked too, and surface as their own
     root marked `looped`. */
  for (const [id] of byId) {
    if (seen.has(id)) continue;
    const n = node(id, []);
    n.looped = true;
    roots.push(n);
    mark(n);
  }

  roots.sort((a, b) => (b.headcount ?? 0) - (a.headcount ?? 0) || a.name.localeCompare(b.name));

  return { roots, cycles, counted };
}

/** Everyone two levels down or more — the skip level a manager also owns. */
export function skipLevelIds(managerId, employees = []) {
  const { children } = indexOrg(employees);
  const direct = new Set(children.get(String(managerId)) ?? []);
  return subordinateIds(String(managerId), employees).filter((id) => !direct.has(id));
}

/** Does anyone reporting to this person have reports of their own? */
export function managesManagers(managerId, employees = []) {
  const { children } = indexOrg(employees);
  return (children.get(String(managerId)) ?? []).some((c) => (children.get(c) ?? []).length > 0);
}

/**
 * Everything structurally wrong with the chart.
 *
 * Split into problems and warnings for the usual reason, but the line is drawn
 * differently here: a problem is something that breaks a *behaviour* — approval
 * routing, visibility scope — and a warning is something a human should look at.
 * A 30-person span is not broken, it is just probably a mistake.
 */
export function checkHierarchy(employees = [], { maxSpan = 15, maxDepth = 8 } = {}) {
  const { byId, children } = indexOrg(employees);
  const problems = [];
  const warnings = [];
  const { roots, cycles, counted } = buildTree(employees);

  for (const cycle of cycles) {
    problems.push(`Reporting loop: ${cycle.map((id) => nameOf(byId.get(id))).join(" → ")}. Neither of them can approve for the other.`);
  }

  for (const e of employees) {
    const id = idOf(e);
    const p = parentOf(e);
    if (p === id) problems.push(`${nameOf(e)} is recorded as their own manager.`);
    else if (p && !byId.has(p)) {
      /* The reason this is a problem and not a warning: chainFor() routes on
         directManagerId, so leave raised by this person waits on somebody who
         is not there. It fails at the moment it is needed. */
      problems.push(`${nameOf(e)} reports to somebody who is not in the directory — their approvals have nowhere to go.`);
    }
  }

  /* More than one root is normal in a BPO (accounts run independently), so it
     is only worth mentioning when it looks accidental. */
  const realRoots = roots.filter((r) => !r.orphaned);
  if (realRoots.length === 0 && counted > 0) {
    problems.push("Every person reports to somebody, so the chart has no top. That means a loop.");
  } else if (realRoots.length > 3) {
    warnings.push(`${realRoots.length} people report to nobody. That is a lot of separate charts — check whether some of them should report to a head of account.`);
  }

  for (const [id, kids] of children) {
    if (kids.length > maxSpan) {
      warnings.push(`${nameOf(byId.get(id))} has ${kids.length} direct reports. Above ${maxSpan}, one-to-ones stop happening.`);
    }
  }

  const deepest = Math.max(0, ...employees.map((e) => managerChain(idOf(e), byId).length));
  if (deepest > maxDepth) {
    warnings.push(`The chart is ${deepest} levels deep. Anything past ${maxDepth} usually means a placeholder manager nobody meant to keep.`);
  }

  return { problems, warnings };
}

/* ── Moving somebody ───────────────────────────────────────────────────────

   A reporting-line change is the one org edit that is never only about the
   person being moved. It changes who approves their leave, who can see their
   record, whose headcount they sit in, and — if they manage anybody — it moves
   a whole subtree with them.

   Which is why this returns a plan rather than performing a write: the losing
   manager and the gaining manager both have to see what they are agreeing to,
   and "3 other people move with them" is not something either of them should
   discover afterwards. */

/**
 * What moving `employeeId` under `newManagerId` would do, and everything that
 * would stop it.
 *
 * @returns {{
 *   problems: string[], warnings: string[],
 *   moving: string[], losing: string|null, gaining: string|null, depth: number
 * }}
 */
export function movePlan(employeeId, newManagerId, employees = []) {
  const { byId } = indexOrg(employees);
  const id = String(employeeId);
  const target = String(newManagerId ?? "");
  const problems = [];
  const warnings = [];

  const person = byId.get(id);
  if (!person) return { problems: ["That person is not in the directory."], warnings: [], moving: [], losing: null, gaining: null, depth: 0 };

  const losing = parentOf(person);
  const subtree = subordinateIds(id, employees);

  if (!target) problems.push("Choose the manager they will report to.");
  else if (target === id) problems.push(`${nameOf(person)} cannot report to themselves.`);
  else if (!byId.has(target)) problems.push("That manager is not in the directory.");
  else if (target === losing) problems.push(`${nameOf(person)} already reports to ${nameOf(byId.get(target))}.`);
  else if (subtree.includes(target)) {
    /* The move that looks harmless and detaches a branch from the company: put
       a manager under one of their own reports and the pair spins off into a
       cycle with nobody above it. */
    problems.push(
      `${nameOf(byId.get(target))} reports to ${nameOf(person)}, directly or further down. ` +
        `Moving them under each other makes a loop and cuts the branch off from the rest of the chart.`,
    );
  }

  const gainer = byId.get(target);
  if (gainer) {
    if (gainer.stage === "Exited" || gainer.stage === "Applicant") {
      problems.push(`${nameOf(gainer)} is ${String(gainer.stage).toLowerCase()} and cannot take reports.`);
    }
    if (subtree.length) {
      warnings.push(
        `${subtree.length} ${subtree.length === 1 ? "person moves" : "people move"} with them — their whole team changes reporting line too.`,
      );
    }
    if (person.account && gainer.account && person.account !== gainer.account) {
      warnings.push(`This moves them from the ${person.account} account to ${gainer.account}. Check the functional manager as well.`);
    }
    if (!losing) warnings.push(`${nameOf(person)} reported to nobody until now, so this is an addition rather than a move.`);
  }

  /* How deep they land. Computed against the *new* parent's chain, which is why
     it is here and not read off the tree — the tree still describes where they
     are, not where they are going. */
  const depth = target && byId.has(target) ? managerChain(target, byId).length + 2 : 0;

  return { problems, warnings, moving: [id, ...subtree], losing, gaining: target || null, depth };
}

/**
 * The effects a settled reporting-line change applies.
 *
 * Only the person named moves. Their reports follow implicitly, because they
 * follow *them* — rewriting every descendant's directManagerId would be both
 * wrong and destructive, since the subtree's internal shape is not changing.
 */
export function moveEffects({ newManagerId = "", alsoFunctional = false, newAccount = "" } = {}) {
  /** @type {Record<string, string>} */
  const employee = { directManagerId: String(newManagerId ?? "") };
  /* Leave routes functional-then-direct, so a transfer between accounts that
     leaves the old functional manager in place sends the new team's leave to
     the old account's manager. Opt-in rather than automatic: plenty of moves
     are within an account and should not touch it. */
  if (alsoFunctional) employee.functionalManagerId = String(newManagerId ?? "");
  if (newAccount) employee.account = String(newAccount);

  return {
    employee,
    events: ["MANAGER_CHANGED", ...(newAccount ? ["TRANSFERRED"] : [])],
  };
}
