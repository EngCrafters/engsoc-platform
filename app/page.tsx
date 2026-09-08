export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-3 p-8 text-center">
      <p className="font-mono text-xs uppercase tracking-widest text-neutral-500">
        Engineering Society
      </p>
      <h1 className="text-2xl font-semibold">Platform, Phase 1</h1>
      <p className="max-w-md text-sm text-neutral-500">
        Building UC-01: member registration &amp; profile. See{" "}
        <code className="font-mono">docs/UC-01_Deep_Dive.pdf</code> for the
        full spec.
      </p>
    </main>
  );
}
