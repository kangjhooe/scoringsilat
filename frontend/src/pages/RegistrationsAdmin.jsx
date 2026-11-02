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
import { localUploadHref, resolvePhotoUrl } from "@/components/PhotoUpload";
import { ShieldCheck, ShieldAlert, ShieldX, Trophy, UserCheck, FileText, RefreshCw, Search, ChevronUp, ChevronDown, ChevronsUpDown, Copy } from "lucide-react";

const PRIVATE_DOC_LABELS = new Set(["ktp", "surat_sehat"]);

function registrationFileHref(reg, file) {
  const label = (file?.label || "").toLowerCase();
  if (PRIVATE_DOC_LABELS.has(label)) {
    if (!reg?.id || !file?.id || !(reg.access_code || "").trim()) return "";
    const params = new URLSearchParams({ access_code: reg.access_code });
    return `${BACKEND_URL}/api/public/registrations/${reg.id}/files/${file.id}?${params.toString()}`;
  }
  return localUploadHref(file?.url);
}

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
            <SelectTrigger className="bg-[#141414] border-white/40 text-white w-72" data-testid="reg-admin-event-select"><SelectValue placeholder="Pilih event"/></SelectTrigger>
            <SelectContent className="bg-[#141414] border-white/30 text-white">
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

const SORT_COLUMNS = [
  { key: "registration_number", label: "No. Registrasi" },
  { key: "name", label: "Nama" },
  { key: "contingent_name", label: "Kontingen" },
  { key: "category_name", label: "Kategori" },
  { key: "weight", label: "BB" },
  { key: "status", label: "Status" },
];
const PAGE_SIZES = [10, 25, 50];

function sortValue(row, key) {
  if (key === "status") return STATUS_LABEL[row.status] || row.status || "";
  if (key === "weight") return Number(row.weight) || 0;
  if (key === "category_name") return `${row.category_name || ""} ${row.class_name || ""}`.trim();
  return String(row[key] || "");
}

