import React from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { LogOut, Shield, Tv, Users, ClipboardList, Gavel, Timer, Trophy, MessageSquare, ScrollText, GitBranch } from "lucide-react";

const ROLE_LABEL = {
  admin: "Administrator",
  operator: "Operator",
  jury: "Juri",
  referee: "Wasit",
  head_jury: "Ketua Juri",
  timer: "Timer",
};

export default function AppShell({ children, title }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const navItems = [
    { to: "/admin", label: "Master Data", icon: Shield, roles: ["admin"] },
    { to: "/admin/registrations", label: "Registrasi", icon: ScrollText, roles: ["admin", "operator"] },
    { to: "/admin/whatsapp", label: "WhatsApp", icon: MessageSquare, roles: ["admin"] },
    { to: "/operator", label: "Pertandingan", icon: ClipboardList, roles: ["admin", "operator"] },
    { to: "/brackets", label: "Bracket", icon: GitBranch, roles: ["admin", "operator"] },
    { to: "/dashboard", label: "Dashboard", icon: Trophy, roles: ["admin", "operator", "jury", "referee", "head_jury", "timer"] },
    { to: "/display", label: "Public Display", icon: Tv, roles: ["admin", "operator", "jury", "referee", "head_jury", "timer"] },
  ];

  const visibleNav = navItems.filter((n) => !n.roles || n.roles.includes(user?.role) || user?.role === "admin");

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white">
      <header className="border-b border-white/10 bg-[#0a0a0a]/95 backdrop-blur sticky top-0 z-30 no-print">
        <div className="max-w-[1600px] mx-auto px-6 py-3 flex items-center gap-6">
          <Link to="/" className="flex items-center gap-3" data-testid="brand-link">
            <div className="w-9 h-9 bg-[#ffcc00] grid place-items-center rounded-sm">
              <span className="font-display text-2xl text-black leading-none">S</span>
            </div>
            <div className="leading-tight">
              <div className="font-display text-xl tracking-tight">SILAT SCORING</div>
              <div className="text-[10px] tracking-[0.3em] text-zinc-500 uppercase">Sistem Penilaian Digital</div>
            </div>
          </Link>
          <nav className="hidden md:flex items-center gap-1 ml-4">
            {visibleNav.map((n) => {
              const Icon = n.icon;
              const active = n.to === "/admin" ? location.pathname === "/admin" : location.pathname.startsWith(n.to);
              return (
                <Link
                  key={n.to}
                  to={n.to}
                  data-testid={`nav-${n.to.replace("/", "")}`}
                  className={`px-3 py-2 text-xs tracking-[0.15em] uppercase rounded-sm transition-colors flex items-center gap-2 ${active ? "bg-white/10 text-white" : "text-zinc-400 hover:text-white hover:bg-white/5"}`}
                >
                  <Icon className="w-3.5 h-3.5" /> {n.label}
                </Link>
              );
            })}
          </nav>
          <div className="ml-auto flex items-center gap-3">
            <div className="text-right">
              <div className="text-sm font-medium">{user?.name}</div>
              <div className="text-[10px] tracking-[0.3em] uppercase text-[#ffcc00]">{ROLE_LABEL[user?.role] || user?.role}</div>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => { logout(); navigate("/login"); }}
              data-testid="logout-btn"
              className="text-zinc-400 hover:text-white hover:bg-white/5"
            >
              <LogOut className="w-4 h-4" />
            </Button>
          </div>
        </div>
        {title && (
          <div className="max-w-[1600px] mx-auto px-6 pb-4">
            <h1 className="font-display text-3xl md:text-4xl tracking-tight uppercase">{title}</h1>
          </div>
        )}
      </header>
      <main className="max-w-[1600px] mx-auto px-6 py-6">{children}</main>
    </div>
  );
}
