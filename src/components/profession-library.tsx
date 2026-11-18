"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowRight, BriefcaseBusiness, Plus, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PROFESSION_COUNT, PROFESSION_GROUPS } from "@/lib/professions";
import "@/app/profession-library.css";

const PAGE_SIZE = 30;
const normalized = (value: string) => value.normalize("NFKD").replace(/\p{Diacritic}/gu, "").toLowerCase();
const professions = PROFESSION_GROUPS.flatMap(({ category, roles }) =>
  roles.map((name) => ({ name, category, search: normalized(`${name} ${category}`) })),
).sort((a, b) => a.name.localeCompare(b.name, "en"));

export function ProfessionLibrary({ onSelect }: { onSelect: (role: string) => void }) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [visible, setVisible] = useState(PAGE_SIZE);
  const heading = useRef<HTMLHeadingElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const nextRole = useRef<HTMLButtonElement>(null);
  const focusNewRole = useRef(false);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      window.scrollTo({ top: 0, behavior: "instant" });
      heading.current?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, []);
  useEffect(() => {
    if (!focusNewRole.current) return;
    focusNewRole.current = false;
    nextRole.current?.focus();
  }, [visible]);

  const customRole = query.trim();
  const words = normalized(customRole).split(/\s+/).filter(Boolean);
  const results = professions.filter((profession) =>
    (!category || profession.category === category) && words.every((word) => profession.search.includes(word)),
  );
  const canUseCustom = customRole.length >= 2 && !professions.some(({ name }) => normalized(name) === normalized(customRole));

  function changeQuery(value: string) {
    setQuery(value);
    setVisible(PAGE_SIZE);
  }

  return (
    <section className="profession-library" aria-labelledby="profession-library-title">
      <header className="profession-library-intro">
        <span aria-hidden="true"><BriefcaseBusiness size={23} /></span>
        <div>
          <h1 ref={heading} tabIndex={-1} id="profession-library-title">Professions</h1>
          <p>Choose from {PROFESSION_COUNT} roles for planning, research, writing, and more.</p>
        </div>
      </header>
      <div className="profession-filters">
        <div className="profession-search">
          <Search size={18} aria-hidden="true" />
          <input ref={search} type="search" aria-label="Search professions" value={query} maxLength={100}
            placeholder="Search by profession or type your own role" onChange={(event) => changeQuery(event.target.value)} />
          {query && (
            <button type="button" className="icon-button" aria-label="Clear profession search" onClick={() => {
              changeQuery("");
              search.current?.focus();
            }}><X size={15} /></button>
          )}
        </div>
        <label className="profession-category-select">
          <span className="sr-only">Profession category</span>
          <select value={category} onChange={(event) => { setCategory(event.target.value); setVisible(PAGE_SIZE); }}>
            <option value="">All categories</option>
            {PROFESSION_GROUPS.map((group) => <option value={group.category} key={group.category}>{group.category}</option>)}
          </select>
        </label>
      </div>
      <div className="profession-results-heading">
        <p role="status">Showing {Math.min(visible, results.length)} of {results.length} {results.length === 1 ? "profession" : "professions"}</p>
        {canUseCustom && <Button type="button" variant="ghost" size="sm" onClick={() => onSelect(customRole)}>
          <Plus size={15} /> Use “{customRole}” as a custom role
        </Button>}
      </div>
      {results.length ? (
        <ul className="profession-results" aria-label="Profession results">
          {results.slice(0, visible).map(({ name, category: group }, index) => (
            <li key={name}>
              <button type="button" ref={index === visible - PAGE_SIZE ? nextRole : undefined} aria-label={name} onClick={() => onSelect(name)}>
                <span><strong>{name}</strong><small>{group}</small></span>
                <ArrowRight size={15} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      ) : <p className="profession-empty">No matching professions. Try a different search or use your own role.</p>}
      {visible < results.length && (
        <div className="profession-more"><Button type="button" variant="outline" onClick={() => {
          focusNewRole.current = true;
          setVisible((current) => current + PAGE_SIZE);
        }}>Show more professions</Button></div>
      )}
    </section>
  );
}
