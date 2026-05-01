import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import type { Organisation } from "@/types/database";
import { getOrganisationLogoPublicUrl } from "@/lib/orgLogo";

export type OrgAffiliation = {
  organisationId: string;
  org: Organisation;
  memberCount: number;
  logoPublicUrl: string | null;
  membershipRole: "member" | "admin";
};

/**
 * Workplace networks the user belongs to (max 3 server-side).
 */
export function useOrgAffiliations(userId: string | null | undefined) {
  const [affiliations, setAffiliations] = useState<OrgAffiliation[]>([]);
  const [loading, setLoading] = useState(false);

  const reloadAffiliations = useCallback(async () => {
    if (!userId) {
      setAffiliations([]);
      return;
    }
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("user_org_memberships")
        .select("organisation_id, org_role, created_at, organisations(*)")
        .eq("user_id", userId)
        .order("created_at", { ascending: true });

      if (error || !data?.length) {
        setAffiliations([]);
        return;
      }

      const next: OrgAffiliation[] = [];
      for (const row of data as {
        organisation_id: string;
        org_role: "member" | "admin";
        organisations: Organisation | Organisation[] | null;
      }[]) {
        const oid = row.organisation_id;
        const rawOrg = row.organisations;
        const org = Array.isArray(rawOrg) ? rawOrg[0] : rawOrg;
        if (!org?.id) continue;

        const { count } = await supabase
          .from("user_org_memberships")
          .select("id", { count: "exact", head: true })
          .eq("organisation_id", oid);

        next.push({
          organisationId: oid,
          org,
          memberCount: count ?? 0,
          logoPublicUrl: getOrganisationLogoPublicUrl(org),
          membershipRole: row.org_role,
        });
      }
      setAffiliations(next);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    void reloadAffiliations();
  }, [reloadAffiliations]);

  return { affiliations, loadingAffiliations: loading, reloadAffiliations };
}
