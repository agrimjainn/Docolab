import type { User } from "@/lib/types";
import { latency, read, remove, write } from "@/lib/api/db";
import { CURRENT_USER } from "@/lib/api/seed";

const KEY = "session";

export type Provider = "google" | "sso";

export function getCurrentUser(): User | null {
  return read<User | null>(KEY, null);
}

function establishSession(user: User): User {
  write(KEY, user);
  return user;
}

export async function signUp(input: {
  name: string;
  email: string;
  password: string;
}): Promise<User> {
  await latency(600);
  if (!input.email.includes("@")) throw new Error("Enter a valid email address.");
  if (input.password.length < 8)
    throw new Error("Password must be at least 8 characters.");
  return establishSession({
    ...CURRENT_USER,
    name: input.name || CURRENT_USER.name,
    email: input.email,
  });
}

export async function signIn(input: {
  email: string;
  password: string;
}): Promise<User> {
  await latency(500);
  if (!input.email.includes("@")) throw new Error("Enter a valid email address.");
  if (!input.password) throw new Error("Enter your password.");
  return establishSession({ ...CURRENT_USER, email: input.email });
}

export async function signInWithProvider(provider: Provider): Promise<User> {
  await latency(700);
  return establishSession({
    ...CURRENT_USER,
    email: provider === "google" ? "you@gmail.com" : "you@enterprise.sso",
  });
}

export async function signOut(): Promise<void> {
  await latency(120);
  remove(KEY);
}
