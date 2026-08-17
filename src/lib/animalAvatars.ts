// Preset avatars: plain Unicode emoji on a flat color background - no
// Storage upload, no signed URL, no copyright risk (unlike custom-drawn
// mascots). Mirrors the emoji+color pattern already used for folders/list
// types (see FOLDER_COLORS in useFolderManagement.ts). Keep this list at
// exactly 10 entries and don't reorder/remove existing ones - the avatar
// presets migration backfills every existing user to one of these emoji by
// index, and profiles.avatar_emoji stores the emoji itself.
export interface AnimalAvatarPreset {
  id: string;
  emoji: string;
  color: string;
  label: string;
}

export const ANIMAL_AVATARS: AnimalAvatarPreset[] = [
  { id: 'dog', emoji: '🐶', color: '#E91E63', label: 'Dog' },
  { id: 'cat', emoji: '🐱', color: '#9C27B0', label: 'Cat' },
  { id: 'fox', emoji: '🦊', color: '#FF9800', label: 'Fox' },
  { id: 'bear', emoji: '🐻', color: '#795548', label: 'Bear' },
  { id: 'panda', emoji: '🐼', color: '#37474F', label: 'Panda' },
  { id: 'koala', emoji: '🐨', color: '#607D8B', label: 'Koala' },
  { id: 'tiger', emoji: '🐯', color: '#FF5722', label: 'Tiger' },
  { id: 'lion', emoji: '🦁', color: '#FFC107', label: 'Lion' },
  { id: 'frog', emoji: '🐸', color: '#4CAF50', label: 'Frog' },
  { id: 'monkey', emoji: '🐵', color: '#8D6E63', label: 'Monkey' },
];

export const DEFAULT_ANIMAL_AVATAR = ANIMAL_AVATARS[0];
