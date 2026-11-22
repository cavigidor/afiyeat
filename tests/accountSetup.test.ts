import { describe, expect, it } from 'vitest';
import {
  canDiscardNewAccount,
  createdWithSocialProvider,
  setupNeeds,
  suggestDisplayName,
  suggestUsername,
  validateUsername,
} from '@/lib/accountSetup';

const emailUser = { app_metadata: { provider: 'email', providers: ['email'] }, user_metadata: { username: 'old' } };
const linkedEmailUser = { app_metadata: { provider: 'email', providers: ['email', 'google'] }, user_metadata: {} };
const newGoogle = {
  app_metadata: { provider: 'google', providers: ['google'] },
  user_metadata: { full_name: 'Ada Lovelace', name: 'Ada Lovelace' },
  email: 'ada.lovelace@gmail.com',
  identities: [{ provider: 'google' }],
};
const newApple = {
  app_metadata: { provider: 'apple', providers: ['apple'] },
  user_metadata: {},
  email: 'x7q2m9@privaterelay.appleid.com',
  identities: [{ provider: 'apple' }],
};

describe('who goes through setup', () => {
  it('never email accounts, even with no username or a linked Google', () => {
    expect(createdWithSocialProvider(emailUser)).toBe(false);
    expect(setupNeeds(emailUser, { username: null })).toBeNull();
    expect(setupNeeds(linkedEmailUser, { username: null })).toBeNull();
  });

  it('new Apple/Google accounts until they have a username and accepted the Terms', () => {
    expect(setupNeeds(newGoogle, { username: null })).toEqual({ username: true, terms: true });
    expect(setupNeeds(newApple, null)).toEqual({ username: true, terms: true });
    const withName = setupNeeds(newGoogle, { username: 'ada' });
    expect(withName).toEqual({ username: false, terms: true });
    const accepted = { ...newGoogle, user_metadata: { ...newGoogle.user_metadata, terms_accepted_at: '2026-11-22T00:00:00Z' } };
    expect(setupNeeds(accepted, { username: '  ' })).toEqual({ username: true, terms: false });
    expect(setupNeeds(accepted, { username: 'ada' })).toBeNull();
  });

  it('nobody when signed out', () => {
    expect(setupNeeds(null, null)).toBeNull();
  });
});

describe('username', () => {
  it('uses the same limits as sign-up', () => {
    expect(validateUsername('ab')).toMatch(/at least 3/);
    expect(validateUsername('a'.repeat(21))).toMatch(/20/);
    expect(validateUsername('  ada  ')).toBeNull();
  });

  it('suggests from a real email, never from Hide My Email', () => {
    expect(suggestUsername(newGoogle)).toBe('adalovelace');
    expect(suggestUsername(newApple)).toBe('');
    expect(suggestUsername({ ...newApple, user_metadata: { full_name: 'José Núñez' } })).toBe('josenunez');
  });

  it('suggests a display name from the provider name', () => {
    expect(suggestDisplayName(newGoogle)).toBe('Ada Lovelace');
    expect(suggestDisplayName(newApple)).toBe('');
  });
});

describe('removing a mistaken new account', () => {
  it('is offered only for a fresh Apple/Google account without a username', () => {
    expect(canDiscardNewAccount(newApple, { username: true, terms: true })).toBe(true);
    expect(canDiscardNewAccount(newApple, { username: false, terms: true })).toBe(false);
    expect(canDiscardNewAccount(newApple, null)).toBe(false);
    expect(canDiscardNewAccount(emailUser as never, { username: true, terms: true })).toBe(false);
  });

  it('never for an account that also has an email sign-in', () => {
    const mixed = { ...newGoogle, app_metadata: { provider: 'google', providers: ['google', 'email'] } };
    expect(canDiscardNewAccount(mixed, { username: true, terms: true })).toBe(false);
    const withEmailIdentity = { ...newGoogle, identities: [{ provider: 'google' }, { provider: 'email' }] };
    expect(canDiscardNewAccount(withEmailIdentity as never, { username: true, terms: true })).toBe(false);
  });
});