function RegTable({ rows, onOpen, stage }) {
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState(null);
  const [sortDir, setSortDir] = useState("asc");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = rows;
    if (q) {
      list = rows.filter((r) => [r.registration_number, r.name, r.contingent_name, r.category_name, r.class_name, STATUS_LABEL[r.status]]
        .filter(Boolean).join(" ").toLowerCase().includes(q));
    }
    if (!sortKey) return list;
    const dir = sortDir === "asc" ? 1 : -1;
    return [...list].sort((a, b) => {
      const av = sortValue(a, sortKey);
      const bv = sortValue(b, sortKey);
      if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir;
      return String(av).localeCompare(String(bv), "id") * dir;
    });
  }, [rows, query, sortKey, sortDir]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize) || 1);
  const safePage = Math.min(page, pageCount);
  const start = filtered.length ? (safePage - 1) * pageSize : 0;
  const pageRows = filtered.slice(start, start + pageSize);

  const toggleSort = (key) => {
    setPage(1);
    if (sortKey !== key) { setSortKey(key); setSortDir("asc"); return; }
    setSortDir((d) => (d === "asc" ? "desc" : "asc"));
  };

  if (!rows.length) {
    return (
      <div className="border border-dashed border-white/10 rounded-sm p-12 text-center text-sm text-zinc-500">
        Belum ada registrasi pada tahap ini.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="relative max-w-sm">
        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
        <Input
          value={query}
          onChange={(e) => { setQuery(e.target.value); setPage(1); }}
          placeholder="Cari nama, nomor, atau kontingen"
          className="bg-[#141414] border-white/40 text-white pl-9"
          data-testid={`reg-search-${stage}`}
        />
      </div>
      {!filtered.length ? (
        <div className="border border-dashed border-white/10 rounded-sm p-12 text-center text-sm text-zinc-500">
          Tidak ada hasil untuk pencarian ini.
        </div>
      ) : (
        <div className="border border-white/10 rounded-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-[#0a0a0a] text-zinc-400 text-[10px] tracking-[0.2em] uppercase">
                <tr>
                  <th className="text-left px-4 py-3 w-12">No</th>
                  {SORT_COLUMNS.map((col) => (
                    <th key={col.key} className="text-left px-4 py-3">
                      <button type="button" onClick={() => toggleSort(col.key)} className="inline-flex items-center gap-1 hover:text-white" data-testid={`reg-sort-${stage}-${col.key}`}>
                        {col.label}
                        {sortKey === col.key
                          ? (sortDir === "asc" ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />)
                          : <ChevronsUpDown className="w-3 h-3 opacity-40" />}
                      </button>
                    </th>
                  ))}
                  <th className="text-right px-4 py-3"></th>
                </tr>
              </thead>
              <tbody>
                {pageRows.map((r, i) => (
                  <tr key={r.id} className="border-t border-white/5 hover:bg-white/[0.02]" data-testid={`reg-row-${r.id}`}>
                    <td className="px-4 py-3 font-mono-display text-xs text-zinc-500">{start + i + 1}</td>
                    <td className="px-4 py-3 font-mono-display text-xs text-zinc-300">{r.registration_number}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        {r.photo_url ? <img src={resolvePhotoUrl(r.photo_url)} alt="" className="w-7 h-7 rounded-full object-cover" onError={(e)=>{e.currentTarget.style.visibility="hidden";}}/> : <div className="w-7 h-7 rounded-full bg-zinc-800 shrink-0"/>}
                        <div>
                          <div className="text-white">{r.name}</div>
                          <div className="text-[10px] tracking-[0.15em] uppercase text-zinc-500">{r.gender === "putra" ? "Putra" : "Putri"}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-zinc-300">{r.contingent_name || "—"}</td>
                    <td className="px-4 py-3 text-zinc-300">
                      <div>{r.category_name || "—"}</div>
                      {r.class_name ? <div className="text-[10px] text-zinc-500">{r.class_name}</div> : null}
                    </td>
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
          <div className="flex items-center justify-between gap-3 px-4 py-3 border-t border-white/10 text-xs text-zinc-400 flex-wrap">
            <div data-testid={`reg-page-info-${stage}`}>Menampilkan {start + 1}–{start + pageRows.length} dari {filtered.length}</div>
            <div className="flex items-center gap-2">
              <span className="uppercase tracking-[0.15em] text-[10px]">Baris</span>
              <Select value={String(pageSize)} onValueChange={(v) => { setPageSize(Number(v)); setPage(1); }}>
                <SelectTrigger className="bg-[#141414] border-white/40 text-white h-8 w-20" data-testid={`reg-page-size-${stage}`}><SelectValue /></SelectTrigger>
                <SelectContent className="bg-[#141414] border-white/30 text-white">
                  {PAGE_SIZES.map((n) => <SelectItem key={n} value={String(n)}>{n}</SelectItem>)}
                </SelectContent>
              </Select>
              <Button size="sm" variant="ghost" disabled={safePage <= 1} onClick={() => setPage(safePage - 1)} className="text-zinc-300 hover:text-white" data-testid={`reg-page-prev-${stage}`}>Sebelumnya</Button>
              <span className="font-mono-display" data-testid={`reg-page-num-${stage}`}>{safePage} / {pageCount}</span>
              <Button size="sm" variant="ghost" disabled={safePage >= pageCount} onClick={() => setPage(safePage + 1)} className="text-zinc-300 hover:text-white" data-testid={`reg-page-next-${stage}`}>Berikutnya</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function DetailDialog({ reg, onClose, onChanged }) {
  const [view, setView] = useState(reg);
  const [notes, setNotes] = useState(reg.admin_notes || "");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api.get(`/registrations/${reg.id}`).then((r) => {
      if (!cancelled && r.data) setView(r.data);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [reg.id]);

  const act = async (status) => {
    setBusy(true);
    try {
      await api.post(`/registrations/${view.id}/status`, { status, admin_notes: notes });
      toast.success(`Status diubah → ${STATUS_LABEL[status]}`);
      onChanged();
    } catch (e) { toast.error(e?.response?.data?.detail || "Gagal"); }
    finally { setBusy(false); }
  };

  const convert = async () => {
    setBusy(true);
    try {
      const r = await api.post(`/registrations/${view.id}/convert-to-athlete`);
      toast.success(`Peserta aktif dibuat: ${r.data.participant_number}`);
      onChanged();
    } catch (e) { toast.error(e?.response?.data?.detail || "Gagal konversi"); }
    finally { setBusy(false); }
  };

  const isVerifyStage = VERIFY_STATUSES.includes(view.status);
  const isSelectionStage = ["verified", "selection_process"].includes(view.status);
  const isAccepted = view.status === "accepted";

  const copyCode = async () => {
    if (!view.access_code) return;
    try {
      await navigator.clipboard.writeText(view.access_code);
      toast.success("Kode akses disalin");
    } catch {
      toast.error("Salin kode secara manual");
    }
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="bg-[#0f0f10] border-white/10 text-white max-w-2xl" data-testid="reg-detail-dialog">
        <DialogHeader><DialogTitle className="font-display text-2xl tracking-tight uppercase">Detail Registrasi</DialogTitle></DialogHeader>

        <div className="space-y-4 max-h-[70vh] overflow-y-auto pr-2">
          <div className="flex items-start gap-4">
            <div className="w-20 h-20 rounded-sm bg-[#0a0a0a] border border-white/10 overflow-hidden shrink-0">
              {view.photo_url ? <img src={resolvePhotoUrl(view.photo_url)} alt="" className="w-full h-full object-cover"/> : <div className="w-full h-full"/>}
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-mono-display text-xs text-[#ffcc00]" data-testid="detail-regnum">{view.registration_number}</div>
              <div className="font-display text-2xl tracking-tight mt-1">{view.name}</div>
              <div className="text-xs text-zinc-400 mt-1">{view.gender === "putra" ? "Putra" : "Putri"} · {view.weight ? `${view.weight} kg` : "BB —"} · {view.contingent_name || "tanpa kontingen"}</div>
              <div className="text-xs text-zinc-400">{[view.category_name, view.class_name].filter(Boolean).join(" · ") || "Kategori belum diisi"}</div>
              <div className={`inline-block px-2 py-0.5 mt-2 border rounded-sm text-[10px] tracking-[0.15em] uppercase ${STATUS_BADGE[view.status] || "border-white/10 text-zinc-300"}`}>{STATUS_LABEL[view.status] || view.status}</div>
            </div>
          </div>

          <div className="border border-[#ffcc00]/30 bg-[#ffcc00]/10 rounded-sm px-3 py-2" data-testid="detail-access-code">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-[10px] tracking-[0.2em] uppercase text-[#ffcc00]">Kode Akses Peserta</div>
                <div className="font-mono-display text-lg text-white mt-0.5 break-all">{view.access_code || "Menyiapkan kode…"}</div>
              </div>
              <Button type="button" size="sm" onClick={copyCode} disabled={!view.access_code} className="bg-[#ffcc00] hover:bg-[#e6b800] text-black rounded-sm shrink-0" data-testid="detail-copy-code">
                <Copy className="w-3.5 h-3.5 mr-1.5" /> Salin
              </Button>
            </div>
            <p className="text-[11px] text-zinc-400 mt-1">Sampaikan kode ini kepada peserta. Nomor registrasi saja tidak cukup untuk cek status.</p>
          </div>

          <div className="grid grid-cols-2 gap-3 text-xs">
            <Field label="Kontingen" value={view.contingent_name || "—"} />
            <Field label="Kategori" value={view.category_name || "—"} />
            <Field label="Kelas" value={view.class_name || "—"} />
            <Field label="Telepon" value={view.phone || "—"} />
            <Field label="Email" value={view.email || "—"} />
            <Field label="Tanggal Lahir" value={view.dob || "—"} />
            <Field label="Alamat" value={view.address || "—"} />
            {view.participant_number && <Field label="Nomor Peserta" value={view.participant_number} highlight />}
          </div>

          {view.files && view.files.length > 0 && (
            <div>
              <div className="text-[10px] tracking-[0.2em] uppercase text-zinc-400 mb-2 flex items-center gap-2"><FileText className="w-3.5 h-3.5"/> Dokumen</div>
              <div className="grid grid-cols-3 gap-2">
                {view.files.map((f) => {
                  const href = registrationFileHref(view, f);
                  if (!href) {
                    return (
                      <div key={f.id} className="border border-white/10 rounded-sm p-3" data-testid={`file-${f.label}`}>
                        <div className="text-[10px] tracking-[0.2em] uppercase text-zinc-400">{f.label}</div>
                        <div className="text-xs text-zinc-500 mt-1 truncate">Berkas tidak tersedia</div>
                      </div>
                    );
                  }
                  return (
                    <a key={f.id} href={href} target="_blank" rel="noreferrer" className="border border-white/10 rounded-sm p-3 hover:bg-white/5 transition-colors" data-testid={`file-${f.label}`}>
                      <div className="text-[10px] tracking-[0.2em] uppercase text-zinc-400">{f.label}</div>
                      <div className="text-xs text-emerald-300 mt-1 truncate">Lihat berkas →</div>
                    </a>
                  );
                })}
              </div>
            </div>
          )}

          <div>
            <Label className="text-[10px] tracking-[0.2em] uppercase text-zinc-400">Catatan Admin</Label>
            <Textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} className="bg-[#0a0a0a] border-white/10 mt-1" data-testid="detail-notes-input" />
          </div>

          {view.history && view.history.length > 0 && (
            <div>
              <div className="text-[10px] tracking-[0.2em] uppercase text-zinc-400 mb-2">Riwayat</div>
              <div className="space-y-1 max-h-32 overflow-y-auto pr-1">
                {[...view.history].reverse().map((h, i) => (
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
          {view.status === "reserve" && (
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
