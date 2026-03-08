/**
 * ProviderAdapterRegistryLive - In-memory provider adapter lookup layer.
 *
 * Binds provider kinds (codex/cursor/...) to concrete adapter services.
 * This layer only performs adapter lookup; it does not route session-scoped
 * calls or own provider lifecycle workflows.
 *
 * @module ProviderAdapterRegistryLive
 */
import { Effect, Layer } from "effect";

import { ProviderUnsupportedError, type ProviderAdapterError } from "../Errors.ts";
import type { ProviderAdapterShape } from "../Services/ProviderAdapter.ts";
import {
  ProviderAdapterRegistry,
  type ProviderAdapterRegistryShape,
} from "../Services/ProviderAdapterRegistry.ts";
import { CodexAdapter } from "../Services/CodexAdapter.ts";
import { BedrockAdapter } from "../Services/BedrockAdapter.ts";

export interface ProviderAdapterRegistryLiveOptions {
  readonly adapters?: ReadonlyArray<ProviderAdapterShape<ProviderAdapterError>>;
}

const makeProviderAdapterRegistry = (options?: ProviderAdapterRegistryLiveOptions) =>
  Effect.gen(function* () {
    const defaults: ProviderAdapterShape<ProviderAdapterError>[] = [yield* CodexAdapter];
    // BedrockAdapter is optional — only registered if its layer is provided
    const bedrock = yield* Effect.serviceOption(BedrockAdapter);
    if (bedrock._tag === "Some") defaults.push(bedrock.value);
    const adapters = options?.adapters ?? defaults;
    const byProvider = new Map(adapters.map((adapter) => [adapter.provider, adapter]));

    const getByProvider: ProviderAdapterRegistryShape["getByProvider"] = (provider) => {
      const adapter = byProvider.get(provider);
      if (!adapter) {
        return Effect.fail(new ProviderUnsupportedError({ provider }));
      }
      return Effect.succeed(adapter);
    };

    const listProviders: ProviderAdapterRegistryShape["listProviders"] = () =>
      Effect.sync(() => Array.from(byProvider.keys()));

    return {
      getByProvider,
      listProviders,
    } satisfies ProviderAdapterRegistryShape;
  });

export const ProviderAdapterRegistryLive = Layer.effect(
  ProviderAdapterRegistry,
  makeProviderAdapterRegistry(),
);
