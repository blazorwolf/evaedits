import Link from "next/link";

export default function Home() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 p-4 text-center">
      <h1 className="text-3xl font-semibold">evaedits</h1>
      <p className="max-w-sm text-neutral-500">
        One app. Every creative tool. From inspiration to final post.
      </p>
      <Link href="/editor" className="rounded-full bg-black px-6 py-3 text-white dark:bg-white dark:text-black">
        Open video editor
      </Link>
    </main>
  );
}
