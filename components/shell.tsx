"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Compass,
  Bookmark,
  UserRound,
  ArrowUpRight,
  Sparkles,
} from "lucide-react";
export function Brand() {
  return (
    <Link href="/" className="brand" aria-label="Whimway home">
      <span className="brand-mark">
        <Sparkles size={23} />
      </span>
      whimway<span className="brand-dot">.</span>
    </Link>
  );
}
export function Shell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const nav = [
    { href: "/", name: "Explore", Icon: Compass },
    { href: "/saved", name: "Saved", Icon: Bookmark },
    { href: "/profile", name: "Profile", Icon: UserRound },
  ];
  return (
    <>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header className="site-header">
        <div className="header-inner">
          <Brand />
          <nav aria-label="Primary navigation">
            {nav.map(({ href, name, Icon }) => (
              <Link
                className={`nav-link ${path === href ? "active" : ""}`}
                href={href}
                key={href}
                aria-current={path === href ? "page" : undefined}
              >
                <Icon size={18} />
                {name}
              </Link>
            ))}
          </nav>
          <Link href="/create" className="header-cta">
            Make a little adventure
            <ArrowUpRight size={16} />
          </Link>
        </div>
      </header>
      <main id="main">{children}</main>
      <footer className="site-footer">
        <div>
          <Brand />
          <span>Good plans start anywhere.</span>
        </div>
        <div>
          <Link href="/privacy">Privacy</Link>
          <Link href="/terms">Terms</Link>
          <span>Made for the days in between.</span>
        </div>
      </footer>
      <nav className="mobile-nav" aria-label="Mobile navigation">
        {nav.map(({ href, name, Icon }) => (
          <Link
            className={path === href ? "active" : ""}
            href={href}
            key={href}
          >
            <Icon size={21} />
            <span>{name}</span>
          </Link>
        ))}
      </nav>
    </>
  );
}
