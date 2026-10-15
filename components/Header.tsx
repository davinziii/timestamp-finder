import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";

const TOOLS = [
  { href: "/", label: "Timestamp Finder" },
  { href: "/best-moments", label: "Best Moments" },
] as const;

export type ToolHref = (typeof TOOLS)[number]["href"];

export function Header({
  active,
  title,
  description,
}: {
  active: ToolHref;
  title: string;
  description: ReactNode;
}) {
  return (
    <header className="mx-auto w-full max-w-3xl px-4 pt-10 pb-8 sm:px-6 sm:pt-14">
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
        <Link href="/" className="flex items-center gap-2.5">
          <Image src="/logo.png" alt="" width={32} height={32} priority className="size-8 shrink-0" />
          <span className="font-mono text-xs tracking-wider text-muted uppercase">ClipFinder</span>
        </Link>
        <nav aria-label="Tools" className="inline-flex rounded-md border border-line bg-surface-2 p-0.5">
          {TOOLS.map((t) => (
            <Link
              key={t.href}
              href={t.href}
              aria-current={t.href === active ? "page" : undefined}
              className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
                t.href === active ? "bg-surface text-fg shadow-sm" : "text-muted hover:text-fg"
              }`}
            >
              {t.label}
            </Link>
          ))}
        </nav>
      </div>
      <h1 className="mt-6 text-3xl font-semibold tracking-tight text-balance sm:text-4xl">{title}</h1>
      <p className="mt-3 max-w-xl text-[15px] leading-relaxed text-muted">{description}</p>
    </header>
  );
}
