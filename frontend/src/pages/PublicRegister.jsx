import React, { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useParams, useSearchParams } from "react-router-dom";
import axios from "axios";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Toaster, toast } from "sonner";
import { BACKEND_URL } from "@/lib/api";
import { Upload, FileCheck2, ArrowRight, ShieldCheck, ClipboardList, IdCard, Stethoscope } from "lucide-react";

const PUB = axios.create({ baseURL: `${BACKEND_URL}/api` });

const REQUIRED_DOCS = [
  { key: "photo", label: "Pas Foto", icon: IdCard, required: true },
  { key: "ktp", label: "KTP / Kartu Identitas", icon: IdCard, required: true },
  { key: "surat_sehat", label: "Surat Keterangan Sehat", icon: Stethoscope, required: true },
];

const STATUS_LABEL = {
  draft: "Draft",
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

const STATUS_COLOR = {
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

export default function PublicRegister() {
  const { slug } = useParams();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const initialMode = location.pathname.endsWith("/check") || searchParams.get("mode") === "check" ? "check" : "form";
  const [mode, setMode] = useState(initialMode);
  const [events, setEvents] = useState([]);
  const [lockedEvent, setLockedEvent] = useState(null);
  const [categories, setCategories] = useState([]);
  const [classes, setClasses] = useState([]);
  const [contingents, setContingents] = useState([]);

  const [form, setForm] = useState({
    event_id: "", category_id: "", class_id: "", contingent_id: "", contingent_name: "",
    name: "", gender: "putra", dob: "", weight: "", phone: "", email: "", address: "", photo_url: "",
  });
  const [files, setFiles] = useState({}); // {photo: url, ktp: url, surat_sehat: url}
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState(null); // {registration_number, id}

  useEffect(() => {
    setMode(location.pathname.endsWith("/check") || searchParams.get("mode") === "check" ? "check" : "form");
  }, [location.pathname, searchParams]);

  useEffect(() => {
    if (slug) {
      PUB.get(`/public/events/${slug}`).then((r) => {
        const ev = r.data;
        setLockedEvent(ev);
        setEvents([ev]);
        setForm((cur) => ({ ...cur, event_id: ev.id, category_id: "", class_id: "", contingent_id: "" }));
      }).catch(() => toast.error("Event tidak ditemukan atau belum dipublikasikan"));
      return;
    }
    setLockedEvent(null);
    PUB.get("/public/events").then((r) => setEvents(r.data || []));
  }, [slug]);

  /* eslint-disable-next-line */
  useEffect(() => {
    if (!form.event_id) { setCategories([]); setClasses([]); setContingents([]); return; }
    Promise.all([
      PUB.get("/public/categories", { params: { event_id: form.event_id } }),
      PUB.get("/public/classes", { params: { event_id: form.event_id } }),
      PUB.get("/public/contingents", { params: { event_id: form.event_id } }),
    ]).then(([c, k, g]) => { setCategories(c.data || []); setClasses(k.data || []); setContingents(g.data || []); });
  }, [form.event_id]);

  const filteredClasses = useMemo(
    () => classes.filter((c) => !form.category_id || c.category_id === form.category_id),
    [classes, form.category_id]
  );

  const canSubmit =
    form.event_id && form.name.trim().length >= 2 && form.gender && form.phone.trim().length >= 6 &&
    (form.contingent_id || form.contingent_name.trim()) &&
    REQUIRED_DOCS.every((d) => files[d.key]);

  const submit = async () => {
    if (!canSubmit) {
      toast.error("Lengkapi semua field wajib dan unggah semua dokumen yang diminta");
      return;
    }
    setSubmitting(true);
    try {
      const payload = {
        ...form,
        weight: Number(form.weight) || 0,
        photo_url: files.photo || form.photo_url,
      };
      const r = await PUB.post("/public/registrations", payload);
      const reg = r.data;
      // Attach files
      for (const d of REQUIRED_DOCS) {
        if (files[d.key]) {
          await PUB.post(`/public/registrations/${reg.id}/files`, { registration_id: reg.id, label: d.key, url: files[d.key] });
        }
      }
      setResult({ ...reg, slug: lockedEvent?.slug || "" });
      toast.success("Registrasi terkirim");
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Gagal mengirim registrasi");
    } finally { setSubmitting(false); }
  };

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white">
      <Toaster theme="dark" position="top-right" />
      <header className="border-b border-white/10 bg-[#0a0a0a]/95 backdrop-blur sticky top-0 z-30">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center gap-4">
          <Link to={lockedEvent?.slug ? `/event/${lockedEvent.slug}` : "/"} className="flex items-center gap-3">
            <div className="w-9 h-9 bg-[#ffcc00] grid place-items-center rounded-sm">
              <span className="font-display text-2xl text-black leading-none">S</span>
            </div>
            <div>
              <div className="font-display text-xl tracking-tight">SILAT SCORING</div>
              <div className="text-[10px] tracking-[0.3em] text-zinc-500 uppercase">Pendaftaran Peserta</div>
            </div>
          </Link>
          <div className="ml-auto flex gap-1 border border-white/10 rounded-sm p-1">
            <button
              onClick={() => { setMode("form"); setResult(null); }}
              className={`px-3 py-1.5 text-[11px] tracking-[0.15em] uppercase rounded-sm ${mode === "form" ? "bg-[#ffcc00] text-black" : "text-zinc-400 hover:text-white"}`}
              data-testid="tab-form"
            >Daftar Baru</button>
            <button
              onClick={() => { setMode("check"); setResult(null); }}
              className={`px-3 py-1.5 text-[11px] tracking-[0.15em] uppercase rounded-sm ${mode === "check" ? "bg-[#ffcc00] text-black" : "text-zinc-400 hover:text-white"}`}
              data-testid="tab-check"
            >Cek Status</button>
          </div>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-6 py-10">
        {mode === "check" ? (
          <StatusCheck />
        ) : result ? (
          <SuccessCard reg={result} onAnother={() => { setResult(null); setForm({ ...form, name: "", phone: "", email: "", address: "", weight: "" }); setFiles({}); }} />
        ) : (
          <>
            <div className="mb-8">
              <div className="text-[10px] tracking-[0.3em] uppercase text-[#ffcc00] mb-2">Formulir Pendaftaran</div>
              <h1 className="font-display text-4xl md:text-5xl tracking-tight uppercase">Daftar sebagai Peserta</h1>
              <p className="text-sm text-zinc-400 mt-2">Lengkapi data berikut, lalu unggah dokumen yang diperlukan. Anda akan menerima nomor registrasi setelah submit. Status verifikasi dapat dicek menggunakan nomor registrasi.</p>
            </div>

            <section className="space-y-6">
              <FormGroup title="Event & Kategori">
                {lockedEvent ? (
                  <div className="border border-[#ffcc00]/30 bg-[#ffcc00]/10 px-4 py-3 rounded-sm" data-testid="reg-locked-event">
                    <div className="text-[10px] tracking-[0.2em] uppercase text-[#ffcc00]">Event</div>
                    <div className="text-sm font-semibold mt-1">{lockedEvent.name}</div>
                    <div className="text-xs text-zinc-400 mt-1">{lockedEvent.location || "-"} · {lockedEvent.start_date || "-"} → {lockedEvent.end_date || "-"}</div>
                  </div>
                ) : (
                  <SelectField label="Event" value={form.event_id} onChange={(v) => setForm({ ...form, event_id: v, category_id: "", class_id: "", contingent_id: "" })} testid="reg-event-select">
                    {events.map((e) => <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>)}
                  </SelectField>
                )}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <SelectField label="Kategori" value={form.category_id} onChange={(v) => setForm({ ...form, category_id: v, class_id: "" })} testid="reg-category-select" disabled={!categories.length}>
                    {categories.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                  </SelectField>
                  <SelectField label="Kelas (opsional)" value={form.class_id} onChange={(v) => setForm({ ...form, class_id: v })} testid="reg-class-select" disabled={!filteredClasses.length}>
                    {filteredClasses.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                  </SelectField>
                </div>
                <SelectField label="Kontingen (terdaftar)" value={form.contingent_id} onChange={(v) => setForm({ ...form, contingent_id: v, contingent_name: "" })} testid="reg-contingent-select" disabled={!contingents.length}>
                  {contingents.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                </SelectField>
                {!form.contingent_id && (
                  <FieldRow label="atau nama kontingen baru">
                    <Input value={form.contingent_name} onChange={(e) => setForm({ ...form, contingent_name: e.target.value })} placeholder="Nama kontingen" className="bg-[#0a0a0a] border-white/10" data-testid="reg-contingent-name"/>
                  </FieldRow>
                )}
              </FormGroup>

              <FormGroup title="Data Diri">
                <FieldRow label="Nama Lengkap *"><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="bg-[#0a0a0a] border-white/10" data-testid="reg-name"/></FieldRow>
                <div className="grid grid-cols-2 gap-4">
                  <SelectField label="Jenis Kelamin *" value={form.gender} onChange={(v) => setForm({ ...form, gender: v })} testid="reg-gender">
                    <SelectItem value="putra">Putra</SelectItem>
                    <SelectItem value="putri">Putri</SelectItem>
                  </SelectField>
                  <FieldRow label="Tanggal Lahir"><Input type="date" value={form.dob} onChange={(e) => setForm({ ...form, dob: e.target.value })} className="bg-[#0a0a0a] border-white/10" data-testid="reg-dob"/></FieldRow>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <FieldRow label="Berat (kg)"><Input type="number" value={form.weight} onChange={(e) => setForm({ ...form, weight: e.target.value })} className="bg-[#0a0a0a] border-white/10" data-testid="reg-weight"/></FieldRow>
                  <FieldRow label="No. WhatsApp *"><Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="08xxxxxxxxxx" className="bg-[#0a0a0a] border-white/10" data-testid="reg-phone"/></FieldRow>
                </div>
                <FieldRow label="Email (opsional)"><Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="bg-[#0a0a0a] border-white/10" data-testid="reg-email"/></FieldRow>
                <FieldRow label="Alamat (opsional)"><Textarea rows={2} value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} className="bg-[#0a0a0a] border-white/10" data-testid="reg-address"/></FieldRow>
              </FormGroup>

              <FormGroup title="Dokumen Wajib">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {REQUIRED_DOCS.map((d) => (
                    <DocUploader key={d.key} doc={d} url={files[d.key]} onUploaded={(url) => setFiles({ ...files, [d.key]: url })} />
                  ))}
                </div>
                <p className="text-xs text-zinc-500 mt-3">Format: JPG, PNG, WEBP, atau PDF. Maks 5 MB per file.</p>
              </FormGroup>

              <div className="pt-2 flex items-center gap-3">
                <Button
                  onClick={submit}
                  disabled={!canSubmit || submitting}
                  className="bg-[#ffcc00] hover:bg-[#e6b800] text-black uppercase tracking-[0.15em] disabled:opacity-40"
                  data-testid="reg-submit"
                >
                  <ClipboardList className="w-4 h-4 mr-2" /> {submitting ? "Mengirim..." : "Kirim Registrasi"}
                </Button>
                <div className="text-xs text-zinc-500">Setelah submit, simpan nomor registrasi Anda untuk cek status.</div>
              </div>
            </section>
          </>
        )}
      </main>
    </div>
  );
}

function FormGroup({ title, children }) {
  return (
    <div className="border border-white/10 rounded-sm bg-[#0f0f10] p-6 space-y-4">
      <div className="text-[10px] tracking-[0.3em] uppercase text-zinc-400">{title}</div>
      <div className="space-y-4">{children}</div>
    </div>
  );
}

function FieldRow({ label, children }) {
  return (
    <div>
      <Label className="text-[10px] tracking-[0.2em] uppercase text-zinc-400">{label}</Label>
      <div className="mt-1">{children}</div>
    </div>
  );
}

function SelectField({ label, value, onChange, children, testid, disabled }) {
  return (
    <FieldRow label={label}>
      <Select value={value || ""} onValueChange={onChange} disabled={disabled}>
        <SelectTrigger className="bg-[#0a0a0a] border-white/10" data-testid={testid}><SelectValue placeholder={disabled ? "—" : "Pilih..."} /></SelectTrigger>
        <SelectContent className="bg-[#141414] border-white/10 text-white">{children}</SelectContent>
      </Select>
    </FieldRow>
  );
}

function DocUploader({ doc, url, onUploaded }) {
  const ref = useRef(null);
  const [busy, setBusy] = useState(false);
  const onPick = async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", f);
      const r = await PUB.post("/public/uploads/document", fd, { headers: { "Content-Type": "multipart/form-data" } });
      onUploaded(r.data.url);
      toast.success(`${doc.label} terunggah`);
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Gagal unggah");
    } finally { setBusy(false); if (ref.current) ref.current.value = ""; }
  };
  const Icon = doc.icon;
  const done = !!url;
  return (
    <div className={`border rounded-sm p-4 transition-colors ${done ? "border-emerald-500/40 bg-emerald-500/5" : "border-white/10 bg-[#0a0a0a]"}`}>
      <div className="flex items-center gap-2 text-xs tracking-[0.15em] uppercase text-zinc-300">
        <Icon className="w-4 h-4" /> {doc.label} {doc.required && <span className="text-[#ff3b30]">*</span>}
      </div>
      <input ref={ref} type="file" accept="image/*,application/pdf" className="hidden" onChange={onPick} data-testid={`doc-${doc.key}-input`} />
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button size="sm" type="button" onClick={() => ref.current?.click()} disabled={busy} className="bg-[#ffcc00] hover:bg-[#e6b800] text-black rounded-sm" data-testid={`doc-${doc.key}-upload`}>
          <Upload className="w-3.5 h-3.5 mr-1.5" /> {busy ? "Mengunggah..." : done ? "Ganti" : "Unggah"}
        </Button>
        {done && (
          <a href={`${BACKEND_URL}${url}`} target="_blank" rel="noreferrer" className="text-[11px] text-emerald-300 hover:underline flex items-center gap-1">
            <FileCheck2 className="w-3.5 h-3.5"/> Lihat
          </a>
        )}
      </div>
    </div>
  );
}

function SuccessCard({ reg, onAnother }) {
  return (
    <div className="border border-emerald-500/30 bg-emerald-500/5 rounded-sm p-8 text-center" data-testid="reg-success">
      <ShieldCheck className="w-12 h-12 mx-auto text-emerald-400 mb-3" />
      <div className="text-[10px] tracking-[0.3em] uppercase text-emerald-300">Registrasi Terkirim</div>
      <h2 className="font-display text-3xl tracking-tight mt-2">Nomor Registrasi Anda</h2>
      <div className="font-mono-display text-2xl text-[#ffcc00] mt-2" data-testid="reg-number">{reg.registration_number}</div>
      <p className="text-sm text-zinc-300 mt-4 max-w-md mx-auto">Simpan nomor di atas. Status verifikasi dapat dipantau melalui tab <strong>Cek Status</strong> pada halaman ini.</p>
      <div className="flex justify-center gap-3 mt-6">
        <Button onClick={onAnother} className="bg-white/5 hover:bg-white/10 text-white border border-white/10 rounded-sm" data-testid="reg-another">Daftar Lagi</Button>
        <Link to={reg.slug ? `/event/${reg.slug}/check?number=${encodeURIComponent(reg.registration_number)}` : `/register?mode=check&number=${encodeURIComponent(reg.registration_number)}`}>
          <Button className="bg-[#ffcc00] hover:bg-[#e6b800] text-black rounded-sm" data-testid="reg-check-status">Cek Status <ArrowRight className="w-4 h-4 ml-2"/></Button>
        </Link>
      </div>
    </div>
  );
}

function StatusCheck() {
  const [searchParams] = useSearchParams();
  const [number, setNumber] = useState(searchParams.get("number") || "");
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const lookup = async (n) => {
    const q = (n ?? number).trim();
    if (!q) return;
    setBusy(true); setData(null);
    try {
      const r = await PUB.get(`/public/registrations/by-number/${encodeURIComponent(q)}`);
      setData(r.data);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Tidak ditemukan");
    } finally { setBusy(false); }
  };
  // eslint-disable-next-line
  useEffect(() => { const n = searchParams.get("number"); if (n) { setNumber(n); lookup(n); } }, [searchParams]);

  return (
    <div>
      <div className="mb-8">
        <div className="text-[10px] tracking-[0.3em] uppercase text-[#ffcc00] mb-2">Cek Status</div>
        <h1 className="font-display text-4xl tracking-tight uppercase">Status Registrasi</h1>
        <p className="text-sm text-zinc-400 mt-2">Masukkan nomor registrasi yang Anda terima saat submit.</p>
      </div>
      <div className="flex gap-2">
        <Input value={number} onChange={(e) => setNumber(e.target.value)} placeholder="REG-EVENT-001" className="bg-[#0a0a0a] border-white/10" data-testid="check-number-input" />
        <Button onClick={() => lookup()} disabled={busy} className="bg-[#ffcc00] hover:bg-[#e6b800] text-black rounded-sm uppercase tracking-[0.15em]" data-testid="check-lookup-btn">Cari</Button>
      </div>

      {data && (
        <div className="mt-6 border border-white/10 rounded-sm bg-[#0f0f10] p-6 space-y-4" data-testid="check-result">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-[10px] tracking-[0.3em] uppercase text-zinc-500">Nama</div>
              <div className="font-display text-2xl tracking-tight">{data.name}</div>
              <div className="text-xs text-zinc-400 mt-1">{data.registration_number}</div>
            </div>
            <div className={`px-3 py-1 text-[11px] tracking-[0.2em] uppercase border rounded-sm ${STATUS_COLOR[data.status] || "border-white/10 text-zinc-300"}`}>
              {STATUS_LABEL[data.status] || data.status}
            </div>
          </div>
          {data.participant_number && (
            <div className="border-t border-white/10 pt-4">
              <div className="text-[10px] tracking-[0.3em] uppercase text-zinc-500">Nomor Peserta</div>
              <div className="font-mono-display text-xl text-[#ffcc00]">{data.participant_number}</div>
            </div>
          )}
          {data.history && (
            <div className="border-t border-white/10 pt-4">
              <div className="text-[10px] tracking-[0.3em] uppercase text-zinc-500 mb-2">Riwayat</div>
              <div className="space-y-1.5">
                {[...data.history].reverse().map((h, i) => (
                  <div key={i} className="text-xs text-zinc-300 flex items-center gap-3">
                    <span className="font-mono-display text-zinc-500">{new Date(h.at).toLocaleString("id-ID")}</span>
                    <span>→</span>
                    <span className="uppercase tracking-[0.15em]">{STATUS_LABEL[h.status] || h.status}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
