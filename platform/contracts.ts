export type WorkspaceRole = "owner" | "admin" | "designer" | "operator" | "customer_service";
export type ChannelMode = "shared" | "merchant";
export type PublishEnvironment = "preview" | "staging" | "production";
export type PublishStatus = "draft" | "queued" | "running" | "succeeded" | "failed" | "rolled_back";

export interface ScopedResource {
  tenantId: string;
  storeId: string;
}

export interface DesignDocument extends ScopedResource {
  id: string;
  schemaVersion: number;
  version: number;
  status: "draft" | "published";
  document: Record<string, unknown>;
  overrideKeys: string[];
  updatedAt: string;
}

export interface PublishJob extends ScopedResource {
  id: string;
  channelMode: ChannelMode;
  environment: PublishEnvironment;
  version: string;
  status: PublishStatus;
  retryCount: number;
  rollbackVersion?: string;
  requestId: string;
  createdAt: string;
}

export interface AiResponse {
  ok: boolean;
  requestId: string;
  provider: string;
  providerId?: string;
  billingMode?: "byok" | "platform" | "rules";
  type: "answer" | "faq" | "action" | "error";
  content: string;
  confidence: number;
  citations: string[];
  actions?: Array<{ id: string; label: string }>;
  usage?: { promptTokens: number; completionTokens: number; weightedPoints: number };
  fallback?: boolean;
}

export interface AiConnection extends ScopedResource {
  id: string;
  ownerType: "merchant" | "platform";
  protocol: "openai";
  providerPreset: string;
  providerName: string;
  baseUrl: string;
  model: string;
  status: "active" | "disabled";
  hasSecret: boolean;
  lastTestOk: boolean | null;
  lastTestAt?: string;
}

export interface AiPolicy extends ScopedResource {
  mode: "rules" | "byok" | "platform";
  connectionId?: string | null;
  platformConnectionId?: string | null;
  dailyPointLimit: number;
  fallbackToRules: boolean;
}

export type OperatorRole = "super_admin" | "operations" | "support" | "finance" | "auditor";

export interface PlanEntitlement {
  planId: "trial" | "starter" | "professional" | "enterprise";
  stores: number;
  skuLimit: number | null;
  storageGb: number | null;
  aiPoints: number | null;
  features: Record<string, boolean>;
}
