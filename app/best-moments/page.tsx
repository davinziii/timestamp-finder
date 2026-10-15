import type { Metadata } from "next";
import { BestMoments } from "@/components/BestMoments";
import { Footer } from "@/components/Footer";
import { Header } from "@/components/Header";

export const metadata: Metadata = {
  title: "Best Moments",
  description: "Discover the most interesting moments in a YouTube video without watching the entire thing.",
};

export default function BestMomentsPage() {
  return (
    <>
      <Header
        active="/best-moments"
        title="Find the Best Moments"
        description="Discover the most interesting moments in a YouTube video without watching the entire thing."
      />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 pb-16 sm:px-6">
        <BestMoments />
      </main>
      <Footer />
    </>
  );
}
