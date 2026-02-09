import { Check, X } from 'lucide-react';
import { cn } from '@/lib/utils';

interface PasswordRequirementsProps {
  password: string;
}

interface Requirement {
  label: string;
  test: (password: string) => boolean;
}

const requirements: Requirement[] = [
  { label: 'At least 6 characters', test: (p) => p.length >= 6 },
  { label: 'Contains uppercase letter', test: (p) => /[A-Z]/.test(p) },
  { label: 'Contains lowercase letter', test: (p) => /[a-z]/.test(p) },
  { label: 'Contains a number', test: (p) => /\d/.test(p) },
];

export function getPasswordStrength(password: string): { score: number; label: string; color: string } {
  const passedCount = requirements.filter((req) => req.test(password)).length;
  
  if (passedCount === 0 || password.length === 0) {
    return { score: 0, label: '', color: '' };
  }
  if (passedCount === 1) {
    return { score: 1, label: 'Weak', color: 'bg-destructive' };
  }
  if (passedCount === 2) {
    return { score: 2, label: 'Fair', color: 'bg-amber-500' };
  }
  if (passedCount === 3) {
    return { score: 3, label: 'Good', color: 'bg-chart-4' };
  }
  return { score: 4, label: 'Strong', color: 'bg-chart-2' };
}

export function PasswordRequirements({ password }: PasswordRequirementsProps) {
  const strength = getPasswordStrength(password);
  
  if (!password) return null;

  return (
    <div className="space-y-3 mt-2">
      {/* Strength indicator bar */}
      <div className="space-y-1">
        <div className="flex gap-1">
          {[1, 2, 3, 4].map((level) => (
            <div
              key={level}
              className={cn(
                'h-1.5 flex-1 rounded-full transition-colors',
                strength.score >= level ? strength.color : 'bg-muted'
              )}
            />
          ))}
        </div>
        {strength.label && (
          <p className={cn(
            'text-xs font-medium',
            strength.score <= 1 && 'text-destructive',
            strength.score === 2 && 'text-amber-600',
            strength.score === 3 && 'text-chart-4',
            strength.score === 4 && 'text-chart-2'
          )}>
            Password strength: {strength.label}
          </p>
        )}
      </div>

      {/* Requirements checklist */}
      <ul className="space-y-1">
        {requirements.map((req, index) => {
          const passed = req.test(password);
          return (
            <li
              key={index}
              className={cn(
                'flex items-center gap-2 text-xs transition-colors',
                passed ? 'text-chart-2' : 'text-muted-foreground'
              )}
            >
              {passed ? (
                <Check className="h-3 w-3" />
              ) : (
                <X className="h-3 w-3" />
              )}
              {req.label}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
