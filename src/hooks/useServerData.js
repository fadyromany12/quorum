"use client";

/* The workspace's data layer: server-rendered initial state, mutations via
   the API routes, and the canonical post-mutation state read back from each
   response — the server re-settles deduction caps on every write, so client
   state is always whatever the database now holds.

   DCM edits are the exception: the editor fires per keystroke, so writes are
   debounced and applied optimistically. */

import { useCallback, useRef, useState } from "react";

export function useServerData(initial) {
  const [data, setData] = useState(initial);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState(""); // success toast text; auto-cleared by the UI
  const dcmTimer = useRef(null);

  const call = useCallback(async (url, method, body) => {
    const res = await fetch(url, {
      method,
      headers: { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      const message = json.error || `${method} ${url} failed (${res.status})`;
      setError(message);
      throw new Error(message);
    }
    setError("");
    return json;
  }, []);

  const setEntries = (entries) => setData((d) => ({ ...d, entries }));
  const setUsers = (users) => setData((d) => ({ ...d, users }));
  const swallow = () => {}; // error already surfaced via setError
  const toast = (message) => setNotice(message);

  return {
    data,
    error,
    notice,
    clearError: () => setError(""),
    clearNotice: () => setNotice(""),

    addEntry: (entry) =>
      call("/api/entries", "POST", { entry }).then((r) => {
        setEntries(r.entries);
        toast(`Case logged — ${entry.violation} (${entry.date}).`);
      }, swallow),
    commitRta: (entries) =>
      call("/api/entries", "POST", { entries, source: "rta" }).then((r) => {
        setEntries(r.entries);
        toast(`RTA import committed — ${entries.length} case${entries.length === 1 ? "" : "s"}.`);
      }, swallow),
    patchEntry: (entry) =>
      call(`/api/entries/${entry.id}`, "PATCH", { entry }).then((r) => {
        setEntries(r.entries);
        toast("Case updated.");
      }, swallow),
    // Soft delete: reversible and audited. Restore re-includes it in the
    // engine; purge is the irreversible SuperAdmin erasure.
    deleteEntry: (id) =>
      call(`/api/entries/${id}`, "DELETE").then((r) => {
        setEntries(r.entries);
        toast("Case voided — restore it any time from the Voided filter.");
      }, swallow),
    restoreEntry: (entry) =>
      call(`/api/entries/${entry.id}`, "PATCH", {
        entry: {
          ...entry,
          voided: false,
          activity: [...(entry.activity || []), { at: Date.now(), by: "", type: "restored", text: "Case restored." }],
        },
      }).then((r) => {
        setEntries(r.entries);
        toast("Case restored.");
      }, swallow),
    purgeEntry: (id) =>
      call(`/api/entries/${id}?purge=1`, "DELETE").then((r) => {
        setEntries(r.entries);
        toast("Case permanently deleted.");
      }, swallow),
    resolveAppeal: (caseId, decision, note) =>
      call("/api/cases/appeal/resolve", "POST", { caseId, decision, note }).then((r) => {
        setEntries(r.entries);
        toast(decision === "overturned" ? "Appeal granted — case overturned & dismissed." : "Appeal reviewed — original decision upheld.");
      }, swallow),
    decide: (ids, stage, assignee, comment) =>
      call("/api/entries/decide", "POST", { ids, stage, assignee, comment }).then((r) => {
        setEntries(r.entries);
        toast(
          stage === "active"
            ? `Escalated ${ids.length} case${ids.length === 1 ? "" : "s"} to ${assignee}.`
            : `Dismissed ${ids.length} case${ids.length === 1 ? "" : "s"}.`
        );
      }, swallow),
    loadSamples: () =>
      call("/api/entries/samples", "POST").then((r) => {
        setEntries(r.entries);
        toast("Sample data loaded.");
      }, swallow),

    setDcm: (dcm) => {
      setData((d) => ({ ...d, dcm }));
      clearTimeout(dcmTimer.current);
      dcmTimer.current = setTimeout(
        () => call("/api/dcm", "PUT", { dcm }).then(() => toast("Matrix saved."), swallow),
        800
      );
    },
    setAccounts: (accounts) => {
      setData((d) => ({ ...d, accounts }));
      call("/api/config", "PUT", { accounts, tls: data.tls }).then(() => toast("Accounts saved."), swallow);
    },
    setTls: (tls) => {
      setData((d) => ({ ...d, tls }));
      call("/api/config", "PUT", { accounts: data.accounts, tls }).then(() => toast("Team leads saved."), swallow);
    },

    createUser: (u) => call("/api/users", "POST", u).then((r) => setUsers(r.users)),
    resetUser: (id) => call(`/api/users/${id}`, "PATCH", { reset: true }).then((r) => setUsers(r.users)),
    setUserRole: (id, role) => call(`/api/users/${id}`, "PATCH", { role }).then((r) => setUsers(r.users)),
    deleteUser: (id) => call(`/api/users/${id}`, "DELETE").then((r) => setUsers(r.users)),

    factoryReset: () => call("/api/admin/reset", "POST"),
  };
}
