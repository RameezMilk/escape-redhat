// WebSocket protocol between apps/server and apps/web. Every server message carries episodeId;
// the client drops messages from an episode other than the one in its latest welcome/snapshot.
import { z } from 'zod';
import type { EpisodeResult, ProviderInfo, Snapshot, TraceRow, ActorId, HazardKind } from './types.js';

export const ClientMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('hello') }),
  z.object({
    type: z.literal('place'),
    kind: z.enum(['fire', 'electrical']),
    col: z.number().int(),
    row: z.number().int(),
  }),
  z.object({ type: z.literal('pause') }),
  z.object({ type: z.literal('resume') }),
  z.object({
    type: z.literal('reset'),
    caseId: z.string().optional(),
    seed: z.number().int().optional(),
  }),
  z.object({ type: z.literal('replay'), runId: z.string() }),
]);
export type ClientMessage = z.infer<typeof ClientMessageSchema>;

export interface BubbleMessage {
  type: 'bubble';
  episodeId: string;
  actor: ActorId;
  text: string;
  /** message = delivered notify (model-chosen); observation = engine perception; ambient = authored idle line. */
  kind: 'message' | 'alert' | 'observation' | 'ambient';
  ttlMs: number;
}

export interface CaseSummary {
  caseId: string;
  split: string;
  family: string;
  notes?: string;
}

export interface RunSummary {
  runId: string;
  caseId: string;
  outcome?: string;
  createdAt: string;
  /** Map the run was recorded on: only runs on the current map replay faithfully. */
  mapHash?: string;
  /** Recorded with the scripted fixture (not a model). */
  scripted?: boolean;
}

export type ServerMessage =
  | {
      type: 'welcome';
      episodeId: string;
      snapshot: Snapshot;
      trace: TraceRow[];
      provider: ProviderInfo;
      mapId: string;
      cases: CaseSummary[];
      runs: RunSummary[];
      result: EpisodeResult | null;
    }
  | { type: 'snapshot'; episodeId: string; snapshot: Snapshot }
  | { type: 'trace'; episodeId: string; row: TraceRow }
  | BubbleMessage
  | {
      type: 'placement_result';
      episodeId: string;
      kind: HazardKind;
      ok: boolean;
      reason?: string;
      code?: string;
    }
  | { type: 'provider'; episodeId: string; provider: ProviderInfo }
  | { type: 'episode_end'; episodeId: string; result: EpisodeResult }
  | { type: 'error'; episodeId: string; message: string };
