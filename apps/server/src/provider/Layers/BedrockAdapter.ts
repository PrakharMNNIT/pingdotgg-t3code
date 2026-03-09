/**
 * BedrockAdapterLive - Amazon Bedrock ProviderAdapter implementation.
 *
 * Wires credential resolver, tool executor, session store, prompt builder,
 * and event translator into the ProviderAdapterShape contract.
 *
 * @module BedrockAdapterLive
 */
import { Effect, Layer, Queue, Stream } from "effect";
import { createAmazonBedrock } from "@ai-sdk/amazon-bedrock";
import { generateText } from "ai";
import type {
  ApprovalRequestId,
  ProviderApprovalDecision,
  ProviderKind,
  ProviderRuntimeEvent,
  ProviderSendTurnInput,
  ProviderSession,
  ProviderSessionStartInput,
  ProviderTurnStartResult,
  ProviderUserInputAnswers,
  ThreadId,
  TurnId,
} from "@t3tools/contracts";
import { BEDROCK_MODEL_IDS } from "@t3tools/contracts";

import { BedrockAdapter, type BedrockAdapterShape } from "../Services/BedrockAdapter.ts";
import {
  ProviderAdapterRequestError,
  ProviderAdapterSessionClosedError,
  ProviderAdapterSessionNotFoundError,
  type ProviderAdapterError,
} from "../Errors.ts";
import type { ProviderAdapterCapabilities, ProviderThreadSnapshot } from "../Services/ProviderAdapter.ts";

import * as creds from "../credential/resolver.ts";
import * as executor from "../tools/executor.ts";
import * as store from "../session/store.ts";
import * as prompt from "../prompt/builder.ts";
import * as translator from "../event/translator.ts";
import { isToolName } from "../tools/definitions.ts";
import { ServerConfig } from "../../config.ts";

import * as path from "node:path";

type Session = {
  threadId: string;
  model: string;
  cwd: string;
  mode: string;
  messages: Array<Record<string, unknown>>;
  turns: number;
  state: "active" | "stopped";
  created: number;
  pending: Map<string, { resolve: (v: string) => void }>;
  abort: AbortController | null;
};

const MAX_STEPS = 25;
const CRED_CACHE_TTL = 300_000; // 5 minutes

/** Tools that never need approval (read-only). */
const APPROVAL_EXEMPT = new Set(["file_read"]);
/** Tools auto-approved in auto-approve mode (read-only network). */
const AUTO_APPROVE_EXEMPT = new Set(["file_read", "browser"]);

function needsApproval(tool: string, mode: string): boolean {
  if (mode === "full-access") return false;
  if (APPROVAL_EXEMPT.has(tool)) return false;
  if (mode === "auto-approve" && AUTO_APPROVE_EXEMPT.has(tool)) return false;
  // approval-required and auto-approve (non-exempt) need approval
  return true;
}

