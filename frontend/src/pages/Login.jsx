import React, { useState } from "react";
import { Link, useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { formatApiError } from "@/lib/api";
import { toast, Toaster } from "sonner";
import { ChevronDown, Eye, EyeOff } from "lucide-react";

const DEMO_GROUPS = [
  {
    title: "Panitia",
    accounts: [
      { email: "admin@silat.id", pw: "admin123", label: "Admin" },
      { email: "operator@silat.id", pw: "password123", label: "Operator" },
    ],
  },
  {
    title: "Juri",
    accounts: [
      { email: "juri1@silat.id", pw: "password123", label: "Juri 1" },
      { email: "juri2@silat.id", pw: "password123", label: "Juri 2" },
      { email: "juri3@silat.id", pw: "password123", label: "Juri 3" },
      { email: "ketuajuri@silat.id", pw: "password123", label: "Ketua Juri" },
    ],
  },
  {
    title: "Lapangan",
    accounts: [
      { email: "wasit@silat.id", pw: "password123", label: "Wasit" },
      { email: "timer@silat.id", pw: "password123", label: "Timer" },
    ],
  },
];

export default function Login() {
  const { login } = useAuth();
  const nav = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [capsLock, setCapsLock] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [demoOpen, setDemoOpen] = useState(false);
  const [filledAs, setFilledAs] = useState("");

  const continueFrom = location.state?.from;

  const onSubmit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const u = await login(email, password);
      toast.success(`Selamat datang, ${u.name}`);
      const dest = continueFrom?.pathname || destinationFor(u.role);
      nav(dest, { replace: true });
    } catch (err) {
      setError(formatApiError(err));
    } finally {
      setBusy(false);
    }
  };

  const fillDemo = (acc) => {
    setEmail(acc.email);
    setPassword(acc.pw);
    setFilledAs(acc.label);
    setError("");
    setDemoOpen(false);
  };

  const onPasswordKey = (e) => {
    setCapsLock(e.getModifierState?.("CapsLock") ?? false);
  };

  return (
    <div className="min-h-screen flex flex-col lg:flex-row bg-[#0a0a0a]">
      <Toaster theme="dark" position="top-right" />

      <header className="lg:hidden flex items-center px-6 h-16 border-b border-white/10">
        <BrandMark compact />
      </header>

      <div className="hidden lg:flex flex-1 relative overflow-hidden border-r border-white/10">
        <div className="absolute inset-0 bg-public" />
        <div className="absolute inset-0 texture-grain opacity-40" />
        <div className="relative z-10 p-12 flex flex-col justify-between w-full">
          <BrandMark />

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
            <Stat label="Skor" value="Live" />
            <Stat label="Gelanggang" value="Multi" />
            <Stat label="Petugas" value="Peran" />
          </div>
        </div>
      </div>

      <div className="flex-1 flex items-center justify-center p-6 sm:p-8">
        <div className="w-full max-w-md">
          <div className="text-[10px] tracking-[0.4em] uppercase text-[#ffcc00] mb-2">Masuk</div>
          <h2 className="font-display text-4xl tracking-tight uppercase mb-6">Selamat Datang</h2>

          {continueFrom && (
            <p className="mb-6 text-sm text-zinc-300 border border-white/10 bg-white/5 px-3 py-2 rounded-sm">
              Masuk untuk melanjutkan.
            </p>
          )}

          <form onSubmit={onSubmit} className="space-y-5" data-testid="login-form">
            <div>
              <Label htmlFor="email" className="text-xs tracking-[0.2em] uppercase text-zinc-400">Email</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => { setEmail(e.target.value); setFilledAs(""); }}
                required
                autoFocus
                autoComplete="email"
                data-testid="login-email-input"
                className="mt-2 h-12 bg-[#141414] border-white/10 focus-visible:ring-[#ffcc00] rounded-sm"
              />
            </div>
            <div>
              <Label htmlFor="password" className="text-xs tracking-[0.2em] uppercase text-zinc-400">Kata Sandi</Label>
              <div className="relative mt-2">
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => { setPassword(e.target.value); setFilledAs(""); }}
                  onKeyDown={onPasswordKey}
                  onKeyUp={onPasswordKey}
                  onBlur={() => setCapsLock(false)}
                  required
                  autoComplete="current-password"
                  data-testid="login-password-input"
                  className="h-12 pr-12 bg-[#141414] border-white/10 focus-visible:ring-[#ffcc00] rounded-sm"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? "Sembunyikan kata sandi" : "Tampilkan kata sandi"}
                  aria-pressed={showPassword}
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 grid h-9 w-9 place-items-center text-zinc-400 hover:text-white rounded-sm"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              {capsLock && (
                <p className="mt-2 text-xs text-[#ffcc00]">Caps Lock aktif.</p>
              )}
              <p className="mt-2 text-xs text-zinc-500">Lupa kata sandi? Hubungi admin acara.</p>
            </div>
            <div
              role="alert"
              aria-live="polite"
              data-testid="login-error"
              className={error ? "text-sm text-[#ff3b30] bg-[#ff3b30]/10 border border-[#ff3b30]/30 px-3 py-2 rounded-sm" : "sr-only"}
            >
              {error}
            </div>
            {filledAs && (
              <p role="status" className="text-sm text-zinc-300">
                Terisi sebagai {filledAs}. Periksa lalu tekan Masuk.
              </p>
            )}
            <Button
              type="submit"
              disabled={busy}
              aria-busy={busy}
              data-testid="login-submit-btn"
              className="w-full h-12 bg-[#ffcc00] hover:bg-[#e6b800] text-black font-bold tracking-[0.15em] uppercase rounded-sm tap-press"
            >
              {busy ? "Memproses..." : "Masuk"}
            </Button>
          </form>

          <div className="mt-8 pt-6 border-t border-white/10">
            <button
              type="button"
              aria-expanded={demoOpen}
              onClick={() => setDemoOpen((v) => !v)}
              className="flex w-full items-center justify-between text-left text-[10px] tracking-[0.3em] uppercase text-zinc-500 hover:text-zinc-300"
            >
              Isi akun demo
              <ChevronDown className={`w-4 h-4 transition-transform ${demoOpen ? "rotate-180" : ""}`} />
            </button>
            {demoOpen && (
              <div className="mt-4 space-y-4">
                {DEMO_GROUPS.map((group) => (
                  <div key={group.title}>
                    <div className="text-[10px] tracking-[0.25em] uppercase text-zinc-600 mb-2">{group.title}</div>
                    <div className="grid grid-cols-2 gap-2">
                      {group.accounts.map((a) => (
                        <button
                          key={a.email}
                          type="button"
                          onClick={() => fillDemo(a)}
                          data-testid={`demo-account-${a.label.toLowerCase().replace(" ", "-")}`}
                          className="min-h-12 text-left px-3 py-2 text-xs bg-[#141414] hover:bg-white/5 border border-white/10 rounded-sm transition-colors"
                        >
                          <div className="text-white font-medium">{a.label}</div>
                          <div className="text-zinc-500 text-[10px] truncate">{a.email}</div>
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <p className="mt-6 text-center text-xs leading-6 text-zinc-500">
            Peserta?{" "}
            <Link to="/" data-testid="participant-registration-link" className="uppercase tracking-[0.12em] text-zinc-300 hover:text-[#ffcc00]">
              Daftar
            </Link>
            <span className="mx-2 text-zinc-700">·</span>
            <Link to="/register?mode=check" data-testid="participant-status-link" className="uppercase tracking-[0.12em] text-zinc-300 hover:text-[#ffcc00]">
              Cek status
            </Link>
            <span className="mx-2 text-zinc-700">·</span>
            <Link to="/display" data-testid="public-display-link" className="uppercase tracking-[0.12em] text-zinc-300 hover:text-[#ffcc00]">
              Tampilan publik
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}

function BrandMark({ compact = false }) {
  return (
    <Link
      to="/"
      aria-label="Silat Scoring, ke beranda"
      className="group inline-flex items-center gap-3 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ffcc00]"
    >
      <div className={`${compact ? "w-9 h-9" : "w-12 h-12"} bg-[#ffcc00] grid place-items-center rounded-sm`}>
        <span className={`font-display text-black leading-none ${compact ? "text-2xl" : "text-3xl"}`}>S</span>
      </div>
      <div>
        <div className={`font-display tracking-tight group-hover:text-[#ffcc00] transition-colors ${compact ? "text-xl" : "text-2xl"}`}>
          SILAT SCORING
        </div>
        <div className="text-[10px] tracking-[0.3em] text-zinc-500 uppercase">Sistem Penilaian Digital</div>
      </div>
    </Link>
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
