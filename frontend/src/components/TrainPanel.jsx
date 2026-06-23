import { useState } from 'react';
import { api } from '../api.js';

export default function TrainPanel({ onTrained, disabled }) {
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const submit = async (e) => {
    e.preventDefault();
    if (!url.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const result = await api.train(url.trim());
      onTrained(result);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="card">
      <h2>1. Index a website</h2>
      <p className="muted">
        Paste any URL. The site will be scraped, chunked, embedded with
        <code> nomic-embed-text</code>, and stored locally in ChromaDB.
      </p>

      <form onSubmit={submit} className="form">
        <input
          type="url"
          required
          placeholder="https://example.com"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          disabled={disabled || loading}
        />
        <button type="submit" disabled={disabled || loading || !url.trim()}>
          {loading ? 'Indexing…' : 'Train'}
        </button>
      </form>

      {error && <div className="error">⚠️ {error}</div>}
    </section>
  );
}
