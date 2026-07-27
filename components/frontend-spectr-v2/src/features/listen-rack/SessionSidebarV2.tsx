/* Listen Rack v2 — session sidebar: one card, three underline tabs with counts
 * (Notes · Chat · Room). Ported from the design handoff (lr-panels.jsx →
 * SessionCard). Live room: chat/roster/status come from the RoomLiveSeam feed;
 * mock demo route keeps the fixtures. Host grant chips (+DJ/+Vis) survive from
 * the old PeoplePanel — they're the only control-handoff surface. */
import { useState } from 'react';
import { toast } from 'sonner';

import type { ActorRefDto } from '../../api/types';
import { Icon } from '../results/Icon';
import {
  REACTION_GROUPS, ROOM_LISTENERS,
  type ReactionFeedItem, type TrackNote,
} from './data';
import type { ActorRef } from './access';
import { sameActor, type RoomControl } from './identity';
import { lrTime } from './lrUtil';
import { actorKey, toActorRef } from './roomStateReducer';

function hueFor(handle: string): number {
  let h = 0;
  for (let i = 0; i < handle.length; i++) h = (h * 31 + handle.charCodeAt(i)) % 360;
  return h;
}

function Pav({ handle, hue, anon }: { handle: string; hue: number; anon?: boolean | undefined }) {
  return (
    <span className="lr-pav" style={{ background: `oklch(0.74 0.15 ${hue})` }}>
      {anon ? '?' : (handle[0] ?? '?').toUpperCase()}
    </span>
  );
}

export interface ChatSeam {
  send: (text: string, position: number) => Promise<unknown>;
  position: () => number;
}

interface MockMsg { id: string; handle: string; text: string; you?: boolean }
const LR_CHAT_SEED: MockMsg[] = [
  { id: 's1', handle: 'vela', text: 'the breakdown reverb is doing a lot' },
  { id: 's2', handle: 'forge', text: 'kick could hit harder imo' },
];

