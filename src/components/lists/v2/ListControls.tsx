import { Check, ChevronDown } from 'lucide-react';
import { VIEW_ICONS } from './viewIcons';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { ListView, ViewOption } from '@/lib/listPresets';
import { cn } from '@/lib/utils';

export interface Segment { id: string; label: string; count: number }

/**
 * Statuses as a segmented control. Two or three fit side by side even at 320 pt; more scroll
 * sideways as pills, so long status sets never squash or wrap.
 */
export function StatusSegments({ segments, value, onChange }: { segments: Segment[]; value: string | null; onChange: (id: string) => void }) {
  if (segments.length <= 3) {
    return (
      <div role="tablist" aria-label="Status" className="grid gap-1 rounded-2xl bg-muted p-1" style={{ gridTemplateColumns: `repeat(${segments.length}, minmax(0, 1fr))` }}>
        {segments.map((s) => {
          const active = s.id === value;
          return (
            <button
              key={s.id} type="button" role="tab" aria-selected={active} aria-label={`${s.label}, ${s.count}`} onClick={() => onChange(s.id)}
              className={cn('min-w-0 rounded-xl px-2 py-2 text-sm font-medium transition-all duration-200 active-press', active ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground')}
            >
              <span className="block truncate">{s.label}</span>
              <span className={cn('block text-[11px] tabular-nums', active ? 'text-muted-foreground' : 'text-muted-foreground/80')}>{s.count}</span>
            </button>
          );
        })}
      </div>
    );
  }
  return (
    <div role="tablist" aria-label="Status" className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 no-scrollbar">
      {segments.map((s) => (
        <Chip key={s.id} active={s.id === value} onClick={() => onChange(s.id)} role="tab" ariaLabel={`${s.label}, ${s.count}`}>
          {s.label} <span className="ml-1 tabular-nums opacity-70">{s.count}</span>
        </Chip>
      ))}
    </div>
  );
}

export function Chip({ active, onClick, children, role, className, ariaLabel }: { active?: boolean; onClick: () => void; children: React.ReactNode; role?: string; className?: string; ariaLabel?: string }) {
  return (
    <button
      type="button" role={role} aria-label={ariaLabel} aria-selected={role === 'tab' ? !!active : undefined} aria-pressed={role ? undefined : !!active} onClick={onClick}
      className={cn(
        'inline-flex h-9 shrink-0 items-center whitespace-nowrap rounded-full border px-3.5 text-sm font-medium transition-colors duration-150 active-press',
        active ? 'border-foreground bg-foreground text-background' : 'border-border bg-card text-foreground hover:bg-muted',
        className,
      )}
    >
      {children}
    </button>
  );
}

export interface CategoryChip { id: string; label: string; icon?: string | null }

/** "All", each category, and "No category" when some items have none. Single choice; scrolls sideways. */
export function CategoryChips({ chips, value, onChange, trailing }: { chips: CategoryChip[]; value: string | null; onChange: (id: string | null) => void; trailing?: React.ReactNode }) {
  return (
    <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 no-scrollbar" aria-label="Filter by category">
      <Chip active={value === null} onClick={() => onChange(null)}>All</Chip>
      {chips.map((c) => (
        <Chip key={c.id} active={value === c.id} onClick={() => onChange(value === c.id ? null : c.id)}>
          {c.icon && <span className="mr-1.5" aria-hidden>{c.icon}</span>}
          {c.label}
        </Chip>
      ))}
      {trailing}
    </div>
  );
}


/** The view switcher: every view this kind of list has, with a reason when one isn't usable yet. */
export function ViewMenu({ options, value, onChange }: { options: ViewOption[]; value: ListView; onChange: (v: ListView) => void }) {
  const Icon = VIEW_ICONS[value];
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" aria-label={`View: ${options.find((o) => o.view === value)?.label ?? value}. Change view`} className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border bg-card shadow-sm active-press">
          <Icon className="h-5 w-5" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" side="top" className="w-64">
        <DropdownMenuLabel className="text-xs font-medium text-muted-foreground">View</DropdownMenuLabel>
        {options.map((o) => {
          const OIcon = VIEW_ICONS[o.view];
          return (
            <DropdownMenuItem key={o.view} disabled={!o.available} onClick={() => o.available && onChange(o.view)} className="items-start gap-3 py-2.5">
              <OIcon className="mt-0.5 h-4 w-4 shrink-0" />
              <span className="min-w-0 flex-1">
                <span className="block font-medium">{o.label}</span>
                {!o.available && o.reason && <span className="block text-xs text-muted-foreground">{o.reason}</span>}
              </span>
              {o.view === value && <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" />}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export type SortKey = 'recent' | 'name' | 'rating' | 'price_asc' | 'price_desc';

export function SortChip({ value, onChange, options }: { value: SortKey; onChange: (s: SortKey) => void; options: { key: SortKey; label: string }[] }) {
  const current = options.find((o) => o.key === value) ?? options[0];
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" aria-label={`Sort: ${current.label}. Change sort`} className="inline-flex h-9 shrink-0 items-center gap-1 whitespace-nowrap rounded-full border border-dashed bg-card px-3.5 text-sm font-medium text-muted-foreground active-press">
          {current.label}
          <ChevronDown className="h-3.5 w-3.5" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel className="text-xs font-medium text-muted-foreground">Sort</DropdownMenuLabel>
        {options.map((o) => (
          <DropdownMenuItem key={o.key} onClick={() => onChange(o.key)} className="gap-2">
            <span className="flex-1">{o.label}</span>
            {o.key === value && <Check className="h-4 w-4 text-primary" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
