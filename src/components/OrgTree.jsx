"use client";

/* The reporting chart.

   `directManagerId` has been on the record from the start and had only ever
   been read one hop at a time. Nobody could look at the tree, so the questions
   managers actually ask — how many people are under me, is anyone reporting to
   somebody who left — had no answer anywhere in the product.

   Rendered as an indented outline rather than boxes and connector lines. A BPO
   chart is wide and shallow; drawn as a diagram it is either unreadable or an
   afternoon of SVG, and an outline collapses, searches and reads on a phone,
   which the diagram would not.

   What is deliberately shown next to each name: direct reports and total
   headcount, because a lead with four agents and a manager with four leads
   under them are not the same number and one number cannot say both. */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Network, ChevronRight, ChevronDown, TriangleAlert, Users, Search } from "lucide-react";
import { Card, Muted, Pill, TInput } from "./ui/index.jsx";
import { P, alpha } from "../lib/tokens.js";

/* Everything at or below a node whose name matches, plus its ancestors — a
   filtered chart that dropped the parents would show people floating. */
function filterTree(node, q) {
  const hit = !q || `${node.name} ${node.employee?.jobTitle ?? ""} ${node.employee?.empId ?? ""}`.toLowerCase().includes(q);
  const kids = node.children.map((c) => filterTree(c, q)).filter(Boolean);
  if (!hit && !kids.length) return null;
  return { ...node, children: kids, matched: hit };
}

function Node({ node, depth, open, toggle, meId, q }) {
  const isOpen = open.has(node.id) || Boolean(q);
  const hasKids = node.children.length > 0;
  const isMe = node.id === meId;

  return (
    <div>
      <div
        className="flex items-center gap-1.5"
        style={{
          paddingInlineStart: depth * 16,
          paddingBlock: 3,
          borderRadius: 6,
          background: isMe ? P.signalWash : "transparent",
        }}
      >
        <button
          type="button"
          onClick={() => hasKids && toggle(node.id)}
          aria-label={hasKids ? (isOpen ? "Collapse" : "Expand") : undefined}
          disabled={!hasKids}
          style={{ width: 16, color: P.sub, opacity: hasKids ? 1 : 0, cursor: hasKids ? "pointer" : "default" }}
        >
          {isOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        </button>

        <span style={{ fontSize: 13, fontWeight: isMe ? 700 : node.managerOfManagers ? 600 : 400 }}>
          {node.name}
        </span>
        {node.employee?.jobTitle && (
          <span style={{ fontSize: 11.5, color: P.sub }}>{node.employee.jobTitle}</span>
        )}

        {/* Two numbers because they answer different questions. */}
        {hasKids && (
          <span className="ao-mono" style={{ fontSize: 11, color: P.sub }} title={`${node.span} direct · ${node.headcount} in total`}>
            {node.span}
            {node.headcount !== node.span && <span style={{ opacity: 0.6 }}> / {node.headcount}</span>}
          </span>
        )}

        {node.cycle && <Pill color={P.brick} filled><TriangleAlert size={10} />loop</Pill>}
        {node.orphaned && <Pill color={P.amber}>manager missing</Pill>}
        {node.looped && <Pill color={P.brick} filled>in a loop</Pill>}
      </div>

      {isOpen &&
        node.children.map((c) => (
          <Node key={c.id} node={c} depth={depth + 1} open={open} toggle={toggle} meId={meId} q={q} />
        ))}
    </div>
  );
}

export default function OrgTree() {
  const [data, setData] = useState(null);
  const [open, setOpen] = useState(new Set());
  const [q, setQ] = useState("");

  const load = useCallback(async () => {
    const res = await fetch("/api/org");
    const j = await res.json().catch(() => ({}));
    if (res.ok) {
      setData(j);
      // Open the top two levels: a fully collapsed chart tells you nothing, and
      // a fully expanded one is a list of everybody.
      const ids = new Set();
      for (const r of j.roots ?? []) {
        ids.add(r.id);
        for (const c of r.children ?? []) ids.add(c.id);
      }
      setOpen(ids);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const toggle = useCallback((id) => {
    setOpen((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const needle = q.trim().toLowerCase();
  const roots = useMemo(
    () => (data?.roots ?? []).map((r) => filterTree(r, needle)).filter(Boolean),
    [data, needle],
  );

  if (!data) {
    return (
      <Card title={<span className="inline-flex items-center gap-2"><Network size={14} />Reporting chart</span>}>
        <Muted>Loading the chart…</Muted>
      </Card>
    );
  }

  return (
    <Card
      title={<span className="inline-flex items-center gap-2"><Network size={14} />Reporting chart</span>}
      right={<Pill color={P.sub}><Users size={11} />{data.total}</Pill>}
    >
      <Muted>
        Everyone you can see, by who they report to. The two numbers are direct reports and everyone beneath.
        {data.me?.managesManagers && " You manage managers, so your skip level is here too — " +
          `${data.me.skipLevel} people below your direct reports.`}
      </Muted>

      {/* Problems break approval routing, so they sit above the chart rather
          than being something you notice by scrolling. */}
      {data.problems?.length > 0 && (
        <div
          className="mt-3 p-3"
          style={{ background: P.brickWash, border: `1px solid ${alpha(P.brick, 0.4)}`, borderRadius: 8, fontSize: 12.5 }}
        >
          <strong style={{ color: P.brick }}>This chart is broken in {data.problems.length} place{data.problems.length === 1 ? "" : "s"}.</strong>
          <ul className="mt-1" style={{ listStyle: "disc", paddingInlineStart: 18, color: P.inkSoft }}>
            {data.problems.map((p) => <li key={p}>{p}</li>)}
          </ul>
        </div>
      )}
      {data.warnings?.length > 0 && (
        <div className="mt-2" style={{ fontSize: 12, color: P.amber }}>
          {data.warnings.map((w) => <div key={w}>{w}</div>)}
        </div>
      )}

      <div className="mt-3 flex items-center gap-2">
        <Search size={14} style={{ color: P.sub, flexShrink: 0 }} />
        <TInput value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a name, title or employee id" />
      </div>

      <div className="mt-3" style={{ overflowX: "auto" }}>
        {roots.length === 0 ? (
          <Muted>{needle ? "Nobody here matches that." : "Nobody to chart yet."}</Muted>
        ) : (
          roots.map((r) => (
            <Node key={r.id} node={r} depth={0} open={open} toggle={toggle} meId={data.me?.id} q={needle} />
          ))
        )}
      </div>
    </Card>
  );
}
