import React, { useEffect, useMemo, useState } from "react";
import AppShell from "@/components/AppShell";
import api, { BACKEND_URL } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Toaster, toast } from "sonner";
import { resolvePhotoUrl } from "@/components/PhotoUpload";
import { ShieldCheck, ShieldAlert, ShieldX, Trophy, UserCheck, FileText, MessageSquare, RefreshCw } from "lucide-react";

const STATUS_LABEL = {
  pending_verification: "Menunggu Verifikasi",
  need_revision: "Perlu Revisi",
  verification_rejected: "Verifikasi Ditolak",
  verified: "Terverifikasi",
  selection_process: "Proses Seleksi",
  accepted: "Diterima",
  reserve: "Cadangan",
  rejected: "Ditolak",
  active_participant: "Peserta Aktif",
};

const STATUS_BADGE = {
  pending_verification: "bg-amber-500/10 text-amber-300 border-amber-500/30",
  need_revision: "bg-orange-500/10 text-orange-300 border-orange-500/30",
  verification_rejected: "bg-red-500/10 text-red-300 border-red-500/30",
  verified: "bg-cyan-500/10 text-cyan-300 border-cyan-500/30",
  selection_process: "bg-indigo-500/10 text-indigo-300 border-indigo-500/30",
  accepted: "bg-emerald-500/10 text-emerald-300 border-emerald-500/30",
  reserve: "bg-zinc-500/10 text-zinc-300 border-zinc-500/30",
  rejected: "bg-rose-500/10 text-rose-300 border-rose-500/30",
  active_participant: "bg-[#ffcc00]/15 text-[#ffcc00] border-[#ffcc00]/40",
};

const VERIFY_STATUSES = ["pending_verification", "need_revision", "verification_rejected", "verified"];
const SELECTION_STATUSES = ["verified", "selection_process", "accepted", "reserve", "rejected", "active_participant"];

