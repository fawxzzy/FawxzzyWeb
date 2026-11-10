import { PASSWORD_MINIMUM, validatePassword } from "@/lib/auth/password-policy";

/**
 * Plain-language guidance for account form problems.
 *
 * Every message says what is needed, not just that something is wrong. These are
 * client-side input rules only: they never reveal whether an account exists, so the
 * generic provider-error copy in `errors.ts` stays the only text for server outcomes.
 */

export type GuidanceField = "username" | "email" | "password" | "confirmation";

export type GuidanceProblem = {
  field: GuidanceField;
  message: string;
};

export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const USERNAME_PATTERN = /^[A-Za-z0-9._-]{2,15}$/;

const EMAIL_HINT = "Use a full address, like name@example.com.";

export function guidanceForCredentials(input: {
  intent: "login" | "signup";
  email: string;
  password: string;
  username: string;
}): GuidanceProblem[] {
  const problems: GuidanceProblem[] = [];

  if (input.intent === "signup") {
    if (!input.username) {
      problems.push({ field: "username", message: "Choose a username." });
    } else if (!USERNAME_PATTERN.test(input.username)) {
      problems.push({
        field: "username",
        message:
          "Username: 2 to 15 letters, numbers, dots, dashes or underscores. No spaces.",
      });
    }
  }

  if (!input.email) {
    problems.push({
      field: "email",
      message: input.intent === "login" ? "Enter your email or username." : "Enter your email address.",
    });
  } else if (input.intent === "signup" && !EMAIL_PATTERN.test(input.email)) {
    problems.push({ field: "email", message: `That email is incomplete. ${EMAIL_HINT}` });
  }

  const password = validatePassword(input.password, input.intent);
  if (!password.valid) problems.push({ field: "password", message: password.message });

  return problems;
}

export function guidanceForResetRequest(email: string): GuidanceProblem[] {
  if (!email) {
    return [{ field: "email", message: "Enter the email address for your account." }];
  }
  if (!EMAIL_PATTERN.test(email)) {
    return [{ field: "email", message: `That email is incomplete. ${EMAIL_HINT}` }];
  }
  return [];
}

export function guidanceForNewPassword(password: string, confirmation: string): GuidanceProblem[] {
  const problems: GuidanceProblem[] = [];

  if (!password) {
    problems.push({
      field: "password",
      message: `Enter a new password of at least ${PASSWORD_MINIMUM} characters.`,
    });
  } else {
    const validation = validatePassword(password, "reset");
    if (!validation.valid) problems.push({ field: "password", message: validation.message });
  }

  if (!confirmation) {
    problems.push({ field: "confirmation", message: "Type the new password again in Confirm password." });
  } else if (password !== confirmation) {
    problems.push({
      field: "confirmation",
      message: "The two passwords do not match. Type the same password in both boxes.",
    });
  }

  return problems;
}