export function SessionSidebarV2({ notes, activeNote, onNote, feed, chatLive, myHandle, roster, statusByActor, meKey, myStatus, onReact, canGrant, roomControl, onGrant }: {
  notes: TrackNote[];
  activeNote: string | null;
  onNote: (n: TrackNote) => void;
  /** Live reaction/chat feed (SSE) — null on the mock route. */
  feed: ReactionFeedItem[] | null;
  /** Live chat sender — null on the mock route (local echo). */
  chatLive: ChatSeam | null;
  myHandle: string;
  /** Live roster — null renders the demo fixture. */
  roster: ActorRefDto[] | null;
  statusByActor: Record<string, string> | null;
  meKey: string | null;
  myStatus: string;
  onReact: (e: string) => void;
  canGrant: boolean;
  roomControl: RoomControl;
  onGrant: (scope: 'rack' | 'visuals', actor: ActorRef | null) => void;
}) {
  const [t, setT] = useState<'notes' | 'chat' | 'room'>('notes');
  const [mockMsgs, setMockMsgs] = useState<MockMsg[]>(LR_CHAT_SEED);
  const [text, setText] = useState('');

  const liveChat = feed?.filter((f) => f.kind === 'chat' || (f.kind == null && f.text)) ?? null;
  const chatCount = liveChat ? liveChat.length : mockMsgs.length;
  const roomCount = roster ? roster.length : ROOM_LISTENERS.length;

  const send = () => {
    const msg = text.trim();
    if (!msg) return;
    if (chatLive) {
      void chatLive.send(msg, chatLive.position()).catch(() => {
        toast.error("Message didn't send.", { id: 'room-send' });
      });
    } else {
      setMockMsgs((m) => [...m, { id: 'm' + m.length, handle: myHandle, you: true, text: msg }]);
    }
    setText('');
  };

  return (
    <aside className="lr-side">
      <div className="lr-sc">
        <div className="lr-mtabs">
          {([['notes', 'Notes', notes.length], ['chat', 'Chat', chatCount], ['room', 'Room', roomCount]] as const).map(([id, l, n]) => (
            <button type="button" key={id} className={t === id ? 'on' : ''} onClick={() => setT(id)}>
              {l}<span className="n">{n}</span>
            </button>
          ))}
        </div>

        {t === 'notes' && (
          <div className="lr-sc-b">
            {notes.length === 0 && (
              <span className="mono" style={{ fontSize: 10, color: 'var(--muted)', padding: '4px 2px' }}>
                No notes on this version yet.
              </span>
            )}
            {notes.map((n) => (
              <button
                type="button"
                key={n.id}
                className={'lr-snote' + (activeNote === n.id ? ' on' : '')}
                onClick={() => onNote(n)}
              >
                <span className="tm">{lrTime(n.t)}</span>
                <span className="tx">{n.text}</span>
                {n.pinned && <span className="pin" title="pinned">●</span>}
              </button>
            ))}
          </div>
        )}

        {t === 'chat' && (
          <div className="lr-sc-b">
            {liveChat
              ? liveChat.map((m) => (
                  <div key={m.id} className="lr-msg">
                    <Pav handle={m.handle} hue={m.you ? 168 : hueFor(m.handle)} />
                    <span className="bb"><span className="h">@{m.handle}</span><span className="x">{m.text || m.emoji}</span></span>
                  </div>
                ))
              : mockMsgs.map((m) => (
                  <div key={m.id} className="lr-msg">
                    <Pav handle={m.handle} hue={m.you ? 168 : hueFor(m.handle)} />
                    <span className="bb"><span className="h">@{m.handle}</span><span className="x">{m.text}</span></span>
                  </div>
                ))}
            <div className="lr-cin">
              <input
                value={text}
                placeholder="Say something…"
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && send()}
              />
              <button type="button" onClick={send} title="Send"><Icon name="send" size={13} /></button>
            </div>
          </div>
        )}

        {t === 'room' && (
          <div className="lr-sc-b">
            <div className="lr-people">
              {roster
                ? roster.map((entry) => {
                    const key = actorKey(entry);
                    const you = meKey != null && key === meKey;
                    const isAnon = entry.type === 'anon';
                    const handle = entry.handle ?? entry.displayName ?? 'anon';
                    const hue = entry.hue ?? hueFor(handle);
                    const status = you ? myStatus : (statusByActor?.[key] ?? '🎧');
                    const actor = toActorRef(entry);
                    const isDJ = sameActor(roomControl.rackHolder, actor);
                    const isVJ = sameActor(roomControl.visualsHolder, actor);
                    return (
                      <span key={key} className="lr-pchip">
                        <Pav handle={handle} hue={hue} anon={isAnon} />
                        {isAnon ? 'anon' : '@' + handle}
                        {isDJ && <span className="st" title="rack control" style={{ color: 'var(--violet)' }}>DJ</span>}
                        {isVJ && <span className="st" title="visuals control" style={{ color: 'var(--accent)' }}>VJ</span>}
                        {/* Grants require a userId on the wire — anon refs carry none. */}
                        {canGrant && !you && entry.type === 'user' && !isDJ && (
                          <button type="button" className="st" title="Grant rack control" onClick={() => onGrant('rack', actor)}>+DJ</button>
                        )}
                        {canGrant && !you && entry.type === 'user' && !isVJ && (
                          <button type="button" className="st" title="Grant visuals control" onClick={() => onGrant('visuals', actor)}>+VJ</button>
                        )}
                        <span className="st">{status}</span>
                      </span>
                    );
                  })
                : ROOM_LISTENERS.map((l) => (
                    <span key={l.handle} className="lr-pchip">
                      <Pav handle={l.handle} hue={l.hue} anon={l.anon} />
                      {l.anon ? 'anon' : '@' + l.handle}
                      <span className="st">{l.you ? myStatus : l.state}</span>
                    </span>
                  ))}
            </div>
            <div className="lr-react">
              {REACTION_GROUPS.map((g) => (
                <div key={g.id} className="rg">
                  <span className="gl" style={{ color: g.tone }}>{g.sign}</span>
                  {g.emojis.map((e) => (
                    <button type="button" key={e} className={myStatus === e ? 'on' : ''} onClick={() => onReact(e)}>{e}</button>
                  ))}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}
