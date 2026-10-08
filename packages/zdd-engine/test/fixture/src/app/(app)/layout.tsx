// src/app/(app)/layout.tsx
// Signed-in layout — the app chrome around the (app) route group.
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return <main>{children}</main>;
}
