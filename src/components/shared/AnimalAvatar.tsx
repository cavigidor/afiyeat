import { cn } from '@/lib/utils';
import { DEFAULT_ANIMAL_AVATAR } from '@/lib/animalAvatars';

interface AnimalAvatarProps {
  emoji?: string | null;
  color?: string | null;
  /** Sizing classes for the outer circle, e.g. "h-10 w-10". Defaults to h-10 w-10. */
  className?: string;
  /** Sizing classes for the emoji glyph itself, e.g. "text-lg". Defaults to text-lg. */
  emojiClassName?: string;
}

// Drop-in replacement for the old <Avatar><AvatarImage/><AvatarFallback/></Avatar>
// pattern used for profile pictures. Renders a plain emoji on a flat color
// background instead of an uploaded photo - no Storage fetch, no signed
// URL, nothing that can silently fail to load.
export function AnimalAvatar({ emoji, color, className, emojiClassName }: AnimalAvatarProps) {
  return (
    <div
      className={cn(
        'relative flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full',
        className,
      )}
      style={{ backgroundColor: color || DEFAULT_ANIMAL_AVATAR.color }}
    >
      <span className={cn('leading-none text-lg', emojiClassName)} aria-hidden="true">
        {emoji || DEFAULT_ANIMAL_AVATAR.emoji}
      </span>
    </div>
  );
}
