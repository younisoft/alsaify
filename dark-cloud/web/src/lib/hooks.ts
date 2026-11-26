import { useEffect, useRef, useState, useCallback } from 'react';
import { onSnapshot, collection, query, type QueryConstraint, doc } from 'firebase/firestore';
import { db } from './firebase';
import { api, syncState } from './api';

export interface Live<T> { data: T[]; loading: boolean; error: string | null; fromCache: boolean }

/** Real-time collection subscription. `deps` key controls re-subscription. */
export function useCollection<T = any>(name: string | null, constraints: QueryConstraint[] = [], key = ''): Live<T & { id: string }> {
  const [state, set] = useState<Live<T & { id: string }>>({ data: [], loading: true, error: null, fromCache: false });
  useEffect(() => {
    if (!name) { set({ data: [], loading: false, error: null, fromCache: false }); return; }
    set((s) => ({ ...s, loading: true }));
    return onSnapshot(query(collection(db, name), ...constraints), { includeMetadataChanges: false },
      (snap) => set({ data: snap.docs.map((d) => ({ ...(d.data() as T), id: d.id })), loading: false, error: null, fromCache: snap.metadata.fromCache }),
      (e) => set({ data: [], loading: false, error: e.code === 'permission-denied' ? 'ليست لديك صلاحية عرض هذه البيانات' : e.message, fromCache: false }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, key]);
  return state;
}

export function useDoc<T = any>(name: string, id: string | undefined) {
  const [state, set] = useState<{ data: (T & { id: string }) | null; loading: boolean; error: string | null }>({ data: null, loading: true, error: null });
  useEffect(() => {
    if (!id) return;
    return onSnapshot(doc(db, name, id), (s) => set({ data: s.exists() ? ({ ...(s.data() as T), id: s.id }) : null, loading: false, error: null }),
      (e) => set({ data: null, loading: false, error: e.code === 'permission-denied' ? 'ليست لديك صلاحية' : e.message }));
  }, [name, id]);
  return state;
}

/** Server report / query action with reload. */
export function useApi<T = any>(action: string | null, input: unknown, key = '') {
  const [state, set] = useState<{ data: T | null; loading: boolean; error: string | null }>({ data: null, loading: !!action, error: null });
  const seq = useRef(0);
  const load = useCallback(() => {
    if (!action) return;
    const n = ++seq.current;
    set((s) => ({ ...s, loading: true, error: null }));
    api<T>(action, input).then((data) => n === seq.current && set({ data, loading: false, error: null }))
      .catch((e) => n === seq.current && set({ data: null, loading: false, error: e.message }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [action, key]);
  useEffect(load, [load]);
  return { ...state, reload: load };
}

export function useOnline() {
  const [on, setOn] = useState(navigator.onLine);
  useEffect(() => { const a = () => setOn(true), b = () => setOn(false); addEventListener('online', a); addEventListener('offline', b); return () => { removeEventListener('online', a); removeEventListener('offline', b); }; }, []);
  return on;
}

/** 'offline' | 'saving' (a write is on its way to the server) | 'synced' */
export function useSyncStatus(): 'offline' | 'saving' | 'synced' {
  const online = useOnline();
  const [n, setN] = useState(syncState.inflight);
  useEffect(() => syncState.subscribe(() => setN(syncState.inflight)), []);
  return !online ? 'offline' : n > 0 ? 'saving' : 'synced';
}
