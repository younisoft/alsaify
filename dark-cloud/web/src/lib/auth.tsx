import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { onAuthStateChanged, signOut, type User } from 'firebase/auth';
import { doc, onSnapshot } from 'firebase/firestore';
import { can as canFn, DEFAULT_SETTINGS, type Action, type Module, type Settings, type UserProfile } from '@dc/shared';
import { auth, db } from './firebase';
import { api } from './api';

type Status = 'loading' | 'signed-out' | 'unauthorized' | 'offline' | 'ready';
interface AuthState {
  status: Status; user: User | null; profile: UserProfile | null; settings: Settings; reason?: string;
  can: (m: Module, a: Action) => boolean; signOut: () => Promise<void>;
}
const Ctx = createContext<AuthState>(null as unknown as AuthState);

function mergeSettings(s: Partial<Settings> | undefined): Settings {
  return { company: { ...DEFAULT_SETTINGS.company, ...s?.company }, finance: { ...DEFAULT_SETTINGS.finance, ...s?.finance },
    lists: { ...DEFAULT_SETTINGS.lists, ...s?.lists }, system: { ...DEFAULT_SETTINGS.system, ...s?.system } };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [status, setStatus] = useState<Status>('loading');
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [reason, setReason] = useState<string>();

  const [retry, setRetry] = useState(0);
  const profileRef = useRef<UserProfile | null>(null);
  useEffect(() => { profileRef.current = profile; }, [profile]);
  useEffect(() => onAuthStateChanged(auth, async (u) => {
    if (!u || u.uid !== profileRef.current?.uid) { setProfile(null); profileRef.current = null; }
    setUser(u);
    if (!u) { setStatus('signed-out'); return; }
    setStatus('loading');
    try {
      const r = await api<{ authorized: boolean; reason?: string }>('auth.claimInvitation');
      if (!r.authorized) { setReason(r.reason); setStatus('unauthorized'); return; }
      // if the live profile is already loaded (e.g. after reconnecting), resume immediately
      const p = profileRef.current;
      if (p) setStatus(p.status === 'active' ? 'ready' : 'unauthorized');
    } catch (e: any) {
      // Only an explicit "authorized: false" from the server means unauthorized.
      // Any failure to get an answer (offline, timeout, server down) is a connection state with retry.
      setReason(e.message); setStatus('offline');
    }
  }), [retry]);
  useEffect(() => {
    if (status !== 'offline') return;
    const on = () => setRetry((n) => n + 1);
    addEventListener('online', on);
    const t = setInterval(on, 15000);   // also retry periodically: the 'online' event is not always fired
    return () => { removeEventListener('online', on); clearInterval(t); };
  }, [status]);

  // Live profile: permission changes and suspensions apply immediately, without re-login.
  useEffect(() => {
    if (!user) return;
    return onSnapshot(doc(db, 'users', user.uid), (s) => {
      if (!s.exists()) return;
      const p = { ...(s.data() as UserProfile), uid: s.id };
      setProfile(p);
      setStatus(p.status === 'active' ? 'ready' : 'unauthorized');
      if (p.status !== 'active') setReason('تم إيقاف حسابك. تواصل مع المدير العام.');
    }, () => {});
  }, [user, retry]);

  useEffect(() => {
    if (status !== 'ready') return;
    return onSnapshot(doc(db, 'settings', 'main'), (s) => setSettings(mergeSettings(s.data() as Partial<Settings>)), () => {});
  }, [status]);

  const value = useMemo<AuthState>(() => ({
    status, user, profile, settings, reason,
    can: (m, a) => canFn(profile, m, a),
    signOut: () => signOut(auth),
  }), [status, user, profile, settings, reason]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
export const useAuth = () => useContext(Ctx);
