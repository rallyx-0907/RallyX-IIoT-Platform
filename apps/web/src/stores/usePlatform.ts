import { useCallback, useEffect, useRef, useState } from 'react';
import { request, errorMessage } from '../api/client';
import type { Alarm, Asset, EventRecord, PlatformData, Rule, Site, Tag, User } from '../types/platform';

const empty: PlatformData = { assets: [], tags: [], alarms: [], events: [], rules: [], tree: [] };
export function usePlatform(user: User | null | undefined) {
  const [data, setData] = useState<PlatformData>(empty);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [connection, setConnection] = useState('connecting');
  const active = useRef(true);
  const busy = useRef(false);
  const refresh = useCallback(async () => {
    if (!user || user.must_change_password || busy.current) return;
    busy.current = true;
    try {
      const [assets, tags, alarms, events, rules, tree] = await Promise.all([
        request<Asset[]>('/assets'), request<Tag[]>('/tags'), request<Alarm[]>('/alarms'),
        request<EventRecord[]>('/events?limit=12'), request<Rule[]>('/rules'), request<Site[]>('/assets/tree'),
      ]);
      if (active.current) { setData({ assets, tags, alarms, events, rules, tree }); setError(''); }
    } catch (error) { if (active.current) setError(errorMessage(error)); }
    finally { busy.current = false; if (active.current) setLoading(false); }
  }, [user]);
  useEffect(() => {
    active.current = true;
    if (!user || user.must_change_password) return;
    setLoading(true); void refresh();
    let socket: WebSocket;
    let stopped = false;
    let reconnect: ReturnType<typeof setTimeout>;
    let update: ReturnType<typeof setTimeout>;
    const connect = () => {
      if (stopped) return;
      socket = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/v1/ws`);
      socket.onopen = () => { setConnection('live'); void refresh(); };
      socket.onmessage = () => { clearTimeout(update); update = setTimeout(() => { void refresh(); }, 150); };
      socket.onerror = () => { setConnection('offline'); socket.close(); };
      socket.onclose = () => { if (!stopped) { setConnection('offline'); reconnect = setTimeout(connect, 3000); } };
    };
    connect();
    const poll = setInterval(() => { void refresh(); }, 15000);
    return () => { stopped = true; active.current = false; clearTimeout(reconnect); clearTimeout(update); clearInterval(poll); socket?.close(); };
  }, [user, refresh]);
  return { data, loading, error, connection, refresh };
}
