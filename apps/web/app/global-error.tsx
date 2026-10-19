'use client';

/**
 * The last resort when the root layout itself fails. It replaces the whole document, so
 * it carries its own html and body and plain styles.
 */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset(): void }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: 'system-ui, sans-serif', display: 'grid', placeItems: 'center', minHeight: '100vh', margin: 0, padding: 24, textAlign: 'center' }}>
        <main>
          <h1 style={{ fontSize: 20, fontWeight: 600 }}>Spooldoc could not start this page</h1>
          <p style={{ color: '#666', fontSize: 14 }}>
            Try again. If it keeps failing, the server log has the error{error.digest ? ` under ${error.digest}` : ''}.
          </p>
          <button type="button" onClick={reset} style={{ marginTop: 12, padding: '6px 14px', fontSize: 14, cursor: 'pointer' }}>
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
