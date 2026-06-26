import React, { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import AppShell from "@/components/AppShell";
import api, { formatApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast, Toaster } from "sonner";
import { Plus, Trash2, Pencil, Calendar, MapPin, Users, Trophy, Building2, Settings2, ListChecks, Globe2, Eye, Link as LinkIcon } from "lucide-react";
import PhotoUpload, { resolvePhotoUrl } from "@/components/PhotoUpload";

export default function AdminDashboard() {
  const { user } = useAuth();
  const [events, setEvents] = useState([]);
  const [selectedEvent, setSelectedEvent] = useState(null);
  const [loading, setLoading] = useState(true);

  const loadEvents = async () => {
    setLoading(true);
    try {
      const r = await api.get("/events");
      setEvents(r.data);
      if (r.data.length > 0) {
        const keep = r.data.find((e) => e.id === selectedEvent?.id);
        setSelectedEvent(keep || r.data[0]);
      } else {
        setSelectedEvent(null);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadEvents(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  return (
    <AppShell title="Master Data">
      <Toaster theme="dark" position="top-right" />
      <div className="grid grid-cols-12 gap-6">
        <aside className="col-span-12 md:col-span-3">
          <EventsSidebar
            events={events}
            selectedId={selectedEvent?.id}
            onSelect={setSelectedEvent}
            onChanged={loadEvents}
            loading={loading}
          />
        </aside>
        <div className="col-span-12 md:col-span-9">
          {selectedEvent ? <EventDetail event={selectedEvent} onChanged={loadEvents} /> : <EmptyState title="Pilih atau buat event terlebih dahulu" />}
        </div>
      </div>
    </AppShell>
  );
}

function EmptyState({ title }) {
  return (
    <div className="border border-dashed border-white/10 rounded-sm p-12 text-center text-zinc-500">
      <Trophy className="w-12 h-12 mx-auto mb-4 text-zinc-700" />
      <div className="text-sm tracking-[0.2em] uppercase">{title}</div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div>
      <Label className="text-[10px] tracking-[0.2em] uppercase text-zinc-400">{label}</Label>
      <div className="mt-1">{children}</div>
    </div>
  );
}

const EMPTY_EVENT = {
  name: "",
  code: "",
  location: "",
  start_date: "",
  end_date: "",
  logo_url: "",
  status: "active",
  slug: "",
  landing_enabled: true,
  registration_enabled: true,
  landing_title: "",
  landing_subtitle: "",
  landing_description: "",
  landing_poster_url: "",
  landing_contact: "",
  landing_requirements: "",
  landing_schedule_note: "",
};

function eventToForm(e = {}) {
  return {
    ...EMPTY_EVENT,
    name: e.name || "",
    code: e.code || "",
    location: e.location || "",
    start_date: e.start_date || "",
    end_date: e.end_date || "",
    logo_url: e.logo_url || "",
    status: e.status || "active",
    slug: e.slug || "",
    landing_enabled: e.landing_enabled !== false,
    registration_enabled: e.registration_enabled !== false,
    landing_title: e.landing_title || "",
    landing_subtitle: e.landing_subtitle || "",
    landing_description: e.landing_description || "",
    landing_poster_url: e.landing_poster_url || "",
    landing_contact: e.landing_contact || "",
    landing_requirements: e.landing_requirements || "",
    landing_schedule_note: e.landing_schedule_note || "",
  };
}

function EventsSidebar({ events, selectedId, onSelect, onChanged, loading }) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY_EVENT);
  const [busy, setBusy] = useState(false);

  const openAdd = () => { setEditing(null); setForm(EMPTY_EVENT); setOpen(true); };
  const openEdit = (e) => { setEditing(e); setForm(eventToForm(e)); setOpen(true); };

  const save = async () => {
    setBusy(true);
    try {
      if (editing) {
        await api.put(`/events/${editing.id}`, form);
        toast.success("Event diperbarui");
      } else {
        await api.post("/events", form);
        toast.success("Event dibuat");
      }
      setOpen(false);
      onChanged();
    } catch (e) { toast.error(formatApiError(e)); }
    finally { setBusy(false); }
  };

  const del = async (id) => {
    if (!window.confirm("Hapus event ini?")) return;
    try { await api.delete(`/events/${id}`); toast.success("Event dihapus"); onChanged(); }
    catch (e) { toast.error(formatApiError(e)); }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-xs tracking-[0.3em] uppercase text-zinc-400">Event</div>
        <Button size="sm" onClick={openAdd} className="h-8 bg-[#ffcc00] hover:bg-[#e6b800] text-black rounded-sm" data-testid="create-event-btn">
          <Plus className="w-4 h-4" />
        </Button>
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="bg-[#141414] border-white/10 text-white max-w-md">
          <DialogHeader><DialogTitle className="font-display text-2xl uppercase tracking-tight">{editing ? "Edit Event" : "Event Baru"}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <Field label="Nama Event"><Input data-testid="event-name-input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="bg-[#0a0a0a] border-white/10" /></Field>
            <Field label="Kode Event (untuk No. Registrasi & Peserta)"><Input data-testid="event-code-input" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} placeholder="contoh: KEJURNAS2026" className="bg-[#0a0a0a] border-white/10 font-mono uppercase" /></Field>
            <Field label="Lokasi"><Input data-testid="event-location-input" value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} className="bg-[#0a0a0a] border-white/10" /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Tanggal Mulai"><Input type="date" value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })} className="bg-[#0a0a0a] border-white/10" /></Field>
              <Field label="Tanggal Selesai"><Input type="date" value={form.end_date} onChange={(e) => setForm({ ...form, end_date: e.target.value })} className="bg-[#0a0a0a] border-white/10" /></Field>
            </div>
            <Field label="Status Event">
              <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v })}>
                <SelectTrigger data-testid="event-status-select" className="bg-[#0a0a0a] border-white/10"><SelectValue /></SelectTrigger>
                <SelectContent className="bg-[#141414] border-white/10 text-white">
                  <SelectItem value="active">Aktif</SelectItem>
                  <SelectItem value="registration_open">Pendaftaran Dibuka</SelectItem>
                  <SelectItem value="scheduled">Terjadwal</SelectItem>
                  <SelectItem value="closed">Ditutup</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <PhotoUpload value={form.logo_url} onChange={(v) => setForm({ ...form, logo_url: v })} label="Logo Event (opsional)" testIdPrefix="event-logo" />
          </div>
          <DialogFooter>
            <Button disabled={busy || !form.name} onClick={save} data-testid="event-save-btn" className="bg-[#ffcc00] hover:bg-[#e6b800] text-black">Simpan</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {loading ? (
        <div className="text-xs text-zinc-500">Memuat...</div>
      ) : events.length === 0 ? (
        <div className="text-xs text-zinc-500 border border-dashed border-white/10 p-4 rounded-sm">Belum ada event</div>
      ) : (
        <div className="space-y-2">
          {events.map((e) => (
            <div key={e.id} className={`group p-3 border rounded-sm transition-all ${selectedId === e.id ? "border-[#ffcc00] bg-[#ffcc00]/5" : "border-white/10 bg-[#141414] hover:border-white/30"}`}>
              <button onClick={() => onSelect(e)} className="w-full text-left tap-press" data-testid={`event-card-${e.id}`}>
                <div className="text-sm font-semibold text-white truncate pr-12">{e.name}</div>
                <div className="flex items-center gap-2 text-[10px] text-zinc-500 mt-1"><MapPin className="w-3 h-3" /> {e.location || "-"}</div>
                <div className="flex items-center gap-2 text-[10px] text-zinc-500 mt-1"><Calendar className="w-3 h-3" /> {e.start_date || "-"} → {e.end_date || "-"}</div>
              </button>
              <div className="flex items-center justify-end gap-1 mt-2">
                <button onClick={() => openEdit(e)} className="p-1.5 text-zinc-400 hover:text-[#ffcc00] hover:bg-white/5 rounded-sm transition-colors" data-testid={`edit-event-${e.id}`}><Pencil className="w-3.5 h-3.5"/></button>
                <button onClick={() => del(e.id)} className="p-1.5 text-zinc-500 hover:text-[#ff3b30] hover:bg-white/5 rounded-sm transition-colors" data-testid={`delete-event-${e.id}`}><Trash2 className="w-3.5 h-3.5"/></button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function EventDetail({ event, onChanged }) {
  return (
    <div>
      <div className="flex items-end justify-between mb-6">
        <div>
          <div className="text-[10px] tracking-[0.3em] uppercase text-[#ffcc00] mb-1">Event Aktif</div>
          <h2 className="font-display text-3xl uppercase tracking-tight">{event.name}</h2>
          <div className="text-sm text-zinc-400 mt-1">{event.location} · {event.start_date} → {event.end_date}</div>
        </div>
      </div>

      <Tabs defaultValue="rules" className="w-full">
        <TabsList className="bg-[#141414] border border-white/10 rounded-sm h-auto p-1 flex-wrap">
          <TabsTrigger value="landing" data-testid="tab-landing" className="rounded-sm data-[state=active]:bg-[#ffcc00] data-[state=active]:text-black text-xs tracking-[0.15em] uppercase"><Globe2 className="w-3.5 h-3.5 mr-2" />Landing Page</TabsTrigger>
          <TabsTrigger value="rules" data-testid="tab-rules" className="rounded-sm data-[state=active]:bg-[#ffcc00] data-[state=active]:text-black text-xs tracking-[0.15em] uppercase"><Settings2 className="w-3.5 h-3.5 mr-2" />Aturan Skor</TabsTrigger>
          <TabsTrigger value="categories" data-testid="tab-categories" className="rounded-sm data-[state=active]:bg-[#ffcc00] data-[state=active]:text-black text-xs tracking-[0.15em] uppercase"><ListChecks className="w-3.5 h-3.5 mr-2" />Kategori</TabsTrigger>
          <TabsTrigger value="classes" data-testid="tab-classes" className="rounded-sm data-[state=active]:bg-[#ffcc00] data-[state=active]:text-black text-xs tracking-[0.15em] uppercase">Kelas</TabsTrigger>
          <TabsTrigger value="arenas" data-testid="tab-arenas" className="rounded-sm data-[state=active]:bg-[#ffcc00] data-[state=active]:text-black text-xs tracking-[0.15em] uppercase"><Building2 className="w-3.5 h-3.5 mr-2" />Gelanggang</TabsTrigger>
          <TabsTrigger value="contingents" data-testid="tab-contingents" className="rounded-sm data-[state=active]:bg-[#ffcc00] data-[state=active]:text-black text-xs tracking-[0.15em] uppercase">Kontingen</TabsTrigger>
          <TabsTrigger value="athletes" data-testid="tab-athletes" className="rounded-sm data-[state=active]:bg-[#ffcc00] data-[state=active]:text-black text-xs tracking-[0.15em] uppercase"><Users className="w-3.5 h-3.5 mr-2" />Atlet</TabsTrigger>
          <TabsTrigger value="users" data-testid="tab-users" className="rounded-sm data-[state=active]:bg-[#ffcc00] data-[state=active]:text-black text-xs tracking-[0.15em] uppercase">Pengguna</TabsTrigger>
        </TabsList>

        <TabsContent value="landing" className="mt-6"><LandingPageTab event={event} onChanged={onChanged} /></TabsContent>
        <TabsContent value="rules" className="mt-6"><ScoringRulesTab eventId={event.id} /></TabsContent>
        <TabsContent value="categories" className="mt-6"><CategoriesTab eventId={event.id} /></TabsContent>
        <TabsContent value="classes" className="mt-6"><ClassesTab eventId={event.id} /></TabsContent>
        <TabsContent value="arenas" className="mt-6"><ArenasTab eventId={event.id} /></TabsContent>
        <TabsContent value="contingents" className="mt-6"><ContingentsTab eventId={event.id} /></TabsContent>
        <TabsContent value="athletes" className="mt-6"><AthletesTab eventId={event.id} /></TabsContent>
        <TabsContent value="users" className="mt-6"><UsersTab /></TabsContent>
      </Tabs>
    </div>
  );
}

function LandingPageTab({ event, onChanged }) {
  const [form, setForm] = useState(eventToForm(event));
  const [busy, setBusy] = useState(false);

  useEffect(() => { setForm(eventToForm(event)); }, [event]);

  const publicUrl = form.slug ? `${window.location.origin}/event/${form.slug}` : `${window.location.origin}/`;

  const save = async () => {
    setBusy(true);
    try {
      await api.put(`/events/${event.id}`, form);
      toast.success("Landing page event tersimpan");
      onChanged?.();
    } catch (e) {
      toast.error(formatApiError(e));
    } finally {
      setBusy(false);
    }
  };

  const copyUrl = async () => {
    try {
      await navigator.clipboard.writeText(publicUrl);
      toast.success("Link landing page disalin");
    } catch {
      toast.error("Gagal menyalin link");
    }
  };

  return (
    <div className="space-y-6">
      <div className="border border-white/10 bg-[#111] p-5">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div>
            <div className="text-[10px] tracking-[0.3em] uppercase text-[#ffcc00]">Publikasi Event</div>
            <h3 className="mt-2 text-2xl font-bold uppercase">Landing page peserta</h3>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-400">Halaman ini menjadi pintu masuk publik untuk informasi event, pendaftaran peserta, cek status registrasi, dan akses display.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button asChild className="bg-white/5 text-white border border-white/10 hover:bg-white/10 rounded-sm" data-testid="landing-preview-btn">
              <a href={publicUrl} target="_blank" rel="noreferrer"><Eye className="w-4 h-4" />Preview</a>
            </Button>
            <Button onClick={copyUrl} className="bg-white/5 text-white border border-white/10 hover:bg-white/10 rounded-sm" data-testid="landing-copy-btn">
              <LinkIcon className="w-4 h-4" />Salin Link
            </Button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="space-y-4">
          <div className="border border-white/10 bg-[#111] p-5 space-y-4">
            <div className="text-[10px] tracking-[0.3em] uppercase text-zinc-400">Status</div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <ToggleBox
                label="Landing Dipublikasikan"
                hint="Event muncul di halaman utama dan URL publik."
                checked={form.landing_enabled}
                onChange={(checked) => setForm({ ...form, landing_enabled: checked })}
                testId="landing-enabled"
              />
              <ToggleBox
                label="Pendaftaran Dibuka"
                hint="Peserta dapat submit formulir untuk event ini."
                checked={form.registration_enabled}
                onChange={(checked) => setForm({ ...form, registration_enabled: checked })}
                testId="registration-enabled"
              />
            </div>
            <Field label="Slug URL">
              <Input
                value={form.slug}
                onChange={(e) => setForm({ ...form, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-") })}
                placeholder="kejurnas-pencak-silat-2026"
                className="bg-[#0a0a0a] border-white/10 font-mono text-xs"
                data-testid="landing-slug-input"
              />
              <div className="mt-1 text-xs text-zinc-500">{publicUrl}</div>
            </Field>
            <Field label="Status Event">
              <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v })}>
                <SelectTrigger data-testid="landing-status-select" className="bg-[#0a0a0a] border-white/10"><SelectValue /></SelectTrigger>
                <SelectContent className="bg-[#141414] border-white/10 text-white">
                  <SelectItem value="active">Aktif</SelectItem>
                  <SelectItem value="registration_open">Pendaftaran Dibuka</SelectItem>
                  <SelectItem value="scheduled">Terjadwal</SelectItem>
                  <SelectItem value="closed">Ditutup</SelectItem>
                </SelectContent>
              </Select>
            </Field>
          </div>

          <div className="border border-white/10 bg-[#111] p-5 space-y-4">
            <div className="text-[10px] tracking-[0.3em] uppercase text-zinc-400">Media</div>
            <PhotoUpload value={form.landing_poster_url} onChange={(v) => setForm({ ...form, landing_poster_url: v })} label="Poster / Hero Landing" testIdPrefix="landing-poster" />
            <PhotoUpload value={form.logo_url} onChange={(v) => setForm({ ...form, logo_url: v })} label="Logo Event" testIdPrefix="landing-logo" />
          </div>
        </div>

        <div className="border border-white/10 bg-[#111] p-5 space-y-4">
          <div className="text-[10px] tracking-[0.3em] uppercase text-zinc-400">Konten Landing</div>
          <Field label="Judul Utama">
            <Input value={form.landing_title} onChange={(e) => setForm({ ...form, landing_title: e.target.value })} placeholder={form.name} className="bg-[#0a0a0a] border-white/10" data-testid="landing-title-input" />
          </Field>
          <Field label="Subjudul">
            <Input value={form.landing_subtitle} onChange={(e) => setForm({ ...form, landing_subtitle: e.target.value })} placeholder="Pendaftaran peserta resmi" className="bg-[#0a0a0a] border-white/10" data-testid="landing-subtitle-input" />
          </Field>
          <Field label="Deskripsi">
            <Textarea rows={4} value={form.landing_description} onChange={(e) => setForm({ ...form, landing_description: e.target.value })} className="bg-[#0a0a0a] border-white/10" data-testid="landing-description-input" />
          </Field>
          <Field label="Catatan Jadwal">
            <Textarea rows={2} value={form.landing_schedule_note} onChange={(e) => setForm({ ...form, landing_schedule_note: e.target.value })} className="bg-[#0a0a0a] border-white/10" data-testid="landing-schedule-input" />
          </Field>
          <Field label="Persyaratan">
            <Textarea rows={3} value={form.landing_requirements} onChange={(e) => setForm({ ...form, landing_requirements: e.target.value })} className="bg-[#0a0a0a] border-white/10" data-testid="landing-requirements-input" />
          </Field>
          <Field label="Kontak Panitia">
            <Input value={form.landing_contact} onChange={(e) => setForm({ ...form, landing_contact: e.target.value })} placeholder="Nama / WhatsApp / email panitia" className="bg-[#0a0a0a] border-white/10" data-testid="landing-contact-input" />
          </Field>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <Button onClick={save} disabled={busy || !form.name} data-testid="landing-save-btn" className="bg-[#ffcc00] hover:bg-[#e6b800] text-black rounded-sm uppercase tracking-[0.15em]">
          {busy ? "Menyimpan..." : "Simpan Landing Page"}
        </Button>
        <div className="text-xs text-zinc-500">Perubahan langsung dipakai oleh halaman publik event.</div>
      </div>
    </div>
  );
}

function ToggleBox({ label, hint, checked, onChange, testId }) {
  return (
    <label className={`block cursor-pointer border p-4 transition-colors ${checked ? "border-[#ffcc00]/50 bg-[#ffcc00]/10" : "border-white/10 bg-[#0a0a0a]"}`} data-testid={testId}>
      <div className="flex items-start gap-3">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          className="mt-1 h-4 w-4 accent-[#ffcc00]"
        />
        <div>
          <div className="text-sm font-semibold text-white">{label}</div>
          <div className="mt-1 text-xs leading-5 text-zinc-500">{hint}</div>
        </div>
      </div>
    </label>
  );
}

/**
 * Reusable list+actions block with Edit & Delete icons per row.
 */
function CRUDList({ title, items, columns, headerAction, onEdit, onDelete, emptyText = "Belum ada data", entity = "item" }) {
  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div className="text-xs tracking-[0.3em] uppercase text-zinc-400">{title}</div>
        {headerAction}
      </div>
      {items.length === 0 ? (
        <div className="border border-dashed border-white/10 rounded-sm p-8 text-center text-zinc-500 text-sm">{emptyText}</div>
      ) : (
        <div className="border border-white/10 rounded-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-[#141414] text-[10px] tracking-[0.2em] uppercase text-zinc-400">
              <tr>
                {columns.map((c) => <th key={c.key} className="text-left px-4 py-3">{c.label}</th>)}
                <th className="px-4 py-3 w-24 text-right">Aksi</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it) => (
                <tr key={it.id} className="border-t border-white/5 hover:bg-white/5" data-testid={`${entity}-row-${it.id}`}>
                  {columns.map((c) => <td key={c.key} className="px-4 py-3">{c.render ? c.render(it) : it[c.key]}</td>)}
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      {onEdit && (
                        <button onClick={() => onEdit(it)} data-testid={`edit-${entity}-${it.id}`} className="p-1.5 text-zinc-400 hover:text-[#ffcc00] hover:bg-white/5 rounded-sm transition-colors" title="Edit">
                          <Pencil className="w-4 h-4" />
                        </button>
                      )}
                      <button onClick={() => onDelete(it.id)} data-testid={`delete-${entity}-${it.id}`} className="p-1.5 text-zinc-500 hover:text-[#ff3b30] hover:bg-white/5 rounded-sm transition-colors" title="Hapus">
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
    </div>
  );
}

/** Hook that manages a list of records for a single endpoint, scoped by event_id. */
function useEntityList(endpoint, eventId) {
  const [items, setItems] = useState([]);
  const load = async () => {
    const r = await api.get(endpoint, { params: eventId ? { event_id: eventId } : {} });
    setItems(r.data);
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [eventId]);
  return { items, load };
}

// ============ Scoring Rules ============
function ScoringRulesTab({ eventId }) {
  const { items: rules, load } = useEntityList("/scoring-rules", eventId);
  const [editing, setEditing] = useState(null);
  const [addOpen, setAddOpen] = useState(false);
  const [newForm, setNewForm] = useState({ name: "", category_type: "tanding" });

  useEffect(() => {
    if (rules.length && (!editing || !rules.find(r => r.id === editing.id))) {
      setEditing(rules[0]);
    }
    if (!rules.length) setEditing(null);
  }, [rules]);

  const save = async () => {
    try {
      await api.put(`/scoring-rules/${editing.id}`, editing);
      toast.success("Aturan tersimpan");
      load();
    } catch (e) { toast.error(formatApiError(e)); }
  };

  const del = async () => {
    if (!editing) return;
    if (!window.confirm(`Hapus aturan "${editing.name}"?`)) return;
    try {
      await api.delete(`/scoring-rules/${editing.id}`);
      toast.success("Aturan dihapus");
      load();
    } catch (e) { toast.error(formatApiError(e)); }
  };

  const createRule = async () => {
    if (!newForm.name.trim()) return toast.error("Nama aturan wajib diisi");
    try {
      const payload = {
        event_id: eventId,
        name: newForm.name,
        category_type: newForm.category_type,
        round_count: 3,
        round_duration_sec: 120,
        rest_duration_sec: 60,
        points: { pukulan: 1, tendangan: 2, jatuhan: 3 },
        penalty_points: { teguran_1: 1, teguran_2: 2, peringatan_1: 5, peringatan_2: 10, peringatan_3: 0 },
        binaan_limit: 2,
        is_default: false,
      };
      const r = await api.post("/scoring-rules", payload);
      toast.success("Aturan baru dibuat");
      setAddOpen(false);
      setNewForm({ name: "", category_type: "tanding" });
      await load();
      setEditing(r.data);
    } catch (e) { toast.error(formatApiError(e)); }
  };

  return (
    <div className="grid grid-cols-12 gap-6">
      <div className="col-span-12 md:col-span-3 space-y-2">
        <div className="flex items-center justify-between mb-2">
          <div className="text-[10px] tracking-[0.3em] uppercase text-zinc-400">Daftar Aturan</div>
          <Button size="sm" onClick={() => setAddOpen(true)} data-testid="add-rule-btn" className="h-8 bg-[#ffcc00] hover:bg-[#e6b800] text-black rounded-sm">
            <Plus className="w-4 h-4" />
          </Button>
        </div>
        {rules.length === 0 && <div className="text-xs text-zinc-500 border border-dashed border-white/10 p-3 rounded-sm">Belum ada aturan</div>}
        {rules.map((r) => (
          <button key={r.id} onClick={() => setEditing(r)} data-testid={`rule-card-${r.id}`} className={`w-full text-left p-3 border rounded-sm text-sm transition-colors ${editing?.id === r.id ? "border-[#ffcc00] bg-[#ffcc00]/5" : "border-white/10 bg-[#141414] hover:border-white/30"}`}>
            <div className="font-semibold">{r.name}</div>
            <div className="text-[10px] uppercase tracking-[0.2em] text-zinc-500 mt-1">{r.category_type}{r.is_default ? " · default" : ""}</div>
          </button>
        ))}
      </div>

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="bg-[#141414] border-white/10 text-white">
          <DialogHeader><DialogTitle className="font-display text-2xl uppercase">Aturan Baru</DialogTitle></DialogHeader>
          <Field label="Nama Aturan"><Input value={newForm.name} onChange={(e) => setNewForm({ ...newForm, name: e.target.value })} className="bg-[#0a0a0a] border-white/10" placeholder="cth: Aturan Remaja IPSI 2026" data-testid="new-rule-name-input"/></Field>
          <Field label="Tipe Kategori">
            <Select value={newForm.category_type} onValueChange={(v) => setNewForm({ ...newForm, category_type: v })}>
              <SelectTrigger data-testid="new-rule-type-select" className="bg-[#0a0a0a] border-white/10"><SelectValue/></SelectTrigger>
              <SelectContent className="bg-[#141414] border-white/10 text-white">
                <SelectItem value="tanding">Tanding</SelectItem>
                <SelectItem value="tunggal">Tunggal</SelectItem>
                <SelectItem value="ganda">Ganda</SelectItem>
                <SelectItem value="regu">Regu</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <DialogFooter><Button onClick={createRule} data-testid="new-rule-save-btn" className="bg-[#ffcc00] hover:bg-[#e6b800] text-black">Buat Aturan</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="col-span-12 md:col-span-9 space-y-6">
        {!editing ? <EmptyState title="Pilih aturan untuk diedit, atau buat baru" /> : (
          <>
            <div className="flex items-center justify-between">
              <div>
                <div className="text-[10px] tracking-[0.3em] uppercase text-[#ffcc00]">Edit Aturan</div>
                <h3 className="font-display text-2xl uppercase tracking-tight">{editing.name}</h3>
              </div>
              <Button variant="ghost" onClick={del} data-testid="rule-delete-btn" className="text-zinc-400 hover:text-[#ff3b30] hover:bg-white/5">
                <Trash2 className="w-4 h-4 mr-2"/>Hapus Aturan
              </Button>
            </div>
            <div className="grid grid-cols-3 gap-4">
              <Field label="Nama Aturan"><Input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} className="bg-[#141414] border-white/10" data-testid="rule-name-input"/></Field>
              <Field label="Tipe Kategori">
                <Select value={editing.category_type} onValueChange={(v) => setEditing({ ...editing, category_type: v })}>
                  <SelectTrigger className="bg-[#141414] border-white/10"><SelectValue/></SelectTrigger>
                  <SelectContent className="bg-[#141414] border-white/10 text-white">
                    <SelectItem value="tanding">Tanding</SelectItem>
                    <SelectItem value="tunggal">Tunggal</SelectItem>
                    <SelectItem value="ganda">Ganda</SelectItem>
                    <SelectItem value="regu">Regu</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Jumlah Ronde"><Input type="number" value={editing.round_count} onChange={(e) => setEditing({ ...editing, round_count: Number(e.target.value) || 1 })} className="bg-[#141414] border-white/10" data-testid="rule-round-count-input"/></Field>
              <Field label="Durasi Ronde (detik)"><Input type="number" value={editing.round_duration_sec} onChange={(e) => setEditing({ ...editing, round_duration_sec: Number(e.target.value) || 60 })} className="bg-[#141414] border-white/10" data-testid="rule-round-duration-input"/></Field>
              <Field label="Istirahat (detik)"><Input type="number" value={editing.rest_duration_sec} onChange={(e) => setEditing({ ...editing, rest_duration_sec: Number(e.target.value) || 0 })} className="bg-[#141414] border-white/10"/></Field>
              <Field label="Batas Binaan"><Input type="number" value={editing.binaan_limit} onChange={(e) => setEditing({ ...editing, binaan_limit: Number(e.target.value) || 0 })} className="bg-[#141414] border-white/10"/></Field>
            </div>
            <div>
              <div className="text-xs tracking-[0.2em] uppercase text-zinc-400 mb-3">Poin Tindakan</div>
              <div className="grid grid-cols-3 gap-3">
                {Object.entries(editing.points || {}).map(([k, v]) => (
                  <Field key={k} label={k.replace(/_/g, " ")}>
                    <Input type="number" value={v} onChange={(e) => setEditing({ ...editing, points: { ...editing.points, [k]: Number(e.target.value) || 0 } })} className="bg-[#141414] border-white/10" data-testid={`rule-point-${k}`}/>
                  </Field>
                ))}
              </div>
            </div>
            <div>
              <div className="text-xs tracking-[0.2em] uppercase text-zinc-400 mb-3">Pelanggaran (Poin ke Lawan)</div>
              <div className="grid grid-cols-3 gap-3">
                {Object.entries(editing.penalty_points || {}).map(([k, v]) => (
                  <Field key={k} label={k.replace(/_/g, " ")}>
                    <Input type="number" value={v} onChange={(e) => setEditing({ ...editing, penalty_points: { ...editing.penalty_points, [k]: Number(e.target.value) || 0 } })} className="bg-[#141414] border-white/10" data-testid={`rule-penalty-${k}`}/>
                  </Field>
                ))}
              </div>
            </div>
            <Button onClick={save} data-testid="rule-save-btn" className="bg-[#ffcc00] hover:bg-[#e6b800] text-black tracking-[0.15em] uppercase">Simpan Aturan</Button>
          </>
        )}
      </div>
    </div>
  );
}

// ============ Categories ============
const EMPTY_CAT = { name: "", type: "tanding", gender: "putra", age_group: "Dewasa", quota: 0 };
function CategoriesTab({ eventId }) {
  const { items, load } = useEntityList("/categories", eventId);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY_CAT);

  const openAdd = () => { setEditing(null); setForm(EMPTY_CAT); setOpen(true); };
  const openEdit = (it) => { setEditing(it); setForm({ name: it.name, type: it.type, gender: it.gender, age_group: it.age_group, quota: it.quota || 0 }); setOpen(true); };
  const save = async () => {
    try {
      if (editing) {
        await api.put(`/categories/${editing.id}`, { ...form, event_id: eventId });
        toast.success("Kategori diperbarui");
      } else {
        await api.post("/categories", { ...form, event_id: eventId });
        toast.success("Kategori ditambahkan");
      }
      setOpen(false); load();
    } catch (e) { toast.error(formatApiError(e)); }
  };
  const del = async (id) => { if (!window.confirm("Hapus kategori?")) return; await api.delete(`/categories/${id}`); load(); };

  return (
    <>
      <CRUDList
        title="Kategori"
        entity="category"
        items={items}
        columns={[
          { key: "name", label: "Nama" },
          { key: "type", label: "Tipe", render: (i) => <Badge className="bg-[#ffcc00]/15 text-[#ffcc00] border-0 uppercase text-[10px] tracking-[0.2em]">{i.type}</Badge> },
          { key: "gender", label: "Gender" },
          { key: "age_group", label: "Kel. Usia" },
        ]}
        headerAction={<Button size="sm" onClick={openAdd} data-testid="add-category-btn" className="bg-[#ffcc00] hover:bg-[#e6b800] text-black rounded-sm"><Plus className="w-4 h-4 mr-1"/>Tambah</Button>}
        onEdit={openEdit}
        onDelete={del}
      />
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="bg-[#141414] border-white/10 text-white">
          <DialogHeader><DialogTitle className="font-display text-2xl uppercase">{editing ? "Edit Kategori" : "Kategori Baru"}</DialogTitle></DialogHeader>
          <Field label="Nama"><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="bg-[#0a0a0a] border-white/10" data-testid="category-name-input"/></Field>
          <Field label="Tipe">
            <Select value={form.type} onValueChange={(v) => setForm({ ...form, type: v })}>
              <SelectTrigger data-testid="category-type-select" className="bg-[#0a0a0a] border-white/10"><SelectValue/></SelectTrigger>
              <SelectContent className="bg-[#141414] border-white/10 text-white">
                <SelectItem value="tanding">Tanding</SelectItem>
                <SelectItem value="tunggal">Tunggal</SelectItem>
                <SelectItem value="ganda">Ganda</SelectItem>
                <SelectItem value="regu">Regu</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="Gender">
            <Select value={form.gender} onValueChange={(v) => setForm({ ...form, gender: v })}>
              <SelectTrigger className="bg-[#0a0a0a] border-white/10"><SelectValue/></SelectTrigger>
              <SelectContent className="bg-[#141414] border-white/10 text-white">
                <SelectItem value="putra">Putra</SelectItem>
                <SelectItem value="putri">Putri</SelectItem>
                <SelectItem value="campuran">Campuran</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="Kelompok Usia"><Input value={form.age_group} onChange={(e) => setForm({ ...form, age_group: e.target.value })} className="bg-[#0a0a0a] border-white/10"/></Field>
          <Field label="Kuota Peserta (0 = tidak dibatasi)"><Input type="number" value={form.quota || 0} onChange={(e) => setForm({ ...form, quota: Number(e.target.value) })} className="bg-[#0a0a0a] border-white/10" data-testid="category-quota-input"/></Field>
          <DialogFooter><Button onClick={save} data-testid="category-save-btn" className="bg-[#ffcc00] hover:bg-[#e6b800] text-black">Simpan</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ============ Classes ============
const EMPTY_CLASS = { name: "", category_id: "", weight_min: 0, weight_max: 0, quota: 0 };
function ClassesTab({ eventId }) {
  const { items, load } = useEntityList("/classes", eventId);
  const { items: cats } = useEntityList("/categories", eventId);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY_CLASS);

  const openAdd = () => { setEditing(null); setForm({ ...EMPTY_CLASS, category_id: cats[0]?.id || "" }); setOpen(true); };
  const openEdit = (it) => { setEditing(it); setForm({ name: it.name, category_id: it.category_id, weight_min: it.weight_min, weight_max: it.weight_max, quota: it.quota || 0 }); setOpen(true); };
  const save = async () => {
    try {
      if (editing) { await api.put(`/classes/${editing.id}`, { ...form, event_id: eventId }); toast.success("Kelas diperbarui"); }
      else { await api.post("/classes", { ...form, event_id: eventId }); toast.success("Kelas ditambahkan"); }
      setOpen(false); load();
    } catch (e) { toast.error(formatApiError(e)); }
  };
  const del = async (id) => { if (!window.confirm("Hapus kelas?")) return; await api.delete(`/classes/${id}`); load(); };
  const catName = (id) => cats.find(c => c.id === id)?.name || "-";

  return (
    <>
      <CRUDList
        title="Kelas"
        entity="class"
        items={items}
        columns={[
          { key: "name", label: "Nama" },
          { key: "category_id", label: "Kategori", render: (i) => catName(i.category_id) },
          { key: "weight", label: "Berat", render: (i) => `${i.weight_min || 0} - ${i.weight_max || 0} kg` },
        ]}
        headerAction={<Button size="sm" onClick={openAdd} data-testid="add-class-btn" className="bg-[#ffcc00] hover:bg-[#e6b800] text-black rounded-sm"><Plus className="w-4 h-4 mr-1"/>Tambah</Button>}
        onEdit={openEdit}
        onDelete={del}
      />
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="bg-[#141414] border-white/10 text-white">
          <DialogHeader><DialogTitle className="font-display text-2xl uppercase">{editing ? "Edit Kelas" : "Kelas Baru"}</DialogTitle></DialogHeader>
          <Field label="Nama Kelas"><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="bg-[#0a0a0a] border-white/10" data-testid="class-name-input"/></Field>
          <Field label="Kategori">
            <Select value={form.category_id} onValueChange={(v) => setForm({ ...form, category_id: v })}>
              <SelectTrigger data-testid="class-category-select" className="bg-[#0a0a0a] border-white/10"><SelectValue placeholder="Pilih kategori..."/></SelectTrigger>
              <SelectContent className="bg-[#141414] border-white/10 text-white">{cats.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Berat Min (kg)"><Input type="number" value={form.weight_min} onChange={(e) => setForm({ ...form, weight_min: Number(e.target.value) })} className="bg-[#0a0a0a] border-white/10"/></Field>
            <Field label="Berat Max (kg)"><Input type="number" value={form.weight_max} onChange={(e) => setForm({ ...form, weight_max: Number(e.target.value) })} className="bg-[#0a0a0a] border-white/10"/></Field>
          </div>
          <Field label="Kuota Kelas (0 = tidak dibatasi)"><Input type="number" value={form.quota || 0} onChange={(e) => setForm({ ...form, quota: Number(e.target.value) })} className="bg-[#0a0a0a] border-white/10" data-testid="class-quota-input"/></Field>
          <DialogFooter><Button onClick={save} data-testid="class-save-btn" className="bg-[#ffcc00] hover:bg-[#e6b800] text-black">Simpan</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ============ Arenas ============
function ArenasTab({ eventId }) {
  const { items, load } = useEntityList("/arenas", eventId);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [name, setName] = useState("");

  const openAdd = () => { setEditing(null); setName(""); setOpen(true); };
  const openEdit = (it) => { setEditing(it); setName(it.name); setOpen(true); };
  const save = async () => {
    try {
      if (editing) { await api.put(`/arenas/${editing.id}`, { event_id: eventId, name }); toast.success("Gelanggang diperbarui"); }
      else { await api.post("/arenas", { event_id: eventId, name }); toast.success("Gelanggang ditambahkan"); }
      setOpen(false); load();
    } catch (e) { toast.error(formatApiError(e)); }
  };
  const del = async (id) => { if (!window.confirm("Hapus gelanggang?")) return; await api.delete(`/arenas/${id}`); load(); };

  return (
    <>
      <CRUDList
        title="Gelanggang"
        entity="arena"
        items={items}
        columns={[
          { key: "name", label: "Nama" },
          { key: "id", label: "ID", render: (i) => <span className="font-mono text-xs text-zinc-500">{i.id.slice(0, 8)}…</span> },
        ]}
        headerAction={<Button size="sm" onClick={openAdd} data-testid="add-arena-btn" className="bg-[#ffcc00] hover:bg-[#e6b800] text-black rounded-sm"><Plus className="w-4 h-4 mr-1"/>Tambah</Button>}
        onEdit={openEdit}
        onDelete={del}
      />
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="bg-[#141414] border-white/10 text-white">
          <DialogHeader><DialogTitle className="font-display text-2xl uppercase">{editing ? "Edit Gelanggang" : "Gelanggang Baru"}</DialogTitle></DialogHeader>
          <Field label="Nama"><Input value={name} onChange={(e) => setName(e.target.value)} className="bg-[#0a0a0a] border-white/10" data-testid="arena-name-input"/></Field>
          <DialogFooter><Button onClick={save} data-testid="arena-save-btn" className="bg-[#ffcc00] hover:bg-[#e6b800] text-black">Simpan</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ============ Contingents ============
const EMPTY_CONT = { name: "", region: "" };
function ContingentsTab({ eventId }) {
  const { items, load } = useEntityList("/contingents", eventId);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY_CONT);

  const openAdd = () => { setEditing(null); setForm(EMPTY_CONT); setOpen(true); };
  const openEdit = (it) => { setEditing(it); setForm({ name: it.name, region: it.region || "" }); setOpen(true); };
  const save = async () => {
    try {
      if (editing) { await api.put(`/contingents/${editing.id}`, { ...form, event_id: eventId }); toast.success("Kontingen diperbarui"); }
      else { await api.post("/contingents", { ...form, event_id: eventId }); toast.success("Kontingen ditambahkan"); }
      setOpen(false); load();
    } catch (e) { toast.error(formatApiError(e)); }
  };
  const del = async (id) => { if (!window.confirm("Hapus kontingen?")) return; await api.delete(`/contingents/${id}`); load(); };

  return (
    <>
      <CRUDList
        title="Kontingen"
        entity="contingent"
        items={items}
        columns={[{ key: "name", label: "Nama" }, { key: "region", label: "Daerah" }]}
        headerAction={<Button size="sm" onClick={openAdd} data-testid="add-contingent-btn" className="bg-[#ffcc00] hover:bg-[#e6b800] text-black rounded-sm"><Plus className="w-4 h-4 mr-1"/>Tambah</Button>}
        onEdit={openEdit}
        onDelete={del}
      />
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="bg-[#141414] border-white/10 text-white">
          <DialogHeader><DialogTitle className="font-display text-2xl uppercase">{editing ? "Edit Kontingen" : "Kontingen Baru"}</DialogTitle></DialogHeader>
          <Field label="Nama"><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="bg-[#0a0a0a] border-white/10" data-testid="contingent-name-input"/></Field>
          <Field label="Daerah"><Input value={form.region} onChange={(e) => setForm({ ...form, region: e.target.value })} className="bg-[#0a0a0a] border-white/10"/></Field>
          <DialogFooter><Button onClick={save} data-testid="contingent-save-btn" className="bg-[#ffcc00] hover:bg-[#e6b800] text-black">Simpan</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ============ Athletes ============
const EMPTY_ATH = { name: "", gender: "putra", weight: 0, contingent_id: "", class_id: "", dob: "", photo_url: "" };
function AthletesTab({ eventId }) {
  const { items, load } = useEntityList("/athletes", eventId);
  const { items: conts } = useEntityList("/contingents", eventId);
  const { items: classes } = useEntityList("/classes", eventId);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY_ATH);

  const openAdd = () => { setEditing(null); setForm(EMPTY_ATH); setOpen(true); };
  const openEdit = (it) => { setEditing(it); setForm({ name: it.name, gender: it.gender, weight: it.weight || 0, contingent_id: it.contingent_id || "", class_id: it.class_id || "", dob: it.dob || "", photo_url: it.photo_url || "" }); setOpen(true); };
  const save = async () => {
    try {
      const payload = { ...form, event_id: eventId, weight: Number(form.weight) || 0 };
      if (editing) { await api.put(`/athletes/${editing.id}`, payload); toast.success("Atlet diperbarui"); }
      else { await api.post("/athletes", payload); toast.success("Atlet ditambahkan"); }
      setOpen(false); load();
    } catch (e) { toast.error(formatApiError(e)); }
  };
  const del = async (id) => { if (!window.confirm("Hapus atlet?")) return; await api.delete(`/athletes/${id}`); load(); };
  const contName = (id) => conts.find(c => c.id === id)?.name || "-";
  const clsName = (id) => classes.find(c => c.id === id)?.name || "-";

  return (
    <>
      <CRUDList
        title="Atlet"
        entity="athlete"
        items={items}
        columns={[
          { key: "photo", label: "", render: (i) => i.photo_url ? <img src={resolvePhotoUrl(i.photo_url)} alt="" onError={(e) => { e.currentTarget.style.visibility = "hidden"; }} className="w-10 h-10 rounded-full object-cover" /> : <div className="w-10 h-10 rounded-full bg-zinc-800"/> },
          { key: "name", label: "Nama" },
          { key: "gender", label: "Gender" },
          { key: "weight", label: "Berat (kg)" },
          { key: "contingent_id", label: "Kontingen", render: (i) => contName(i.contingent_id) },
          { key: "class_id", label: "Kelas", render: (i) => clsName(i.class_id) },
        ]}
        headerAction={<Button size="sm" onClick={openAdd} data-testid="add-athlete-btn" className="bg-[#ffcc00] hover:bg-[#e6b800] text-black rounded-sm"><Plus className="w-4 h-4 mr-1"/>Tambah</Button>}
        onEdit={openEdit}
        onDelete={del}
      />
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="bg-[#141414] border-white/10 text-white">
          <DialogHeader><DialogTitle className="font-display text-2xl uppercase">{editing ? "Edit Atlet" : "Atlet Baru"}</DialogTitle></DialogHeader>
          <Field label="Nama"><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="bg-[#0a0a0a] border-white/10" data-testid="athlete-name-input"/></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Gender">
              <Select value={form.gender} onValueChange={(v) => setForm({ ...form, gender: v })}>
                <SelectTrigger className="bg-[#0a0a0a] border-white/10"><SelectValue/></SelectTrigger>
                <SelectContent className="bg-[#141414] border-white/10 text-white"><SelectItem value="putra">Putra</SelectItem><SelectItem value="putri">Putri</SelectItem></SelectContent>
              </Select>
            </Field>
            <Field label="Berat (kg)"><Input type="number" value={form.weight} onChange={(e) => setForm({ ...form, weight: e.target.value })} className="bg-[#0a0a0a] border-white/10"/></Field>
          </div>
          <Field label="Kontingen">
            <Select value={form.contingent_id} onValueChange={(v) => setForm({ ...form, contingent_id: v })}>
              <SelectTrigger data-testid="athlete-contingent-select" className="bg-[#0a0a0a] border-white/10"><SelectValue placeholder="Pilih kontingen..."/></SelectTrigger>
              <SelectContent className="bg-[#141414] border-white/10 text-white">{conts.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
          <Field label="Kelas">
            <Select value={form.class_id} onValueChange={(v) => setForm({ ...form, class_id: v })}>
              <SelectTrigger data-testid="athlete-class-select" className="bg-[#0a0a0a] border-white/10"><SelectValue placeholder="Pilih kelas..."/></SelectTrigger>
              <SelectContent className="bg-[#141414] border-white/10 text-white">{classes.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
          <PhotoUpload value={form.photo_url} onChange={(v) => setForm({ ...form, photo_url: v })} label="Foto Atlet" testIdPrefix="athlete-photo" />
          <DialogFooter><Button onClick={save} data-testid="athlete-save-btn" className="bg-[#ffcc00] hover:bg-[#e6b800] text-black">Simpan</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ============ Users ============
const EMPTY_USER = { name: "", email: "", password: "", role: "jury" };
function UsersTab() {
  const [items, setItems] = useState([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY_USER);

  const load = async () => { const r = await api.get("/auth/users"); setItems(r.data); };
  useEffect(() => { load(); }, []);

  const openAdd = () => { setEditing(null); setForm(EMPTY_USER); setOpen(true); };
  const openEdit = (u) => { setEditing(u); setForm({ name: u.name, email: u.email, password: "", role: u.role }); setOpen(true); };
  const save = async () => {
    try {
      if (editing) {
        const payload = { name: form.name, email: form.email, role: form.role };
        if (form.password) payload.password = form.password;
        await api.put(`/auth/users/${editing.id}`, payload);
        toast.success("Pengguna diperbarui");
      } else {
        await api.post("/auth/register", form);
        toast.success("Pengguna dibuat");
      }
      setOpen(false); load();
    } catch (e) { toast.error(formatApiError(e)); }
  };
  const del = async (id) => { if (!window.confirm("Hapus pengguna?")) return; try { await api.delete(`/auth/users/${id}`); load(); } catch (e) { toast.error(formatApiError(e)); } };

  return (
    <>
      <CRUDList
        title="Pengguna"
        entity="user"
        items={items}
        columns={[
          { key: "name", label: "Nama" },
          { key: "email", label: "Email" },
          { key: "role", label: "Role", render: (i) => <Badge className="bg-white/5 text-white border border-white/10 uppercase text-[10px] tracking-[0.2em]">{i.role}</Badge> },
        ]}
        headerAction={<Button size="sm" onClick={openAdd} data-testid="add-user-btn" className="bg-[#ffcc00] hover:bg-[#e6b800] text-black rounded-sm"><Plus className="w-4 h-4 mr-1"/>Tambah Pengguna</Button>}
        onEdit={openEdit}
        onDelete={del}
      />
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="bg-[#141414] border-white/10 text-white">
          <DialogHeader><DialogTitle className="font-display text-2xl uppercase">{editing ? "Edit Pengguna" : "Pengguna Baru"}</DialogTitle></DialogHeader>
          <Field label="Nama"><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="bg-[#0a0a0a] border-white/10" data-testid="user-name-input"/></Field>
          <Field label="Email"><Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="bg-[#0a0a0a] border-white/10" data-testid="user-email-input"/></Field>
          <Field label={editing ? "Kata Sandi (kosongkan jika tidak diubah)" : "Kata Sandi"}>
            <Input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} className="bg-[#0a0a0a] border-white/10" data-testid="user-password-input"/>
          </Field>
          <Field label="Role">
            <Select value={form.role} onValueChange={(v) => setForm({ ...form, role: v })}>
              <SelectTrigger data-testid="user-role-select" className="bg-[#0a0a0a] border-white/10"><SelectValue/></SelectTrigger>
              <SelectContent className="bg-[#141414] border-white/10 text-white">
                <SelectItem value="admin">Admin</SelectItem>
                <SelectItem value="operator">Operator</SelectItem>
                <SelectItem value="jury">Juri</SelectItem>
                <SelectItem value="referee">Wasit</SelectItem>
                <SelectItem value="head_jury">Ketua Juri</SelectItem>
                <SelectItem value="timer">Timer</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <DialogFooter><Button onClick={save} data-testid="user-save-btn" className="bg-[#ffcc00] hover:bg-[#e6b800] text-black">Simpan</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
