import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function hasAnalyzableInput(
  links: object | null | undefined,
  resumeFileName?: string | null,
): boolean {
  const values = links ? Object.values(links as Record<string, unknown>) : [];
  const hasLink = values.some((value) => typeof value === 'string' && value.trim().length > 0);
  return hasLink || Boolean(resumeFileName && resumeFileName.trim());
}
