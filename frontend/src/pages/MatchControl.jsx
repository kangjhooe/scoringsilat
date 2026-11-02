/* eslint-disable */
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useNavigate, Link, Navigate } from "react-router-dom";
import AppShell from "@/components/AppShell";
import { useAuth } from "@/contexts/AuthContext";
import api, { formatApiError } from "@/lib/api";
import { openMatchSocket } from "@/lib/ws";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast, Toaster } from "sonner";
import { Play, Pause, RotateCcw, SkipForward, Square, CheckCircle2, FileText, Tv, AlertCircle, ShieldAlert } from "lucide-react";
import AthleteAvatar, { ActionIcon, actionLabel } from "@/components/AthleteAvatar";

// ============ Hooks ============
function useMatchState(matchId) {
  const [state, setState] = useState(null);
  const [loading, setLoading] = useState(true);

  const refresh = async () => {
    try {
      const r = await api.get(`/matches/${matchId}`);
      setState(r.data);
    } catch (e) {
      // ignore
    } finally { setLoading(false); }
  };

  useEffect(() => {
    refresh();
    const sock = openMatchSocket(matchId, (msg) => {
      if (msg?.state) setState(msg.state);
    });
    return () => sock.close();
  }, [matchId]);

  return { state, loading, refresh };
}

function useTicker(running) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [running]);
  return now;
}

function computeRemaining(timer) {
  if (!timer) return 0;
  let rem = timer.remaining_sec || 0;
  if (timer.running && timer.started_at) {
    const started = new Date(timer.started_at).getTime();
    rem = Math.max(0, rem - (Date.now() - started) / 1000);
  }
  return rem;
}

