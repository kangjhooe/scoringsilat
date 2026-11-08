import React, { useEffect, useMemo, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import AppShell from "@/components/AppShell";
import api, { BACKEND_URL } from "@/lib/api";
import axios from "axios";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Toaster, toast } from "sonner";
import { resolvePhotoUrl } from "@/components/PhotoUpload";
import { PrintLetterhead, printFileTitle, usePrintTitle } from "@/components/PrintDocument";
import { Plus, Trash2, Play, Printer, Eye, Trophy, Crown, ArrowRight, FileText, Layers, GripVertical } from "lucide-react";

const PUB = axios.create({ baseURL: `${BACKEND_URL}/api` });

const STATUS_LABEL = { draft: "Draft", running: "Berjalan", completed: "Selesai" };
const STATUS_COLOR = {
  draft: "bg-zinc-500/10 text-zinc-300 border-zinc-500/30",
  running: "bg-emerald-500/10 text-emerald-300 border-emerald-500/30",
  completed: "bg-[#ffcc00]/15 text-[#ffcc00] border-[#ffcc00]/40",
};

export function BracketsList() {
  const nav = useNavigate();
  const [events, setEvents] = useState([]);
  const [eventId, setEventId] = useState(localStorage.getItem("admin_event_id") || "");
  const [brackets, setBrackets] = useState([]);
  const [classes, setClasses] = useState([]);
  const [arenas, setArenas] = useState([]);
  const [rules, setRules] = useState([]);
  const [open, setOpen] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkResult, setBulkResult] = useState(null);
  const [bulk, setBulk] = useState({ arena_id: "", scoring_rule_id: "" });
  const [form, setForm] = useState({ name: "Bracket", class_id: "", size: 8, auto_fill: true, arena_id: "", scoring_rule_id: "" });

  const load = async () => {
    if (!eventId) { setBrackets([]); return; }
    const r = await api.get("/brackets", { params: { event_id: eventId } });
    setBrackets(r.data || []);
  };

  useEffect(() => { api.get("/events").then((r) => setEvents(r.data || [])); }, []);
  /* eslint-disable */
  useEffect(() => {
    if (!eventId) return;
    Promise.all([
      api.get("/classes", { params: { event_id: eventId } }),
      api.get("/arenas", { params: { event_id: eventId } }),
      api.get("/scoring-rules", { params: { event_id: eventId } }),
    ]).then(([c, a, r]) => {
      setClasses(c.data || []); setArenas(a.data || []); setRules(r.data || []);
    });
    load();
  }, [eventId]);
  /* eslint-enable */

  const create = async () => {
    if (!form.arena_id || !form.scoring_rule_id) return toast.error("Pilih arena dan aturan skoring");
    try {
      const r = await api.post("/brackets", { event_id: eventId, ...form, size: Number(form.size) });
      toast.success("Bracket dibuat");
      setOpen(false);
      load();
      nav(`/brackets/${r.data.id}`);
    } catch (e) { toast.error(e?.response?.data?.detail || "Gagal"); }
  };

  const tandingRules = rules.filter((rule) => (rule.category_type || "tanding") === "tanding");

  const openBulk = () => {
    const ruleOptions = tandingRules.length ? tandingRules : rules;
    setBulk({
      arena_id: bulk.arena_id || arenas[0]?.id || "",
      scoring_rule_id: bulk.scoring_rule_id || ruleOptions.find((rule) => rule.is_default)?.id || ruleOptions[0]?.id || "",
    });
    setBulkResult(null);
    setBulkOpen(true);
  };

  const generateAll = async () => {
    if (!bulk.arena_id || !bulk.scoring_rule_id) return toast.error("Pilih arena dan aturan skoring");
    setBulkBusy(true);
    try {
      const r = await api.post("/brackets/generate", { event_id: eventId, ...bulk });
      setBulkResult(r.data);
      const made = r.data?.created?.length || 0;
      if (made) toast.success(`${made} bagan dibuat`);
      else toast.message("Tidak ada bagan baru");
      load();
    } catch (e) { toast.error(e?.response?.data?.detail || "Gagal membuat bagan"); }
    finally { setBulkBusy(false); }
  };

  const remove = async (id, status) => {
    const msg = status && status !== "draft"
      ? "Hapus bracket ini beserta semua pertandingan yang sudah dibuat? Tindakan ini tidak bisa dibatalkan."
      : "Hapus bracket ini?";
    if (!window.confirm(msg)) return;
    try { await api.delete(`/brackets/${id}`); toast.success("Terhapus"); load(); }
    catch (e) { toast.error(e?.response?.data?.detail || "Gagal hapus"); }
  };

  return (
    <AppShell title="Bracket Pertandingan">
      <Toaster theme="dark" position="top-right" />
      <div className="flex items-center justify-between mb-6 gap-4 flex-wrap">
        <div>
          <h1 className="font-display text-3xl tracking-tight uppercase">Bracket</h1>
          <p className="text-sm text-zinc-400 mt-1">Bagan gugur per kelas. Buat satu kelas, atau sekaligus untuk semua kelas tanding yang punya peserta aktif.</p>
        </div>
        <div className="flex gap-2 items-center">
          <Select value={eventId} onValueChange={(v) => { setEventId(v); localStorage.setItem("admin_event_id", v); }}>
            <SelectTrigger className="bg-[#141414] border-white/40 text-white w-72" data-testid="bracket-event-select"><SelectValue placeholder="Pilih event"/></SelectTrigger>
            <SelectContent className="bg-[#141414] border-white/30 text-white">
              {events.map((e) => <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button onClick={openBulk} disabled={!eventId} variant="ghost" className="border border-white/10 hover:bg-white/5 text-white rounded-sm uppercase tracking-[0.15em] text-xs" data-testid="bracket-generate-btn"><Layers className="w-4 h-4 mr-1"/>Semua Kelas</Button>
          <Button onClick={() => setOpen(true)} disabled={!eventId} className="bg-[#ffcc00] hover:bg-[#e6b800] text-black rounded-sm uppercase tracking-[0.15em] text-xs" data-testid="bracket-add-btn"><Plus className="w-4 h-4 mr-1"/>Bracket</Button>
        </div>
      </div>

      {brackets.length === 0 ? (
        <div className="border border-dashed border-white/10 rounded-sm p-12 text-center text-sm text-zinc-500">
          {eventId ? "Belum ada bracket pada event ini." : "Pilih event terlebih dahulu."}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {brackets.map((b) => (
            <div key={b.id} className="border border-white/10 rounded-sm bg-[#0f0f10] p-5 hover:bg-white/[0.02] transition-colors" data-testid={`bracket-card-${b.id}`}>
              <div className="flex items-start justify-between">
                <div>
                  <div className="text-[10px] tracking-[0.3em] uppercase text-zinc-500">Bracket · {b.size} slot</div>
                  <div className="font-display text-xl tracking-tight mt-1">{b.name}</div>
                </div>
                <span className={`px-2 py-0.5 text-[10px] tracking-[0.2em] uppercase border rounded-sm ${STATUS_COLOR[b.status] || "border-white/10 text-zinc-300"}`}>{STATUS_LABEL[b.status] || b.status}</span>
              </div>
              <div className="mt-4 flex items-center gap-2">
                <Link to={`/brackets/${b.id}`} className="flex-1">
                  <Button size="sm" className="w-full bg-white/5 hover:bg-white/10 text-white border border-white/10 rounded-sm uppercase tracking-[0.15em] text-[10px]" data-testid={`bracket-view-${b.id}`}><Eye className="w-3.5 h-3.5 mr-2"/>Lihat</Button>
                </Link>
                <Link to={`/print/bracket/${b.id}`}>
                  <Button size="sm" className="bg-white/5 hover:bg-white/10 text-white border border-white/10 rounded-sm" data-testid={`bracket-paper-${b.id}`} title="Versi kertas"><FileText className="w-3.5 h-3.5"/></Button>
                </Link>
                <Button size="sm" onClick={() => remove(b.id, b.status)} className="bg-rose-500/15 hover:bg-rose-500/25 text-rose-300 border border-rose-500/30 rounded-sm" data-testid={`bracket-del-${b.id}`}><Trash2 className="w-3.5 h-3.5"/></Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="bg-[#0f0f10] border-white/10 text-white">
          <DialogHeader><DialogTitle className="font-display text-2xl tracking-tight uppercase">Buat Bracket</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <Row label="Nama"><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="bg-[#0a0a0a] border-white/10" data-testid="bracket-name-input"/></Row>
            <Row label="Kelas"><Select value={form.class_id} onValueChange={(v) => setForm({ ...form, class_id: v })}>
              <SelectTrigger className="bg-[#0a0a0a] border-white/10" data-testid="bracket-class-select"><SelectValue placeholder="Pilih kelas"/></SelectTrigger>
              <SelectContent className="bg-[#141414] border-white/10 text-white">
                {classes.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select></Row>
            <div className="grid grid-cols-2 gap-3">
              <Row label="Arena Default"><Select value={form.arena_id} onValueChange={(v) => setForm({ ...form, arena_id: v })}>
                <SelectTrigger className="bg-[#0a0a0a] border-white/10" data-testid="bracket-arena-select"><SelectValue placeholder="Pilih arena"/></SelectTrigger>
                <SelectContent className="bg-[#141414] border-white/10 text-white">
                  {arenas.map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
                </SelectContent>
              </Select></Row>
              <Row label="Aturan Skoring"><Select value={form.scoring_rule_id} onValueChange={(v) => setForm({ ...form, scoring_rule_id: v })}>
                <SelectTrigger className="bg-[#0a0a0a] border-white/10" data-testid="bracket-rule-select"><SelectValue placeholder="Pilih aturan"/></SelectTrigger>
                <SelectContent className="bg-[#141414] border-white/10 text-white">
                  {rules.map((r) => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}
                </SelectContent>
              </Select></Row>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Row label="Ukuran Bracket"><Select value={String(form.size)} onValueChange={(v) => setForm({ ...form, size: Number(v) })}>
                <SelectTrigger className="bg-[#0a0a0a] border-white/10" data-testid="bracket-size-select"><SelectValue/></SelectTrigger>
                <SelectContent className="bg-[#141414] border-white/10 text-white">
                  {[2,4,8,16,32].map((s) => <SelectItem key={s} value={String(s)}>{s} peserta</SelectItem>)}
                </SelectContent>
              </Select></Row>
              <Row label="Isi Otomatis">
                <label className="flex items-center gap-2 text-sm text-zinc-300 h-10">
                  <input type="checkbox" checked={form.auto_fill} onChange={(e) => setForm({ ...form, auto_fill: e.target.checked })} data-testid="bracket-autofill"/>
                  Acak dari peserta aktif
                </label>
              </Row>
            </div>
          </div>
          <DialogFooter><Button onClick={create} className="bg-[#ffcc00] hover:bg-[#e6b800] text-black uppercase tracking-[0.15em]" data-testid="bracket-create-confirm">Buat</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={bulkOpen} onOpenChange={setBulkOpen}>
        <DialogContent className="bg-[#0f0f10] border-white/10 text-white max-h-[85vh] overflow-y-auto">
          <DialogHeader><DialogTitle className="font-display text-2xl tracking-tight uppercase">Bagan Semua Kelas</DialogTitle></DialogHeader>
          <p className="text-sm text-zinc-400">Satu bagan draft untuk setiap kelas tanding yang punya peserta aktif. Ukuran mengikuti jumlah peserta. Kelas yang sudah punya bagan dilewati. Bagan belum dimulai.</p>
          <div className="space-y-4">
            <Row label="Arena"><Select value={bulk.arena_id} onValueChange={(v) => setBulk({ ...bulk, arena_id: v })}>
              <SelectTrigger className="bg-[#0a0a0a] border-white/10" data-testid="bracket-generate-arena"><SelectValue placeholder="Pilih arena"/></SelectTrigger>
              <SelectContent className="bg-[#141414] border-white/10 text-white">
                {arenas.map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
              </SelectContent>
            </Select></Row>
            <Row label="Aturan Skoring"><Select value={bulk.scoring_rule_id} onValueChange={(v) => setBulk({ ...bulk, scoring_rule_id: v })}>
              <SelectTrigger className="bg-[#0a0a0a] border-white/10" data-testid="bracket-generate-rule"><SelectValue placeholder="Pilih aturan"/></SelectTrigger>
              <SelectContent className="bg-[#141414] border-white/10 text-white">
                {(tandingRules.length ? tandingRules : rules).map((r) => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}
              </SelectContent>
            </Select></Row>
          </div>
          {bulkResult && (
            <div className="space-y-3 text-sm" data-testid="bracket-generate-result">
              <div>
                <div className="text-[10px] tracking-[0.2em] uppercase text-zinc-500 mb-1">Dibuat ({bulkResult.created?.length || 0})</div>
                {(bulkResult.created || []).length === 0 ? <div className="text-zinc-500">Tidak ada.</div> : (
                  <ul className="space-y-1">
                    {bulkResult.created.map((item) => (
                      <li key={item.id} className="text-zinc-200">{item.name} · {item.size} slot · {item.athlete_count} peserta</li>
                    ))}
                  </ul>
                )}
              </div>
              {(bulkResult.skipped || []).length > 0 && (
                <div>
                  <div className="text-[10px] tracking-[0.2em] uppercase text-zinc-500 mb-1">Dilewati ({bulkResult.skipped.length})</div>
                  <ul className="space-y-1">
                    {bulkResult.skipped.map((item) => (
                      <li key={item.class_id} className="text-zinc-400">{item.name} — {item.reason}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button onClick={generateAll} disabled={bulkBusy} className="bg-[#ffcc00] hover:bg-[#e6b800] text-black uppercase tracking-[0.15em]" data-testid="bracket-generate-confirm">{bulkBusy ? "Membuat..." : "Buat Bagan"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}

export function BracketView({ publicMode = false }) {
  const { bid } = useParams();
  const nav = useNavigate();
  const [data, setData] = useState(null);
  const [athletes, setAthletes] = useState([]); // for slot assignment dropdown
  const [dragOverId, setDragOverId] = useState(null);

  const load = async () => {
    const r = publicMode ? await PUB.get(`/public/brackets/${bid}`) : await api.get(`/brackets/${bid}`);
    setData(r.data);
    if (!publicMode && r.data?.event_id) {
      const a = await api.get("/athletes", { params: { event_id: r.data.event_id } });
      setAthletes(a.data || []);
    }
  };

  /* eslint-disable */
  useEffect(() => { load(); }, [bid]);
  /* eslint-enable */

  const rounds = useMemo(() => {
    if (!data?.slots) return [];
    const max = data.slots.reduce((m, s) => Math.max(m, s.round), 0);
    const out = [];
    for (let r = 1; r <= max; r++) {
      out.push(data.slots.filter((s) => s.round === r).sort((a, b) => a.position - b.position));
    }
    return out;
  }, [data]);

  const start = async () => {
    if (!window.confirm("Mulai bracket? Setelah dimulai, posisi slot tidak dapat diubah.")) return;
    try { await api.post(`/brackets/${bid}/start`); toast.success("Bracket dimulai"); load(); }
    catch (e) { toast.error(e?.response?.data?.detail || "Gagal"); }
  };

  const assignSlot = async (slotId, athleteId) => {
    try { await api.put(`/brackets/${bid}/slots/${slotId}`, { athlete_id: athleteId || null }); load(); }
    catch (e) { toast.error(e?.response?.data?.detail || "Gagal"); }
  };

  const swapSlots = async (fromId, toId) => {
    if (!fromId || !toId || fromId === toId) return;
    try {
      const r = await api.post(`/brackets/${bid}/slots/swap`, { slot_a: fromId, slot_b: toId });
      setData(r.data);
    } catch (e) { toast.error(e?.response?.data?.detail || "Gagal menukar slot"); }
  };

  const remove = async () => {
    const msg = data?.status && data.status !== "draft"
      ? "Hapus bracket ini beserta semua pertandingan yang sudah dibuat? Tindakan ini tidak bisa dibatalkan."
      : "Hapus bracket ini?";
    if (!window.confirm(msg)) return;
    try {
      await api.delete(`/brackets/${bid}`);
      toast.success("Terhapus");
      nav("/brackets");
    } catch (e) { toast.error(e?.response?.data?.detail || "Gagal hapus"); }
  };

  usePrintTitle(data ? printFileTitle(["Bagan", data.class_name || data.name, data.event?.name]) : "");

  if (!data) return <Wrap publicMode={publicMode}><div className="p-12 text-center text-zinc-500">Memuat...</div></Wrap>;

  const winner = data.status === "completed" ? data.slots.find((s) => s.round === Math.max(...data.slots.map((x) => x.round)))?.athlete : null;

  return (
    <Wrap publicMode={publicMode}>
      <div className="print-landscape bracket-screen">
      <Toaster theme="dark" position="top-right" />
      <div className="hidden print:block mb-4 text-black">
        <PrintLetterhead event={data.event} documentTitle="Bagan Pertandingan" />
        <div className="text-center">
          <div className="text-xl font-bold">{data.name}</div>
          <div className="text-sm">{[data.class_name || "Tanpa kelas", `${data.size} peserta`].join(" · ")}</div>
        </div>
      </div>
      <div className="flex items-start justify-between gap-4 flex-wrap mb-6 no-print">
        <div>
          <div className="text-[10px] tracking-[0.3em] uppercase text-[#ffcc00]">Bracket Tournament</div>
          <h1 className="font-display text-3xl md:text-4xl tracking-tight uppercase">{data.name}</h1>
          <div className="text-xs text-zinc-400 mt-1">{[data.class_name, `${data.size} peserta`, `${data.rounds + 1} ronde`, STATUS_LABEL[data.status]].filter(Boolean).join(" · ")}</div>
          {!publicMode && data.status === "draft" && (
            <div className="text-xs text-zinc-500 mt-2">Seret ikon di kartu babak 1 untuk menukar posisi peserta.</div>
          )}
        </div>
        <div className="flex gap-2 flex-wrap">
          {!publicMode && data.status === "draft" && (
            <Button onClick={start} className="bg-emerald-500 hover:bg-emerald-600 text-black uppercase tracking-[0.15em] text-xs rounded-sm" data-testid="bracket-start-btn"><Play className="w-4 h-4 mr-2"/>Mulai Bracket</Button>
          )}
          <Button onClick={() => window.print()} variant="ghost" className="border border-white/10 hover:bg-white/5 text-xs uppercase tracking-[0.15em]" data-testid="bracket-print-btn"><Printer className="w-4 h-4 mr-2"/>Cetak / PDF</Button>
          {!publicMode && (
            <Link to={`/print/bracket/${bid}`}>
              <Button variant="ghost" className="border border-white/10 hover:bg-white/5 text-xs uppercase tracking-[0.15em]" data-testid="bracket-paper-btn"><FileText className="w-4 h-4 mr-2"/>Versi Kertas</Button>
            </Link>
          )}
          {!publicMode && (
            <Link to={`/bracket/${bid}/public`} target="_blank">
              <Button variant="ghost" className="border border-white/10 hover:bg-white/5 text-xs uppercase tracking-[0.15em]" data-testid="bracket-public-btn"><Eye className="w-4 h-4 mr-2"/>Tampilan Publik</Button>
            </Link>
          )}
          {!publicMode && (
            <Button onClick={remove} variant="ghost" className="border border-rose-500/30 bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 text-xs uppercase tracking-[0.15em]" data-testid="bracket-detail-del-btn"><Trash2 className="w-4 h-4 mr-2"/>Hapus</Button>
          )}
        </div>
      </div>

      {winner && (
        <div className="mb-6 border-2 border-[#ffcc00] bg-[#ffcc00]/5 rounded-sm p-4 flex items-center gap-4 print:border-black print:bg-white print:text-black" data-testid="bracket-winner">
          <Crown className="w-10 h-10 text-[#ffcc00] print:text-black"/>
          <div>
            <div className="text-[10px] tracking-[0.3em] uppercase text-[#ffcc00] print:text-black">Juara</div>
            <div className="font-display text-2xl tracking-tight">{winner.name}</div>
          </div>
        </div>
      )}

      <div className="bracket-tree overflow-x-auto pb-4 -mx-2 px-2">
        <div className="flex gap-8 min-w-fit">
          {rounds.map((slots, idx) => (
            <RoundColumn
              key={idx}
              roundNum={idx + 1}
              isFinal={idx === rounds.length - 1}
              slots={slots}
              athletes={athletes}
              canEdit={!publicMode && data.status === "draft" && idx === 0}
              onAssign={assignSlot}
              onSwap={swapSlots}
              dragOverId={dragOverId}
              onDragOverSlot={setDragOverId}
              totalRounds={rounds.length}
            />
          ))}
        </div>
      </div>
      </div>
    </Wrap>
  );
}

function Wrap({ publicMode, children }) {
  if (publicMode) return (
    <div className="min-h-screen bg-[#0a0a0a] text-white print:bg-white print:text-black">
      <header className="border-b border-white/10 px-6 py-4 flex items-center justify-between no-print">
        <Link to="/" className="flex items-center gap-3">
          <div className="w-8 h-8 bg-[#ffcc00] grid place-items-center rounded-sm"><span className="font-display text-xl text-black leading-none">S</span></div>
          <div className="font-display tracking-tight">SILAT SCORING</div>
        </Link>
      </header>
      <main className="max-w-[1600px] mx-auto px-6 py-6">{children}</main>
    </div>
  );
  return <AppShell title="Bracket">{children}</AppShell>;
}

function RoundColumn({ roundNum, isFinal, slots, athletes, canEdit, onAssign, onSwap, dragOverId, onDragOverSlot, totalRounds }) {
  const slotHeight = 84;
  const gap = (Math.pow(2, roundNum - 1) - 1) * slotHeight + (roundNum - 1) * 16;
  return (
    <div className="flex flex-col items-stretch" data-testid={`round-col-${roundNum}`}>
      <div className="round-label text-[10px] tracking-[0.3em] uppercase text-zinc-500 mb-3 text-center print:text-black">
        {isFinal ? "Juara" : roundNum === totalRounds - 1 ? "Final" : roundNum === totalRounds - 2 ? "Semi Final" : `Ronde ${roundNum}`}
      </div>
      <div className="flex flex-col" style={{ gap: `${gap}px`, paddingTop: roundNum > 1 ? `${gap / 2}px` : 0 }}>
        {/* Pair grouping */}
        {pairs(slots).map((pair, i) => (
          <div key={i} className="flex flex-col" style={{ gap: roundNum === 1 ? "8px" : "16px" }}>
            {pair.map((slot) => (
              <SlotCard key={slot.id} slot={slot} athletes={athletes} canEdit={canEdit} onAssign={onAssign} onSwap={onSwap} dragOver={dragOverId === slot.id} onDragOverSlot={onDragOverSlot} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function pairs(arr) {
  const out = [];
  for (let i = 0; i < arr.length; i += 2) out.push(arr.slice(i, i + 2));
  return out;
}

function SlotCard({ slot, athletes, canEdit, onAssign, onSwap, dragOver, onDragOverSlot }) {
  const a = slot.athlete;
  const m = slot.match;
  const isWinner = m && m.winner_corner && ((m.winner_corner === "red" && m.red_athlete_id === a?.id) || (m.winner_corner === "blue" && m.blue_athlete_id === a?.id));
  return (
    <div
      className={`bracket-slot relative w-64 border rounded-sm bg-[#0f0f10] print:bg-white print:text-black ${slot.is_bye ? "border-dashed border-white/10 opacity-50" : isWinner ? "is-winner border-[#ffcc00] bg-[#ffcc00]/5" : "border-white/10"} ${dragOver ? "ring-2 ring-[#ffcc00]" : ""}`}
      data-testid={`slot-r${slot.round}-p${slot.position}`}
      onDragOver={canEdit ? (e) => { e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = "move"; onDragOverSlot?.(slot.id); } : undefined}
      onDragLeave={canEdit ? (e) => { if (!e.currentTarget.contains(e.relatedTarget)) onDragOverSlot?.(null); } : undefined}
      onDrop={canEdit ? (e) => {
        e.preventDefault();
        const from = e.dataTransfer.getData("text/plain");
        onDragOverSlot?.(null);
        onSwap?.(from, slot.id);
      } : undefined}
    >
      <div className="px-3 py-2 flex items-center gap-2 min-h-[72px]">
        {canEdit && (
          <span
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData("text/plain", slot.id);
              e.dataTransfer.effectAllowed = "move";
            }}
            onDragEnd={() => onDragOverSlot?.(null)}
            className="no-print cursor-grab active:cursor-grabbing text-zinc-500 hover:text-white shrink-0"
            data-testid={`slot-drag-${slot.id}`}
            title="Seret untuk menukar"
          >
            <GripVertical className="w-4 h-4" />
          </span>
        )}
        <div className="slot-photo w-10 h-10 rounded-sm bg-[#0a0a0a] border border-white/10 overflow-hidden shrink-0 grid place-items-center">
          {a?.photo_url ? <img src={resolvePhotoUrl(a.photo_url)} alt="" className="w-full h-full object-cover" onError={(e) => { e.currentTarget.style.display = "none"; }}/> : <span className="text-zinc-700 text-xs">—</span>}
        </div>
        <div className="flex-1 min-w-0">
          {slot.is_bye ? (
            <div className="text-xs text-zinc-500 italic">— bye —</div>
          ) : a ? (
            <>
              <div className="text-sm font-medium truncate">{a.name}</div>
              <div className="text-[10px] text-zinc-500 truncate">{a.weight ? `${a.weight} kg` : ""} {a.gender}</div>
            </>
          ) : canEdit ? (
            <>
              <div className="no-print"><AthleteSelector slot={slot} athletes={athletes} onAssign={onAssign} /></div>
              <div className="hidden print:block text-xs">Menunggu</div>
            </>
          ) : (
            <div className="text-xs text-zinc-600 italic">menunggu...</div>
          )}
        </div>
        {isWinner && <Trophy className="w-3.5 h-3.5 text-[#ffcc00] print:text-black shrink-0"/>}
      </div>
      {m && (
        <div className="slot-meta border-t border-white/10 px-3 py-1 flex items-center justify-between text-[10px] text-zinc-400 print:text-black">
          <span className="font-mono-display">#{m.match_number}</span>
          <Link to={`/match/${m.id}`} className="no-print text-[#ffcc00] hover:underline flex items-center gap-1">Buka<ArrowRight className="w-3 h-3"/></Link>
        </div>
      )}
    </div>
  );
}

function AthleteSelector({ slot, athletes, onAssign }) {
  return (
    <Select onValueChange={(v) => onAssign(slot.id, v)}>
      <SelectTrigger className="bg-[#0a0a0a] border-white/10 h-8 text-xs" data-testid={`slot-assign-${slot.id}`}><SelectValue placeholder="+ pilih peserta"/></SelectTrigger>
      <SelectContent className="bg-[#141414] border-white/10 text-white max-h-64">
        {athletes.map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}

function Row({ label, children }) {
  return (
    <div>
      <Label className="text-[10px] tracking-[0.2em] uppercase text-zinc-400">{label}</Label>
      <div className="mt-1">{children}</div>
    </div>
  );
}
