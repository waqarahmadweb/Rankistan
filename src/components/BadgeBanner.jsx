import React from 'react';

/**
 * BadgeBanner
 * Sits between the leaderboard header and the dev table.
 * Props:
 *   onNavigateToBadge  — () => void   calls onChangeTab('badge') in parent
 */
export default function BadgeBanner({ onNavigateToBadge }) {
  return (
    <div className="w-full border border-outline-variant bg-surface-container-lowest flex flex-col gap-3 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between sm:gap-4 sm:py-4 sm:pl-5 sm:pr-7">
      <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
        <div className="flex items-center gap-2.5 sm:contents">
          <span className="material-symbols-outlined text-secondary shrink-0 text-2xl leading-none sm:text-3xl">shield</span>
          <span className="font-mono text-[10px] uppercase tracking-widest text-secondary sm:hidden">New Feature</span>
        </div>
        <div className="min-w-0 flex-1">
          <div className="mb-1 hidden font-mono text-[10px] uppercase tracking-widest text-secondary sm:block">New Feature</div>
          <p className="font-body text-xs leading-relaxed text-on-surface-variant sm:text-sm sm:leading-snug">
            Flaunt your Rankistan rank in your GitHub README.{' '}
            <span className="font-mono text-[10px] text-primary sm:text-[11px]">
              ranked_devs can embed a live badge powered by Rankistan.
            </span>
          </p>
        </div>
      </div>
      <button
        type="button"
        onClick={onNavigateToBadge}
        className="flex w-full min-h-11 shrink-0 items-center justify-center gap-2 border border-secondary px-4 py-2.5 font-mono text-[10px] uppercase tracking-widest text-secondary transition-colors hover:bg-secondary/10 active:scale-95 sm:w-auto sm:min-h-0 sm:py-2"
      >
        <span className="material-symbols-outlined text-sm">arrow_forward</span>
        Get Your Badge
      </button>
    </div>
  );
}
