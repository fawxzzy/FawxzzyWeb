"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { boardView, initialBoardState, resolveCardReference, resolveDetailDependency, resolveVisibleSelection } from "@/data/project-board-adapter.mjs";
import preview from "@/data/project-board-preview.generated.json";

const stages = [
  { id: "plan", label: "Plan", description: "Desired and defined work waiting to start.", states: ["intake", "planning", "ready", "opened"] },
  { id: "build", label: "Build", description: "Implementation started and unfinished; this is not a live worker indicator.", states: ["in_progress", "active", "running"] },
  { id: "review", label: "Review", description: "Candidate work awaiting requirements verification and possibly integration or release.", states: ["review", "accepted"] },
  { id: "blocked", label: "Blocked", description: "Work waiting on a concrete prerequisite.", states: ["blocked", "held"] },
] as const;
const completedStates = new Set(["completed", "complete", "closed", "archived", "retired"]);

type Card = {
  id: string;
  sourceProjectId: string;
  component: string | null;
  sourceRevision: string;
  owner: string;
  title: string;
  summary: string;
  lifecycle: string;
  workType: string;
  priority: string | null;
  dependencies: string[];
  parentId: string | null;
  duplicateOf: string | null;
  supersededBy: string | null;
  updatedAt: string;
};

type PublicBoardState = ReturnType<typeof initialBoardState>;

