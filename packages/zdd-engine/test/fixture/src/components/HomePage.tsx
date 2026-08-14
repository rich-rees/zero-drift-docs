// Client-side things list — fetches the catalogue and renders it.
"use client";
import { useEffect, useState } from "react";

export function HomePage() {
  const [things, setThings] = useState([]);
  useEffect(() => {
    fetch("/api/things")
      .then((r) => r.json())
      .then(setThings);
  }, []);
  return (
    <ul>
      {things.map((t: { id: string; title: string }) => (
        <li key={t.id}>{t.title}</li>
      ))}
    </ul>
  );
}
