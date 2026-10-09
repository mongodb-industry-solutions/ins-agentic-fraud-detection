"use client";

import styles from "./Pagination.module.css";

/** Page numbers to show: first, last, and a window around the current page. */
function toPageItems(page, pageCount) {
  const wanted = new Set([1, pageCount, page - 1, page, page + 1]);
  const pages = [...wanted].filter((n) => n >= 1 && n <= pageCount).sort((a, b) => a - b);
  return pages.flatMap((n, index) => (index > 0 && n - pages[index - 1] > 1 ? ["gap", n] : [n]));
}

export default function Pagination({ pagination, onChange }) {
  const { page, pageCount, total, from, to } = pagination;
  if (total === 0) return null;

  return (
    <nav className={styles.bar} aria-label="Claims pages">
      <span className={styles.range}>
        Showing{" "}
        <span className={styles.mono}>
          {from}–{to}
        </span>{" "}
        of <span className={styles.mono}>{total}</span> claims
      </span>
      {pageCount > 1 && (
        <div className={styles.pages}>
          <button
            type="button"
            className={styles.step}
            disabled={page === 1}
            onClick={() => onChange(page - 1)}
          >
            Previous
          </button>
          {toPageItems(page, pageCount).map((item, index) =>
            item === "gap" ? (
              <span key={`gap-${index}`} className={styles.gap}>
                …
              </span>
            ) : (
              <button
                key={item}
                type="button"
                className={`${styles.page} ${item === page ? styles.current : ""}`}
                aria-current={item === page ? "page" : undefined}
                onClick={() => onChange(item)}
              >
                {item}
              </button>
            )
          )}
          <button
            type="button"
            className={styles.step}
            disabled={page === pageCount}
            onClick={() => onChange(page + 1)}
          >
            Next
          </button>
        </div>
      )}
    </nav>
  );
}
