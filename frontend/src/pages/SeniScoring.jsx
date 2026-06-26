import React, { useEffect, useMemo, useState, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import AppShell from "@/components/AppShell";
import api, { BACKEND_URL } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Toaster, toast } from "sonner";
import { resolvePhotoUrl } from "@/components/PhotoUpload";
import { Trophy, Send, Plus, Trash2, CheckCircle2, AlertOctagon } from "lucide-react";
import { openMatchSocket } from "@/lib/ws";

const PENALTY_CODES = [
  { code: "keluar_gelanggang", label: "Keluar Gelanggang", suggest: 5 },
  { code: "waktu", label: "Waktu Kurang/Lebih", suggest: 5 },
  { code: "kostum", label: "Kostum / Atribut", suggest: 5 },
  { code: "tertahan", label: "Tertahan/Berhenti", suggest: 10 },
  { code: "jatuh", label: "Jatuh", suggest: 5 },
  { code: "lainnya", label: "Lainnya", suggest: 5 },
];

export default function SeniScoring() {
  const { mid } = useParams();
  const nav = useNavigate();
  const { user } = useAuth();
  const [summary, setSummary] = useState(null);

  const load = useCallback(async () => {
    try {
      const r = await api.get(`/matches/${mid}/seni`);
      setSummary(r.data);
    } catch (e) { toast.error(e?.response?.data?.detail || "Gagal memuat"); }
  }, [mid]);

  /* eslint-disable */
  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const ws = openMatchSocket(mid, () => load());
    return () => ws?.close?.();
  }, [mid, load]);
  /* eslint-enable */

  if (!summary) return <AppShell title="Seni Scoring"><div className="p-12 text-center text-zinc-500">Memuat...</div></AppShell>;
  if (!user) return <AppShell title="Seni Scoring"><div className="p-12 text-center text-zinc-500">Memuat sesi...</div></AppShell>;

  const match = summary.match;
  const role = user?.role;
  const isJury = role === "jury";
  const isHead = role === "head_jury" || role === "admin";
  const finalized = match.status === "approved";

  return (
    <AppShell title={`Seni · ${match.discipline?.toUpperCase() || ""}`}>
      <Toaster theme="dark" position="top-right" />
      <PerformerHeader match={match} summary={summary} />

      <div className="mt-6 grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          {isJury && !finalized && <JuryPanel mid={mid} summary={summary} user={user} onChanged={load} />}
          {!isJury && <JuryScoreList summary={summary} />}
        </div>

        <aside className="space-y-4">
          <ScoreSummary summary={summary} />
          {isHead && !finalized && (
            <>
              <PenaltyPanel mid={mid} summary={summary} onChanged={load} />
              <FinalizeBox mid={mid} summary={summary} onDone={() => { load(); }} />
            </>
          )}
          {finalized && <FinalizedBanner summary={summary} onPrint={() => nav(`/report/${mid}`)} />}
        </aside>
      </div>
    </AppShell>
  );
}

