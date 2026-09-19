import { Link, createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';

import { useReports } from '../../api/hooks';
import type { ReportsFilter } from '../../api/types';
import { GradePill } from '../../ui/GradePill';
import s from './reports.module.css';

export const Route = createFileRoute('/_app/reports')({
  component: ReportsPage,
});

const PAGE_SIZE = 25;

function ReportsPage() {
  const [songName, setSongName] = useState('');
  const [tags, setTags] = useState('');
  const [genre, setGenre] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [page, setPage] = useState(1);

  const filter: ReportsFilter = {
    ...(songName.trim() && { songName: songName.trim() }),
    ...(tags.trim() && { tags: tags.trim() }),
    ...(genre.trim() && { genreHint: genre.trim() }),
    ...(startDate && { startDate }),
    ...(endDate && { endDate }),
    page,
    pageSize: PAGE_SIZE,
  };

  const { data, isLoading, error } = useReports(filter);

  const totalPages = data ? Math.ceil(data.total / PAGE_SIZE) : 1;

  const handleFilter = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(1);
  };

  const clearFilters = () => {
    setSongName('');
    setTags('');
    setGenre('');
    setStartDate('');
    setEndDate('');
    setPage(1);
  };

  return (
    <div className={s.page}>
      <div className={s.header}>
        <h1 className={s.title}>Reports</h1>
        {data && (
          <p className={s.subtitle}>{data.total} {data.total === 1 ? 'result' : 'results'}</p>
        )}
      </div>

      <form className={s.filterBar} onSubmit={handleFilter}>
        <input
          className={s.filterInput}
          placeholder="Song name"
          value={songName}
          onChange={(e) => setSongName(e.target.value)}
        />
        <input
          className={s.filterInput}
          placeholder="Tags (comma-separated)"
          value={tags}
          onChange={(e) => setTags(e.target.value)}
        />
        <input
          className={s.filterInput}
          placeholder="Genre"
          value={genre}
          onChange={(e) => setGenre(e.target.value)}
        />
        <input
          type="date"
          className={s.filterInput}
          value={startDate}
          onChange={(e) => setStartDate(e.target.value)}
          title="Start date"
        />
        <input
          type="date"
          className={s.filterInput}
          value={endDate}
          onChange={(e) => setEndDate(e.target.value)}
          title="End date"
        />
        <button type="submit" className="btn primary sm">
          Filter
        </button>
        <button type="button" className="btn ghost sm" onClick={clearFilters}>
          Clear
        </button>
      </form>

      {isLoading && <p className={`mono ${s.status}`}>Loading…</p>}
      {error && (
        <p className={s.error}>
          Could not load reports: {error instanceof Error ? error.message : String(error)}
        </p>
      )}

      {data && data.items.length === 0 && !isLoading && (
        <div className={s.empty}>
          <p>No reports found.</p>
          <p className="mono">Upload and analyze a track to see results here.</p>
        </div>
      )}

      {data && data.items.length > 0 && (
        <div className={s.table}>
          <div className={s.tableHead}>
            <span>Song</span>
            <span>Ver</span>
            <span>Genre</span>
            <span>Grade</span>
            <span>Score</span>
            <span>Status</span>
            <span>Date</span>
          </div>
          {data.items.map((item) => (
            <ReportRow key={item.jobId} item={item} />
          ))}
        </div>
      )}

      {data && totalPages > 1 && (
        <div className={s.pagination}>
          <button
            type="button"
            className="btn ghost sm"
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
          >
            ← Prev
          </button>
          <span className="mono">
            {page} / {totalPages}
          </span>
          <button
            type="button"
            className="btn ghost sm"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
          >
            Next →
          </button>
        </div>
      )}
    </div>
  );
}

function ReportRow({ item }: { item: import('../../api/types').ReportListItemDto }) {
  const date = new Date(item.dispatchedAt);
  const dateStr = date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });

  const nameCell = item.songId && item.songName ? (
    <Link to="/songs/$songId" params={{ songId: item.songId }} className={s.songLink}>
      {item.songName}
    </Link>
  ) : (
    <span className="mono">—</span>
  );

  const resultCell =
    item.status === 'complete' && item.songId && item.jobId ? (
      <Link
        to="/songs/$songId/results/$jobId"
        params={{ songId: item.songId, jobId: item.jobId }}
        className={s.viewLink}
      >
        View →
      </Link>
    ) : null;

  return (
    <div className={s.tableRow} data-status={item.status}>
      <span className={s.songCell}>
        {nameCell}
        {item.tags.length > 0 && (
          <span className={s.tagRow}>
            {item.tags.map((t) => (
              <span key={t.id} className={s.tagChip}>
                {t.name}
              </span>
            ))}
          </span>
        )}
      </span>
      <span className="mono">{item.versionNumber != null ? `v${item.versionNumber}` : '—'}</span>
      <span>{item.genreHint ?? '—'}</span>
      <span>{item.grade ? <GradePill grade={item.grade} size="sm" /> : '—'}</span>
      <span className="mono">{item.score != null ? item.score.toFixed(1) : '—'}</span>
      <span className={`pill ${statusTone(item.status)}`}>{item.status}</span>
      <span className="mono">
        {dateStr}
        {resultCell}
      </span>
    </div>
  );
}

function statusTone(status: string): string {
  switch (status) {
    case 'complete': return 'green';
    case 'failed': return 'red';
    case 'processing': return 'cyan';
    default: return '';
  }
}
