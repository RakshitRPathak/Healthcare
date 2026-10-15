import type { PostContent, PreContent, Summary } from '../types';
import { Badge } from '../ui';

const List = ({ title, items, tone }: { title: string; items: string[]; tone?: 'warn' }) => items.length === 0 ? null : (
  <div>
    <h4 className={`text-xs font-semibold uppercase tracking-wide ${tone === 'warn' ? 'text-amber-700' : 'text-slate-500'}`}>{title}</h4>
    <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm text-slate-700">{items.map((x, i) => <li key={i}>{x}</li>)}</ul>
  </div>
);

export const SourceBadge = ({ s }: { s: Summary }) =>
  s.status === 'PENDING' || !s.content ? <Badge tone="amber">generating…</Badge>
  : s.source === 'doctor' ? <Badge tone="teal">edited by doctor</Badge>
  : s.source === 'llm' ? <Badge tone="blue">AI-drafted</Badge>
  : <Badge tone="slate">auto summary (AI unavailable)</Badge>;

export function PreView({ c }: { c: PreContent }) {
  return (
    <div className="space-y-3">
      <div><h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Chief complaint</h4><p className="text-sm text-slate-800">{c.chiefComplaint}</p></div>
      <List title="Flags" items={c.flags} tone="warn" />
      <List title="Allergies" items={c.allergies} />
      <List title="Relevant history" items={c.relevantHistory} />
      <List title="Current medications" items={c.currentMedications} />
      <List title="Suggested questions" items={c.suggestedQuestions} />
    </div>
  );
}

export function PostView({ c }: { c: PostContent }) {
  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-800">{c.summary}</p>
      {c.findings && <div><h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Findings</h4><p className="text-sm text-slate-700">{c.findings}</p></div>}
      <List title="What to do" items={c.instructions} />
      {c.medications.length > 0 && <div>
        <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Medications</h4>
        <ul className="mt-1 space-y-1 text-sm text-slate-700">{c.medications.map((m, i) => <li key={i}><strong>{m.name}</strong> · {m.dosage} · {m.howToTake}</li>)}</ul></div>}
      {c.followUp && <div><h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Follow-up</h4><p className="text-sm text-slate-700">{c.followUp}</p></div>}
      <List title="Get care urgently if" items={c.whenToSeekCare} tone="warn" />
    </div>
  );
}
