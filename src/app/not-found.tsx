import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-4 text-center">
      <h1 className="text-xl font-semibold">Not found</h1>
      <p className="mt-2 text-sm text-text-2">That page or symbol is not in Verde Dhan's analysed universe.</p>
      <Link href="/" className="mt-4 text-sm text-accent underline">Back to the dashboard</Link>
    </main>
  );
}
