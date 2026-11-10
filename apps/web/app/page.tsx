import { ScanForm } from '@/components/views/scan-form';
import { PERSONA_DESCRIPTIONS, PERSONA_LABELS } from '@/lib/utils';

export default function Landing() {
  return (
    <>
      <section aria-labelledby="hero" className="py-8">
        <h1 id="hero" className="max-w-3xl text-4xl font-extrabold leading-tight sm:text-5xl">
          AI testers who use your website the way people with disabilities do
        </h1>
        <p className="mt-4 max-w-2xl text-xl text-muted">Six agents try to complete real tasks on your site. We confirm what they find with axe-core, show you video proof, and open a pull request with the fix. Nothing is merged without you.</p>
        <div className="mt-8">
          <ScanForm />
        </div>
      </section>

      <section aria-labelledby="personas" className="mt-12">
        <h2 id="personas" className="text-2xl font-bold">
          Who tests your site
        </h2>
        <ul className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Object.keys(PERSONA_LABELS).map((p) => (
            <li key={p} className="rounded-lg border-2 border-border p-4">
              <h3 className="font-bold">{PERSONA_LABELS[p]}</h3>
              <p className="mt-1 text-muted">{PERSONA_DESCRIPTIONS[p]}</p>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="how" className="mt-12">
        <h2 id="how" className="text-2xl font-bold">
          How it works
        </h2>
        <ol className="mt-4 list-decimal space-y-2 pl-6 text-lg">
          <li>Enter your address and pick the tasks that matter, such as checkout or sign-up.</li>
          <li>Each agent attempts the task, and every problem it reports is checked against axe-core.</li>
          <li>Review findings with video, then generate a fix and open a pull request.</li>
        </ol>
      </section>
    </>
  );
}