function PerformerHeader({ match, summary }) {
  const [athlete, setAthlete] = useState(null);
  useEffect(() => {
    if (match.red_athlete_id) api.get(`/athletes/${match.red_athlete_id}`).then((r) => setAthlete(r.data)).catch(() => {});
  }, [match.red_athlete_id]);
  return (
    <div className="border border-white/10 rounded-sm bg-[#0f0f10] p-5 flex items-center gap-5" data-testid="seni-header">
      <div className="w-24 h-24 rounded-sm bg-[#0a0a0a] border border-white/10 overflow-hidden shrink-0 grid place-items-center">
        {athlete?.photo_url ? <img src={resolvePhotoUrl(athlete.photo_url)} alt="" className="w-full h-full object-cover"/> : <span className="text-zinc-700 text-3xl">—</span>}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-[10px] tracking-[0.3em] uppercase text-[#ffcc00]">Seni {match.discipline?.toUpperCase()}</div>
        <div className="font-display text-3xl tracking-tight mt-1 truncate">{athlete?.name || "—"}</div>
        <div className="text-xs text-zinc-400 mt-1">Match #{match.match_number} · {match.round_label}</div>
      </div>
      <div className="text-right">
        <div className="text-[10px] tracking-[0.3em] uppercase text-zinc-500">Skor Akhir</div>
        <div className="font-mono-display text-5xl text-[#ffcc00]" data-testid="seni-final-score">{summary.final_score.toFixed(2)}</div>
        <div className="text-[10px] text-zinc-500 mt-1">{summary.jury_count} juri · Σ −{summary.total_penalty.toFixed(2)}</div>
      </div>
    </div>
  );
}

function JuryPanel({ mid, summary, user, onChanged }) {
  const myScore = summary.scores.find((s) => s.jury_id === user.id);
  const [form, setForm] = useState({
    jury_position: myScore?.jury_position || 1,
    teknik: myScore?.teknik ?? 55,
    wirama: myScore?.wirama ?? 28,
    penghayatan: myScore?.penghayatan ?? 18,
  });
  const [busy, setBusy] = useState(false);
  const total = useMemo(() => Number(form.teknik || 0) + Number(form.wirama || 0) + Number(form.penghayatan || 0), [form]);

  const submit = async () => {
    setBusy(true);
    try {
      await api.post(`/matches/${mid}/seni/score`, form);
      toast.success("Nilai terkirim");
      onChanged();
    } catch (e) { toast.error(e?.response?.data?.detail || "Gagal"); }
    finally { setBusy(false); }
  };
  const clear = async () => {
    setBusy(true);
    try { await api.delete(`/matches/${mid}/seni/score`); toast.success("Nilai dihapus"); onChanged(); }
    catch (e) { toast.error(e?.response?.data?.detail || "Gagal"); }
    finally { setBusy(false); }
  };

  return (
    <div className="border border-white/10 rounded-sm bg-[#0f0f10] p-6 space-y-5" data-testid="seni-jury-panel">
      <div>
        <div className="text-[10px] tracking-[0.3em] uppercase text-[#ffcc00]">Input Nilai Juri</div>
        <div className="text-xs text-zinc-400 mt-1">Login sebagai <span className="text-white">{user.name}</span>. Nilai dapat diperbarui kapan saja sebelum difinalisasi.</div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <RangeField label="Posisi Juri" min={1} max={9} step={1} value={form.jury_position} onChange={(v) => setForm({ ...form, jury_position: v })} testid="seni-position"/>
        <RangeField label="Teknik (50–60)" min={0} max={60} step={1} value={form.teknik} onChange={(v) => setForm({ ...form, teknik: v })} accent testid="seni-teknik"/>
        <RangeField label="Wirama (25–30)" min={0} max={30} step={1} value={form.wirama} onChange={(v) => setForm({ ...form, wirama: v })} accent testid="seni-wirama"/>
        <RangeField label="Penghayatan (15–20)" min={0} max={20} step={1} value={form.penghayatan} onChange={(v) => setForm({ ...form, penghayatan: v })} accent testid="seni-penghayatan"/>
      </div>

      <div className="flex items-center justify-between border-t border-white/10 pt-4">
        <div>
          <div className="text-[10px] tracking-[0.3em] uppercase text-zinc-500">Total Saya</div>
          <div className="font-mono-display text-4xl text-white" data-testid="seni-my-total">{total.toFixed(2)}</div>
        </div>
        <div className="flex gap-2">
          {myScore && <Button onClick={clear} disabled={busy} variant="ghost" className="text-rose-300 hover:bg-rose-500/10 border border-rose-500/30 rounded-sm uppercase tracking-[0.15em] text-[11px]" data-testid="seni-clear-btn"><Trash2 className="w-3.5 h-3.5 mr-1.5"/>Hapus</Button>}
          <Button onClick={submit} disabled={busy} className="bg-[#ffcc00] hover:bg-[#e6b800] text-black uppercase tracking-[0.15em]" data-testid="seni-submit-btn"><Send className="w-4 h-4 mr-2"/>{myScore ? "Perbarui" : "Kirim"}</Button>
        </div>
      </div>
    </div>
  );
}

function RangeField({ label, min, max, step, value, onChange, accent, testid }) {
  return (
    <div>
      <div className="text-[10px] tracking-[0.2em] uppercase text-zinc-400 flex justify-between">
        <span>{label}</span>
        <span className={`font-mono-display ${accent ? "text-[#ffcc00]" : "text-white"}`}>{Number(value).toFixed(0)}</span>
      </div>
      <input
        type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full mt-2 accent-[#ffcc00]"
        data-testid={testid}
      />
      <Input
        type="number" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="bg-[#0a0a0a] border-white/10 mt-1 text-center font-mono-display"
        data-testid={`${testid}-num`}
      />
    </div>
  );
}

function JuryScoreList({ summary }) {
  if (!summary.scores.length) {
    return (
      <div className="border border-dashed border-white/10 rounded-sm p-12 text-center text-sm text-zinc-500">
        Belum ada nilai juri yang masuk.
      </div>
    );
  }
  return (
    <div className="border border-white/10 rounded-sm bg-[#0f0f10] overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-[#0a0a0a] text-zinc-400 text-[10px] tracking-[0.2em] uppercase">
          <tr>
            <th className="text-left px-4 py-3">#</th>
            <th className="text-left px-4 py-3">Juri</th>
            <th className="text-right px-4 py-3">Teknik</th>
            <th className="text-right px-4 py-3">Wirama</th>
            <th className="text-right px-4 py-3">Pengh.</th>
            <th className="text-right px-4 py-3">Total</th>
          </tr>
        </thead>
        <tbody>
          {summary.scores.map((s) => (
            <tr key={s.jury_id} className="border-t border-white/5" data-testid={`seni-row-${s.jury_position}`}>
              <td className="px-4 py-3 font-mono-display text-[#ffcc00]">J{s.jury_position}</td>
              <td className="px-4 py-3 text-white">{s.jury_name}</td>
              <td className="px-4 py-3 text-right font-mono-display">{s.teknik.toFixed(0)}</td>
              <td className="px-4 py-3 text-right font-mono-display">{s.wirama.toFixed(0)}</td>
              <td className="px-4 py-3 text-right font-mono-display">{s.penghayatan.toFixed(0)}</td>
              <td className="px-4 py-3 text-right font-mono-display text-[#ffcc00] text-base">{s.total.toFixed(2)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ScoreSummary({ summary }) {
  return (
    <div className="border border-white/10 rounded-sm bg-[#0f0f10] p-5">
      <div className="text-[10px] tracking-[0.3em] uppercase text-zinc-400">Ringkasan</div>
      <div className="mt-3 space-y-2 text-sm">
        <Row label="Rata-rata" value={summary.average.toFixed(2)} />
        <Row label="Hukuman" value={`− ${summary.total_penalty.toFixed(2)}`} accent="rose" />
        <div className="border-t border-white/10 pt-2 flex items-center justify-between">
          <div className="text-[10px] tracking-[0.3em] uppercase text-[#ffcc00]">Nilai Akhir</div>
          <div className="font-mono-display text-2xl text-[#ffcc00]">{summary.final_score.toFixed(2)}</div>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value, accent }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-xs text-zinc-400">{label}</span>
      <span className={`font-mono-display ${accent === "rose" ? "text-rose-300" : "text-white"}`}>{value}</span>
    </div>
  );
}

function PenaltyPanel({ mid, summary, onChanged }) {
  const [code, setCode] = useState("keluar_gelanggang");
  const [value, setValue] = useState(5);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);

  const add = async () => {
    setBusy(true);
    try {
      await api.post(`/matches/${mid}/seni/penalty`, { code, value: Number(value), notes });
      toast.success("Hukuman ditambahkan"); setNotes(""); onChanged();
    } catch (e) { toast.error(e?.response?.data?.detail || "Gagal"); }
    finally { setBusy(false); }
  };
  const remove = async (pid) => {
    try { await api.delete(`/matches/${mid}/seni/penalty/${pid}`); toast.success("Hukuman dihapus"); onChanged(); }
    catch (e) { toast.error(e?.response?.data?.detail || "Gagal"); }
  };

  return (
    <div className="border border-white/10 rounded-sm bg-[#0f0f10] p-5 space-y-3" data-testid="seni-penalty-panel">
      <div className="text-[10px] tracking-[0.3em] uppercase text-zinc-400 flex items-center gap-2"><AlertOctagon className="w-3.5 h-3.5"/>Hukuman (Ketua Juri)</div>
      <Select value={code} onValueChange={(v) => { setCode(v); const def = PENALTY_CODES.find((p) => p.code === v); if (def) setValue(def.suggest); }}>
        <SelectTrigger className="bg-[#0a0a0a] border-white/10" data-testid="penalty-code"><SelectValue/></SelectTrigger>
        <SelectContent className="bg-[#141414] border-white/10 text-white">
          {PENALTY_CODES.map((p) => <SelectItem key={p.code} value={p.code}>{p.label}</SelectItem>)}
        </SelectContent>
      </Select>
      <div className="grid grid-cols-3 gap-2">
        <Input type="number" min={0} step={0.5} value={value} onChange={(e) => setValue(e.target.value)} className="bg-[#0a0a0a] border-white/10 col-span-1 font-mono-display text-center" data-testid="penalty-value"/>
        <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Catatan" className="bg-[#0a0a0a] border-white/10 col-span-2" data-testid="penalty-notes"/>
      </div>
      <Button onClick={add} disabled={busy} size="sm" className="w-full bg-rose-500/15 hover:bg-rose-500/25 text-rose-300 border border-rose-500/30 rounded-sm uppercase tracking-[0.15em] text-xs" data-testid="penalty-add-btn"><Plus className="w-3.5 h-3.5 mr-1.5"/>Tambah Hukuman</Button>

      {summary.penalties.length > 0 && (
        <div className="border-t border-white/10 pt-3 space-y-1.5">
          {summary.penalties.map((p) => (
            <div key={p.id} className="flex items-center justify-between text-xs" data-testid={`penalty-row-${p.id}`}>
              <div className="flex-1 min-w-0">
                <div className="text-zinc-300 truncate">{PENALTY_CODES.find((x) => x.code === p.code)?.label || p.code}</div>
                {p.notes && <div className="text-zinc-500 truncate">{p.notes}</div>}
              </div>
              <span className="font-mono-display text-rose-300 mx-2">−{Number(p.value).toFixed(2)}</span>
              <button onClick={() => remove(p.id)} className="text-zinc-500 hover:text-rose-300" data-testid={`penalty-del-${p.id}`}><Trash2 className="w-3.5 h-3.5"/></button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function FinalizeBox({ mid, summary, onDone }) {
  const [busy, setBusy] = useState(false);
  const finalize = async () => {
    if (!summary.jury_count) return toast.error("Belum ada nilai juri");
    if (!window.confirm(`Finalisasi penilaian dengan nilai akhir ${summary.final_score.toFixed(2)}?`)) return;
    setBusy(true);
    try {
      await api.post(`/matches/${mid}/seni/finalize`);
      toast.success("Penilaian difinalisasi");
      onDone();
    } catch (e) { toast.error(e?.response?.data?.detail || "Gagal"); }
    finally { setBusy(false); }
  };
  return (
    <Button onClick={finalize} disabled={busy} className="w-full bg-[#ffcc00] hover:bg-[#e6b800] text-black uppercase tracking-[0.15em] rounded-sm" data-testid="seni-finalize-btn">
      <CheckCircle2 className="w-4 h-4 mr-2"/>Finalisasi & Setujui
    </Button>
  );
}

function FinalizedBanner({ summary, onPrint }) {
  return (
    <div className="border-2 border-[#ffcc00] bg-[#ffcc00]/5 rounded-sm p-5 text-center" data-testid="seni-finalized">
      <Trophy className="w-10 h-10 mx-auto text-[#ffcc00] mb-2"/>
      <div className="text-[10px] tracking-[0.3em] uppercase text-[#ffcc00]">Nilai Final Disahkan</div>
      <div className="font-mono-display text-4xl text-[#ffcc00] mt-2">{summary.final_score.toFixed(2)}</div>
      <Button onClick={onPrint} size="sm" className="mt-4 bg-white/5 hover:bg-white/10 text-white border border-white/10 rounded-sm uppercase tracking-[0.15em] text-xs"><Send className="w-3.5 h-3.5 mr-1.5"/>Lihat Laporan</Button>
    </div>
  );
}