function fmtTime(sec) {
  sec = Math.max(0, Math.floor(sec));
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

// ============ Athlete cache ============
function useAthletes(eventId) {
  const [map, setMap] = useState({});
  useEffect(() => {
    if (!eventId) return;
    api.get("/athletes", { params: { event_id: eventId } }).then((r) => {
      const obj = {};
      r.data.forEach(a => { obj[a.id] = a; });
      setMap(obj);
    });
  }, [eventId]);
  return map;
}

// ============ Main ============
export default function MatchControl() {
  const { matchId } = useParams();
  const { user } = useAuth();
  const nav = useNavigate();
  const { state, loading, refresh } = useMatchState(matchId);
  const athletes = useAthletes(state?.event_id);

  if (loading) return <AppShell title="Memuat..."><div className="text-zinc-400">Memuat data partai...</div></AppShell>;
  if (!state) return <AppShell title="Tidak ditemukan"><div className="text-zinc-400">Partai tidak ditemukan</div></AppShell>;

  // Seni matches (tunggal/ganda/regu) have a dedicated scoring UI
  if (state.discipline && state.discipline !== "tanding") {
    return <Navigate to={`/seni/${matchId}`} replace />;
  }

  const red = athletes[state.red_athlete_id];
  const blue = athletes[state.blue_athlete_id];

  // pick default view by role
  const role = user.role;
  const defaultTab = role === "jury" ? "jury" : role === "referee" ? "referee" : role === "timer" ? "timer" : role === "head_jury" ? "head" : "jury";

  return (
    <AppShell>
      <Toaster theme="dark" position="top-right" />
      <MatchHeader state={state} red={red} blue={blue} />

      <Tabs defaultValue={defaultTab} className="mt-6">
        <TabsList className="bg-[#141414] border border-white/10 rounded-sm h-auto p-1 flex-wrap">
          <TabsTrigger value="jury" data-testid="tab-jury" className="rounded-sm data-[state=active]:bg-[#ffcc00] data-[state=active]:text-black text-xs tracking-[0.15em] uppercase">Juri</TabsTrigger>
          <TabsTrigger value="referee" data-testid="tab-referee" className="rounded-sm data-[state=active]:bg-[#ffcc00] data-[state=active]:text-black text-xs tracking-[0.15em] uppercase">Wasit</TabsTrigger>
          <TabsTrigger value="timer" data-testid="tab-timer" className="rounded-sm data-[state=active]:bg-[#ffcc00] data-[state=active]:text-black text-xs tracking-[0.15em] uppercase">Timer</TabsTrigger>
          <TabsTrigger value="head" data-testid="tab-head" className="rounded-sm data-[state=active]:bg-[#ffcc00] data-[state=active]:text-black text-xs tracking-[0.15em] uppercase">Ketua Juri</TabsTrigger>
          <TabsTrigger value="logs" data-testid="tab-logs" className="rounded-sm data-[state=active]:bg-[#ffcc00] data-[state=active]:text-black text-xs tracking-[0.15em] uppercase">Log</TabsTrigger>
        </TabsList>
        <TabsContent value="jury" className="mt-6"><JuryPanel state={state} role={role} refresh={refresh} red={red} blue={blue}/></TabsContent>
        <TabsContent value="referee" className="mt-6"><RefereePanel state={state} role={role} refresh={refresh}/></TabsContent>
        <TabsContent value="timer" className="mt-6"><TimerPanel state={state} role={role} refresh={refresh}/></TabsContent>
        <TabsContent value="head" className="mt-6"><HeadJuryPanel state={state} role={role} refresh={refresh} red={red} blue={blue}/></TabsContent>
        <TabsContent value="logs" className="mt-6"><LogsPanel matchId={matchId} role={role} onChanged={refresh}/></TabsContent>
      </Tabs>
    </AppShell>
  );
}

// ============ Header + Scoreboard ============
function MatchHeader({ state, red, blue }) {
  const ticker = useTicker(state.timer?.running);
  const remaining = computeRemaining(state.timer);
  const totalRounds = state.rule?.round_count || 3;

  return (
    <div className="border border-white/10 rounded-sm bg-[#141414] overflow-hidden">
      <div className="grid grid-cols-12 gap-0">
        {/* Red */}
        <div className="col-span-12 md:col-span-4 bg-corner-red-solid p-4 md:p-6 relative">
          <div className="text-[10px] tracking-[0.3em] uppercase text-white/80 mb-2">Sudut Merah</div>
          <div className="flex items-center gap-4">
            <AthleteAvatar athlete={red} corner="red" size={72} />
            <div className="min-w-0 flex-1">
              <div className="font-display text-2xl md:text-3xl tracking-tight uppercase truncate" data-testid="header-red-name">{red?.name || "—"}</div>
              <div className="text-white/70 text-sm">{red?.weight ? `${red.weight} kg · ` : ""}{red?.gender || ""}</div>
            </div>
          </div>
          <div className="font-display text-6xl md:text-7xl xl:text-8xl tracking-tighter mt-4 leading-none" data-testid="header-red-score">{state.red.score}</div>
        </div>

        {/* Center */}
        <div className="col-span-12 md:col-span-4 bg-[#0a0a0a] p-4 md:p-6 flex flex-col items-center justify-center border-y md:border-y-0 md:border-x border-white/10">
          <div className="text-[10px] tracking-[0.3em] uppercase text-zinc-500">Ronde</div>
          <div className="font-display text-5xl tracking-tighter mt-1" data-testid="header-round">
            {state.current_round} <span className="text-zinc-600 text-3xl">/ {totalRounds}</span>
          </div>
          <div className="text-[10px] tracking-[0.3em] uppercase text-zinc-500 mt-3" data-testid="header-phase">
            {state.timer?.phase === "rest" ? "Istirahat" : "Waktu"}
          </div>
          <div className={`font-mono-display text-5xl md:text-6xl mt-1 tracking-tighter ${state.timer?.running ? "text-[#ffcc00]" : "text-white"}`} data-testid="header-timer">
            {fmtTime(remaining)}
          </div>
          <div className="mt-2"><StatusBadge status={state.status}/></div>
        </div>

        {/* Blue */}
        <div className="col-span-12 md:col-span-4 bg-corner-blue-solid p-4 md:p-6">
          <div className="text-[10px] tracking-[0.3em] uppercase text-white/80 mb-2 text-right">Sudut Biru</div>
          <div className="flex items-center gap-4 flex-row-reverse">
            <AthleteAvatar athlete={blue} corner="blue" size={72} />
            <div className="min-w-0 flex-1 text-right">
              <div className="font-display text-2xl md:text-3xl tracking-tight uppercase truncate" data-testid="header-blue-name">{blue?.name || "—"}</div>
              <div className="text-white/70 text-sm">{blue?.weight ? `${blue.weight} kg · ` : ""}{blue?.gender || ""}</div>
            </div>
          </div>
          <div className="font-display text-6xl md:text-7xl xl:text-8xl tracking-tighter mt-4 leading-none text-right" data-testid="header-blue-score">{state.blue.score}</div>
        </div>
      </div>
      <div className="px-4 md:px-6 py-3 bg-[#0a0a0a] border-t border-white/10 flex flex-wrap items-center gap-3 text-xs text-zinc-400">
        <div>Partai <span className="text-white font-mono-display">#{state.match_number}</span></div>
        <div className="text-zinc-600">·</div>
        <div>{state.round_label}</div>
        <div className="ml-auto flex items-center gap-2">
          <Link to={`/display/match/${state.id}`} target="_blank" className="text-[#ffcc00] hover:underline flex items-center gap-1" data-testid="open-public-display">
            <Tv className="w-3.5 h-3.5"/> Buka Public Display
          </Link>
          {state.status === "approved" && (
            <Link to={`/report/${state.id}`} className="text-[#ffcc00] hover:underline flex items-center gap-1">
              <FileText className="w-3.5 h-3.5"/> Laporan
            </Link>
          )}
        </div>
      </div>
    </div>
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

// ============ Jury Panel ============
function JuryPanel({ state, role, refresh, red, blue }) {
  const canScore = role === "jury" || role === "admin";
  const resting = state.timer?.phase === "rest";
  const points = state.rule?.points || { pukulan: 1, tendangan: 2, jatuhan: 3 };
  const windowSec = state.rule?.jury_consensus_window_sec ?? 2;

  const sendScore = async (corner, code, pts) => {
    try {
      const r = await api.post(`/matches/${state.id}/actions`, { corner, action_type: "score", code, points: pts });
      if (r.data?.pending) toast("Menunggu juri lain");
      else toast.success("Poin masuk");
    } catch (e) { toast.error(formatApiError(e)); }
  };

  if (state.status !== "in_progress" && state.status !== "paused") {
    return <NoticeBox text={`Partai belum dimulai (${state.status}). Mohon menunggu timer memulai partai.`} />;
  }

  const buttons = Object.entries(points);
  const pending = state.pending_votes || [];

  return (
    <div className="space-y-4">
      <div className="text-xs text-zinc-400">Poin masuk setelah dua juri menekan aksi yang sama dalam {windowSec} detik.</div>
      {resting && <NoticeBox text="Sedang istirahat. Skor dibuka lagi saat ronde dimulai." />}
      {pending.length > 0 && (
        <div className="border border-[#ffcc00]/40 bg-[#ffcc00]/10 rounded-sm px-4 py-3 text-sm text-[#ffcc00]">
          Menunggu juri lain: {pending.map((v) => `${v.code} sudut ${v.corner === "red" ? "merah" : "biru"}`).join(", ")}
        </div>
      )}
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 md:gap-6">
      <CornerJury corner="red" athlete={red} score={state.red.score} buttons={buttons} disabled={!canScore || resting} onScore={(code, pts) => sendScore("red", code, pts)} />
      <CornerJury corner="blue" athlete={blue} score={state.blue.score} buttons={buttons} disabled={!canScore || resting} onScore={(code, pts) => sendScore("blue", code, pts)} />
    </div>
    </div>
  );
}

function CornerJury({ corner, athlete, score, buttons, disabled, onScore }) {
  const isRed = corner === "red";
  const cls = isRed ? "bg-corner-red-solid" : "bg-corner-blue-solid";
  return (
    <div className={`rounded-sm border ${isRed ? "border-[#ff3b30]/30" : "border-[#007aff]/30"} overflow-hidden`}>
      <div className={`${cls} p-4 flex items-center gap-4`}>
        <AthleteAvatar athlete={athlete} corner={corner} size={64} />
        <div className="min-w-0 flex-1">
          <div className="text-[10px] tracking-[0.3em] uppercase text-white/70">Sudut {isRed ? "Merah" : "Biru"}</div>
          <div className="font-display text-2xl tracking-tight uppercase truncate">{athlete?.name || "—"}</div>
        </div>
        <div className="font-display text-6xl tracking-tighter leading-none">{score}</div>
      </div>
      <div className="bg-[#141414] p-4 grid grid-cols-1 gap-3">
        {buttons.map(([code, pts]) => (
          <button
            key={code}
            disabled={disabled}
            onClick={() => onScore(code, pts)}
            data-testid={`jury-${corner}-${code}`}
            className={`tap-press h-20 sm:h-24 rounded-sm font-display text-2xl sm:text-3xl tracking-tight uppercase flex items-center justify-between px-4 sm:px-6 gap-3 transition-colors ${disabled ? "bg-zinc-800 text-zinc-600 cursor-not-allowed" : isRed ? "bg-[#ff3b30] hover:bg-[#ff5147] text-white" : "bg-[#007aff] hover:bg-[#1f8cff] text-white"}`}
          >
            <span className="flex items-center gap-4">
              <ActionIcon code={code} className="w-10 h-10" />
              <span>{actionLabel(code)}</span>
            </span>
            <span className="font-mono-display text-4xl">+{pts}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function NoticeBox({ text }) {
  return (
    <div className="border border-[#ffcc00]/30 bg-[#ffcc00]/10 rounded-sm p-6 flex items-center gap-3 text-[#ffcc00]">
      <AlertCircle className="w-5 h-5" />
      <span className="text-sm tracking-wide">{text}</span>
    </div>
  );
}

// ============ Referee Panel ============
function RefereePanel({ state, role, refresh }) {
  const can = role === "referee" || role === "head_jury" || role === "admin";
  const penalties = state.rule?.penalty_points || {};

  const send = async (corner, action_type, code) => {
    try {
      await api.post(`/matches/${state.id}/actions`, { corner, action_type, code });
      toast.success(`${action_type} ${code} → ${corner}`);
    } catch (e) { toast.error(formatApiError(e)); }
  };

  const binaan = async (corner) => send(corner, "binaan", "binaan_1");
  const penalty = async (corner, code) => send(corner, "penalty", code);
  const absolute = async (corner) => send(corner, "absolute_win", "menang_mutlak");

  if (state.status !== "in_progress" && state.status !== "paused") {
    return <NoticeBox text={`Partai belum dimulai (${state.status}). Wasit tidak dapat memberi tindakan saat ini.`} />;
  }
  if (!can) return <NoticeBox text="Hanya Wasit atau Ketua Juri yang dapat memberi tindakan dari panel ini." />;

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">
      {["red", "blue"].map((c) => {
        const isRed = c === "red";
        return (
          <div key={c} className={`rounded-sm border ${isRed ? "border-[#ff3b30]/30" : "border-[#007aff]/30"} bg-[#141414] overflow-hidden`}>
            <div className={`px-4 py-3 ${isRed ? "bg-corner-red" : "bg-corner-blue"} border-b ${isRed ? "border-[#ff3b30]/30" : "border-[#007aff]/30"}`}>
              <div className="text-[10px] tracking-[0.3em] uppercase text-white/80">Tindakan untuk Sudut {isRed ? "Merah" : "Biru"}</div>
            </div>
            <div className="p-4 space-y-3">
              <Button onClick={() => binaan(c)} data-testid={`ref-${c}-binaan`} className="tap-press w-full h-16 rounded-sm font-display text-xl uppercase bg-zinc-700 hover:bg-zinc-600">Binaan</Button>
              <div className="text-[10px] tracking-[0.3em] uppercase text-zinc-400 mt-3">Pelanggaran (poin ke lawan)</div>
              <div className="grid grid-cols-2 gap-2">
                {Object.entries(penalties).map(([code, pts]) => (
                  <Button key={code} onClick={() => penalty(c, code)} data-testid={`ref-${c}-${code}`} className="tap-press h-16 rounded-sm bg-[#ff3b30]/20 hover:bg-[#ff3b30]/30 text-white border border-[#ff3b30]/30">
                    <div className="flex items-center justify-between w-full">
                      <span className="uppercase text-xs tracking-[0.1em]">{code.replace("_", " ")}</span>
                      <span className="font-mono-display text-sm">+{pts}</span>
                    </div>
                  </Button>
                ))}
              </div>
              <Button onClick={() => absolute(c)} data-testid={`ref-${c}-absolute`} className="tap-press w-full h-14 rounded-sm bg-[#ffcc00] hover:bg-[#e6b800] text-black font-bold uppercase tracking-[0.15em] mt-2">
                <ShieldAlert className="w-4 h-4 mr-2" /> Menang Mutlak (KO)
              </Button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ============ Timer Panel ============
function TimerPanel({ state, role, refresh }) {
  const can = role === "timer" || role === "operator" || role === "admin";
  const locked = state.status === "approved" || state.status === "finished";
  const send = async (action) => {
    if (locked) return;
    try { await api.post(`/matches/${state.id}/timer`, { action }); }
    catch (e) { toast.error(formatApiError(e)); }
  };
  const remaining = computeRemaining(state.timer);
  useTicker(state.timer?.running);

  if (!can) return <NoticeBox text="Hanya Timer/Operator yang dapat mengontrol timer." />;

  const running = state.timer?.running;
  const timerBtn = "tap-press h-20 sm:h-24 rounded-sm font-bold uppercase tracking-[0.08em] whitespace-normal text-center px-2 disabled:cursor-not-allowed";
  return (
    <div className="grid grid-cols-12 gap-6">
      <div className="col-span-12 md:col-span-6 border border-white/10 rounded-sm bg-[#141414] p-8 text-center">
        <div className="text-[10px] tracking-[0.3em] uppercase text-zinc-400" data-testid="timer-phase-label">{state.timer?.phase === "rest" ? "Istirahat" : "Sisa Waktu Ronde"}</div>
        <div className={`font-mono-display text-7xl md:text-8xl xl:text-9xl tracking-tighter mt-2 ${running ? "text-[#ffcc00]" : "text-white"}`} data-testid="timer-remaining">{fmtTime(remaining)}</div>
        <div className="text-sm text-zinc-500 mt-2">Ronde {state.current_round} / {state.rule?.round_count || 3}</div>
      </div>
      <div className="col-span-12 md:col-span-6 flex flex-col gap-3">
        {locked && <div data-testid="timer-locked-notice"><NoticeBox text="Partai sudah dikunci." /></div>}
        <div className="grid grid-cols-2 gap-3">
          <Button disabled={locked} onClick={() => send("start")} data-testid="timer-start" className={`${timerBtn} bg-[#10b981] hover:bg-[#0ea271] text-white`}>
            <Play className="w-5 h-5 mr-2"/> Mulai
          </Button>
          <Button disabled={locked} onClick={() => send("pause")} data-testid="timer-pause" className={`${timerBtn} bg-[#ffcc00] hover:bg-[#e6b800] text-black`}>
            <Pause className="w-5 h-5 mr-2"/> Jeda
          </Button>
          <Button disabled={locked} onClick={() => send("reset")} data-testid="timer-reset" className={`${timerBtn} bg-zinc-700 hover:bg-zinc-600 text-white`}>
            <RotateCcw className="w-5 h-5 mr-2"/> Reset Ronde
          </Button>
          <Button disabled={locked} onClick={() => send("next_round")} data-testid="timer-next" className={`${timerBtn} bg-zinc-700 hover:bg-zinc-600 text-white`}>
            <SkipForward className="w-5 h-5 mr-2"/> Ronde Berikutnya
          </Button>
          <Button disabled={locked} onClick={() => send("end_match")} data-testid="timer-end" className="tap-press col-span-2 h-16 rounded-sm bg-[#ff3b30] hover:bg-[#ff5147] text-white font-bold uppercase tracking-[0.15em] disabled:cursor-not-allowed">
            <Square className="w-5 h-5 mr-2"/> Akhiri Partai
          </Button>
        </div>
      </div>
    </div>
  );
}

// ============ Head Jury Panel ============
function HeadJuryPanel({ state, role, refresh, red, blue }) {
  const can = role === "head_jury" || role === "admin";
  const [open, setOpen] = useState(false);
  const [winner, setWinner] = useState("");
  const [method, setMethod] = useState("menang_angka");
  const [notes, setNotes] = useState("");

  const inBracket = Boolean(state.bracket_id);
  const needsCorner = inBracket && winner !== "red" && winner !== "blue";

  useEffect(() => {
    const bracketMatch = Boolean(state.bracket_id);
    if (state.status === "approved" && (state.winner_corner === "red" || state.winner_corner === "blue" || state.winner_corner === "draw")) {
      setWinner(state.winner_corner);
      if (state.decision_method) setMethod(state.decision_method);
      return;
    }
    if (state.winner_corner === "red" || state.winner_corner === "blue") {
      setWinner(state.winner_corner);
      if (state.decision_method) setMethod(bracketMatch && state.decision_method === "seri" ? "menang_angka" : state.decision_method);
      return;
    }
    if (state.winner_corner === "draw" && !bracketMatch) {
      setWinner("draw");
      if (state.decision_method) setMethod(state.decision_method);
      return;
    }
    if (state.red.score > state.blue.score) setWinner("red");
    else if (state.blue.score > state.red.score) setWinner("blue");
    else setWinner(bracketMatch ? "" : "draw");
    if (bracketMatch) setMethod((prev) => (prev === "seri" ? "menang_angka" : prev));
  }, [state.status, state.red.score, state.blue.score, state.winner_corner, state.decision_method, state.bracket_id]);

  const approve = async () => {
    if (needsCorner) {
      toast.error("Partai bagan tidak boleh seri. Pilih sudut merah atau biru.");
      return;
    }
    try {
      const res = await api.post(`/matches/${state.id}/approve`, {
        winner_corner: winner,
        decision_method: inBracket && method === "seri" ? "menang_angka" : method,
        notes,
      });
      toast.success("Hasil disahkan");
      if (res.data?.bracket_warning) toast.warning(res.data.bracket_warning);
      setOpen(false);
      refresh();
    } catch (e) { toast.error(formatApiError(e)); }
  };

  if (!can) return <NoticeBox text="Hanya Ketua Juri yang dapat mengesahkan hasil." />;

  return (
    <div className="grid grid-cols-12 gap-6">
      <div className="col-span-12 md:col-span-8 border border-white/10 rounded-sm bg-[#141414] p-6">
        <div className="text-xs tracking-[0.3em] uppercase text-zinc-400 mb-4">Ringkasan Hasil</div>
        <div className="grid grid-cols-3 gap-4 mb-6">
          <Recap label="Sudut Merah" value={state.red.score} color="#ff3b30" sub={red?.name}/>
          <Recap label="Selisih" value={Math.abs(state.red.score - state.blue.score)} color="#ffcc00"/>
          <Recap label="Sudut Biru" value={state.blue.score} color="#007aff" sub={blue?.name}/>
        </div>
        <div className="grid grid-cols-3 gap-3 text-xs">
          <SmallCounter label="Teguran Merah" value={state.red.teguran}/>
          <SmallCounter label="Peringatan Merah" value={state.red.peringatan}/>
          <SmallCounter label="Binaan Merah" value={state.red.binaan}/>
          <SmallCounter label="Teguran Biru" value={state.blue.teguran}/>
          <SmallCounter label="Peringatan Biru" value={state.blue.peringatan}/>
          <SmallCounter label="Binaan Biru" value={state.blue.binaan}/>
        </div>
      </div>

      <div className="col-span-12 md:col-span-4 border border-white/10 rounded-sm bg-[#141414] p-6 flex flex-col">
        <div className="text-xs tracking-[0.3em] uppercase text-zinc-400 mb-3">Status Partai</div>
        <StatusBadge status={state.status}/>
        <div className="mt-6 text-xs tracking-[0.3em] uppercase text-zinc-400 mb-3">Pemenang Disarankan</div>
        <div className="font-display text-3xl uppercase tracking-tight">
          {winner === "red" ? <span className="text-[#ff3b30]">{red?.name || "Sudut Merah"}</span> : winner === "blue" ? <span className="text-[#007aff]">{blue?.name || "Sudut Biru"}</span> : winner === "draw" ? <span className="text-zinc-300">Seri</span> : <span className="text-zinc-400">Pilih sudut</span>}
        </div>
        {needsCorner && (
          <p className="text-xs text-amber-300 mt-3" data-testid="approve-bracket-draw-note">Hasil seri ditolak pada partai bagan. Wajib menunjuk sudut merah atau biru.</p>
        )}
        <div className="flex-1"></div>
        {state.status === "approved" ? (
          <Button asChild className="bg-emerald-500 hover:bg-emerald-600 text-white rounded-sm uppercase tracking-[0.15em] mt-6">
            <Link to={`/report/${state.id}`} data-testid="open-report-btn"><FileText className="w-4 h-4 mr-2"/>Lihat Laporan</Link>
          </Button>
        ) : (
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button data-testid="approve-open-btn" disabled={state.status === "in_progress"} className="bg-[#ffcc00] hover:bg-[#e6b800] text-black uppercase tracking-[0.15em] mt-6 disabled:opacity-50">
                <CheckCircle2 className="w-4 h-4 mr-2"/>Sahkan Hasil
              </Button>
            </DialogTrigger>
            <DialogContent className="bg-[#141414] border-white/10 text-white">
              <DialogHeader><DialogTitle className="font-display text-2xl uppercase">Pengesahan Hasil</DialogTitle></DialogHeader>
              <div className="space-y-3">
                <div>
                  <div className="text-[10px] tracking-[0.2em] uppercase text-zinc-400 mb-1">Pemenang</div>
                  <Select value={winner || undefined} onValueChange={setWinner}>
                    <SelectTrigger className="bg-[#0a0a0a] border-white/10" data-testid="approve-winner-select"><SelectValue placeholder="Pilih pemenang"/></SelectTrigger>
                    <SelectContent className="bg-[#141414] border-white/10 text-white">
                      <SelectItem value="red">Sudut Merah — {red?.name}</SelectItem>
                      <SelectItem value="blue">Sudut Biru — {blue?.name}</SelectItem>
                      {!inBracket && <SelectItem value="draw">Seri</SelectItem>}
                    </SelectContent>
                  </Select>
                  {inBracket && <p className="text-xs text-zinc-400 mt-2">Partai bagan wajib punya pemenang. Seri tidak dapat disahkan.</p>}
                </div>
                <div>
                  <div className="text-[10px] tracking-[0.2em] uppercase text-zinc-400 mb-1">Metode</div>
                  <Select value={method} onValueChange={setMethod}>
                    <SelectTrigger className="bg-[#0a0a0a] border-white/10"><SelectValue/></SelectTrigger>
                    <SelectContent className="bg-[#141414] border-white/10 text-white">
                      <SelectItem value="menang_angka">Menang Angka</SelectItem>
                      <SelectItem value="menang_mutlak">Menang Mutlak</SelectItem>
                      <SelectItem value="menang_teknik">Menang Teknik</SelectItem>
                      <SelectItem value="menang_diskualifikasi">Menang Diskualifikasi</SelectItem>
                      {!inBracket && <SelectItem value="seri">Seri</SelectItem>}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <div className="text-[10px] tracking-[0.2em] uppercase text-zinc-400 mb-1">Catatan (opsional)</div>
                  <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} className="w-full bg-[#0a0a0a] border border-white/10 rounded-sm p-2 text-sm"/>
                </div>
              </div>
              <DialogFooter>
                <Button onClick={approve} disabled={needsCorner} data-testid="approve-confirm-btn" className="bg-[#ffcc00] hover:bg-[#e6b800] text-black uppercase tracking-[0.15em] disabled:opacity-50">Sahkan</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}
      </div>
    </div>
  );
}

function Recap({ label, value, color, sub }) {
  return (
    <div className="border border-white/10 rounded-sm p-4 bg-[#0a0a0a] text-center">
      <div className="text-[10px] tracking-[0.3em] uppercase text-zinc-500">{label}</div>
      <div className="font-display text-6xl tracking-tighter mt-1" style={{ color }}>{value}</div>
      {sub && <div className="text-xs text-zinc-400 mt-1 truncate">{sub}</div>}
    </div>
  );
}
function SmallCounter({ label, value }) {
  return (
    <div className="border border-white/10 rounded-sm p-3 bg-[#0a0a0a] flex items-center justify-between">
      <div className="text-[10px] uppercase tracking-[0.2em] text-zinc-400">{label}</div>
      <div className="font-mono-display text-lg">{value}</div>
    </div>
  );
}

// ============ Logs panel ============
function LogsPanel({ matchId, role, onChanged }) {
  const [logs, setLogs] = useState([]);
  const load = async () => { const r = await api.get(`/matches/${matchId}/logs`); setLogs(r.data); };
  useEffect(() => { load(); const id = setInterval(load, 3000); return () => clearInterval(id); }, [matchId]);

  const canInvalidate = role === "head_jury" || role === "admin";

  const invalidate = async (logId) => {
    try { await api.post(`/matches/${matchId}/logs/${logId}/invalidate`); toast.success("Log dibatalkan"); load(); onChanged?.(); }
    catch (e) { toast.error(formatApiError(e)); }
  };

  return (
    <div className="border border-white/10 rounded-sm overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-[#141414] text-[10px] tracking-[0.2em] uppercase text-zinc-400">
          <tr>
            <th className="text-left px-4 py-3">Waktu</th>
            <th className="text-left px-4 py-3">Ronde</th>
            <th className="text-left px-4 py-3">Sudut</th>
            <th className="text-left px-4 py-3">Tindakan</th>
            <th className="text-left px-4 py-3">Kode</th>
            <th className="text-right px-4 py-3">Poin</th>
            <th className="text-left px-4 py-3">Oleh</th>
            <th className="text-right px-4 py-3"></th>
          </tr>
        </thead>
        <tbody>
          {logs.length === 0 ? (
            <tr><td colSpan={8} className="px-4 py-8 text-center text-zinc-500 text-xs tracking-[0.2em] uppercase">Belum ada log</td></tr>
          ) : logs.map((l) => (
            <tr key={l.id} className={`border-t border-white/5 ${l.valid ? "" : "opacity-40 line-through"}`} data-testid={`log-row-${l.id}`}>
              <td className="px-4 py-2 text-xs font-mono-display text-zinc-400">{new Date(l.timestamp).toLocaleTimeString("id-ID")}</td>
              <td className="px-4 py-2">{l.round}</td>
              <td className="px-4 py-2"><span className={l.corner === "red" ? "text-[#ff3b30]" : "text-[#007aff]"}>{l.corner === "red" ? "Merah" : "Biru"}</span></td>
              <td className="px-4 py-2 uppercase text-xs tracking-wide">{l.action_type}</td>
              <td className="px-4 py-2 uppercase text-xs">{l.code}</td>
              <td className="px-4 py-2 text-right font-mono-display">+{l.points}</td>
              <td className="px-4 py-2 text-zinc-400 text-xs">{l.judge_name} ({l.judge_role})</td>
              <td className="px-4 py-2 text-right">
                {canInvalidate && l.valid && (
                  <button onClick={() => invalidate(l.id)} className="text-xs text-zinc-500 hover:text-[#ff3b30]" data-testid={`invalidate-${l.id}`}>Batalkan</button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
