import Image from "next/image";

export function Header() {
  return (
    <header className="mx-auto w-full max-w-3xl px-4 pt-12 pb-8 sm:px-6 sm:pt-16">
      <div className="flex items-center gap-2.5">
        <Image src="/logo.png" alt="" width={32} height={32} priority className="size-8 shrink-0" />
        <span className="font-mono text-xs tracking-wider text-muted uppercase">Timestamp Finder</span>
      </div>
      <h1 className="mt-5 text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
        Find exact moments in long-form YouTube videos.
      </h1>
      <p className="mt-3 max-w-xl text-[15px] leading-relaxed text-muted">
        Paste a video and the lines you&rsquo;re looking for. Get a timestamp for every one, without
        scrubbing through hours of footage.
      </p>
    </header>
  );
}
