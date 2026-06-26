import React, { useState } from "react";
import { Link, useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { formatApiError } from "@/lib/api";
import { toast, Toaster } from "sonner";
import { ClipboardCheck, Monitor, UserPlus } from "lucide-react";

const DEMO_ACCOUNTS = [
  { email: "admin@silat.id", pw: "admin123", label: "Admin" },
  { email: "operator@silat.id", pw: "password123", label: "Operator" },
  { email: "juri1@silat.id", pw: "password123", label: "Juri 1" },
  { email: "juri2@silat.id", pw: "password123", label: "Juri 2" },
  { email: "juri3@silat.id", pw: "password123", label: "Juri 3" },
  { email: "wasit@silat.id", pw: "password123", label: "Wasit" },
  { email: "ketuajuri@silat.id", pw: "password123", label: "Ketua Juri" },
  { email: "timer@silat.id", pw: "password123", label: "Timer" },
];

export default function Login() {
  const { login } = useAuth();
  const nav = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState("admin@silat.id");
  const [password, setPassword] = useState("admin123");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const onSubmit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const u = await login(email, password);
      toast.success(`Selamat datang, ${u.name}`);
      const dest = location.state?.from?.pathname || destinationFor(u.role);
      nav(dest, { replace: true });
    } catch (err) {
      setError(formatApiError(err));
    } finally {
      setBusy(false);
    }
  };

  const fillDemo = (acc) => { setEmail(acc.email); setPassword(acc.pw); };

  return (
    <div className="min-h-screen flex bg-[#0a0a0a]">
      <Toaster theme="dark" position="top-right" />
      {/* Left visual */}
      <div className="hidden lg:flex flex-1 relative overflow-hidden border-r border-white/10">
        <div className="absolute inset-0 bg-public" />
        <div className="absolute inset-0 texture-grain opacity-40" />
        <div className="relative z-10 p-12 flex flex-col justify-between w-full">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 bg-[#ffcc00] grid place-items-center rounded-sm">
              <span className="font-display text-3xl text-black leading-none">S</span>
            </div>
            <div>
              <div className="font-display text-2xl tracking-tight">SILAT SCORING</div>
              <div className="text-[10px] tracking-[0.3em] text-zinc-500 uppercase">Sistem Penilaian Digital</div>
            </div>
          </div>

          <div>
            <div className="text-[10px] tracking-[0.4em] uppercase text-[#ffcc00] mb-4">Real-Time / Multi-Arena / Pencak Silat</div>
            <h1 className="font-display text-7xl tracking-tighter uppercase leading-none">
              Penilaian<br/>
              <span className="text-[#ff3b30]">Merah</span> vs <span className="text-[#007aff]">Biru</span>
            </h1>
            <p className="text-zinc-400 mt-6 max-w-md text-base leading-relaxed">
              Aplikasi penilaian digital untuk kompetisi pencak silat. Mendukung peran admin, operator, juri,
              wasit, ketua juri, timer, dan tampilan publik. Real-time via WebSocket, multi-gelanggang.
            </p>
          </div>

          <div className="grid grid-cols-3 gap-4 max-w-md">
            <Stat label="Juri" value="3" />
            <Stat label="Ronde" value="3 × 2'" />
            <Stat label="Mode" value="Tablet" />
          </div>
        </div>
      </div>

      {/* Form */}
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="w-full max-w-md">
          <div className="text-[10px] tracking-[0.4em] uppercase text-[#ffcc00] mb-2">Masuk</div>
          <h2 className="font-display text-4xl tracking-tight uppercase mb-8">Selamat Datang</h2>

          <form onSubmit={onSubmit} className="space-y-5" data-testid="login-form">
            <div>
              <Label htmlFor="email" className="text-xs tracking-[0.2em] uppercase text-zinc-400">Email</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
                data-testid="login-email-input"
                className="mt-2 h-12 bg-[#141414] border-white/10 focus-visible:ring-white/40 rounded-sm"
              />
            </div>
            <div>
              <Label htmlFor="password" className="text-xs tracking-[0.2em] uppercase text-zinc-400">Kata Sandi</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="current-password"
                data-testid="login-password-input"
                className="mt-2 h-12 bg-[#141414] border-white/10 focus-visible:ring-white/40 rounded-sm"
              />
            </div>
            {error && (
              <div className="text-sm text-[#ff3b30] bg-[#ff3b30]/10 border border-[#ff3b30]/30 px-3 py-2 rounded-sm" data-testid="login-error">
                {error}
              </div>
            )}
            <Button
              type="submit"
              disabled={busy}
              data-testid="login-submit-btn"
              className="w-full h-12 bg-[#ffcc00] hover:bg-[#e6b800] text-black font-bold tracking-[0.15em] uppercase rounded-sm tap-press"
            >
              {busy ? "Memproses..." : "Masuk"}
            </Button>
          </form>

          <div className="mt-8 pt-6 border-t border-white/10">
            <div className="text-[10px] tracking-[0.3em] uppercase text-zinc-500 mb-3">Akun Demo (klik untuk isi)</div>
            <div className="grid grid-cols-2 gap-2">
              {DEMO_ACCOUNTS.map((a) => (
                <button
                  key={a.email}
                  type="button"
                  onClick={() => fillDemo(a)}
                  data-testid={`demo-account-${a.label.toLowerCase().replace(" ", "-")}`}
                  className="text-left px-3 py-2 text-xs bg-[#141414] hover:bg-white/5 border border-white/10 rounded-sm transition-colors"
                >
                  <div className="text-white font-medium">{a.label}</div>
                  <div className="text-zinc-500 text-[10px] truncate">{a.email}</div>
                </button>
              ))}
            </div>
          </div>

          <div className="mt-6 space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <Button
                asChild
                className="h-11 bg-[#ffcc00] hover:bg-[#e6b800] text-black rounded-sm uppercase tracking-[0.15em] text-xs"
              >
                <Link to="/" data-testid="participant-registration-link">
                  <UserPlus className="w-4 h-4" />
                  Daftar Peserta
                </Link>
              </Button>
              <Button
                asChild
                className="h-11 bg-white/5 hover:bg-white/10 text-white border border-white/10 rounded-sm uppercase tracking-[0.15em] text-xs"
              >
                <Link to="/register?mode=check" data-testid="participant-status-link">
                  <ClipboardCheck className="w-4 h-4" />
                  Cek Status
                </Link>
              </Button>
            </div>
            <div className="text-center">
              <Link to="/display" data-testid="public-display-link" className="inline-flex items-center gap-2 text-xs tracking-[0.2em] uppercase text-zinc-500 hover:text-[#ffcc00] transition-colors">
                <Monitor className="w-3.5 h-3.5" />
                Buka Tampilan Publik
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div className="border-l-2 border-white/10 pl-3">
      <div className="font-display text-3xl tracking-tight">{value}</div>
      <div className="text-[10px] tracking-[0.3em] uppercase text-zinc-500">{label}</div>
    </div>
  );
}

function destinationFor(role) {
  if (role === "admin") return "/admin";
  if (role === "operator") return "/operator";
  return "/dashboard";
}
