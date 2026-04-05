-- =============================================================
-- Org route groups: parent-defined corridors / lines within an org
-- for planning and admin visibility (member counts, etc.).
-- =============================================================

CREATE TABLE public.org_route_groups (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid NOT NULL REFERENCES public.organisations (id) ON DELETE CASCADE,
  name         text NOT NULL,
  description  text,
  created_by   uuid REFERENCES public.users (id) ON DELETE SET NULL,
  archived     boolean NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT org_route_groups_name_nonempty CHECK (char_length(trim(name)) > 0)
);

CREATE INDEX idx_org_route_groups_org ON public.org_route_groups (org_id) WHERE archived = false;
CREATE INDEX idx_org_route_groups_created_by ON public.org_route_groups (created_by);

CREATE TABLE public.org_route_group_members (
  group_id   uuid NOT NULL REFERENCES public.org_route_groups (id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  joined_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (group_id, user_id)
);

CREATE INDEX idx_org_route_group_members_user ON public.org_route_group_members (user_id);

ALTER TABLE public.org_route_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.org_route_group_members ENABLE ROW LEVEL SECURITY;

-- Groups: visible to everyone in the same organisation
CREATE POLICY org_route_groups_select_same_org
  ON public.org_route_groups FOR SELECT TO authenticated
  USING (
    org_id = public.current_user_org_id()
    AND public.current_user_org_id() IS NOT NULL
  );

-- Members create groups in their org
CREATE POLICY org_route_groups_insert_member
  ON public.org_route_groups FOR INSERT TO authenticated
  WITH CHECK (
    org_id = public.current_user_org_id()
    AND public.current_user_org_id() IS NOT NULL
    AND created_by = auth.uid()
  );

-- Creator or org admin may update (e.g. archive, rename)
CREATE POLICY org_route_groups_update_creator_or_admin
  ON public.org_route_groups FOR UPDATE TO authenticated
  USING (
    org_id = public.current_user_org_id()
    AND public.current_user_org_id() IS NOT NULL
    AND (
      created_by = auth.uid()
      OR public.current_user_is_org_admin()
    )
  )
  WITH CHECK (
    org_id = public.current_user_org_id()
    AND public.current_user_org_id() IS NOT NULL
  );

-- Members: readable within org
CREATE POLICY org_route_group_members_select_same_org
  ON public.org_route_group_members FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.org_route_groups g
      WHERE g.id = org_route_group_members.group_id
        AND g.org_id = public.current_user_org_id()
        AND public.current_user_org_id() IS NOT NULL
    )
  );

-- Join a group in your org (self only)
CREATE POLICY org_route_group_members_insert_self
  ON public.org_route_group_members FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.org_route_groups g
      WHERE g.id = org_route_group_members.group_id
        AND g.org_id = public.current_user_org_id()
        AND public.current_user_org_id() IS NOT NULL
        AND g.archived = false
    )
  );

-- Leave group (self), or org admin / group creator removes members (same org only)
CREATE POLICY org_route_group_members_delete_self_or_admin
  ON public.org_route_group_members FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.org_route_groups g
      WHERE g.id = org_route_group_members.group_id
        AND g.org_id = public.current_user_org_id()
        AND public.current_user_org_id() IS NOT NULL
        AND (
          org_route_group_members.user_id = auth.uid()
          OR public.current_user_is_org_admin()
          OR g.created_by = auth.uid()
        )
    )
  );

CREATE TRIGGER set_updated_at_org_route_groups
  BEFORE UPDATE ON public.org_route_groups
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- Org admins may remove any member row in their org (covered by DELETE policy).

COMMENT ON TABLE public.org_route_groups IS
  'Named route corridor / line within an organisation for parent planning and admin reporting.';
COMMENT ON TABLE public.org_route_group_members IS
  'Users who opted into an org route group.';
