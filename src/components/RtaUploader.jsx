/* Tab B — the RTA bulk uploader (WFM's whole world).

   Drop or paste the daily RTA export, see every row classified before anything
   is committed, then push: irregular rows to the triage gate, fully-compensated
   rows straight to Approved / Acknowledged, clean rows nowhere. */

import { useMemo, useRef, useState } from "react";
import { UploadCloud, FileSpreadsheet, ClipboardPaste, Download, Send, X, CircleCheck, CircleAlert } from "lucide-react";
import { Card, Pill, Muted, BtnPrimary, BtnGhost, TSelect, TArea, Label } from "./ui/index.jsx";
import { P, sevColor, alpha } from "../lib/tokens.js";
import { fmtMin, plural } from "../lib/format.js";
import { assessRta, buildEntries, TEMPLATE_CSV } from "../lib/rta.js";
import { AUTO_ACK_ACTION } from "../lib/compensation.js";

const CLS_STYLE = {
  irregular: { label: "To triage", color: P.amber, filled: true },
  compensated: { label: "Auto-ack", color: P.green, filled: true },
  duplicate: { label: "Duplicate", color: P.petrol, filled: false },
  clean: { label: "Clean", color: P.sub, filled: false },
  error: { label: "Error", color: P.brick, filled: true },
};

