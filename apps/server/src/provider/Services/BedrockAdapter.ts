/**
 * BedrockAdapter - Amazon Bedrock implementation of the generic provider adapter contract.
 *
 * This service owns Bedrock AI SDK calls, tool execution, session persistence,
 * and event translation. It does not perform cross-provider routing, shared
 * event fan-out, or checkpoint orchestration.
 *
 * @module BedrockAdapter
 */
import { ServiceMap } from "effect";

import type { ProviderAdapterError } from "../Errors.ts";
import type { ProviderAdapterShape } from "./ProviderAdapter.ts";

/**
 * BedrockAdapterShape - Service API for the Bedrock provider adapter.
 */
export interface BedrockAdapterShape extends ProviderAdapterShape<ProviderAdapterError> {
  readonly provider: "bedrock";
}

/**
 * BedrockAdapter - Service tag for Bedrock provider adapter operations.
 */
export class BedrockAdapter extends ServiceMap.Service<BedrockAdapter, BedrockAdapterShape>()(
  "t3/provider/Services/BedrockAdapter",
) {}
