import { useQuery } from "@tanstack/react-query";
import { getDatasetById } from "@/api/endpoints";

/**
 * The dataset a `/dataset/$id` route names — by numeric id or short
 * name, whichever the URL carried.
 *
 * One definition because two places read it: the dataset page, and the
 * footer's Curation link, which needs the numeric id the curation app
 * routes on when the URL only has `GSE…`. Same key, so on a dataset page
 * the footer shares the page's request rather than making its own.
 * `undefined` asks for nothing.
 */
export function useDataset(id: string | undefined) {
  return useQuery({
    queryKey: ["dataset", id],
    queryFn: ({ signal }) => getDatasetById(id!, signal),
    enabled: !!id,
  });
}