function titleCase(value: string) {
  return value.replaceAll("_", " ").replaceAll("-", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function cardKey(card: Card) {
  return `${card.sourceProjectId}:${card.id}`;
}

function isCompleted(card: Card) {
  return completedStates.has(card.lifecycle);
}

function CardItem({ card, onSelect }: { card: Card; onSelect: (card: Card, trigger: HTMLButtonElement) => void }) {
  return (
    <button className="project-card" data-lifecycle={card.lifecycle} onClick={(event) => onSelect(card, event.currentTarget)} type="button">
      <span className="project-card__meta">
        <span>{card.id}</span>
        <span>{titleCase(card.workType)}</span>
      </span>
      {card.component ? <span className="project-card__component">{card.component}</span> : null}
      <h3>{card.title}</h3>
      <p>{card.summary}</p>
      <span className="project-card__signals">
        <span>Status · {titleCase(card.lifecycle)}</span>
        {card.priority ? <span>Priority · {titleCase(card.priority)}</span> : null}
      </span>
      {card.dependencies.length ? (
        <span className="project-card__relations">{card.dependencies.length} prerequisite{card.dependencies.length === 1 ? "" : "s"}</span>
      ) : null}
      <span className="project-card__open">View details <span aria-hidden="true">→</span></span>
    </button>
  );
}

function CardGroups({ cards, grouped, onSelect }: { cards: Card[]; grouped: boolean; onSelect: (card: Card, trigger: HTMLButtonElement) => void }) {
  if (cards.length === 0) return <p className="project-stage__empty">No cards at this stage.</p>;
  if (!grouped) return <>{cards.map((card) => <CardItem card={card} key={cardKey(card)} onSelect={onSelect} />)}</>;
  const names = [...new Set(cards.map((card) => card.component || "Other"))].sort();
  return <>{names.map((name) => (
    <section className="project-component" key={name}>
      <h3>{name} <small>{cards.filter((card) => (card.component || "Other") === name).length}</small></h3>
      <div className="project-component__cards">
        {cards.filter((card) => (card.component || "Other") === name).map((card) => <CardItem card={card} key={cardKey(card)} onSelect={onSelect} />)}
      </div>
    </section>
  ))}</>;
}

// The page uses the dated preview until an approved public transport supplies
// state advanced through applyBoardEnvelope. This component does not fetch.
export function ProjectBoard({ publicBoardState }: { publicBoardState?: PublicBoardState } = {}) {
  const previewState = useMemo(() => initialBoardState(preview), []);
  const view = boardView(publicBoardState ?? previewState);
  const boards = view.boards as typeof preview.boards;
  const allCards = boards.flatMap((item) => item.cards as Card[]);
  const [boardId, setBoardId] = useState("fitness");
  const [query, setQuery] = useState("");
  const [showCompleted, setShowCompleted] = useState(false);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const workspace = useRef<HTMLElement>(null);
  const dialog = useRef<HTMLElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef<HTMLButtonElement | null>(null);
  const board = boards.find((item) => item.id === boardId) ?? boards[0];
  const selected = resolveVisibleSelection(allCards, selectedKey) as Card | null;
  const dialogOpen = Boolean(selected);
  const selectCard = (card: Card, trigger?: HTMLButtonElement) => {
    if (trigger) returnFocus.current = trigger;
    setSelectedKey(cardKey(card));
  };
  const closeCard = () => setSelectedKey(null);
  const normalized = query.trim().toLowerCase();
  const source = (board?.cards ?? []) as Card[];
  const cards = normalized ? source.filter((card) =>
      `${card.id} ${card.component ?? ""} ${card.title} ${card.summary} ${card.owner} ${card.workType} ${card.lifecycle}`
        .toLowerCase().includes(normalized),
    ) : source;
  const activeCards = cards.filter((card) => !isCompleted(card));
  const completedCards = cards.filter(isCompleted);
  const dependents = selected ? allCards.filter((card) => card.dependencies.some((reference) => {
    const target = resolveCardReference(allCards, card.sourceProjectId, reference);
    return target !== null && cardKey(target) === cardKey(selected);
  })) : [];
  useEffect(() => {
    if (!dialogOpen) {
      if (returnFocus.current) {
        const fallback = workspace.current?.querySelector<HTMLButtonElement>('.project-tab[aria-pressed="true"]');
        (returnFocus.current.isConnected ? returnFocus.current : fallback)?.focus();
        returnFocus.current = null;
      }
      return;
    }
    closeButton.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setSelectedKey(null);
      }
      if (event.key !== "Tab" || !dialog.current) return;
      const focusable = [...dialog.current.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')];
      const first = focusable[0];
      const last = focusable.at(-1);
      if (!first || !last) return;
      const inside = dialog.current.contains(document.activeElement);
      if (event.shiftKey && (!inside || document.activeElement === first)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (!inside || document.activeElement === last)) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [dialogOpen, selectedKey]);

  return (
    <section aria-label="Project boards" className="project-workspace" ref={workspace}>
      <div className="project-board-shell">
        <div className="project-board-toolbar">
          <div>
            <p className="eyebrow">Public view · Fawxzzy project boards</p>
            <h1>{board?.name ?? "Project boards unavailable"}</h1>
            <p className="project-board-toolbar__rule">Public board view. Full account access uses a separate owner-only surface.</p>
            <p>{activeCards.length} open · {completedCards.length} completed</p>
            <p aria-live="polite" className="project-board-toolbar__rule">
              {view.reason === "STATIC_PREVIEW_NOT_CURRENT_TRUTH"
                ? `Board placeholder prepared ${preview.preparedAt}. Live master sync is pending; no real card content is approved for this website view.`
                : view.authoritative
                  ? `Public board snapshot accepted ${view.lastSuccessfulAt}. Live website sync is not connected.`
                  : view.health === "stale" || view.health === "reconciling"
                    ? `Board source is ${view.health}; showing last known cards without current-truth authority. Last accepted ${view.lastSuccessfulAt ?? "never"}.`
                    : `Board source is ${view.health}; cards are hidden. Last accepted ${view.lastSuccessfulAt ?? "never"}.`}
            </p>
            {board && board.cards.length === 0 ? <p className="project-board-toolbar__rule">{view.reason === "STATIC_PREVIEW_NOT_CURRENT_TRUTH" ? "No cards are cleared for this display board yet; owner review remains pending." : "No cards are available on this display board."}</p> : null}
            {!board ? <p className="project-board-toolbar__rule">No public board cards are available to display.</p> : null}
          </div>
          <label className="project-search">
            <span className="sr-only">Search board cards</span>
            <input onChange={(event) => setQuery(event.target.value)} placeholder="Search cards" type="search" value={query} />
          </label>
        </div>

        <nav aria-label="Project boards" className="project-tabs">
          {boards.map((item) => (
            <button aria-label={`${item.name}, ${item.cards.length} cards`} aria-pressed={item.id === board?.id}
              className="project-tab" key={item.id} onClick={() => { setBoardId(item.id); setShowCompleted(false); }} type="button">
              <span>{item.name}</span><strong>{item.cards.length}</strong>
            </button>
          ))}
        </nav>

        <div aria-label="Lifecycle colors" className="project-legend">
          {stages.map((stage) => <span data-tone={stage.id === "plan" ? "planned" : stage.id === "build" ? "active" : stage.id} key={stage.id} title={stage.description}>{stage.label}</span>)}
          <span data-tone="completed" title="Card-specific acceptance was verified at the recorded source date.">Completed</span>
        </div>

        <div aria-label="Card lifecycle" className="project-map" role="region">
          <div aria-hidden="true" className="project-map__rail" />
          {stages.map((stage) => {
            const items = activeCards.filter((card) => (stage.states as readonly string[]).includes(card.lifecycle));
            return (
              <section className="project-stage" data-stage={stage.id} key={stage.id}>
                <header><span aria-hidden="true" className="project-stage__node" /><h2 title={stage.description}>{stage.label}</h2><span>{items.length}</span></header>
                <div className="project-stage__cards"><CardGroups cards={items} grouped={board?.id === "atlas-stack"} onSelect={selectCard} /></div>
              </section>
            );
          })}
        </div>

        <section className="project-completed">
          <button aria-expanded={showCompleted} className="project-completed__toggle" onClick={() => setShowCompleted((value) => !value)} title="Card-specific acceptance was verified at the recorded source date." type="button">
            <span><strong>Completed archive</strong><small>{board?.cards.length ? "Source-exported completed cards remain available." : "No completed cards are approved for this view."}</small></span>
            <span>{completedCards.length} {showCompleted ? "−" : "+"}</span>
          </button>
          {showCompleted ? <div className="project-completed__cards"><CardGroups cards={completedCards} grouped={board?.id === "atlas-stack"} onSelect={selectCard} /></div> : null}
        </section>
      </div>

      {selected ? (
        <div className="project-detail-backdrop" onMouseDown={closeCard}>
          <section aria-labelledby="project-detail-title" aria-modal="true" className="project-detail"
            onMouseDown={(event) => event.stopPropagation()} ref={dialog} role="dialog">
            <button aria-label="Close card details" className="project-detail__close" onClick={closeCard} ref={closeButton} type="button">×</button>
            <p className="eyebrow">{selected.component || board?.name} · {selected.id}</p>
            <h2 id="project-detail-title">{selected.title}</h2>
            <p>{selected.summary}</p>
            <div className="project-detail__dependencies"><h3>Depends on</h3>
              {selected.dependencies.length ? <ul>{selected.dependencies.map((id, index) => {
                const { key, target: dependency } = resolveDetailDependency(allCards, selected.sourceProjectId, id, index);
                return <li key={key}>{dependency ? <button onClick={() => selectCard(dependency)} type="button">{dependency.id} · View card</button> : <span>Another prerequisite is outside this view.</span>}</li>;
              })}</ul> : <p>No public prerequisites shown.</p>}
              <p>Only links between displayed cards are shown; other source prerequisites may exist.</p>
            </div>
            <dl>
              <div><dt>Status</dt><dd>{titleCase(selected.lifecycle)}</dd></div>
              <div><dt>Category</dt><dd>{titleCase(selected.workType)}</dd></div>
              <div><dt>Owner</dt><dd>{selected.owner}</dd></div>
              <div><dt>Source project</dt><dd>{selected.sourceProjectId}</dd></div>
              <div><dt>Priority</dt><dd>{selected.priority ? titleCase(selected.priority) : "Not ranked"}</dd></div>
              <div><dt>Card updated</dt><dd>{selected.updatedAt.slice(0, 10)}</dd></div>
              {selected.parentId ? <div><dt>Parent</dt><dd>{resolveCardReference(allCards, selected.sourceProjectId, selected.parentId)?.id ?? "Outside this view"}</dd></div> : null}
              {selected.duplicateOf ? <div><dt>Duplicate of</dt><dd>{resolveCardReference(allCards, selected.sourceProjectId, selected.duplicateOf)?.id ?? "Outside this view"}</dd></div> : null}
              {selected.supersededBy ? <div><dt>Superseded by</dt><dd>{resolveCardReference(allCards, selected.sourceProjectId, selected.supersededBy)?.id ?? "Outside this view"}</dd></div> : null}
            </dl>
            <div className="project-detail__dependencies"><h3>Enables</h3>
              {dependents.length ? <ul>{dependents.map((card) => <li key={cardKey(card)}><button onClick={() => selectCard(card)} type="button">{cardKey(card)} · View card</button></li>)}</ul> : <p>No cards directly depend on this card.</p>}
            </div>
            <p className="project-detail__source">Source revision: {selected.sourceRevision.slice(0, 19)}… · {view.authoritative ? "Accepted public snapshot" : "Not current source truth"}</p>
          </section>
        </div>
      ) : null}
    </section>
  );
}
