export const PASSWORD_MINIMUM = 10;

export type PasswordAction = "login" | "signup" | "reset" | "change";

export type PasswordValidation =
  | { valid: true }
  | { valid: false; message: string };

export function validatePassword(
  password: string,
  action: PasswordAction,
): PasswordValidation {
  if (!password) {
    return { valid: false, message: "Enter your password." };
  }

  if (action !== "login" && password.length < PASSWORD_MINIMUM) {
    return {
      valid: false,
      message: `Use at least ${PASSWORD_MINIMUM} characters. Longer passphrases are welcome.`,
    };
  }

  return { valid: true };
}
