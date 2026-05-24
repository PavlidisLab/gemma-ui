import { useQuery } from "@tanstack/react-query";
import { api } from "./client";

/**
 * Mirrors Gemma's `QuantitationTypeValueObject`. The mock proxies
 * to the raw gemmapy SDK response so every column the production
 * Gemma QT tab shows comes through (the gemmapy DataFrame helper
 * drops most fields).
 */
export interface QuantitationType {
  id: number;
  name: string;
  description: string;
  general_type: string;            // "QUANTITATIVE" | "CATEGORICAL"
  type: string;                    // "AMOUNT" | "COUNT" | "PRESENT_ABSENT" | …
  representation: string;          // "DOUBLE" | "INT" | …
  scale: string;                   // "LOG2" | "LINEAR" | "COUNT" | …
  is_background: boolean;
  is_background_subtracted: boolean;
  is_batch_corrected: boolean;
  is_normalized: boolean;
  is_ratio: boolean;
  is_recomputed_from_raw_data: boolean;
  is_preferred: boolean;
  is_masked_preferred: boolean;
  vector_type: string;
}

const KEY = (experimentId: number | string) =>
  ["quantitation-types", experimentId] as const;

export function useQuantitationTypes(experimentId: number | string) {
  return useQuery({
    queryKey: KEY(experimentId),
    queryFn: () =>
      api.get<QuantitationType[]>(
        `/rest/v2/datasets/${experimentId}/quantitationTypes`,
      ),
    staleTime: 1000 * 60 * 30,
  });
}
