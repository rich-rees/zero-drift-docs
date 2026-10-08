import { memo } from "react";

type BadgeProps = {
  tone: "info" | "warn";
  children?: React.ReactNode;
};

// A small coloured label.
export const Badge = memo(({ tone, children }: BadgeProps) => <span className={tone}>{children}</span>);

// Not a component: lowercase, and returns a string.
export const toneLabel = (tone: BadgeProps["tone"]) => tone.toUpperCase();
