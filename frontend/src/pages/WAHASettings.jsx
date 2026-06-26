import React, { useEffect, useState } from "react";
import AppShell from "@/components/AppShell";
import api from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Toaster, toast } from "sonner";
import { Send, PlugZap, Save, MessageSquare, History, RefreshCw } from "lucide-react";

const TEMPLATE_KEYS = [
  { key: "verified", label: "Terverifikasi" },
  { key: "need_revision", label: "Perlu Revisi" },
  { key: "verification_rejected", label: "Verifikasi Ditolak" },
  { key: "accepted", label: "Diterima" },
  { key: "reserve", label: "Cadangan" },
  { key: "rejected", label: "Ditolak Seleksi" },
  { key: "active_participant", label: "Peserta Aktif" },
];

export default function WAHASettings() {
  const [cfg, setCfg] = useState({ base_url: "", api_key: "", session: "default", sender_phone: "", enabled: false, templates: {} });
  const [busy, setBusy] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [sendPhone, setSendPhone] = useState("");
  const [sendMsg, setSendMsg] = useState("Halo, ini pesan tes dari Silat Scoring.");
  const [logs, setLogs] = useState([]);
  const [logsBusy, setLogsBusy] = useState(false);

  const load = () => api.get("/waha/config").then((r) => setCfg(r.data || cfg));
  const loadLogs = async () => {
    setLogsBusy(true);
    try { const r = await api.get("/waha/logs", { params: { limit: 30 } }); setLogs(r.data || []); }
    catch { /* ignore */ }
    finally { setLogsBusy(false); }
  };
  // eslint-disable-next-line
  useEffect(() => { load(); loadLogs(); }, []);

  const save = async () => {
    setBusy(true);
    try {
      await api.put("/waha/config", cfg);
      toast.success("Konfigurasi disimpan");
    } catch (e) { toast.error(e?.response?.data?.detail || "Gagal menyimpan"); }
    finally { setBusy(false); }
  };

  const testConn = async () => {
    setBusy(true); setTestResult(null);
    try {
      const r = await api.post("/waha/test-connection");
      setTestResult(r.data);
      if (r.data.ok) toast.success("Koneksi WAHA berhasil");
      else toast.error("Koneksi gagal — periksa URL/API key");
    } catch (e) { toast.error(e?.response?.data?.detail || "Gagal"); setTestResult({ ok: false, error: e?.message }); }
    finally { setBusy(false); }
  };

  const testSend = async () => {
    if (!sendPhone) return toast.error("Masukkan nomor tujuan");
    setBusy(true);
    try {
      const r = await api.post("/waha/test-send", { phone: sendPhone, message: sendMsg });
      if (r.data.ok) toast.success("Pesan terkirim");
      else toast.error(`Gagal kirim — status ${r.data.status_code || ""}`);
      setTestResult(r.data);
    } catch (e) { toast.error(e?.response?.data?.detail || "Gagal kirim"); }
    finally { setBusy(false); }
  };

  return (
    <AppShell title="Pengaturan WhatsApp (WAHA)">
      <Toaster theme="dark" position="top-right" />
      <div className="mb-6">
        <h1 className="font-display text-3xl tracking-tight uppercase">Pengaturan WhatsApp</h1>
        <p className="text-sm text-zinc-400 mt-1">Integrasi WAHA HTTP API untuk notifikasi peserta. Pengiriman otomatis aktif untuk setiap perubahan status registrasi (template di bawah). Pastikan WAHA berjalan dan toggle &quot;Aktifkan integrasi&quot; sebelum status berubah.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <section className="border border-white/10 rounded-sm bg-[#0f0f10] p-6 space-y-4">
          <div className="text-[10px] tracking-[0.3em] uppercase text-zinc-400">Koneksi</div>

          <div className="flex items-center justify-between">
            <Label className="text-sm">Aktifkan integrasi WAHA</Label>
            <Switch checked={!!cfg.enabled} onCheckedChange={(v) => setCfg({ ...cfg, enabled: v })} data-testid="waha-enabled-toggle"/>
          </div>

          <Row label="Base URL WAHA" hint="Contoh: http://localhost:3000">
            <Input value={cfg.base_url} onChange={(e) => setCfg({ ...cfg, base_url: e.target.value })} placeholder="http://localhost:3000" className="bg-[#0a0a0a] border-white/10" data-testid="waha-base-url"/>
          </Row>
          <Row label="API Key (X-Api-Key)" hint="Kosongkan bila instance tidak memerlukan">
            <Input type="password" value={cfg.api_key} onChange={(e) => setCfg({ ...cfg, api_key: e.target.value })} className="bg-[#0a0a0a] border-white/10" data-testid="waha-api-key"/>
          </Row>
          <div className="grid grid-cols-2 gap-3">
            <Row label="Session"><Input value={cfg.session} onChange={(e) => setCfg({ ...cfg, session: e.target.value })} className="bg-[#0a0a0a] border-white/10" data-testid="waha-session"/></Row>
            <Row label="No. Pengirim"><Input value={cfg.sender_phone} onChange={(e) => setCfg({ ...cfg, sender_phone: e.target.value })} placeholder="6281234567890" className="bg-[#0a0a0a] border-white/10" data-testid="waha-sender"/></Row>
          </div>

          <div className="flex gap-2 pt-2">
            <Button onClick={save} disabled={busy} className="bg-[#ffcc00] hover:bg-[#e6b800] text-black rounded-sm uppercase tracking-[0.15em]" data-testid="waha-save"><Save className="w-4 h-4 mr-2"/>Simpan</Button>
            <Button onClick={testConn} disabled={busy} variant="ghost" className="border border-white/10 hover:bg-white/5" data-testid="waha-test-conn"><PlugZap className="w-4 h-4 mr-2"/>Tes Koneksi</Button>
          </div>

          {testResult && (
            <pre className="text-xs bg-black/40 border border-white/10 rounded-sm p-3 mt-2 overflow-x-auto max-h-40" data-testid="waha-test-result">{JSON.stringify(testResult, null, 2)}</pre>
          )}
        </section>

        <section className="border border-white/10 rounded-sm bg-[#0f0f10] p-6 space-y-4">
          <div className="text-[10px] tracking-[0.3em] uppercase text-zinc-400 flex items-center gap-2"><Send className="w-3.5 h-3.5"/> Kirim Pesan Manual</div>
          <Row label="No. Tujuan (08xx / 62xx)"><Input value={sendPhone} onChange={(e) => setSendPhone(e.target.value)} className="bg-[#0a0a0a] border-white/10" data-testid="waha-send-phone"/></Row>
          <Row label="Pesan"><Textarea rows={4} value={sendMsg} onChange={(e) => setSendMsg(e.target.value)} className="bg-[#0a0a0a] border-white/10" data-testid="waha-send-msg"/></Row>
          <Button onClick={testSend} disabled={busy || !cfg.enabled} className="bg-emerald-500 hover:bg-emerald-600 text-black rounded-sm uppercase tracking-[0.15em]" data-testid="waha-send-btn">
            <Send className="w-4 h-4 mr-2"/>Kirim Tes
          </Button>
          {!cfg.enabled && <p className="text-xs text-amber-400">Aktifkan integrasi terlebih dahulu untuk mengirim pesan.</p>}
        </section>
      </div>

      <section className="mt-6 border border-white/10 rounded-sm bg-[#0f0f10] p-6 space-y-4">
        <div className="text-[10px] tracking-[0.3em] uppercase text-zinc-400 flex items-center gap-2"><MessageSquare className="w-3.5 h-3.5"/> Template Pesan</div>
        <p className="text-xs text-zinc-500">Placeholder yang didukung: <code className="text-[#ffcc00]">{"{name}"}</code>, <code className="text-[#ffcc00]">{"{event_name}"}</code>, <code className="text-[#ffcc00]">{"{registration_number}"}</code>, <code className="text-[#ffcc00]">{"{participant_number}"}</code>, <code className="text-[#ffcc00]">{"{admin_notes}"}</code>. Template ini akan dipakai pada update otomatis berikutnya.</p>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {TEMPLATE_KEYS.map((t) => (
            <div key={t.key}>
              <Label className="text-[10px] tracking-[0.2em] uppercase text-zinc-400">{t.label}</Label>
              <Textarea
                rows={3}
                value={(cfg.templates || {})[t.key] || ""}
                onChange={(e) => setCfg({ ...cfg, templates: { ...(cfg.templates || {}), [t.key]: e.target.value } })}
                className="bg-[#0a0a0a] border-white/10 mt-1 font-mono text-xs"
                data-testid={`waha-tpl-${t.key}`}
              />
            </div>
          ))}
        </div>
        <Button onClick={save} disabled={busy} className="bg-[#ffcc00] hover:bg-[#e6b800] text-black rounded-sm uppercase tracking-[0.15em]" data-testid="waha-templates-save"><Save className="w-4 h-4 mr-2"/>Simpan Template</Button>
      </section>

      <section className="mt-6 border border-white/10 rounded-sm bg-[#0f0f10] p-6 space-y-3">
        <div className="flex items-center justify-between">
          <div className="text-[10px] tracking-[0.3em] uppercase text-zinc-400 flex items-center gap-2"><History className="w-3.5 h-3.5"/> Riwayat Pengiriman (30 terbaru)</div>
          <Button onClick={loadLogs} disabled={logsBusy} variant="ghost" className="h-8 border border-white/10 hover:bg-white/5" data-testid="waha-logs-refresh"><RefreshCw className={`w-3.5 h-3.5 mr-2 ${logsBusy ? "animate-spin" : ""}`}/>Muat ulang</Button>
        </div>
        {logs.length === 0 ? (
          <div className="text-xs text-zinc-500 py-6 text-center" data-testid="waha-logs-empty">Belum ada riwayat pengiriman.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-zinc-500 uppercase text-[10px] tracking-wider border-b border-white/10">
                <tr><th className="text-left py-2 pr-3">Waktu</th><th className="text-left pr-3">Status</th><th className="text-left pr-3">No HP</th><th className="text-left pr-3">Hasil</th><th className="text-left">Pesan</th></tr>
              </thead>
              <tbody data-testid="waha-logs-table">
                {logs.map((l) => (
                  <tr key={l.id} className="border-b border-white/5" data-testid={`waha-log-${l.id}`}>
                    <td className="py-2 pr-3 whitespace-nowrap text-zinc-400">{new Date(l.at).toLocaleString("id-ID", { hour12: false })}</td>
                    <td className="pr-3 uppercase tracking-wider text-[10px]"><span className="px-1.5 py-0.5 border border-white/10 rounded-sm">{l.status}</span></td>
                    <td className="pr-3 font-mono text-zinc-300">{l.phone || "—"}</td>
                    <td className="pr-3">
                      {l.ok
                        ? <span className="text-emerald-400">OK</span>
                        : l.skipped
                          ? <span className="text-zinc-500">SKIP: {l.reason}</span>
                          : <span className="text-rose-400" title={l.error || ""}>GAGAL{l.status_code ? ` (${l.status_code})` : ""}</span>}
                    </td>
                    <td className="text-zinc-400 max-w-[420px] truncate" title={l.message || ""}>{l.message || (l.error || "—")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </AppShell>
  );
}

function Row({ label, hint, children }) {
  return (
    <div>
      <Label className="text-[10px] tracking-[0.2em] uppercase text-zinc-400">{label}</Label>
      <div className="mt-1">{children}</div>
      {hint && <div className="text-[10px] text-zinc-500 mt-1">{hint}</div>}
    </div>
  );
}
