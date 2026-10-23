import { useState, useEffect, useCallback, useMemo } from "react";
import { api } from "../api/client";

interface ProviderModel {
  id: string;
  vision?: number;
  context?: string;
}

interface Provider {
  id: string;
  name: string;
  baseUrl: string;
  apiFormat: string;
  apiKey: string;
  modelList: ProviderModel[];
  enabled: number;
  isCustom: number;
  createdAt: number;
}

export function useProviders() {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const list = await (api as unknown as { listProviders: () => Promise<Provider[]> }).listProviders();
      setProviders(list);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  // Old/deprecated models hidden everywhere (user request): glm-4*, llama*, gpt-oss*
  const isOldModel = (id: string) => /glm-4/i.test(id) || /llama/i.test(id) || /gpt-oss/i.test(id);

  const allModels = useMemo(() => {
    const models: Array<{ id: string; name: string; provider: string; providerLabel: string; description: string; baseUrl: string; apiFormat: string; context?: number | string }> = [];
    for (const p of providers) {
      if (!p.enabled) continue;
      for (const m of p.modelList) {
        if (isOldModel(m.id)) continue;
        models.push({
          id: m.id,
          name: m.id.split("/").pop() || m.id,
          provider: p.id,
          providerLabel: p.name,
          description: `${p.name} • ${m.context || ""} ${m.vision ? "Vision" : ""}`.trim(),
          baseUrl: p.baseUrl,
          apiFormat: p.apiFormat,
          context: m.context,
        });
      }
    }
    return models;
  }, [providers]);

  return { providers, loading, refresh, allModels };
}
