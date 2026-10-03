import { cn } from "../../class-name/index.js";
import { BaseAvatar } from "../../import.js";

export interface AvatarProps {
  // Whose face this is, for the image's alt text and the initials.
  readonly name: string;
  readonly src?: string | null;
  readonly size?: "sm" | "md";
  readonly className?: string;
}

// An image when there is one and it loads; otherwise the name's initials on --primary.
export function Avatar({ name, src, size = "md", className }: AvatarProps) {
  return (
    <BaseAvatar.Root
      className={cn(
        "ui-avatar inline-flex shrink-0 select-none items-center justify-center overflow-hidden rounded-full bg-primary font-medium text-primary-fg",
        size === "sm" ? "size-6 text-xs" : "size-8 text-sm",
        className,
      )}
    >
      {src ? <BaseAvatar.Image src={src} alt={name} className="size-full object-cover" /> : null}
      <BaseAvatar.Fallback aria-label={name}>{Avatar.initials(name)}</BaseAvatar.Fallback>
    </BaseAvatar.Root>
  );
}

// Two letters at most: the first of the first two words, else the first two of one.
Avatar.initials = (name: string): string => {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  const letters =
    words.length > 1
      ? `${words[0]?.[0] ?? ""}${words[1]?.[0] ?? ""}`
      : (words[0] ?? "").slice(0, 2);
  return letters.toUpperCase();
};