export default function RtaUploader({ data, me, onCommit }) {
  const [account, setAccount] = useState(data.accounts[0] || "");
  const [fileName, setFileName] = useState("");
  const [text, setText] = useState("");
  const [pasteMode, setPasteMode] = useState(false);
  const [pasteDraft, setPasteDraft] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [result, setResult] = useState(null);
  const inputRef = useRef(null);

  const assessed = useMemo(() => (text ? assessRta(text, data.dcm, data.entries) : null), [text, data.dcm, data.entries]);

  const readFile = async (file) => {
    if (!file) return;
    if (/\.xlsx?$/i.test(file.name)) {
      setFileName("");
      setText("");
      setResult({ error: `“${file.name}” is an Excel workbook — export it as CSV (File → Save As → CSV) and drop that instead.` });
      return;
    }
    setResult(null);
    setFileName(file.name);
    setText(await file.text());
  };

  const commit = () => {
    if (!assessed || assessed.error) return;
    const { entries, toTriage, acked } = buildEntries(assessed.rows, {
      account,
      entries: data.entries,
      dcm: data.dcm,
      uploadedBy: me.name,
    });
    onCommit(entries);
    setResult({
      toTriage,
      acked,
      skipped: assessed.counts.clean || 0,
      duplicates: assessed.counts.duplicate || 0,
      errors: assessed.counts.error || 0,
    });
    setText("");
    setFileName("");
    setPasteDraft("");
  };

  const clear = () => {
    setText("");
    setFileName("");
    setResult(null);
  };

  const downloadTemplate = () => {
    const blob = new Blob(["﻿" + TEMPLATE_CSV], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "rta-template.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="grid gap-4">
      <Card
        title="RTA bulk upload"
        right={
          <div className="flex items-center gap-2">
            <span style={{ fontSize: 11.5, color: P.sub }}>Account</span>
            <TSelect value={account} onChange={(e) => setAccount(e.target.value)} style={{ width: 130, fontSize: 13, padding: "5px 8px" }}>
              {data.accounts.map((a) => (
                <option key={a}>{a}</option>
              ))}
            </TSelect>
          </div>
        }
      >
        <Muted>
          Import the daily Real-Time Adherence sheet. Irregular rows (tardy, absent, missing hours) are piped to the
          Manager Triage Gate; rows whose lost time is fully compensated are logged as “{AUTO_ACK_ACTION.split(" — ")[0]}”
          automatically; clean rows are skipped.
        </Muted>

        {!text && (
          <>
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                readFile(e.dataTransfer.files?.[0]);
              }}
              onClick={() => inputRef.current?.click()}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && inputRef.current?.click()}
              className="mt-4 p-8 text-center"
              style={{
                border: `2px dashed ${dragOver ? P.petrol : P.line}`,
                background: dragOver ? P.signalWash : "var(--well)",
                borderRadius: 12,
                cursor: "pointer",
              }}
            >
              <UploadCloud size={28} color={dragOver ? P.petrol : P.sub} style={{ margin: "0 auto" }} />
              <div className="ao-disp font-bold uppercase tracking-wide mt-2" style={{ fontSize: 14, color: P.ink }}>
                Drop the RTA file here
              </div>
              <div className="mt-1" style={{ fontSize: 12.5, color: P.sub }}>
                CSV or tab-separated · or click to browse
              </div>
              <input
                ref={inputRef}
                type="file"
                accept=".csv,.tsv,.txt"
                style={{ display: "none" }}
                onChange={(e) => readFile(e.target.files?.[0])}
              />
            </div>

            <div className="flex items-center gap-2 mt-3 flex-wrap">
              <BtnGhost icon={ClipboardPaste} onClick={() => setPasteMode((m) => !m)}>
                Paste rows instead
              </BtnGhost>
              <BtnGhost icon={Download} onClick={downloadTemplate}>
                Download template
              </BtnGhost>
            </div>

            {pasteMode && (
              <div className="mt-3">
                <Label>Paste the sheet (header row included)</Label>
                <div className="mt-1">
                  <TArea
                    value={pasteDraft}
                    onChange={(e) => setPasteDraft(e.target.value)}
                    placeholder={"LOB,Date,Employee Name,Employee ID,…"}
                    style={{ minHeight: 120, fontFamily: "IBM Plex Mono, monospace", fontSize: 12 }}
                  />
                </div>
                <div className="flex justify-end mt-2">
                  <BtnPrimary
                    disabled={!pasteDraft.trim()}
                    onClick={() => {
                      setResult(null);
                      setFileName("(pasted)");
                      setText(pasteDraft);
                    }}
                  >
                    Preview
                  </BtnPrimary>
                </div>
              </div>
            )}
          </>
        )}

        {result?.error && (
          <div className="mt-3 flex items-start gap-2 p-3" style={{ background: P.brickWash, border: `1px solid ${alpha(P.brick, 0.33)}`, borderRadius: 8 }}>
            <CircleAlert size={15} color={P.brick} style={{ flexShrink: 0, marginTop: 1 }} />
            <span style={{ fontSize: 12.5, color: P.inkSoft }}>{result.error}</span>
          </div>
        )}

        {result && !result.error && (
          <div className="mt-3 flex items-start gap-2 p-3" style={{ background: P.greenWash, border: `1px solid ${alpha(P.green, 0.33)}`, borderRadius: 8 }}>
            <CircleCheck size={15} color={P.green} style={{ flexShrink: 0, marginTop: 1 }} />
            <span style={{ fontSize: 12.5, color: P.inkSoft }}>
              Committed: <b>{plural(result.toTriage, "case")}</b> to the triage gate, <b>{result.acked}</b> auto-acknowledged
              (fully compensated), {result.skipped} clean row{result.skipped === 1 ? "" : "s"} skipped
              {result.duplicates ? `, ${plural(result.duplicates, "duplicate")} skipped` : ""}
              {result.errors ? `, ${plural(result.errors, "unreadable row")} ignored` : ""}.
            </span>
          </div>
        )}
      </Card>

      {assessed && (
        <Card
          title={
            <span className="inline-flex items-center gap-2">
              <FileSpreadsheet size={14} />
              Preview · {fileName}
            </span>
          }
          right={
            <button onClick={clear} className="inline-flex items-center gap-1" style={{ border: "none", background: "none", cursor: "pointer", fontSize: 12, color: P.sub }}>
              <X size={13} />
              Discard
            </button>
          }
        >
          {assessed.error ? (
            <div className="flex items-start gap-2 p-3" style={{ background: P.brickWash, border: `1px solid ${alpha(P.brick, 0.33)}`, borderRadius: 8 }}>
              <CircleAlert size={15} color={P.brick} style={{ flexShrink: 0, marginTop: 1 }} />
              <span style={{ fontSize: 12.5, color: P.inkSoft }}>{assessed.error}</span>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2 flex-wrap">
                {Object.entries(CLS_STYLE).map(([cls, s]) =>
                  assessed.counts[cls] ? (
                    <Pill key={cls} color={s.color} filled={s.filled}>
                      {assessed.counts[cls]} {s.label}
                    </Pill>
                  ) : null
                )}
              </div>

              <div className="mt-3" style={{ overflowX: "auto", border: `1px solid ${P.line}`, borderRadius: 8 }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                  <thead>
                    <tr style={{ background: P.mist }}>
                      {["", "Line", "Date", "Agent", "ID", "LOB", "Status", "Violation", "Lost", "Comp", "Net", "Note"].map((h) => (
                        <th key={h} className="ao-disp uppercase tracking-wider text-left" style={{ fontSize: 9.5, color: P.sub, padding: "6px 8px", whiteSpace: "nowrap" }}>
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {assessed.rows.slice(0, 200).map((r) => {
                      const s = CLS_STYLE[r.cls];
                      const sev = r.violation ? data.dcm.find((x) => x.name === r.violation)?.severity : null;
                      return (
                        <tr key={r.line} style={{ borderTop: `1px solid ${P.mist}`, opacity: r.cls === "clean" ? 0.55 : 1 }}>
                          <td style={{ padding: "5px 8px" }}>
                            <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: 999, background: s.color }} />
                          </td>
                          <td className="ao-mono" style={{ padding: "5px 8px", color: P.sub }}>{r.line}</td>
                          <td className="ao-mono" style={{ padding: "5px 8px", whiteSpace: "nowrap" }}>{r.date || r.rawDate || "—"}</td>
                          <td style={{ padding: "5px 8px", whiteSpace: "nowrap" }}>{r.name || "—"}</td>
                          <td className="ao-mono" style={{ padding: "5px 8px" }}>{r.empId || "—"}</td>
                          <td style={{ padding: "5px 8px" }}>{r.lob || "—"}</td>
                          <td style={{ padding: "5px 8px" }}>{r.status || "—"}</td>
                          <td style={{ padding: "5px 8px", color: sev ? sevColor(sev) : P.inkSoft, whiteSpace: "nowrap" }}>{r.violation || "—"}</td>
                          <td className="ao-mono" style={{ padding: "5px 8px", color: r.lost ? P.brick : P.sub }}>{r.lost ? fmtMin(r.lost) : "—"}</td>
                          <td className="ao-mono" style={{ padding: "5px 8px", color: r.comp ? P.green : P.sub }}>{r.comp ? fmtMin(r.comp) : "—"}</td>
                          <td className="ao-mono" style={{ padding: "5px 8px", color: r.net ? P.brick : P.sub }}>{r.net ? fmtMin(r.net) : "—"}</td>
                          <td style={{ padding: "5px 8px", color: r.err ? P.brick : P.sub, whiteSpace: "nowrap" }}>{r.err || s.label}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {assessed.rows.length > 200 && (
                  <div className="p-2 text-center" style={{ fontSize: 11.5, color: P.sub }}>
                    Showing the first 200 of {assessed.rows.length} rows — all of them commit.
                  </div>
                )}
              </div>

              <div className="flex items-center justify-end gap-3 mt-3">
                <span style={{ fontSize: 12, color: P.sub }}>
                  Committing to <b>{account}</b> as {me.name}
                </span>
                <BtnPrimary
                  icon={Send}
                  disabled={!((assessed.counts.irregular || 0) + (assessed.counts.compensated || 0))}
                  onClick={commit}
                >
                  Commit {(assessed.counts.irregular || 0) + (assessed.counts.compensated || 0)} rows
                </BtnPrimary>
              </div>
            </>
          )}
        </Card>
      )}
    </div>
  );
}
