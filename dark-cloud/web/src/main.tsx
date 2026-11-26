import { StrictMode, Component, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';
import { registerServiceWorker } from './lib/pwa';

registerServiceWorker();

// After a new deployment, an already-open old version may request a chunk that no longer exists.
// Reload once to pick up the new version instead of showing a broken screen.
addEventListener('vite:preloadError', (e) => {
  try { if (sessionStorage.getItem('dc-chunk-reload')) return; sessionStorage.setItem('dc-chunk-reload', '1'); } catch { /* ignore */ }
  e.preventDefault();
  location.reload();
});
addEventListener('load', () => setTimeout(() => { try { sessionStorage.removeItem('dc-chunk-reload'); } catch { /* ignore */ } }, 10000));

class Boundary extends Component<{ children: ReactNode }, { err: Error | null }> {
  state = { err: null as Error | null };
  static getDerivedStateFromError(err: Error) { return { err }; }
  render() {
    if (this.state.err) return (
      <div dir="rtl" style={{ padding: 32, fontFamily: 'sans-serif' }}>
        <h1>حدث خطأ في الواجهة</h1><p>لم يتأثر أي سجل مالي — كل الحفظ يتم على الخادم. أعد تحميل الصفحة.</p>
        <button onClick={() => location.reload()}>إعادة التحميل</button>
      </div>);
    return this.props.children;
  }
}
createRoot(document.getElementById('root')!).render(<StrictMode><Boundary><App /></Boundary></StrictMode>);