export default function RegistrationsAdmin() {
  const [events, setEvents] = useState([]);
  const [eventId, setEventId] = useState(localStorage.getItem("admin_event_id") || "");
  const [regs, setRegs] = useState([]);
  const [tab, setTab] = useState("verify");
  const [detail, setDetail] = useState(null);

  const load = async () => {
    if (!eventId) { setRegs([]); return; }
    const r = await api.get("/registrations", { params: { event_id: eventId } });
    setRegs(r.data || []);
  };

  useEffect(() => { api.get("/events").then((r) => setEvents(r.data || [])); }, []);
  // eslint-disable-next-line
  useEffect(() => { load(); }, [eventId]);

  const verifyList = useMemo(() => regs.filter((r) => VERIFY_STATUSES.includes(r.status)), [regs]);
  const selectionList = useMemo(() => regs.filter((r) => SELECTION_STATUSES.includes(r.status)), [regs]);

  return (
    <AppShell title="Registrasi & Seleksi">
      <Toaster theme="dark" position="top-right" />
      <div className="flex items-center justify-between mb-6 gap-4 flex-wrap">
        <div>
          <h1 className="font-display text-3xl tracking-tight uppercase">Pendaftaran Peserta</h1>
          <p className="text-sm text-zinc-400 mt-1">Verifikasi pendaftaran masuk, lakukan seleksi, dan konversi menjadi peserta aktif.</p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={eventId} onValueChange={(v) => { setEventId(v); localStorage.setItem("admin_event_id", v); }}>
            <SelectTrigger className="bg-[#0a0a0a] border-white/10 w-72" data-testid="reg-admin-event-select"><SelectValue placeholder="Pilih event"/></SelectTrigger>
            <SelectContent className="bg-[#141414] border-white/10 text-white">
              {events.map((e) => <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button onClick={load} variant="ghost" size="sm" className="text-zinc-400 hover:text-white" data-testid="reg-admin-refresh"><RefreshCw className="w-4 h-4"/></Button>
        </div>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="bg-[#141414] border border-white/10 rounded-sm">
          <TabsTrigger value="verify" data-testid="tab-verify" className="data-[state=active]:bg-[#ffcc00] data-[state=active]:text-black uppercase tracking-[0.2em] text-xs">
            <ShieldCheck className="w-4 h-4 mr-2"/> Verifikasi
            <span className="ml-2 text-[10px] font-mono-display opacity-70" data-testid="verify-count">({verifyList.length})</span>
          </TabsTrigger>
          <TabsTrigger value="selection" data-testid="tab-selection" className="data-[state=active]:bg-[#ffcc00] data-[state=active]:text-black uppercase tracking-[0.2em] text-xs">
            <Trophy className="w-4 h-4 mr-2"/> Seleksi
            <span className="ml-2 text-[10px] font-mono-display opacity-70" data-testid="selection-count">({selectionList.length})</span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="verify" className="mt-6">
          <RegTable rows={verifyList} onOpen={setDetail} stage="verify" />
        </TabsContent>
        <TabsContent value="selection" className="mt-6">
          <RegTable rows={selectionList} onOpen={setDetail} stage="selection" />
        </TabsContent>
      </Tabs>

      {detail && <DetailDialog reg={detail} onClose={() => setDetail(null)} onChanged={() => { load(); setDetail(null); }} />}
    </AppShell>
  );
}

function RegTable({ rows, onOpen, stage }) {
  if (!rows.length) {
    return (
      <div className="border border-dashed border-white/10 rounded-sm p-12 text-center text-sm text-zinc-500">
        Belum ada registrasi pada tahap ini.
      </div>
    );
  }
  return (
    <div className="border border-white/10 rounded-sm overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-[#0a0a0a] text-zinc-400 text-[10px] tracking-[0.2em] uppercase">
          <tr>
            <th className="text-left px-4 py-3">No. Registrasi</th>
            <th className="text-left px-4 py-3">Nama</th>
            <th className="text-left px-4 py-3">Kontingen</th>
            <th className="text-left px-4 py-3">Kategori</th>
            <th className="text-left px-4 py-3">BB</th>
            <th className="text-left px-4 py-3">Status</th>
            <th className="text-right px-4 py-3"></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-t border-white/5 hover:bg-white/[0.02]" data-testid={`reg-row-${r.id}`}>
              <td className="px-4 py-3 font-mono-display text-xs text-zinc-300">{r.registration_number}</td>
              <td className="px-4 py-3 flex items-center gap-2">
                {r.photo_url ? <img src={resolvePhotoUrl(r.photo_url)} alt="" className="w-7 h-7 rounded-full object-cover" onError={(e)=>{e.currentTarget.style.visibility="hidden";}}/> : <div className="w-7 h-7 rounded-full bg-zinc-800"/>}
                <span className="text-white">{r.name}</span>
              </td>
              <td className="px-4 py-3 text-zinc-300">{r.contingent_name || "—"}</td>
              <td className="px-4 py-3 text-zinc-300">{r.gender === "putra" ? "Putra" : "Putri"}</td>
              <td className="px-4 py-3 text-zinc-300">{r.weight ? `${r.weight} kg` : "—"}</td>
              <td className="px-4 py-3">
                <span className={`px-2 py-0.5 border rounded-sm text-[10px] tracking-[0.15em] uppercase ${STATUS_BADGE[r.status] || "border-white/10 text-zinc-400"}`}>{STATUS_LABEL[r.status] || r.status}</span>
              </td>
              <td className="px-4 py-3 text-right">
                <Button size="sm" onClick={() => onOpen(r)} className="bg-white/5 hover:bg-white/10 text-white border border-white/10 rounded-sm uppercase tracking-[0.15em] text-[10px]" data-testid={`reg-open-${r.id}`}>
                  {stage === "verify" ? "Verifikasi" : "Seleksi"}
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DetailDialog({ reg, onClose, onChanged }) {
  const [notes, setNotes] = useState(reg.admin_notes || "");
  const [busy, setBusy] = useState(false);

  const act = async (status) => {
    setBusy(true);
    try {
      await api.post(`/registrations/${reg.id}/status`, { status, admin_notes: notes });
      toast.success(`Status diubah → ${STATUS_LABEL[status]}`);
      onChanged();
    } catch (e) { toast.error(e?.response?.data?.detail || "Gagal"); }
    finally { setBusy(false); }
  };

  const convert = async () => {
    setBusy(true);
    try {
      const r = await api.post(`/registrations/${reg.id}/convert-to-athlete`);
      toast.success(`Peserta aktif dibuat: ${r.data.participant_number}`);
      onChanged();
    } catch (e) { toast.error(e?.response?.data?.detail || "Gagal konversi"); }
    finally { setBusy(false); }
  };

  const isVerifyStage = VERIFY_STATUSES.includes(reg.status);
  const isSelectionStage = ["verified", "selection_process"].includes(reg.status);
  const isAccepted = reg.status === "accepted";

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="bg-[#0f0f10] border-white/10 text-white max-w-2xl" data-testid="reg-detail-dialog">
        <DialogHeader><DialogTitle className="font-display text-2xl tracking-tight uppercase">Detail Registrasi</DialogTitle></DialogHeader>

        <div className="space-y-4 max-h-[70vh] overflow-y-auto pr-2">
          <div className="flex items-start gap-4">
            <div className="w-20 h-20 rounded-sm bg-[#0a0a0a] border border-white/10 overflow-hidden shrink-0">
              {reg.photo_url ? <img src={resolvePhotoUrl(reg.photo_url)} alt="" className="w-full h-full object-cover"/> : <div className="w-full h-full"/>}
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-mono-display text-xs text-[#ffcc00]" data-testid="detail-regnum">{reg.registration_number}</div>
              <div className="font-display text-2xl tracking-tight mt-1">{reg.name}</div>
              <div className="text-xs text-zinc-400 mt-1">{reg.gender === "putra" ? "Putra" : "Putri"} · {reg.weight ? `${reg.weight} kg` : "BB —"} · {reg.contingent_name || "tanpa kontingen"}</div>
              <div className={`inline-block px-2 py-0.5 mt-2 border rounded-sm text-[10px] tracking-[0.15em] uppercase ${STATUS_BADGE[reg.status] || "border-white/10 text-zinc-300"}`}>{STATUS_LABEL[reg.status] || reg.status}</div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 text-xs">
            <Field label="Telepon" value={reg.phone || "—"} />
            <Field label="Email" value={reg.email || "—"} />
            <Field label="Tanggal Lahir" value={reg.dob || "—"} />
            <Field label="Alamat" value={reg.address || "—"} />
            {reg.participant_number && <Field label="Nomor Peserta" value={reg.participant_number} highlight />}
          </div>

          {reg.files && reg.files.length > 0 && (
            <div>
              <div className="text-[10px] tracking-[0.2em] uppercase text-zinc-400 mb-2 flex items-center gap-2"><FileText className="w-3.5 h-3.5"/> Dokumen</div>
              <div className="grid grid-cols-3 gap-2">
                {reg.files.map((f) => (
                  <a key={f.id} href={`${BACKEND_URL}${f.url}`} target="_blank" rel="noreferrer" className="border border-white/10 rounded-sm p-3 hover:bg-white/5 transition-colors" data-testid={`file-${f.label}`}>
                    <div className="text-[10px] tracking-[0.2em] uppercase text-zinc-400">{f.label}</div>
                    <div className="text-xs text-emerald-300 mt-1 truncate">Lihat berkas →</div>
                  </a>
                ))}
              </div>
            </div>
          )}

          <div>
            <Label className="text-[10px] tracking-[0.2em] uppercase text-zinc-400">Catatan Admin</Label>
            <Textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} className="bg-[#0a0a0a] border-white/10 mt-1" data-testid="detail-notes-input" />
          </div>

          {reg.history && reg.history.length > 0 && (
            <div>
              <div className="text-[10px] tracking-[0.2em] uppercase text-zinc-400 mb-2">Riwayat</div>
              <div className="space-y-1 max-h-32 overflow-y-auto pr-1">
                {[...reg.history].reverse().map((h, i) => (
                  <div key={i} className="text-[11px] text-zinc-400 flex items-start gap-2">
                    <span className="font-mono-display text-zinc-500 shrink-0">{new Date(h.at).toLocaleString("id-ID")}</span>
                    <span className="uppercase tracking-[0.15em]">{STATUS_LABEL[h.status] || h.status}</span>
                    {h.notes && <span className="italic text-zinc-500">— {h.notes}</span>}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="flex flex-wrap gap-2 mt-2">
          {isVerifyStage && (
            <>
              <Button onClick={() => act("need_revision")} disabled={busy} className="bg-orange-500/15 text-orange-300 hover:bg-orange-500/25 border border-orange-500/30 rounded-sm uppercase tracking-[0.15em] text-[11px]" data-testid="action-need-revision">
                <ShieldAlert className="w-3.5 h-3.5 mr-2"/> Perlu Revisi
              </Button>
              <Button onClick={() => act("verification_rejected")} disabled={busy} className="bg-rose-500/15 text-rose-300 hover:bg-rose-500/25 border border-rose-500/30 rounded-sm uppercase tracking-[0.15em] text-[11px]" data-testid="action-reject-verify">
                <ShieldX className="w-3.5 h-3.5 mr-2"/> Tolak Verifikasi
              </Button>
              <Button onClick={() => act("verified")} disabled={busy} className="bg-emerald-500 hover:bg-emerald-600 text-black rounded-sm uppercase tracking-[0.15em] text-[11px]" data-testid="action-verify">
                <ShieldCheck className="w-3.5 h-3.5 mr-2"/> Verifikasi
              </Button>
            </>
          )}
          {isSelectionStage && (
            <>
              <Button onClick={() => act("rejected")} disabled={busy} className="bg-rose-500/15 text-rose-300 hover:bg-rose-500/25 border border-rose-500/30 rounded-sm uppercase tracking-[0.15em] text-[11px]" data-testid="action-reject">Tolak</Button>
              <Button onClick={() => act("reserve")} disabled={busy} className="bg-zinc-500/15 text-zinc-200 hover:bg-zinc-500/25 border border-zinc-500/30 rounded-sm uppercase tracking-[0.15em] text-[11px]" data-testid="action-reserve">Cadangan</Button>
              <Button onClick={() => act("accepted")} disabled={busy} className="bg-emerald-500 hover:bg-emerald-600 text-black rounded-sm uppercase tracking-[0.15em] text-[11px]" data-testid="action-accept">Terima</Button>
            </>
          )}
          {isAccepted && (
            <Button onClick={convert} disabled={busy} className="bg-[#ffcc00] hover:bg-[#e6b800] text-black rounded-sm uppercase tracking-[0.15em] text-[11px]" data-testid="action-convert">
              <UserCheck className="w-3.5 h-3.5 mr-2"/> Jadikan Peserta Aktif
            </Button>
          )}
          {reg.status === "reserve" && (
            <Button onClick={() => act("accepted")} disabled={busy} className="bg-emerald-500 hover:bg-emerald-600 text-black rounded-sm uppercase tracking-[0.15em] text-[11px]" data-testid="action-promote">Promosi → Terima</Button>
          )}
          <Button onClick={onClose} variant="ghost" className="text-zinc-400">Tutup</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, value, highlight }) {
  return (
    <div>
      <div className="text-[10px] tracking-[0.2em] uppercase text-zinc-500">{label}</div>
      <div className={`text-sm ${highlight ? "text-[#ffcc00] font-mono-display" : "text-white"} mt-0.5`}>{value}</div>
    </div>
  );
}