const makeBedrockAdapter = Effect.gen(function* () {
  const config = yield* ServerConfig;
  const dir = path.join(config.stateDir, "bedrock-sessions");
  const queue = yield* Queue.unbounded<ProviderRuntimeEvent>();
  const sessions = new Map<string, Session>();

  // P1 fix: buffer events during async callbacks, flush via Effect pipeline
  const pending: ProviderRuntimeEvent[] = [];

  function buffer(evt: ProviderRuntimeEvent): void {
    pending.push(evt);
  }

  function flush(): Effect.Effect<void> {
    if (pending.length === 0) return Effect.void;
    const batch = pending.splice(0, pending.length);
    return Queue.offerAll(queue, batch);
  }

  // P2 fix: credential cache with TTL
  let cached: { value: creds.Credentials | null; at: number } | null = null;

  async function resolve(): Promise<{ region: string; credentials: creds.Credentials | null }> {
    if (cached && Date.now() - cached.at < CRED_CACHE_TTL) {
      return { region: cached.value?.region ?? "us-east-1", credentials: cached.value };
    }
    const resolved = await creds.resolve(config.stateDir);
    cached = { value: resolved, at: Date.now() };
    return { region: resolved?.region ?? "us-east-1", credentials: resolved };
  }

  // Restore persisted sessions
  for (const data of store.list(dir)) {
    sessions.set(data.threadId, {
      threadId: data.threadId,
      model: data.model,
      cwd: data.projectDir,
      mode: data.runtimeMode,
      messages: data.messages as Array<Record<string, unknown>>,
      turns: data.turnCount,
      state: "active",
      created: data.created,
      pending: new Map(),
      abort: null,
    });
  }

  function persist(s: Session): void {
    store.save(dir, {
      threadId: s.threadId,
      model: s.model,
      created: s.created,
      updated: Date.now(),
      messages: s.messages,
      turnCount: s.turns,
      projectDir: s.cwd,
      runtimeMode: s.mode,
      state: s.state,
    });
  }

  function session(id: string): Session {
    const s = sessions.get(id);
    if (!s) throw new ProviderAdapterSessionNotFoundError({ provider: "bedrock", threadId: id });
    if (s.state === "stopped") throw new ProviderAdapterSessionClosedError({ provider: "bedrock", threadId: id });
    return s;
  }

  function modelId(slug: string): string {
    const ids = BEDROCK_MODEL_IDS as Record<string, string>;
    return ids[slug] ?? slug;
  }

  const capabilities: ProviderAdapterCapabilities = {
    sessionModelSwitch: "restart-session",
  };

  const startSession = (input: ProviderSessionStartInput): Effect.Effect<ProviderSession, ProviderAdapterError> =>
    Effect.tryPromise({
      try: async () => {
        const { credentials } = await resolve();
        if (!credentials) throw new Error("No AWS credentials found");
        const id = input.threadId as string;
        const model = (input.model ?? "claude-sonnet-4") as string;
        const cwd = (input.cwd ?? process.cwd()) as string;
        const mode = (input.runtimeMode ?? "approval-required") as string;

        const s: Session = {
          threadId: id, model, cwd, mode,
          messages: [], turns: 0, state: "active",
          created: Date.now(), pending: new Map(), abort: null,
        };
        sessions.set(id, s);
        persist(s);

        return {
          provider: "bedrock" as ProviderKind, status: "ready",
          runtimeMode: input.runtimeMode, model,
          threadId: input.threadId,
          createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
        } as unknown as ProviderSession;
      },
      catch: (err) => new ProviderAdapterRequestError({ provider: "bedrock", method: "startSession", detail: String(err) }),
    });

  const sendTurn = (input: ProviderSendTurnInput): Effect.Effect<ProviderTurnStartResult, ProviderAdapterError> =>
    Effect.gen(function* () {
      const result = yield* Effect.tryPromise({
        try: async () => {
          const s = session(input.threadId as string);
          const turnId = crypto.randomUUID() as TurnId;
          const text = (input.input ?? "") as string;

          s.messages.push({ role: "user", content: text });
          s.abort = new AbortController();

          const { credentials, region } = await resolve();
          if (!credentials) throw new Error("No AWS credentials");

          const opts: Record<string, unknown> = {
            region, accessKeyId: credentials.accessKeyId, secretAccessKey: credentials.secretAccessKey,
          };
          if (credentials.sessionToken) opts.sessionToken = credentials.sessionToken;
          const bedrock = createAmazonBedrock(opts as Parameters<typeof createAmazonBedrock>[0]);

          const mid = modelId(s.model);
          const sys = prompt.build(s.cwd);
          const ctx = { threadId: s.threadId, turnId: turnId as string };

          // TODO: Replace (generateText as Function) with typed call when AI SDK v6 + zod v4 compat is resolved
          const params: Record<string, unknown> = {
            model: bedrock(mid), system: sys, messages: s.messages,
            maxSteps: MAX_STEPS, abortSignal: s.abort.signal,
            onStepFinish: async (step: Record<string, unknown>) => {
              const txt = step.text as string | undefined;
              if (txt) {
                const evt = translator.translate({ type: "text-done", text: txt }, ctx);
                if (evt) buffer(evt as unknown as ProviderRuntimeEvent);
              }
              const calls = step.toolCalls as Array<Record<string, unknown>> | undefined;
              if (calls) {
                for (const tc of calls) {
                  const name = tc.toolName as string;
                  if (!isToolName(name)) continue;
                  const args = tc.args as Record<string, unknown>;

                  const callEvt = translator.translate(
                    { type: "tool-call", toolCallId: tc.toolCallId, toolName: name, args }, ctx,
                  );
                  if (callEvt) buffer(callEvt as unknown as ProviderRuntimeEvent);

                  // P1 fix: check approval before executing tool
                  if (needsApproval(name, s.mode)) {
                    const reqId = crypto.randomUUID();
                    const approval = translator.approval(ctx, reqId, name, args);
                    buffer(approval as unknown as ProviderRuntimeEvent);

                    // Await user decision via deferred promise
                    const decision = await new Promise<string>((res) => {
                      s.pending.set(reqId, { resolve: res });
                    });
                    s.pending.delete(reqId);

                    if (decision === "decline" || decision === "cancel") {
                      const denied = translator.toolOutput(ctx, tc.toolCallId as string, "User denied this tool call", true);
                      buffer(denied as unknown as ProviderRuntimeEvent);
                      continue;
                    }
                  }

                  const toolResult = await executor.execute(name, args, { root: s.cwd });
                  const resultEvt = translator.toolOutput(ctx, tc.toolCallId as string, toolResult.output, toolResult.error);
                  buffer(resultEvt as unknown as ProviderRuntimeEvent);
                }
              }
            },
          };

          const res = await (generateText as Function)(params) as { text: string; finishReason: string };

          s.messages.push({ role: "assistant", content: res.text });
          s.turns++;
          s.abort = null;
          persist(s);

          const done = translator.translate({ type: "finish", finishReason: res.finishReason }, ctx);
          if (done) buffer(done as unknown as ProviderRuntimeEvent);

          return { threadId: input.threadId, turnId } as unknown as ProviderTurnStartResult;
        },
        catch: (err) => new ProviderAdapterRequestError({ provider: "bedrock", method: "sendTurn", detail: String(err) }),
      });

      // P1 fix: flush buffered events through Effect pipeline (not runSync)
      yield* flush();
      return result;
    });

  const interruptTurn = (threadId: ThreadId): Effect.Effect<void, ProviderAdapterError> =>
    Effect.sync(() => {
      const s = sessions.get(threadId as string);
      if (s?.abort) { s.abort.abort(); s.abort = null; }
    });

  const respondToRequest = (
    threadId: ThreadId, requestId: ApprovalRequestId, decision: ProviderApprovalDecision,
  ): Effect.Effect<void, ProviderAdapterError> =>
    Effect.sync(() => {
      const s = sessions.get(threadId as string);
      const p = s?.pending.get(requestId as string);
      if (p) { p.resolve(decision as string); s?.pending.delete(requestId as string); }
    });

  const respondToUserInput = (
    threadId: ThreadId, _requestId: ApprovalRequestId, _answers: ProviderUserInputAnswers,
  ): Effect.Effect<void, ProviderAdapterError> =>
    Effect.sync(() => { void threadId; });

  const stopSession = (threadId: ThreadId): Effect.Effect<void, ProviderAdapterError> =>
    Effect.sync(() => {
      const s = sessions.get(threadId as string);
      if (s) { s.state = "stopped"; s.abort?.abort(); s.abort = null; persist(s); }
    });

  const listSessions = (): Effect.Effect<ReadonlyArray<ProviderSession>> =>
    Effect.sync(() =>
      Array.from(sessions.values())
        .filter((s) => s.state === "active")
        .map((s) => ({
          provider: "bedrock" as ProviderKind, status: "ready", runtimeMode: s.mode,
          model: s.model, threadId: s.threadId,
          createdAt: new Date(s.created).toISOString(), updatedAt: new Date().toISOString(),
        }) as unknown as ProviderSession),
    );

  const hasSession = (threadId: ThreadId): Effect.Effect<boolean> =>
    Effect.sync(() => {
      const s = sessions.get(threadId as string);
      return s !== undefined && s.state === "active";
    });

  const readThread = (threadId: ThreadId): Effect.Effect<ProviderThreadSnapshot, ProviderAdapterError> =>
    Effect.try({
      try: () => { session(threadId as string); return { threadId, turns: [] } as ProviderThreadSnapshot; },
      catch: (err) => new ProviderAdapterSessionNotFoundError({ provider: "bedrock", threadId: threadId as string, cause: err as Error }),
    });

  const rollbackThread = (threadId: ThreadId, count: number): Effect.Effect<ProviderThreadSnapshot, ProviderAdapterError> =>
    Effect.try({
      try: () => {
        const s = session(threadId as string);
        const remove = Math.min(count * 2, s.messages.length);
        s.messages.splice(s.messages.length - remove, remove);
        s.turns = Math.max(0, s.turns - count);
        persist(s);
        return { threadId, turns: [] } as ProviderThreadSnapshot;
      },
      catch: (err) => new ProviderAdapterSessionNotFoundError({ provider: "bedrock", threadId: threadId as string, cause: err as Error }),
    });

  const stopAll = (): Effect.Effect<void, ProviderAdapterError> =>
    Effect.sync(() => {
      for (const s of sessions.values()) { s.state = "stopped"; s.abort?.abort(); s.abort = null; persist(s); }
    });

  const streamEvents: Stream.Stream<ProviderRuntimeEvent> = Stream.fromQueue(queue);

  return {
    provider: "bedrock" as const, capabilities,
    startSession, sendTurn, interruptTurn, respondToRequest, respondToUserInput,
    stopSession, listSessions, hasSession, readThread, rollbackThread, stopAll, streamEvents,
  } satisfies BedrockAdapterShape;
});

export const BedrockAdapterLive = Layer.effect(BedrockAdapter, makeBedrockAdapter);
