import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { TimestampFinder } from "@/components/TimestampFinder";

export default function Home() {
  return (
    <>
      <Header />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 pb-16 sm:px-6">
        <TimestampFinder />
      </main>
      <Footer />
    </>
  );
}
