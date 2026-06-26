import React, { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import api from "@/lib/api";
import { Button } from "@/components/ui/button";
import { resolvePhotoUrl } from "@/components/PhotoUpload";
import {
  ArrowRight,
  CalendarDays,
  CheckCircle2,
  ClipboardCheck,
  Clock,
  LogIn,
  MapPin,
  Monitor,
  Phone,
  ShieldCheck,
  Trophy,
  UserPlus,
  Users,
} from "lucide-react";

const FALLBACK_HERO = "/assets/silat-event-hero.png";

export function EventHome() {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get("/public/events")
      .then((r) => setEvents(r.data || []))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <PublicLoading />;
  if (!events.length) return <NoPublicEvent />;
  if (events.length === 1) return <EventLanding eventSeed={events[0]} />;

  return (
    <div className="min-h-screen bg-[#070707] text-white">
      <PublicNav />
      <section className="relative min-h-[54svh] overflow-hidden">
        <img src={FALLBACK_HERO} alt="" className="absolute inset-0 h-full w-full object-cover opacity-65" />
        <div className="absolute inset-0 bg-black/65" />
        <div className="relative mx-auto flex min-h-[54svh] max-w-6xl flex-col justify-end px-6 pb-12 pt-24">
          <div className="text-[10px] uppercase text-[#ffcc00]">Event Publik</div>
          <h1 className="mt-3 max-w-3xl text-4xl font-extrabold uppercase leading-none md:text-6xl">Pilih event pencak silat</h1>
          <p className="mt-4 max-w-2xl text-sm leading-6 text-zinc-300">Setiap event memiliki halaman publik sendiri untuk informasi, pendaftaran peserta, cek status, dan tampilan gelanggang.</p>
        </div>
      </section>
      <section className="mx-auto max-w-6xl px-6 py-10">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {events.map((event) => (
            <Link key={event.id} to={`/event/${event.slug}`} className="group border border-white/10 bg-[#111] p-5 transition-colors hover:border-[#ffcc00]" data-testid={`public-event-${event.slug}`}>
              <div className="flex items-start gap-4">
                <div className="h-20 w-28 shrink-0 overflow-hidden bg-[#1b1b1b]">
                  <img src={heroUrl(event)} alt="" className="h-full w-full object-cover transition-transform group-hover:scale-105" />
                </div>
                <div className="min-w-0">
                  <div className="text-[10px] uppercase text-[#ffcc00]">{event.status || "active"}</div>
                  <h2 className="mt-1 text-xl font-bold uppercase leading-tight">{event.landing_title || event.name}</h2>
                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-400">
                    <span className="inline-flex items-center gap-1"><MapPin className="h-3.5 w-3.5" />{event.location || "-"}</span>
                    <span className="inline-flex items-center gap-1"><CalendarDays className="h-3.5 w-3.5" />{dateRange(event)}</span>
                  </div>
                </div>
              </div>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}

export function EventLandingPage() {
  const { slug } = useParams();
  return <EventLanding slug={slug} />;
}

function EventLanding({ slug, eventSeed }) {
  const [event, setEvent] = useState(eventSeed || null);
  const [categories, setCategories] = useState([]);
  const [classes, setClasses] = useState([]);
  const [arenas, setArenas] = useState([]);
  const [loading, setLoading] = useState(!eventSeed);

  useEffect(() => {
    if (eventSeed) return;
    const endpoint = slug ? `/public/events/${slug}` : "/public/events/current";
    setLoading(true);
    api.get(endpoint)
      .then((r) => setEvent(r.data))
      .catch(() => setEvent(null))
      .finally(() => setLoading(false));
  }, [slug, eventSeed]);

  useEffect(() => {
    if (!event?.id) return;
    Promise.all([
      api.get("/public/categories", { params: { event_id: event.id } }),
      api.get("/public/classes", { params: { event_id: event.id } }),
      api.get("/public/arenas", { params: { event_id: event.id } }),
    ]).then(([cat, cls, arena]) => {
      setCategories(cat.data || []);
      setClasses(cls.data || []);
      setArenas(arena.data || []);
    }).catch(() => {
      setCategories([]);
      setClasses([]);
      setArenas([]);
    });
  }, [event?.id]);

  const groupedClasses = useMemo(() => {
    const map = {};
    categories.forEach((cat) => { map[cat.id] = []; });
    classes.forEach((cls) => {
      if (map[cls.category_id]) map[cls.category_id].push(cls);
    });
    return map;
  }, [categories, classes]);

  if (loading) return <PublicLoading />;
  if (!event) return <NoPublicEvent />;

  const registrationOpen = event.registration_enabled !== false && event.status !== "closed";
  const poster = heroUrl(event);

  return (
    <div className="min-h-screen bg-[#070707] text-white">
      <PublicNav event={event} />
      <section className="relative min-h-[86svh] overflow-hidden">
        <img src={poster} alt="" className="absolute inset-0 h-full w-full object-cover" data-testid="event-hero-image" />
        <div className="absolute inset-0 bg-black/60" />
        <div className="relative mx-auto flex min-h-[86svh] max-w-6xl flex-col justify-end px-6 pb-12 pt-28">
          <div className="mb-4 inline-flex w-fit items-center gap-2 border border-[#ffcc00]/40 bg-black/45 px-3 py-1 text-[10px] uppercase text-[#ffcc00]">
            <ShieldCheck className="h-3.5 w-3.5" />
            {registrationOpen ? "Pendaftaran Dibuka" : "Pendaftaran Ditutup"}
          </div>
          <h1 className="max-w-4xl text-4xl font-extrabold uppercase leading-none md:text-7xl" data-testid="event-landing-title">
            {event.landing_title || event.name}
          </h1>
          <p className="mt-4 max-w-2xl text-base leading-7 text-zinc-200 md:text-lg">{event.landing_subtitle || event.landing_description}</p>
          {event.landing_description && (
            <p className="mt-3 max-w-2xl text-sm leading-6 text-zinc-300">{event.landing_description}</p>
          )}

          <div className="mt-7 flex flex-wrap gap-3">
            {registrationOpen ? (
              <Button asChild className="h-12 bg-[#ffcc00] px-5 text-black hover:bg-[#e6b800]">
                <Link to={`/event/${event.slug}/register`} data-testid="event-register-cta">
                  <UserPlus className="h-4 w-4" />
                  Daftar Peserta
                </Link>
              </Button>
            ) : (
              <Button disabled className="h-12 bg-zinc-700 px-5 text-zinc-300">
                <Clock className="h-4 w-4" />
                Pendaftaran Ditutup
              </Button>
            )}
            <Button asChild className="h-12 border border-white/15 bg-white/10 px-5 text-white hover:bg-white/15">
              <Link to={`/event/${event.slug}/check`} data-testid="event-check-cta">
                <ClipboardCheck className="h-4 w-4" />
                Cek Status
              </Link>
            </Button>
            <Button asChild className="h-12 border border-white/15 bg-white/5 px-5 text-white hover:bg-white/10">
              <Link to="/display">
                <Monitor className="h-4 w-4" />
                Public Display
              </Link>
            </Button>
          </div>

          <div className="mt-8 flex flex-wrap gap-3 text-sm text-zinc-200">
            <InfoPill icon={MapPin} label={event.location || "-"} />
            <InfoPill icon={CalendarDays} label={dateRange(event)} />
            <InfoPill icon={Trophy} label={`${categories.length} kategori`} />
            <InfoPill icon={Users} label={`${classes.length} kelas`} />
          </div>
        </div>
      </section>

      <section className="border-y border-white/10 bg-[#0d0d0e]">
        <div className="mx-auto grid max-w-6xl grid-cols-1 gap-6 px-6 py-8 md:grid-cols-3">
          <InfoBlock icon={CalendarDays} label="Jadwal" value={event.landing_schedule_note || dateRange(event)} />
          <InfoBlock icon={CheckCircle2} label="Persyaratan" value={event.landing_requirements || "Unggah pas foto, identitas, dan surat keterangan sehat saat mendaftar."} />
          <InfoBlock icon={Phone} label="Kontak" value={event.landing_contact || "Hubungi panitia event untuk informasi tambahan."} />
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-6 py-12">
        <div className="mb-6 flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
          <div>
            <div className="text-[10px] uppercase text-[#ffcc00]">Kategori & Kelas</div>
            <h2 className="mt-2 text-3xl font-bold uppercase">Nomor yang tersedia</h2>
          </div>
          {registrationOpen && (
            <Link to={`/event/${event.slug}/register`} className="inline-flex items-center gap-2 text-sm text-[#ffcc00] hover:underline">
              Mulai pendaftaran <ArrowRight className="h-4 w-4" />
            </Link>
          )}
        </div>

        {categories.length ? (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {categories.map((cat) => (
              <article key={cat.id} className="border border-white/10 bg-[#111] p-5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-[10px] uppercase text-zinc-500">{cat.type} · {cat.gender}</div>
                    <h3 className="mt-1 text-xl font-semibold uppercase">{cat.name}</h3>
                    <div className="mt-1 text-xs text-zinc-400">{cat.age_group || "Umum"}</div>
                  </div>
                  {cat.quota > 0 && <div className="border border-[#ffcc00]/40 px-2 py-1 text-[10px] uppercase text-[#ffcc00]">Kuota {cat.quota}</div>}
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  {(groupedClasses[cat.id] || []).length ? groupedClasses[cat.id].map((cls) => (
                    <span key={cls.id} className="border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-zinc-300">
                      {cls.name}
                    </span>
                  )) : (
                    <span className="text-xs text-zinc-500">Kelas belum ditentukan</span>
                  )}
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="border border-dashed border-white/10 px-6 py-10 text-center text-sm text-zinc-500">Kategori belum dipublikasikan oleh admin.</div>
        )}
      </section>

      <section className="mx-auto max-w-6xl px-6 pb-14">
        <div className="flex flex-col gap-4 border border-white/10 bg-[#111] p-6 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="text-[10px] uppercase text-[#ffcc00]">Gelanggang</div>
            <div className="mt-1 text-2xl font-bold uppercase">{arenas.length ? `${arenas.length} gelanggang siap ditampilkan` : "Gelanggang belum ditentukan"}</div>
            <p className="mt-2 text-sm text-zinc-400">Tampilan publik live scoreboard tetap tersedia untuk penonton dan panitia.</p>
          </div>
          <Button asChild className="h-11 bg-white/10 text-white hover:bg-white/15">
            <Link to="/display">
              <Monitor className="h-4 w-4" />
              Buka Display
            </Link>
          </Button>
        </div>
      </section>
    </div>
  );
}

function PublicNav({ event }) {
  return (
    <header className="fixed inset-x-0 top-0 z-40 border-b border-white/10 bg-black/65 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-4 px-6">
        <Link to="/" className="flex items-center gap-3">
          <div className="grid h-9 w-9 place-items-center bg-[#ffcc00] text-xl font-black text-black">S</div>
          <div>
            <div className="text-sm font-bold uppercase leading-none">Silat Scoring</div>
            <div className="mt-1 text-[10px] uppercase text-zinc-500">{event?.name || "Event Publik"}</div>
          </div>
        </Link>
        <nav className="ml-auto flex items-center gap-2">
          {event?.slug && (
            <>
              <Link to={`/event/${event.slug}/register`} className="hidden text-xs uppercase text-zinc-300 hover:text-[#ffcc00] sm:inline">Daftar</Link>
              <Link to={`/event/${event.slug}/check`} className="hidden text-xs uppercase text-zinc-300 hover:text-[#ffcc00] sm:inline">Cek Status</Link>
            </>
          )}
          <Link to="/login" className="inline-flex items-center gap-2 border border-white/10 px-3 py-2 text-xs uppercase text-zinc-300 hover:border-[#ffcc00] hover:text-[#ffcc00]">
            <LogIn className="h-3.5 w-3.5" />
            Login
          </Link>
        </nav>
      </div>
    </header>
  );
}

function InfoPill({ icon: Icon, label }) {
  return (
    <span className="inline-flex items-center gap-2 border border-white/15 bg-black/35 px-3 py-2">
      <Icon className="h-4 w-4 text-[#ffcc00]" />
      {label}
    </span>
  );
}

function InfoBlock({ icon: Icon, label, value }) {
  return (
    <div className="flex gap-3">
      <Icon className="mt-1 h-5 w-5 shrink-0 text-[#ffcc00]" />
      <div>
        <div className="text-[10px] uppercase text-zinc-500">{label}</div>
        <div className="mt-1 text-sm leading-6 text-zinc-200">{value}</div>
      </div>
    </div>
  );
}

function PublicLoading() {
  return (
    <div className="grid min-h-screen place-items-center bg-[#070707] text-white">
      <div className="text-sm uppercase text-zinc-500">Memuat event...</div>
    </div>
  );
}

function NoPublicEvent() {
  return (
    <div className="min-h-screen bg-[#070707] text-white">
      <PublicNav />
      <div className="mx-auto flex min-h-screen max-w-3xl flex-col items-center justify-center px-6 text-center">
        <Trophy className="h-14 w-14 text-zinc-700" />
        <h1 className="mt-5 text-3xl font-bold uppercase">Belum ada event publik</h1>
        <p className="mt-3 text-sm leading-6 text-zinc-400">Admin dapat mengaktifkan landing page event dari Master Data, lalu halaman ini akan menampilkan event tersebut.</p>
        <Button asChild className="mt-6 bg-[#ffcc00] text-black hover:bg-[#e6b800]">
          <Link to="/login">Login Admin</Link>
        </Button>
      </div>
    </div>
  );
}

function heroUrl(event) {
  return resolvePhotoUrl(event?.landing_poster_url || event?.logo_url || FALLBACK_HERO) || FALLBACK_HERO;
}

function dateRange(event) {
  const start = formatDate(event?.start_date);
  const end = formatDate(event?.end_date);
  if (start && end) return `${start} - ${end}`;
  return start || end || "Tanggal menyusul";
}

function formatDate(value) {
  if (!value) return "";
  try {
    return new Date(value).toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" });
  } catch {
    return value;
  }
}
