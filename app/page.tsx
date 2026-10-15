import type { Metadata } from "next";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { TimestampFinder } from "@/components/TimestampFinder";

export const metadata: Metadata = {
  // The root layout's title template only applies to child segments.
  title: "Timestamp Finder · ClipFinder",
};

export default function Home() {
  return (
    <>
      <Header
        active="/"
        title="Find exact moments in long-form YouTube videos."
        description={
          <>
            Paste a video and the lines you&rsquo;re looking for. Get a timestamp for every one, without scrubbing
            through hours of footage.
          </>
        }
      />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 pb-16 sm:px-6">
        <TimestampFinder />
      </main>
      <Footer />
    </>
  );
}
