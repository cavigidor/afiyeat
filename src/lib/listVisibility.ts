/**
 * Who can see a custom list - stored as custom_lists.visibility and
 * enforced by the database (see the 20261030120000 migration). The labels
 * are worded for the account the person actually has.
 *
 *   'profile'   - follows the profile, as every list always has: everyone
 *                 for a public account, approved followers for a private one.
 *   'private'   - only the owner.
 *   'anonymous' - the owner, plus anyone on Afiyeat through Explore, with
 *                 no name attached (offered to private accounts).
 */
export type ListVisibility = 'profile' | 'private' | 'anonymous';

export const DEFAULT_LIST_VISIBILITY: ListVisibility = 'profile';

export interface VisibilityOption {
  value: ListVisibility;
  label: string;
  description: string;
  icon: string;
}

export function visibilityOptions(isPrivateAccount: boolean, current?: ListVisibility | null): VisibilityOption[] {
  const profile: VisibilityOption = isPrivateAccount
    ? {
        value: 'profile',
        label: 'Followers only',
        description: 'People you have approved to follow you can see it, with your name.',
        icon: '👥',
      }
    : {
        value: 'profile',
        label: 'Visible to everyone',
        description: 'Anyone on Afiyeat can find it in Explore and on your profile, with your name.',
        icon: '🌐',
      };
  const anonymous: VisibilityOption = {
    value: 'anonymous',
    label: 'Discoverable anonymously',
    description: 'Anyone on Afiyeat can find it in Explore. Your name and profile are never shown.',
    icon: '🕶️',
  };
  const onlyMe: VisibilityOption = {
    value: 'private',
    label: 'Only me',
    description: 'Nobody else can see it - not followers, not Explore.',
    icon: '🔒',
  };
  // Anonymous sharing is for private accounts: on a public account the
  // list would sit next to your name anyway. A list that is already
  // anonymous keeps the option so its setting is always shown truthfully.
  return isPrivateAccount || current === 'anonymous' ? [profile, anonymous, onlyMe] : [profile, onlyMe];
}

/** Short label for a list header chip. */
export function visibilityChip(visibility: ListVisibility | null | undefined, isPrivateAccount: boolean) {
  const v = visibility ?? DEFAULT_LIST_VISIBILITY;
  return visibilityOptions(isPrivateAccount, v).find((o) => o.value === v)!;
}

/** What an anonymous list shows and never shows - used by the consent and the preview. */
export const ANONYMOUS_SHOWN = ['List name and icon', 'Item names', 'Statuses and types', 'Ratings (if the list uses them)'];
export const ANONYMOUS_HIDDEN = [
  'Your name, username and profile',
  'Notes',
  'Photos',
  'Addresses and map locations',
  'Prices',
  'When you added things',
];
