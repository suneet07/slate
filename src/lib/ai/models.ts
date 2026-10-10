/** 'cli' is not in SUPPORTED_MODELS: it is the signed-in CLI connection, chosen in Settings. */
export type ModelProvider = 'nvidia' | 'groq' | 'openai' | 'custom' | 'cli';

export interface AiModelConfig {
  id: string;
  name: string;
  provider: ModelProvider;
  providerName: string;
  description: string;
  isRecommended?: boolean;
  requiresKey: 'llmApiKey' | 'groqApiKey' | 'openaiApiKey' | 'none';
}

export const SUPPORTED_MODELS: AiModelConfig[] = [
  // NVIDIA NIM & DeepSeek
  {
    id: 'deepseek-ai/deepseek-v4-flash',
    name: 'DeepSeek V4 Flash',
    provider: 'nvidia',
    providerName: 'NVIDIA NIM',
    description: 'Ultra-fast structured reasoning & scene graph editing',
    isRecommended: true,
    requiresKey: 'llmApiKey'
  },
  {
    id: 'deepseek-ai/deepseek-r1',
    name: 'DeepSeek R1 Reasoning',
    provider: 'nvidia',
    providerName: 'NVIDIA NIM',
    description: 'Deep chain-of-thought reasoning for complex diagrams',
    requiresKey: 'llmApiKey'
  },
  {
    id: 'deepseek-ai/deepseek-v3',
    name: 'DeepSeek V3',
    provider: 'nvidia',
    providerName: 'NVIDIA NIM',
    description: '671B parameter high-precision architecture model',
    requiresKey: 'llmApiKey'
  },
  {
    id: 'nvidia/nemotron-4-340b-instruct',
    name: 'NVIDIA Nemotron 4 340B',
    provider: 'nvidia',
    providerName: 'NVIDIA NIM',
    description: 'NVIDIA flagship synthetic & instructional model',
    requiresKey: 'llmApiKey'
  },

  // Groq LLaMA
  {
    id: 'llama-3.3-70b-versatile',
    name: 'LLaMA 3.3 70B Versatile',
    provider: 'groq',
    providerName: 'Groq Cloud',
    description: '70B parameters running on LPU ultra-low latency hardware',
    isRecommended: true,
    requiresKey: 'groqApiKey'
  },
  {
    id: 'llama3-8b-8192',
    name: 'LLaMA 3 8B Fast',
    provider: 'groq',
    providerName: 'Groq Cloud',
    description: 'Instant sub-100ms response time for rapid edits',
    requiresKey: 'groqApiKey'
  },
  {
    id: 'mixtral-8x7b-32768',
    name: 'Mixtral 8x7B MoE',
    provider: 'groq',
    providerName: 'Groq Cloud',
    description: 'Mixture of Experts for instructional diagram execution',
    requiresKey: 'groqApiKey'
  },

  // OpenAI
  {
    id: 'gpt-4o',
    name: 'OpenAI GPT-4o',
    provider: 'openai',
    providerName: 'OpenAI',
    description: 'Omni-modal high precision logic model',
    requiresKey: 'openaiApiKey'
  },
  {
    id: 'gpt-4o-mini',
    name: 'OpenAI GPT-4o Mini',
    provider: 'openai',
    providerName: 'OpenAI',
    description: 'Lightweight & cost-efficient structured model',
    requiresKey: 'openaiApiKey'
  },
  {
    id: 'o3-mini',
    name: 'OpenAI o3-mini Reasoning',
    provider: 'openai',
    providerName: 'OpenAI',
    description: 'STEM reasoning model for complex whiteboard diagrams',
    requiresKey: 'openaiApiKey'
  },

  // Local / Custom Endpoint
  {
    id: 'custom-model',
    name: 'Custom Endpoint / Local LLM',
    provider: 'custom',
    providerName: 'Ollama / LM Studio / OpenRouter',
    description: 'Connect to local vLLM, Ollama, LM Studio, or OpenRouter endpoint',
    requiresKey: 'none'
  }
];

export function getModelConfig(modelId: string): AiModelConfig {
  const found = SUPPORTED_MODELS.find((m) => m.id === modelId);
  if (found) return found;

  // Custom model fallback
  return {
    id: modelId,
    name: modelId.split('/').pop() || modelId,
    provider: 'custom',
    providerName: 'Custom Endpoint',
    description: `Custom model ID: ${modelId}`,
    requiresKey: 'none'
  };
}
