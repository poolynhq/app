-- Corridor labels are computed by Poolyn (see poolyn_org_auto_route_corridors).
-- Retain org_route_groups / org_route_group_members for historical rows only;
-- authenticated users may no longer create, edit, join, or leave manual groups.

DROP POLICY IF EXISTS org_route_groups_insert_member ON public.org_route_groups;
DROP POLICY IF EXISTS org_route_groups_update_creator_or_admin ON public.org_route_groups;
DROP POLICY IF EXISTS org_route_group_members_insert_self ON public.org_route_group_members;
DROP POLICY IF EXISTS org_route_group_members_delete_self_or_admin ON public.org_route_group_members;

COMMENT ON TABLE public.org_route_groups IS
  'Deprecated manual corridor tags; reads only. Use poolyn_org_auto_route_corridors for org admin.';
COMMENT ON TABLE public.org_route_group_members IS
  'Deprecated; reads only. Corridor membership is not user-managed.';
