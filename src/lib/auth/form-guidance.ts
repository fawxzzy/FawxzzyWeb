/**
 * Client-side input rules for the account forms. The words shown for a broken rule live in the copy
 * matrix (`copy-matrix.ts`); `auth-outcomes.ts` maps each rule to its line. These rules never reveal
 * whether an account exists.
 */

export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const USERNAME_PATTERN = /^[A-Za-z0-9._-]{2,15}$/;
