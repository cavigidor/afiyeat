import { useState } from 'react';
import { ChevronDown, Plus, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { uiOf, type FieldDef } from '@/lib/presetFields';
import type { FieldValue, ItemValues } from '@/lib/itemDetails';
import { cn } from '@/lib/utils';

interface DetailsFieldsProps {
  /** Already filtered to what this item should offer (see visibleFields). */
  fields: FieldDef[];
  values: ItemValues;
  onChange: (key: string, value: FieldValue | undefined) => void;
  errors?: Record<string, string>;
}

const CHIP_LIMIT = 8;

/**
 * An item's preset fields, compact: the main ones straight away, the rest behind one "More details" row.
 * Every field is optional. Opens by itself only when a "more" field already has a value, so nothing saved
 * is ever out of sight.
 */
export function DetailsFields({ fields, values, onChange, errors = {} }: DetailsFieldsProps) {
  const main = fields.filter((f) => uiOf(f).tier === 'main');
  const more = fields.filter((f) => uiOf(f).tier !== 'main');
  const moreFilled = more.filter((f) => hasValue(values[f.key])).length;
  // Open by itself while a "more" field has a saved value (values can arrive after the first render); after a tap, the person decides.
  const [chosen, setChosen] = useState<boolean | null>(null);
  const open = chosen ?? moreFilled > 0;
  if (fields.length === 0) return null;

  return (
    <div className="space-y-4" data-testid="details-fields">
      {main.map((f) => <Field key={f.key} def={f} value={values[f.key]} onChange={onChange} error={errors[f.key]} />)}
      {more.length > 0 && (
        <div className="rounded-xl border">
          <button type="button" onClick={() => setChosen(!open)} aria-expanded={open}
            className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left text-sm font-medium active-press">
            <span>
              More details
              <span className="ml-1.5 font-normal text-muted-foreground">
                {moreFilled ? `${moreFilled} filled` : more.map((f) => f.label).slice(0, 3).join(', ') + (more.length > 3 ? '…' : '')}
              </span>
            </span>
            <ChevronDown className={cn('h-4 w-4 shrink-0 text-muted-foreground transition-transform', open && 'rotate-180')} />
          </button>
          {open && (
            <div className="space-y-4 border-t px-3 py-3">
              {more.map((f) => <Field key={f.key} def={f} value={values[f.key]} onChange={onChange} error={errors[f.key]} />)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const hasValue = (v: FieldValue | undefined) => v != null && !(Array.isArray(v) && v.length === 0) && String(v).trim() !== '';

function Field({ def, value, onChange, error }: { def: FieldDef; value: FieldValue | undefined; onChange: DetailsFieldsProps['onChange']; error?: string }) {
  const ui = uiOf(def);
  const id = `field-${def.key}`;
  const label = ui.unit && def.type === 'number' ? `${def.label} (${ui.unit})` : def.label;
  return (
    <div className="space-y-1.5">
      <Label htmlFor={def.type === 'choice' || def.type === 'multi' || def.type === 'tags' ? undefined : id} id={`${id}-label`}>{label}</Label>
      {def.type === 'text' && (
        <Input id={id} value={(value as string) ?? ''} placeholder={ui.placeholder} maxLength={2000} autoComplete="off"
          onChange={(e) => onChange(def.key, e.target.value)} />
      )}
      {def.type === 'number' && (
        <Input id={id} type="number" inputMode={ui.integer ? 'numeric' : 'decimal'} step={ui.integer ? 1 : 'any'} min={ui.min} max={ui.max}
          value={typeof value === 'number' ? String(value) : ''} placeholder={ui.placeholder}
          onChange={(e) => onChange(def.key, e.target.value === '' ? undefined : Number(e.target.value))} />
      )}
      {def.type === 'date' && (
        <Input id={id} type="date" value={(value as string) ?? ''} onChange={(e) => onChange(def.key, e.target.value || undefined)} />
      )}
      {def.type === 'choice' && (
        (def.options?.length ?? 0) <= CHIP_LIMIT ? (
          <div role="radiogroup" aria-labelledby={`${id}-label`} className="flex flex-wrap gap-1.5">
            {def.options!.map((o) => (
              <Chip key={o} selected={value === o} role="radio" onClick={() => onChange(def.key, value === o ? undefined : o)}>{o}</Chip>
            ))}
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <Select value={(value as string) ?? ''} onValueChange={(v) => onChange(def.key, v)}>
              <SelectTrigger aria-labelledby={`${id}-label`}><SelectValue placeholder="Choose" /></SelectTrigger>
              <SelectContent>{def.options!.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}</SelectContent>
            </Select>
            {value != null && (
              <button type="button" aria-label={`Clear ${def.label}`} className="rounded-full p-2 text-muted-foreground active-press" onClick={() => onChange(def.key, undefined)}>
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        )
      )}
      {def.type === 'multi' && (
        <div role="group" aria-labelledby={`${id}-label`} className="flex flex-wrap gap-1.5">
          {def.options!.map((o) => {
            const list = Array.isArray(value) ? value : [];
            const on = list.includes(o);
            return <Chip key={o} selected={on} role="checkbox" onClick={() => onChange(def.key, on ? list.filter((x) => x !== o) : [...list, o])}>{o}</Chip>;
          })}
        </div>
      )}
      {def.type === 'tags' && (
        <TagsInput labelId={`${id}-label`} label={def.label} value={Array.isArray(value) ? value : []} suggestions={ui.suggestions ?? []}
          placeholder={ui.placeholder} onChange={(v) => onChange(def.key, v)} />
      )}
      {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

function Chip({ selected, children, onClick, role }: { selected: boolean; children: React.ReactNode; onClick: () => void; role: 'radio' | 'checkbox' }) {
  return (
    <button type="button" role={role} aria-checked={selected} onClick={onClick}
      className={cn('rounded-full border px-3 py-1.5 text-sm transition-colors active-press', selected ? 'border-primary bg-primary text-primary-foreground' : 'bg-background')}>
      {children}
    </button>
  );
}

/** Suggested tags to tap, plus anything typed (Enter or comma adds it). */
function TagsInput({ labelId, label, value, suggestions, placeholder, onChange }: {
  labelId: string; label: string; value: string[]; suggestions: string[]; placeholder?: string; onChange: (v: string[]) => void;
}) {
  const [draft, setDraft] = useState('');
  const lower = new Set(value.map((v) => v.toLowerCase()));
  const add = (t: string) => {
    const tag = t.trim().slice(0, 60);
    if (!tag || lower.has(tag.toLowerCase()) || value.length >= 30) return;
    onChange([...value, tag]);
  };
  const commit = () => { draft.split(',').forEach(add); setDraft(''); };
  const custom = value.filter((v) => !suggestions.some((s) => s.toLowerCase() === v.toLowerCase()));
  return (
    <div className="space-y-2" role="group" aria-labelledby={labelId}>
      {(suggestions.length > 0 || custom.length > 0) && (
        <div className="flex flex-wrap gap-1.5">
          {suggestions.map((s) => {
            const on = lower.has(s.toLowerCase());
            return <Chip key={s} selected={on} role="checkbox" onClick={() => (on ? onChange(value.filter((v) => v.toLowerCase() !== s.toLowerCase())) : add(s))}>{s}</Chip>;
          })}
          {custom.map((t) => (
            <Chip key={t} selected role="checkbox" onClick={() => onChange(value.filter((v) => v !== t))}>
              <span className="inline-flex items-center gap-1">{t}<X className="h-3 w-3" aria-hidden /></span>
            </Chip>
          ))}
        </div>
      )}
      <div className="flex items-center gap-2">
        <Input value={draft} placeholder={placeholder ?? 'Add your own'} aria-label={`Add to ${label}`} enterKeyHint="done" autoComplete="off"
          onChange={(e) => { if (e.target.value.endsWith(',')) { add(e.target.value.slice(0, -1)); setDraft(''); } else setDraft(e.target.value); }}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commit(); } }}
          onBlur={() => draft.trim() && commit()} />
        {draft.trim() && (
          <button type="button" aria-label={`Add ${draft.trim()}`} className="rounded-full border p-2 active-press" onClick={commit}><Plus className="h-4 w-4" /></button>
        )}
      </div>
    </div>
  );
}
