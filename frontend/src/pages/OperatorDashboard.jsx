import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import AppShell from "@/components/AppShell";
import api, { formatApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { toast, Toaster } from "sonner";
import { Plus, Trash2, Play, ListChecks, Trophy, FileText, Tv } from "lucide-react";

export default function OperatorDashboard() {
  const nav = useNavigate();
  const [events, setEvents] = useState([]);
  const [eventId, setEventId] = useState("");
  const [arenas, setArenas] = useState([]);
  const [matches, setMatches] = useState([]);
  const [athletes, setAthletes] = useState([]);
  const [rules, setRules] = useState([]);
  const [classes, setClasses] = useState([]);
  const [filterArena, setFilterArena] = useState("all");
  const [filterStatus, setFilterStatus] = useState("all");

  useEffect(() => {
    (async () => {
      const r = await api.get("/events");
      setEvents(r.data);
      if (r.data.length) setEventId(r.data[0].id);
    })();
  }, []);

  const loadAll = async () => {
    if (!eventId) return;
    const [a, m, ath, rul, cls] = await Promise.all([
      api.get("/arenas", { params: { event_id: eventId } }),
      api.get("/matches", { params: { event_id: eventId } }),
      api.get("/athletes", { params: { event_id: eventId } }),
      api.get("/scoring-rules", { params: { event_id: eventId } }),
      api.get("/classes", { params: { event_id: eventId } }),
    ]);
    setArenas(a.data); setMatches(m.data); setAthletes(ath.data); setRules(rul.data); setClasses(cls.data);
  };

  useEffect(() => { loadAll(); }, [eventId]);

  const filtered = useMemo(() => {
    return matches.filter((m) => (filterArena === "all" || m.arena_id === filterArena) && (filterStatus === "all" || m.status === filterStatus));
  }, [matches, filterArena, filterStatus]);

  const athleteName = (id) => athletes.find(a => a.id === id)?.name || "—";
  const arenaName = (id) => arenas.find(a => a.id === id)?.name || "—";

  const del = async (id) => {
    if (!window.confirm("Hapus partai ini?")) return;
    try {
      await api.delete(`/matches/${id}`);
      loadAll();
    } catch (e) {
      toast.error(formatApiError(e));
    }
  };

  return (
    <AppShell title="Manajemen Pertandingan">
      <Toaster theme="dark" position="top-right" />
      <div className="grid grid-cols-2 md:grid-cols-[minmax(0,18rem)_minmax(0,14rem)_minmax(0,14rem)_minmax(0,14rem)] gap-3 mb-6 items-end">
        <div className="col-span-2 md:col-span-1 min-w-0">
          <div className="text-[10px] tracking-[0.3em] uppercase text-zinc-400 mb-1">Event</div>
          <Select value={eventId} onValueChange={setEventId}>
            <SelectTrigger className="w-full min-w-0 bg-[#141414] border-white/10" data-testid="event-select"><SelectValue/></SelectTrigger>
            <SelectContent className="bg-[#141414] border-white/10 text-white">
              {events.map((e) => <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="min-w-0">
          <div className="text-[10px] tracking-[0.3em] uppercase text-zinc-400 mb-1">Filter Gelanggang</div>
          <Select value={filterArena} onValueChange={setFilterArena}>
            <SelectTrigger className="w-full min-w-0 bg-[#141414] border-white/10"><SelectValue/></SelectTrigger>
            <SelectContent className="bg-[#141414] border-white/10 text-white">
              <SelectItem value="all">Semua</SelectItem>
              {arenas.map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="min-w-0">
          <div className="text-[10px] tracking-[0.3em] uppercase text-zinc-400 mb-1">Filter Status</div>
          <Select value={filterStatus} onValueChange={setFilterStatus}>
            <SelectTrigger className="w-full min-w-0 bg-[#141414] border-white/10"><SelectValue/></SelectTrigger>
            <SelectContent className="bg-[#141414] border-white/10 text-white">
              <SelectItem value="all">Semua</SelectItem>
              <SelectItem value="scheduled">Terjadwal</SelectItem>
              <SelectItem value="in_progress">Berlangsung</SelectItem>
              <SelectItem value="paused">Dijeda</SelectItem>
              <SelectItem value="finished">Selesai</SelectItem>
              <SelectItem value="approved">Disahkan</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="col-span-2 md:col-span-1 min-w-0">
          <MatchCreateDialog eventId={eventId} arenas={arenas} athletes={athletes} rules={rules} classes={classes} onCreated={loadAll} />
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="border border-dashed border-white/10 rounded-sm p-12 text-center text-zinc-500">
          <ListChecks className="w-12 h-12 mx-auto mb-3 text-zinc-700" />
          <div className="text-sm tracking-[0.2em] uppercase">Belum ada partai. Buat partai baru.</div>
        </div>
      ) : (
        <div className="border border-white/10 rounded-sm overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="bg-[#141414] text-[10px] tracking-[0.2em] uppercase text-zinc-400">
              <tr>
                <th className="text-left px-4 py-3 w-12">#</th>
                <th className="text-left px-4 py-3">Gelanggang</th>
                <th className="text-left px-4 py-3 text-[#ff3b30]">Sudut Merah</th>
                <th className="text-left px-4 py-3 text-[#007aff]">Sudut Biru</th>
                <th className="text-left px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Aksi</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((m) => (
                <tr key={m.id} className="border-t border-white/5 hover:bg-white/5 transition-colors" data-testid={`match-row-${m.id}`}>
                  <td className="px-4 py-3 font-mono-display text-zinc-400">#{m.match_number}</td>
                  <td className="px-4 py-3">{arenaName(m.arena_id)}</td>
                  <td className="px-4 py-3 text-[#ff3b30] font-semibold">{athleteName(m.red_athlete_id)}</td>
                  <td className="px-4 py-3 text-[#007aff] font-semibold">{athleteName(m.blue_athlete_id)}</td>
                  <td className="px-4 py-3"><StatusBadge status={m.status} /></td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <Button size="sm" variant="ghost" onClick={() => nav(`/match/${m.id}`)} data-testid={`open-match-${m.id}`} className="text-zinc-300 hover:text-white hover:bg-white/10 rounded-sm">
                        <Play className="w-3.5 h-3.5 mr-1" />Buka
                      </Button>
                      {m.status === "approved" && (
                        <Button size="sm" variant="ghost" onClick={() => nav(`/report/${m.id}`)} className="text-zinc-300 hover:text-white hover:bg-white/10 rounded-sm">
                          <FileText className="w-3.5 h-3.5 mr-1" />Laporan
                        </Button>
                      )}
                      <button onClick={() => del(m.id)} className="text-zinc-500 hover:text-[#ff3b30] p-2 transition-colors" data-testid={`delete-match-${m.id}`}>
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </AppShell>
  );
}

function StatusBadge({ status }) {
  const map = {
    scheduled: { label: "Terjadwal", c: "bg-zinc-500/15 text-zinc-300 border-zinc-500/30" },
    in_progress: { label: "Berlangsung", c: "bg-[#10b981]/15 text-[#10b981] border-[#10b981]/30 animate-pulse" },
    paused: { label: "Dijeda", c: "bg-[#ffcc00]/15 text-[#ffcc00] border-[#ffcc00]/30" },
    finished: { label: "Selesai", c: "bg-blue-500/15 text-blue-300 border-blue-500/30" },
    approved: { label: "Disahkan", c: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30" },
  };
  const m = map[status] || map.scheduled;
  return <Badge className={`border ${m.c} text-[10px] tracking-[0.2em] uppercase rounded-sm`}>{m.label}</Badge>;
}

const DISCIPLINE_COUNT = { tanding: 2, tunggal: 1, ganda: 2, regu: 3 };

function MatchCreateDialog({ eventId, arenas, athletes, rules, classes, onCreated }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    arena_id: "", class_id: "", scoring_rule_id: "",
    red_athlete_id: "", blue_athlete_id: "", match_number: 1, round_label: "Babak Penyisihan",
    discipline: "tanding", performer_ids: ["", ""], round_duration_sec: "",
  });
  const [busy, setBusy] = useState(false);
  const isTanding = form.discipline === "tanding";
  const seniCount = DISCIPLINE_COUNT[form.discipline] || 1;

  useEffect(() => {
    if (open && arenas[0] && !form.arena_id) setForm((f) => ({ ...f, arena_id: arenas[0].id }));
    if (open && rules[0] && !form.scoring_rule_id) setForm((f) => ({ ...f, scoring_rule_id: rules[0].id }));
  }, [open, arenas, rules]);

  const setPerformer = (index, id) => {
    const next = [...form.performer_ids];
    next[index] = id;
    setForm({ ...form, performer_ids: next });
  };

  const create = async () => {
    let roundDuration;
    if (form.round_duration_sec !== "" && form.round_duration_sec !== null && form.round_duration_sec !== undefined) {
      roundDuration = Number(form.round_duration_sec);
      if (!Number.isFinite(roundDuration) || roundDuration < 1) {
        toast.error("Durasi ronde minimal 1 detik, atau kosongkan untuk memakai aturan");
        return;
      }
    }
    let payload;
    if (isTanding) {
      if (!form.red_athlete_id || !form.blue_athlete_id || form.red_athlete_id === form.blue_athlete_id) {
        toast.error("Pilih dua atlet yang berbeda");
        return;
      }
      payload = { ...form, event_id: eventId, discipline: "tanding", performer_ids: [] };
    } else {
      const ids = form.performer_ids.slice(0, seniCount).filter(Boolean);
      if (ids.length !== seniCount || new Set(ids).size !== seniCount) {
        toast.error(`Pilih ${seniCount} pesilat yang berbeda`);
        return;
      }
      payload = {
        ...form,
        event_id: eventId,
        discipline: form.discipline,
        red_athlete_id: ids[0],
        blue_athlete_id: "",
        performer_ids: ids.slice(1),
      };
    }
    delete payload.round_duration_sec;
    if (roundDuration) payload.round_duration_sec = roundDuration;
    setBusy(true);
    try {
      await api.post("/matches", payload);
      toast.success("Partai dibuat");
      setOpen(false);
      onCreated();
    } catch (e) { toast.error(formatApiError(e)); }
    finally { setBusy(false); }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button data-testid="create-match-btn" disabled={!eventId} className="w-full bg-[#ffcc00] hover:bg-[#e6b800] text-black rounded-sm px-3 tracking-normal md:tracking-[0.12em] uppercase">
          <Plus className="w-4 h-4 mr-2" />Buat Partai
        </Button>
      </DialogTrigger>
      <DialogContent className="bg-[#141414] border-white/10 text-white max-w-xl max-h-[85vh] overflow-y-auto">
        <DialogHeader><DialogTitle className="font-display text-2xl uppercase">Partai Baru</DialogTitle></DialogHeader>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <Label className="text-[10px] tracking-[0.2em] uppercase text-zinc-400">Gelanggang</Label>
            <Select value={form.arena_id} onValueChange={(v) => setForm({ ...form, arena_id: v })}>
              <SelectTrigger className="bg-[#0a0a0a] border-white/10 mt-1" data-testid="match-arena-select"><SelectValue placeholder="Pilih..."/></SelectTrigger>
              <SelectContent className="bg-[#141414] border-white/10 text-white">{arenas.map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-[10px] tracking-[0.2em] uppercase text-zinc-400">Aturan Skor</Label>
            <Select value={form.scoring_rule_id} onValueChange={(v) => setForm({ ...form, scoring_rule_id: v })}>
              <SelectTrigger className="bg-[#0a0a0a] border-white/10 mt-1" data-testid="match-rule-select"><SelectValue placeholder="Pilih..."/></SelectTrigger>
              <SelectContent className="bg-[#141414] border-white/10 text-white">{rules.map((r) => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-[10px] tracking-[0.2em] uppercase text-zinc-400">Kelas (opsional)</Label>
            <Select value={form.class_id} onValueChange={(v) => setForm({ ...form, class_id: v })}>
              <SelectTrigger className="bg-[#0a0a0a] border-white/10 mt-1"><SelectValue placeholder="Pilih..."/></SelectTrigger>
              <SelectContent className="bg-[#141414] border-white/10 text-white">{classes.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-[10px] tracking-[0.2em] uppercase text-zinc-400">Disiplin</Label>
            <Select value={form.discipline} onValueChange={(v) => setForm({ ...form, discipline: v, performer_ids: ["", "", ""] })}>
              <SelectTrigger className="bg-[#0a0a0a] border-white/10 mt-1" data-testid="match-discipline-select"><SelectValue/></SelectTrigger>
              <SelectContent className="bg-[#141414] border-white/10 text-white">
                <SelectItem value="tanding">Tanding</SelectItem>
                <SelectItem value="tunggal">Tunggal</SelectItem>
                <SelectItem value="ganda">Ganda</SelectItem>
                <SelectItem value="regu">Regu</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-[10px] tracking-[0.2em] uppercase text-zinc-400">Babak / Label</Label>
            <Input value={form.round_label} onChange={(e) => setForm({ ...form, round_label: e.target.value })} className="bg-[#0a0a0a] border-white/10 mt-1" />
          </div>
          {isTanding ? (
            <>
              <div>
                <Label className="text-[10px] tracking-[0.2em] uppercase text-[#ff3b30]">Sudut Merah (Atlet)</Label>
                <Select value={form.red_athlete_id} onValueChange={(v) => setForm({ ...form, red_athlete_id: v })}>
                  <SelectTrigger data-testid="match-red-athlete-select" className="bg-[#0a0a0a] border-white/10 mt-1"><SelectValue placeholder="Pilih atlet..."/></SelectTrigger>
                  <SelectContent className="bg-[#141414] border-white/10 text-white">{athletes.map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-[10px] tracking-[0.2em] uppercase text-[#007aff]">Sudut Biru (Atlet)</Label>
                <Select value={form.blue_athlete_id} onValueChange={(v) => setForm({ ...form, blue_athlete_id: v })}>
                  <SelectTrigger data-testid="match-blue-athlete-select" className="bg-[#0a0a0a] border-white/10 mt-1"><SelectValue placeholder="Pilih atlet..."/></SelectTrigger>
                  <SelectContent className="bg-[#141414] border-white/10 text-white">{athletes.map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </>
          ) : (
            Array.from({ length: seniCount }, (_, index) => (
              <div key={index}>
                <Label className="text-[10px] tracking-[0.2em] uppercase text-[#ffcc00]">Pesilat {index + 1}</Label>
                <Select value={form.performer_ids[index] || ""} onValueChange={(v) => setPerformer(index, v)}>
                  <SelectTrigger data-testid={`match-performer-${index}`} className="bg-[#0a0a0a] border-white/10 mt-1"><SelectValue placeholder="Pilih pesilat..."/></SelectTrigger>
                  <SelectContent className="bg-[#141414] border-white/10 text-white">{athletes.map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            ))
          )}
          <div>
            <Label className="text-[10px] tracking-[0.2em] uppercase text-zinc-400">Nomor Partai</Label>
            <Input type="number" value={form.match_number} onChange={(e) => setForm({ ...form, match_number: Number(e.target.value) || 1 })} className="bg-[#0a0a0a] border-white/10 mt-1" />
          </div>
          <div>
            <Label className="text-[10px] tracking-[0.2em] uppercase text-zinc-400">Durasi Ronde (detik, kosong = aturan)</Label>
            <Input
              type="number"
              min={1}
              value={form.round_duration_sec}
              placeholder="Ikuti aturan"
              onChange={(e) => setForm({ ...form, round_duration_sec: e.target.value })}
              className="bg-[#0a0a0a] border-white/10 mt-1"
              data-testid="match-round-duration-input"
            />
          </div>
        </div>
        <DialogFooter>
          <Button disabled={busy} onClick={create} data-testid="match-save-btn" className="bg-[#ffcc00] hover:bg-[#e6b800] text-black tracking-[0.15em] uppercase">Buat Partai</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
