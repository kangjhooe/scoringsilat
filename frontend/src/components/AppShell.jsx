import React, { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { LogOut, Shield, Tv, Users, ClipboardList, Gavel, Timer, Trophy, MessageSquare, ScrollText, GitBranch, Medal, Menu } from "lucide-react";

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
  const [menuOpen, setMenuOpen] = useState(false);

  const navItems = [
    { to: "/admin", label: "Master Data", icon: Shield, roles: ["admin"] },
    { to: "/admin/registrations", label: "Registrasi", icon: ScrollText, roles: ["admin", "operator"] },
    { to: "/operator", label: "Pertandingan", icon: ClipboardList, roles: ["admin", "operator"] },
    { to: "/brackets", label: "Bracket", icon: GitBranch, roles: ["admin", "operator"] },
    { to: "/medals", label: "Medali", icon: Medal, roles: ["admin", "operator"] },
    { to: "/dashboard", label: "Dashboard", icon: Trophy, roles: ["admin", "operator", "jury", "referee", "head_jury", "timer"] },
    { to: "/display", label: "Public Display", icon: Tv, roles: ["admin", "operator", "jury", "referee", "head_jury", "timer"] },
    { to: "/admin/whatsapp", label: "WhatsApp", icon: MessageSquare, roles: ["admin"] },
  ];

  const visibleNav = navItems.filter((n) => !n.roles || n.roles.includes(user?.role) || user?.role === "admin");

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white">
      <header className="border-b border-white/10 bg-[#0a0a0a]/95 backdrop-blur sticky top-0 z-30 no-print">
        <div className="max-w-[1600px] mx-auto px-4 sm:px-6 py-3 flex items-center gap-3">
          <Link to="/" className="flex items-center gap-3 min-w-0" data-testid="brand-link">
            <div className="w-9 h-9 bg-[#ffcc00] grid place-items-center rounded-sm shrink-0">
              <span className="font-display text-2xl text-black leading-none">S</span>
            </div>
            <div className="leading-tight min-w-0">
              <div className="font-display text-lg sm:text-xl tracking-tight truncate">SILAT SCORING</div>
              <div className="hidden sm:block text-[10px] tracking-[0.3em] text-zinc-500 uppercase">Sistem Penilaian Digital</div>
            </div>
          </Link>
          <nav className="hidden xl:flex items-center gap-0.5 ml-2">
            {visibleNav.map((n) => {
              const Icon = n.icon;
              const active = n.to === "/admin" ? location.pathname === "/admin" : location.pathname.startsWith(n.to);
              return (
                <Link
                  key={n.to}
                  to={n.to}
                  data-testid={`nav-${n.to.replace("/", "")}`}
                  className={`px-2 py-2 text-[11px] tracking-[0.12em] uppercase rounded-sm transition-colors flex items-center gap-1.5 whitespace-nowrap ${active ? "bg-white/10 text-white" : "text-zinc-400 hover:text-white hover:bg-white/5"}`}
                >
                  <Icon className="w-3.5 h-3.5" /> {n.label}
                </Link>
              );
            })}
          </nav>
          <div className="ml-auto flex items-center gap-2 shrink-0">
            <div className="text-right hidden sm:block max-w-[9rem] lg:max-w-[12rem]">
              <div className="text-sm font-medium truncate">{user?.name}</div>
              <div className="text-[10px] tracking-[0.3em] uppercase text-[#ffcc00] truncate">{ROLE_LABEL[user?.role] || user?.role}</div>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setMenuOpen(true)}
              data-testid="nav-menu-btn"
              aria-label="Buka menu"
              className="xl:hidden text-zinc-300 hover:text-white hover:bg-white/5"
            >
              <Menu className="w-4 h-4" />
            </Button>
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
          <div className="max-w-[1600px] mx-auto px-4 sm:px-6 pb-4">
            <h1 className="font-display text-3xl md:text-4xl tracking-tight uppercase">{title}</h1>
          </div>
        )}
      </header>
      <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
        <SheetContent side="left" className="bg-[#0a0a0a] text-white border-white/10 w-[min(20rem,88vw)] p-0">
          <SheetHeader className="px-5 pt-6 pb-4 pr-12 border-b border-white/10 text-left space-y-1">
            <SheetTitle className="font-display text-2xl tracking-tight uppercase text-white">Menu</SheetTitle>
            <SheetDescription className="text-zinc-400">
              {user?.name} · {ROLE_LABEL[user?.role] || user?.role}
            </SheetDescription>
          </SheetHeader>
          <nav className="flex flex-col p-3 gap-1">
            {visibleNav.map((n) => {
              const Icon = n.icon;
              const active = n.to === "/admin" ? location.pathname === "/admin" : location.pathname.startsWith(n.to);
              return (
                <Link
                  key={n.to}
                  to={n.to}
                  onClick={() => setMenuOpen(false)}
                  data-testid={`nav-mobile-${n.to.replace("/", "")}`}
                  className={`px-3 py-3 text-sm tracking-[0.14em] uppercase rounded-sm transition-colors flex items-center gap-3 ${active ? "bg-white/10 text-white" : "text-zinc-300 hover:text-white hover:bg-white/5"}`}
                >
                  <Icon className="w-4 h-4" /> {n.label}
                </Link>
              );
            })}
          </nav>
        </SheetContent>
      </Sheet>
      <main className="max-w-[1600px] mx-auto px-4 sm:px-6 py-6">{children}</main>
    </div>
  );
}
