"use client";

export default function ErrorPage({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="rounded-md border border-loss/40 bg-loss-soft px-4 py-6 text-sm">
      <p className="font-medium text-loss">This page could not load its data.</p>
      <p className="mt-1 text-text-2">Nothing has been substituted for the missing data. Try again, or check provider health on the Admin page.</p>
      <button type="button" onClick={reset} className="mt-3 text-accent underline">Try again</button>
    </div>
  );
}
