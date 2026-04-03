import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import type { OrganisationNetworkStatus } from "@/types/database";

export type AdminOrgBillingState = {
  organisation_status: OrganisationNetworkStatus | null;
  grace_started_at: string | null;
  days_remaining_in_grace: number | null;
};

export function useAdminOrgBilling(enabled: boolean) {
  const [state, setState] = useState<AdminOrgBillingState | null>(null);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!enabled) {
      setState(null);
      return;
    }
    setLoading(true);
    try {
      const { data, error } = await supabase.rpc("poolyn_org_billing_state_for_admin");
      if (error) throw error;
      const row = data as Record<string, unknown> | null;
      setState({
        organisation_status: (row?.organisation_status as OrganisationNetworkStatus) ?? null,
        grace_started_at: (row?.grace_started_at as string) ?? null,
        days_remaining_in_grace:
          typeof row?.days_remaining_in_grace === "number"
            ? row.days_remaining_in_grace
            : null,
      });
    } catch {
      setState(null);
    } finally {
      setLoading(false);
    }
  }, [enabled]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { billing: state, billingLoading: loading, refreshBilling: refresh };
}
