/**
 * Poolyn — Supabase Database Types
 *
 * Mirrors the schema defined in 0001_initial_schema.sql.
 * In production, regenerate with:
 *   npx supabase gen types typescript --project-id <id> > src/types/database.ts
 *
 * This hand-authored version provides the initial type safety
 * before the remote project exists.
 */

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

/** PostGIS geography point serialised by Supabase as GeoJSON or WKT */
export type GeoPoint = string | null;
/** PostGIS geography linestring serialised by Supabase */
export type GeoLineString = string | null;

// ── Enum-like union types ─────────────────────────────────

export type OrgType = "enterprise" | "community";
export type OrgPlan = "free" | "starter" | "business" | "enterprise";
/** Private network + billing lifecycle (see migration 0030). */
export type OrganisationNetworkStatus =
  | "active"
  | "grace"
  | "inactive"
  | "dissolved";
export type UserRole = "driver" | "passenger" | "both";
export type VisibilityMode = "network" | "nearby";
export type OrgRole = "member" | "admin";
export type RegistrationType = "enterprise" | "independent";
export type ScheduleType = "fixed_weekly" | "shift_window" | "adhoc";
export type RideStatus = "scheduled" | "active" | "completed" | "cancelled";
export type RideType = "adhoc" | "recurring";
export type RideDirection = "to_work" | "from_work" | "custom";
export type RideRequestStatus = "pending" | "matched" | "expired" | "cancelled";
export type PassengerStatus =
  | "pending"
  | "confirmed"
  | "picked_up"
  | "dropped_off"
  | "completed"
  | "cancelled"
  | "no_show";
export type RidePassengerPaymentStatus = "pending" | "paid" | "failed";
export type SuggestionPartyStatus = "pending" | "accepted" | "declined";
export type SuggestionStatus = "pending" | "accepted" | "declined" | "expired";
export type MatchNetworkScope = "network" | "extended";
export type Gender = "male" | "female" | "non_binary" | "prefer_not_to_say";
export type GenderPref = "any" | "same" | "male" | "female";
export type PointsTxnType =
  | "ride_driver_earn"
  | "ride_passenger_spend"
  | "signup_bonus"
  | "referral_bonus"
  | "consistency_bonus"
  | "admin_adjustment";
export type FlexCreditTxnType =
  | "monthly_grant"
  | "earned_consistency"
  | "used_late_cancel"
  | "used_no_show"
  | "used_schedule_change"
  | "employer_grant"
  | "admin_adjustment";
/** Poolyn commute credits ledger (Phase 6); not flex credits, not cash. */
export type CommuteCreditTxnType =
  | "credit_earned"
  | "credit_used"
  | "credit_adjustment";
export type ReportReason =
  | "unsafe_driving"
  | "harassment"
  | "no_show"
  | "inappropriate_behaviour"
  | "vehicle_condition"
  | "other";
export type ReportStatus = "pending" | "reviewing" | "resolved" | "dismissed";
export type BadgeCriteriaType =
  | "ride_count"
  | "rating_avg"
  | "streak"
  | "points_milestone"
  | "verification"
  | "manual";
export type SubscriptionStatus =
  | "active"
  | "past_due"
  | "cancelled"
  | "trialing";

// ── Row / Insert / Update shapes per table ────────────────

export interface Database {
  public: {
    Tables: {
      organisations: {
        Row: {
          id: string;
          name: string;
          domain: string;
          org_type: OrgType;
          plan: OrgPlan;
          max_seats: number | null;
          allow_cross_org: boolean;
          invite_code: string | null;
          invite_code_active: boolean;
          estimated_team_size: number | null;
          work_locations: Json;
          trial_ends_at: string | null;
          active: boolean;
          status: OrganisationNetworkStatus;
          grace_started_at: string | null;
          settings: Json;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          domain: string;
          org_type?: OrgType;
          plan?: OrgPlan;
          max_seats?: number | null;
          allow_cross_org?: boolean;
          invite_code?: string | null;
          invite_code_active?: boolean;
          estimated_team_size?: number | null;
          work_locations?: Json;
          trial_ends_at?: string | null;
          active?: boolean;
          status?: OrganisationNetworkStatus;
          grace_started_at?: string | null;
          settings?: Json;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          domain?: string;
          org_type?: OrgType;
          plan?: OrgPlan;
          max_seats?: number | null;
          allow_cross_org?: boolean;
          invite_code?: string | null;
          invite_code_active?: boolean;
          estimated_team_size?: number | null;
          work_locations?: Json;
          trial_ends_at?: string | null;
          active?: boolean;
          status?: OrganisationNetworkStatus;
          grace_started_at?: string | null;
          settings?: Json;
          updated_at?: string;
        };
      };

      org_route_groups: {
        Row: {
          id: string;
          org_id: string;
          name: string;
          description: string | null;
          created_by: string | null;
          archived: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          org_id: string;
          name: string;
          description?: string | null;
          created_by?: string | null;
          archived?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          name?: string;
          description?: string | null;
          created_by?: string | null;
          archived?: boolean;
          updated_at?: string;
        };
      };

      org_route_group_members: {
        Row: {
          group_id: string;
          user_id: string;
          joined_at: string;
        };
        Insert: {
          group_id: string;
          user_id: string;
          joined_at?: string;
        };
        Update: {
          joined_at?: string;
        };
      };

      platform_super_admins: {
        Row: {
          user_id: string;
          note: string | null;
          created_at: string;
        };
        Insert: {
          user_id: string;
          note?: string | null;
          created_at?: string;
        };
        Update: {
          user_id?: string;
          note?: string | null;
          created_at?: string;
        };
      };

      users: {
        Row: {
          id: string;
          org_id: string | null;
          email: string;
          full_name: string | null;
          phone_number: string | null;
          avatar_url: string | null;
          role: UserRole;
          visibility_mode: VisibilityMode;
          org_role: OrgRole;
          registration_type: RegistrationType;
          home_location: GeoPoint;
          pickup_location: GeoPoint;
          work_location: GeoPoint;
          work_location_label: string | null;
          detour_tolerance_mins: number;
          reliability_score: number;
          schedule_flex_mins: number;
          home_geohash: string | null;
          work_geohash: string | null;
          points_balance: number;
          flex_credits_balance: number;
          commute_credits_balance: number;
          licence_number: string | null;
          license_verified: boolean;
          gender: Gender | null;
          same_gender_pref: boolean;
          org_member_verified: boolean;
          active_mode: "driver" | "passenger" | null;
          driver_show_outer_network_riders: boolean;
          onboarding_completed: boolean;
          active: boolean;
          created_at: string;
          updated_at: string;
          notification_preferences: Json;
        };
        Insert: {
          id: string;
          org_id?: string | null;
          email: string;
          full_name?: string | null;
          phone_number?: string | null;
          avatar_url?: string | null;
          role?: UserRole;
          visibility_mode?: VisibilityMode;
          org_role?: OrgRole;
          registration_type?: RegistrationType;
          home_location?: GeoPoint;
          pickup_location?: GeoPoint;
          work_location?: GeoPoint;
          work_location_label?: string | null;
          detour_tolerance_mins?: number;
          reliability_score?: number;
          schedule_flex_mins?: number;
          home_geohash?: string | null;
          work_geohash?: string | null;
          points_balance?: number;
          flex_credits_balance?: number;
          commute_credits_balance?: number;
          licence_number?: string | null;
          license_verified?: boolean;
          gender?: Gender | null;
          same_gender_pref?: boolean;
          org_member_verified?: boolean;
          active_mode?: "driver" | "passenger" | null;
          driver_show_outer_network_riders?: boolean;
          onboarding_completed?: boolean;
          active?: boolean;
          created_at?: string;
          updated_at?: string;
          notification_preferences?: Json;
        };
        Update: {
          org_id?: string | null;
          full_name?: string | null;
          phone_number?: string | null;
          avatar_url?: string | null;
          role?: UserRole;
          visibility_mode?: VisibilityMode;
          org_role?: OrgRole;
          home_location?: GeoPoint;
          pickup_location?: GeoPoint;
          work_location?: GeoPoint;
          work_location_label?: string | null;
          detour_tolerance_mins?: number;
          reliability_score?: number;
          schedule_flex_mins?: number;
          home_geohash?: string | null;
          work_geohash?: string | null;
          licence_number?: string | null;
          license_verified?: boolean;
          gender?: Gender | null;
          same_gender_pref?: boolean;
          org_member_verified?: boolean;
          active_mode?: "driver" | "passenger" | null;
          driver_show_outer_network_riders?: boolean;
          onboarding_completed?: boolean;
          active?: boolean;
          updated_at?: string;
          notification_preferences?: Json;
        };
      };

      vehicles: {
        Row: {
          id: string;
          user_id: string;
          make: string;
          model: string;
          colour: string | null;
          plate: string | null;
          seats: number;
          vehicle_class: string;
          photo_url: string | null;
          active: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          make: string;
          model: string;
          colour?: string | null;
          plate?: string | null;
          seats: number;
          vehicle_class?: string;
          photo_url?: string | null;
          active?: boolean;
          created_at?: string;
        };
        Update: {
          user_id?: string;
          make?: string;
          model?: string;
          colour?: string | null;
          plate?: string | null;
          seats?: number;
          vehicle_class?: string;
          photo_url?: string | null;
          active?: boolean;
        };
      };

      waitlist_signups: {
        Row: {
          id: string;
          email: string;
          full_name: string | null;
          metro_area: string | null;
          intent: string | null;
          source: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          email: string;
          full_name?: string | null;
          metro_area?: string | null;
          intent?: string | null;
          source?: string | null;
          created_at?: string;
        };
        Update: {
          email?: string;
          full_name?: string | null;
          metro_area?: string | null;
          intent?: string | null;
          source?: string | null;
        };
      };

      commute_routes: {
        Row: {
          id: string;
          user_id: string;
          direction: string;
          encoded_polyline: string | null;
          route_geom: GeoLineString;
          distance_m: number;
          duration_s: number;
          bbox_min_lng: number;
          bbox_min_lat: number;
          bbox_max_lng: number;
          bbox_max_lat: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          direction?: string;
          encoded_polyline?: string | null;
          route_geom: GeoLineString;
          distance_m: number;
          duration_s: number;
          bbox_min_lng: number;
          bbox_min_lat: number;
          bbox_max_lng: number;
          bbox_max_lat: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          encoded_polyline?: string | null;
          route_geom?: GeoLineString;
          distance_m?: number;
          duration_s?: number;
          bbox_min_lng?: number;
          bbox_min_lat?: number;
          bbox_max_lng?: number;
          bbox_max_lat?: number;
          updated_at?: string;
        };
      };

      crew_members: {
        Row: {
          crew_id: string;
          user_id: string;
          role: string;
          joined_at: string;
        };
        Insert: {
          crew_id: string;
          user_id: string;
          role?: string;
          joined_at?: string;
        };
        Update: {
          role?: string;
        };
      };

      crew_messages: {
        Row: {
          id: string;
          crew_trip_instance_id: string;
          sender_id: string | null;
          body: string;
          kind: string;
          meta: Json;
          sent_at: string;
        };
        Insert: {
          id?: string;
          crew_trip_instance_id: string;
          sender_id?: string | null;
          body: string;
          kind?: string;
          meta?: Json;
          sent_at?: string;
        };
        Update: never;
      };

      crew_trip_instances: {
        Row: {
          id: string;
          crew_id: string;
          trip_date: string;
          designated_driver_user_id: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          crew_id: string;
          trip_date: string;
          designated_driver_user_id?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          designated_driver_user_id?: string | null;
          updated_at?: string;
        };
      };

      crew_invitations: {
        Row: {
          id: string;
          crew_id: string;
          invited_user_id: string;
          invited_by_user_id: string;
          message: string | null;
          status: string;
          created_at: string;
          responded_at: string | null;
        };
        Insert: {
          id?: string;
          crew_id: string;
          invited_user_id: string;
          invited_by_user_id: string;
          message?: string | null;
          status?: string;
          created_at?: string;
          responded_at?: string | null;
        };
        Update: {
          status?: string;
          responded_at?: string | null;
        };
      };

      crews: {
        Row: {
          id: string;
          name: string;
          org_id: string | null;
          created_by: string;
          invite_code: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          org_id?: string | null;
          created_by: string;
          invite_code?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          name?: string;
          updated_at?: string;
        };
      };

      driver_preferences: {
        Row: {
          id: string;
          user_id: string;
          max_detour_mins: number;
          max_passengers: number;
          auto_accept: boolean;
          gender_pref: GenderPref;
          quiet_ride: boolean;
          smoking_ok: boolean;
          pets_ok: boolean;
          music_ok: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          max_detour_mins?: number;
          max_passengers?: number;
          auto_accept?: boolean;
          gender_pref?: GenderPref;
          quiet_ride?: boolean;
          smoking_ok?: boolean;
          pets_ok?: boolean;
          music_ok?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          max_detour_mins?: number;
          max_passengers?: number;
          auto_accept?: boolean;
          gender_pref?: GenderPref;
          quiet_ride?: boolean;
          smoking_ok?: boolean;
          pets_ok?: boolean;
          music_ok?: boolean;
          updated_at?: string;
        };
      };

      driver_trusted_passengers: {
        Row: {
          driver_id: string;
          passenger_id: string;
          created_at: string;
        };
        Insert: {
          driver_id: string;
          passenger_id: string;
          created_at?: string;
        };
        Update: {
          created_at?: string;
        };
      };

      schedules: {
        Row: {
          id: string;
          user_id: string;
          type: ScheduleType;
          weekday_times: Json | null;
          shift_start: string | null;
          shift_end: string | null;
          tolerance_mins: number;
          active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          type: ScheduleType;
          weekday_times?: Json | null;
          shift_start?: string | null;
          shift_end?: string | null;
          tolerance_mins?: number;
          active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          type?: ScheduleType;
          weekday_times?: Json | null;
          shift_start?: string | null;
          shift_end?: string | null;
          tolerance_mins?: number;
          active?: boolean;
          updated_at?: string;
        };
      };

      emergency_contacts: {
        Row: {
          id: string;
          user_id: string;
          name: string;
          phone_number: string;
          relationship: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          name: string;
          phone_number: string;
          relationship?: string | null;
          created_at?: string;
        };
        Update: {
          name?: string;
          phone_number?: string;
          relationship?: string | null;
        };
      };

      rides: {
        Row: {
          id: string;
          driver_id: string;
          vehicle_id: string;
          depart_at: string;
          return_at: string | null;
          status: RideStatus;
          ride_type: RideType;
          direction: RideDirection;
          origin: GeoPoint;
          destination: GeoPoint;
          route_geometry: GeoLineString;
          origin_cluster: string | null;
          destination_cluster: string | null;
          seats_available: number;
          recurrence_rule: string | null;
          notes: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          driver_id: string;
          vehicle_id: string;
          depart_at: string;
          return_at?: string | null;
          status?: RideStatus;
          ride_type?: RideType;
          direction?: RideDirection;
          origin: GeoPoint;
          destination: GeoPoint;
          route_geometry?: GeoLineString;
          origin_cluster?: string | null;
          destination_cluster?: string | null;
          seats_available: number;
          recurrence_rule?: string | null;
          notes?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          vehicle_id?: string;
          depart_at?: string;
          return_at?: string | null;
          status?: RideStatus;
          direction?: RideDirection;
          origin?: GeoPoint;
          destination?: GeoPoint;
          route_geometry?: GeoLineString;
          origin_cluster?: string | null;
          destination_cluster?: string | null;
          seats_available?: number;
          recurrence_rule?: string | null;
          notes?: string | null;
          updated_at?: string;
        };
      };

      ride_requests: {
        Row: {
          id: string;
          passenger_id: string;
          origin: GeoPoint;
          destination: GeoPoint;
          direction: RideDirection;
          desired_depart_at: string;
          flexibility_mins: number;
          status: RideRequestStatus;
          matched_ride_id: string | null;
          notes: string | null;
          created_at: string;
          expires_at: string;
        };
        Insert: {
          id?: string;
          passenger_id: string;
          origin: GeoPoint;
          destination: GeoPoint;
          direction?: RideDirection;
          desired_depart_at: string;
          flexibility_mins?: number;
          status?: RideRequestStatus;
          matched_ride_id?: string | null;
          notes?: string | null;
          created_at?: string;
          expires_at?: string;
        };
        Update: {
          origin?: GeoPoint;
          destination?: GeoPoint;
          direction?: RideDirection;
          desired_depart_at?: string;
          flexibility_mins?: number;
          status?: RideRequestStatus;
          matched_ride_id?: string | null;
          notes?: string | null;
          expires_at?: string;
        };
      };

      ride_passengers: {
        Row: {
          id: string;
          ride_id: string;
          passenger_id: string;
          status: PassengerStatus;
          pickup_point: GeoPoint;
          pickup_order: number | null;
          estimated_pickup_at: string | null;
          confirmed_at: string | null;
          picked_up_at: string | null;
          dropped_off_at: string | null;
          points_cost: number;
          flex_credit_used: boolean;
          expected_contribution_cents: number;
          network_fee_cents: number;
          cash_to_charge_cents: number;
          payment_status: RidePassengerPaymentStatus;
          stripe_payment_intent_id: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          ride_id: string;
          passenger_id: string;
          status?: PassengerStatus;
          pickup_point?: GeoPoint;
          pickup_order?: number | null;
          estimated_pickup_at?: string | null;
          confirmed_at?: string | null;
          picked_up_at?: string | null;
          dropped_off_at?: string | null;
          points_cost?: number;
          flex_credit_used?: boolean;
          expected_contribution_cents?: number;
          network_fee_cents?: number;
          cash_to_charge_cents?: number;
          payment_status?: RidePassengerPaymentStatus;
          stripe_payment_intent_id?: string | null;
          created_at?: string;
        };
        Update: {
          status?: PassengerStatus;
          pickup_point?: GeoPoint;
          pickup_order?: number | null;
          estimated_pickup_at?: string | null;
          confirmed_at?: string | null;
          picked_up_at?: string | null;
          dropped_off_at?: string | null;
          points_cost?: number;
          flex_credit_used?: boolean;
          expected_contribution_cents?: number;
          network_fee_cents?: number;
          cash_to_charge_cents?: number;
          payment_status?: RidePassengerPaymentStatus;
          stripe_payment_intent_id?: string | null;
        };
      };

      match_suggestions: {
        Row: {
          id: string;
          ride_id: string | null;
          ride_request_id: string | null;
          driver_id: string;
          passenger_id: string;
          match_score: number;
          detour_mins: number | null;
          distance_meters: number | null;
          route_similarity_score: number | null;
          time_overlap_mins: number | null;
          network_scope: MatchNetworkScope;
          driver_status: SuggestionPartyStatus;
          passenger_status: SuggestionPartyStatus;
          status: SuggestionStatus;
          created_at: string;
          expires_at: string;
        };
        Insert: {
          id?: string;
          ride_id?: string | null;
          ride_request_id?: string | null;
          driver_id: string;
          passenger_id: string;
          match_score?: number;
          detour_mins?: number | null;
          distance_meters?: number | null;
          route_similarity_score?: number | null;
          time_overlap_mins?: number | null;
          network_scope?: MatchNetworkScope;
          driver_status?: SuggestionPartyStatus;
          passenger_status?: SuggestionPartyStatus;
          status?: SuggestionStatus;
          created_at?: string;
          expires_at?: string;
        };
        Update: {
          driver_status?: SuggestionPartyStatus;
          passenger_status?: SuggestionPartyStatus;
          status?: SuggestionStatus;
          route_similarity_score?: number | null;
          time_overlap_mins?: number | null;
          network_scope?: MatchNetworkScope;
          expires_at?: string;
        };
      };

      messages: {
        Row: {
          id: string;
          ride_id: string;
          sender_id: string;
          body: string;
          sent_at: string;
        };
        Insert: {
          id?: string;
          ride_id: string;
          sender_id: string;
          body: string;
          sent_at?: string;
        };
        Update: {
          body?: string;
        };
      };

      live_locations: {
        Row: {
          id: string;
          ride_id: string;
          user_id: string;
          location: GeoPoint;
          heading: number | null;
          speed: number | null;
          recorded_at: string;
        };
        Insert: {
          id?: string;
          ride_id: string;
          user_id: string;
          location: GeoPoint;
          heading?: number | null;
          speed?: number | null;
          recorded_at?: string;
        };
        Update: never;
      };

      points_ledger: {
        Row: {
          id: string;
          user_id: string;
          delta: number;
          balance_after: number;
          txn_type: PointsTxnType;
          reference_type: string | null;
          reference_id: string | null;
          description: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          delta: number;
          balance_after?: number;
          txn_type: PointsTxnType;
          reference_type?: string | null;
          reference_id?: string | null;
          description?: string | null;
          created_at?: string;
        };
        Update: never;
      };

      flex_credits_ledger: {
        Row: {
          id: string;
          user_id: string;
          delta: number;
          balance_after: number;
          txn_type: FlexCreditTxnType;
          reference_type: string | null;
          reference_id: string | null;
          description: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          delta: number;
          balance_after?: number;
          txn_type: FlexCreditTxnType;
          reference_type?: string | null;
          reference_id?: string | null;
          description?: string | null;
          created_at?: string;
        };
        Update: never;
      };

      commute_credits_ledger: {
        Row: {
          id: string;
          user_id: string;
          delta: number;
          balance_after: number;
          txn_type: CommuteCreditTxnType;
          reference_type: string | null;
          reference_id: string | null;
          description: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          delta: number;
          balance_after?: number;
          txn_type: CommuteCreditTxnType;
          reference_type?: string | null;
          reference_id?: string | null;
          description?: string | null;
          created_at?: string;
        };
        Update: never;
      };

      reports: {
        Row: {
          id: string;
          reporter_id: string;
          reported_id: string;
          ride_id: string | null;
          reason: ReportReason;
          description: string | null;
          status: ReportStatus;
          reviewed_by: string | null;
          created_at: string;
          resolved_at: string | null;
        };
        Insert: {
          id?: string;
          reporter_id: string;
          reported_id: string;
          ride_id?: string | null;
          reason: ReportReason;
          description?: string | null;
          status?: ReportStatus;
          reviewed_by?: string | null;
          created_at?: string;
          resolved_at?: string | null;
        };
        Update: {
          status?: ReportStatus;
          reviewed_by?: string | null;
          resolved_at?: string | null;
        };
      };

      blocks: {
        Row: {
          id: string;
          blocker_id: string;
          blocked_id: string;
          reason: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          blocker_id: string;
          blocked_id: string;
          reason?: string | null;
          created_at?: string;
        };
        Update: {
          reason?: string | null;
        };
      };

      notifications: {
        Row: {
          id: string;
          user_id: string;
          type: string;
          title: string;
          body: string | null;
          data: Json;
          read: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          type: string;
          title: string;
          body?: string | null;
          data?: Json;
          read?: boolean;
          created_at?: string;
        };
        Update: {
          read?: boolean;
        };
      };

      user_push_tokens: {
        Row: {
          id: string;
          user_id: string;
          expo_push_token: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          expo_push_token: string;
          updated_at?: string;
        };
        Update: {
          expo_push_token?: string;
          updated_at?: string;
        };
      };

      badges: {
        Row: {
          id: string;
          name: string;
          description: string | null;
          icon_url: string | null;
          criteria_type: BadgeCriteriaType;
          criteria_value: Json;
          active: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          description?: string | null;
          icon_url?: string | null;
          criteria_type: BadgeCriteriaType;
          criteria_value?: Json;
          active?: boolean;
          created_at?: string;
        };
        Update: {
          name?: string;
          description?: string | null;
          icon_url?: string | null;
          criteria_type?: BadgeCriteriaType;
          criteria_value?: Json;
          active?: boolean;
        };
      };

      user_badges: {
        Row: {
          id: string;
          user_id: string;
          badge_id: string;
          awarded_at: string;
          awarded_by_ride: string | null;
        };
        Insert: {
          id?: string;
          user_id: string;
          badge_id: string;
          awarded_at?: string;
          awarded_by_ride?: string | null;
        };
        Update: never;
      };

      ride_ratings: {
        Row: {
          id: string;
          ride_id: string;
          rater_id: string;
          ratee_id: string;
          score: number;
          comment: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          ride_id: string;
          rater_id: string;
          ratee_id: string;
          score: number;
          comment?: string | null;
          created_at?: string;
        };
        Update: never;
      };

      subscriptions: {
        Row: {
          id: string;
          org_id: string | null;
          user_id: string | null;
          stripe_customer_id: string | null;
          stripe_sub_id: string | null;
          plan: OrgPlan;
          seat_count: number | null;
          status: SubscriptionStatus;
          current_period_end: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          org_id?: string | null;
          user_id?: string | null;
          stripe_customer_id?: string | null;
          stripe_sub_id?: string | null;
          plan: OrgPlan;
          seat_count?: number | null;
          status?: SubscriptionStatus;
          current_period_end?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          stripe_customer_id?: string | null;
          stripe_sub_id?: string | null;
          plan?: OrgPlan;
          seat_count?: number | null;
          status?: SubscriptionStatus;
          current_period_end?: string | null;
          updated_at?: string;
        };
      };
    };

    Views: {
      user_rating_summary: {
        Row: {
          user_id: string;
          total_ratings: number;
          avg_score: number;
          five_star_count: number;
        };
      };
      user_ride_stats: {
        Row: {
          user_id: string;
          rides_as_driver: number;
          rides_as_passenger: number;
          total_rides: number;
        };
      };
    };

    Functions: {
      current_user_org_id: {
        Args: Record<string, never>;
        Returns: string | null;
      };
      current_user_is_org_admin: {
        Args: Record<string, never>;
        Returns: boolean;
      };
      generate_invite_code: {
        Args: Record<string, never>;
        Returns: string;
      };
      create_enterprise_org: {
        Args: {
          org_name: string;
          org_domain: string;
          admin_user_id: string;
          plan_name?: string;
        };
        Returns: Json;
      };
      join_org_by_invite: {
        Args: { code: string };
        Returns: Json;
      };
      org_active_user_count: {
        Args: { target_org_id: string; ref_month?: string };
        Returns: number;
      };
      grant_org_flex_credits: {
        Args: { target_user_id: string; amount: number; reason?: string };
        Returns: Json;
      };
      compute_match_candidates: {
        Args: { p_user_id: string; p_scope?: string };
        Returns: {
          driver_id: string;
          passenger_id: string;
          ride_id: string | null;
          ride_request_id: string | null;
          route_similarity_score: number;
          time_overlap_mins: number;
          detour_mins: number;
          distance_meters: number;
          reliability_weight: number;
          match_score: number;
          network_scope: string;
        }[];
      };
      upsert_match_suggestions: {
        Args: { p_user_id: string; p_scope?: string };
        Returns: number;
      };
      get_discover_matches: {
        Args: {
          p_user_id: string;
          p_scope?: string;
          p_verified_drivers_only?: boolean;
          p_min_reliability?: number;
          p_gender_filter?: string | null;
        };
        Returns: {
          suggestion_id: string;
          section: string;
          match_score: number;
          route_similarity_score: number;
          time_overlap_mins: number;
          depart_at: string | null;
          desired_depart_at: string | null;
          driver_id: string;
          passenger_id: string;
          driver_name: string | null;
          passenger_name: string | null;
          driver_reliability: number;
          passenger_reliability: number;
          driver_verified: boolean;
          trust_label: string;
        }[];
      };
      recompute_driver_assignment_stats: {
        Args: Record<string, never>;
        Returns: void;
      };
      auto_assign_driver_for_request: {
        Args: { p_request_id: string };
        Returns: Json;
      };
      get_org_analytics_summary: {
        Args: { p_org_id: string; p_month?: string };
        Returns: Json;
      };
      get_org_plan_usage: {
        Args: { p_org_id: string; p_month?: string };
        Returns: Json;
      };
      poolyn_org_admin_dashboard_stats: {
        Args: { p_org_id: string };
        Returns: Json;
      };
      get_map_layers_for_discover: {
        Args: { p_user_id: string; p_scope?: string };
        Returns: Json;
      };
      get_my_commute_route_geojson: {
        Args: { p_direction?: string };
        Returns: Json | null;
      };
      prefilter_commute_match_pairs: {
        Args: { p_viewer_id: string; p_include_local_pool?: boolean };
        Returns: {
          driver_id: string;
          passenger_id: string;
          driver_route_id: string;
          passenger_route_id: string;
          overlap_ratio_initial: number;
          match_scope: string;
        }[];
      };
      count_geometry_match_peers: {
        Args: { p_user_id: string };
        Returns: number;
      };
      get_matching_config: {
        Args: { p_org_id: string };
        Returns: Json;
      };
      reserve_commute_ride: {
        Args: {
          p_driver_id: string;
          p_driver_route_id: string;
          p_passenger_route_id: string;
          p_cost_breakdown?: Json;
          p_passenger_cost_cents?: number | null;
          p_overlap_ratio?: number | null;
          p_detour_distance_m?: number | null;
          p_detour_time_s?: number | null;
          p_pickup_eta_hint?: string | null;
        };
        Returns: Json;
      };
      is_platform_super_admin: {
        Args: Record<string, never>;
        Returns: boolean;
      };
      super_admin_list_directory: {
        Args: Record<string, never>;
        Returns: {
          user_id: string;
          email: string;
          full_name: string | null;
          commute_role: string;
          org_role: string;
          org_id: string | null;
          org_name: string | null;
          org_domain: string | null;
          org_type: string | null;
          registration_type: string;
          onboarding_completed: boolean;
          active: boolean;
          created_at: string;
        }[];
      };
      super_admin_org_overview: {
        Args: Record<string, never>;
        Returns: {
          org_id: string;
          org_name: string;
          org_domain: string;
          org_type: string;
          plan: string;
          member_count: number;
          admin_count: number;
          active_member_count: number;
        }[];
      };
      admin_list_domain_explorers: {
        Args: Record<string, never>;
        Returns: {
          user_id: string;
          email: string;
          full_name: string | null;
          avatar_url: string | null;
        }[];
      };
      admin_claim_explorers: {
        Args: { p_user_ids: string[] };
        Returns: Json;
      };
      admin_send_network_join_invite: {
        Args: { p_target_user_id: string };
        Returns: Json;
      };
      get_peer_commute_badge: {
        Args: { p_peer_id: string };
        Returns: Json;
      };
      enterprise_org_domain_status: {
        Args: { p_domain: string };
        Returns: Json;
      };
      poolyn_org_exists_for_email_domain: {
        Args: { p_domain: string };
        Returns: boolean;
      };
      enterprise_org_domain_duplicate_check: {
        Args: { p_domain: string };
        Returns: Json;
      };
      transfer_org_admin: {
        Args: { p_new_admin_id: string };
        Returns: Json;
      };
      poolyn_leave_organisation: {
        Args: Record<string, never>;
        Returns: Json;
      };
      poolyn_admin_remove_org_member: {
        Args: { p_target_user_id: string };
        Returns: Json;
      };
      poolyn_deduct_commute_credits_for_ride: {
        Args: { p_ride_passenger_id: string; p_credits_used: number };
        Returns: Json;
      };
      poolyn_passenger_network_fee_preview: {
        Args: { p_total_contribution_cents: number };
        Returns: Json;
      };
      poolyn_commit_commute_passenger_pricing: {
        Args: { p_ride_passenger_id: string; p_reservation_id: string };
        Returns: Json;
      };
      poolyn_credit_driver_for_ride_leg: {
        Args: {
          p_ride_passenger_id: string;
          p_total_contribution_cents?: number | null;
        };
        Returns: Json;
      };
      poolyn_admin_commute_credit_adjustment: {
        Args: {
          p_target_user_id: string;
          p_delta: number;
          p_reason?: string | null;
        };
        Returns: Json;
      };
      poolyn_org_grace_period_days: {
        Args: Record<string, never>;
        Returns: number;
      };
      poolyn_org_enter_grace_on_payment_failure: {
        Args: { p_org_id: string };
        Returns: Json;
      };
      poolyn_process_org_grace_expiry: {
        Args: Record<string, never>;
        Returns: Json;
      };
      poolyn_org_reactivate_network: {
        Args: { p_org_id: string };
        Returns: Json;
      };
      poolyn_prepare_ride_passenger_for_payment: {
        Args: { p_ride_passenger_id: string };
        Returns: Json;
      };
      poolyn_finalize_ride_passenger_confirmation: {
        Args: { p_ride_passenger_id: string };
        Returns: Json;
      };
      poolyn_mark_ride_passenger_payment_paid: {
        Args: {
          p_ride_passenger_id: string;
          p_stripe_payment_intent_id?: string | null;
        };
        Returns: Json;
      };
      poolyn_mark_ride_passenger_payment_failed: {
        Args: { p_ride_passenger_id: string };
        Returns: Json;
      };
      poolyn_org_billing_state_for_admin: {
        Args: Record<string, never>;
        Returns: Json;
      };
      create_commute_ride_request: {
        Args: {
          p_direction?: string;
          p_leave_in_mins?: number | null;
          p_desired_depart_at?: string | null;
          p_flexibility_mins?: number;
          p_notes?: string | null;
        };
        Returns: Json;
      };
      accept_ride_request_as_driver: {
        Args: { p_request_id: string };
        Returns: Json;
      };
      expire_pending_ride_requests: {
        Args: Record<string, never>;
        Returns: null;
      };
      poolyn_join_crew: {
        Args: { p_invite_code: string };
        Returns: Json;
      };
      poolyn_respond_crew_invitation: {
        Args: { p_invitation_id: string; p_accept: boolean };
        Returns: Json;
      };
      poolyn_crew_roll_driver: {
        Args: { p_trip_instance_id: string; p_eligible_user_ids?: string[] };
        Returns: Json;
      };
      poolyn_org_crew_route_candidates: {
        Args: { p_detour_mins: number };
        Returns: { id: string; full_name: string }[];
      };
      get_discover_route_snapshot: {
        Args: { p_user_id: string };
        Returns: Json;
      };
    };

    Enums: Record<string, never>;
  };
}

// ── Convenience aliases ──────────────────────────────────

type Tables = Database["public"]["Tables"];

export type Organisation = Tables["organisations"]["Row"];
export type OrgRouteGroup = Tables["org_route_groups"]["Row"];
export type OrgRouteGroupMember = Tables["org_route_group_members"]["Row"];
export type User = Tables["users"]["Row"];
export type Vehicle = Tables["vehicles"]["Row"];
export type DriverPreference = Tables["driver_preferences"]["Row"];
export type Schedule = Tables["schedules"]["Row"];
export type EmergencyContact = Tables["emergency_contacts"]["Row"];
export type Ride = Tables["rides"]["Row"];
export type RideRequest = Tables["ride_requests"]["Row"];
export type RidePassenger = Tables["ride_passengers"]["Row"];
export type MatchSuggestion = Tables["match_suggestions"]["Row"];
export type Message = Tables["messages"]["Row"];
export type LiveLocation = Tables["live_locations"]["Row"];
export type PointsLedgerEntry = Tables["points_ledger"]["Row"];
export type FlexCreditsLedgerEntry = Tables["flex_credits_ledger"]["Row"];
export type CommuteCreditsLedgerEntry = Tables["commute_credits_ledger"]["Row"];
export type Report = Tables["reports"]["Row"];
export type Block = Tables["blocks"]["Row"];
export type Notification = Tables["notifications"]["Row"];
export type Badge = Tables["badges"]["Row"];
export type UserBadge = Tables["user_badges"]["Row"];
export type RideRating = Tables["ride_ratings"]["Row"];
export type Subscription = Tables["subscriptions"]["Row"];

export type UserRatingSummary = Database["public"]["Views"]["user_rating_summary"]["Row"];
export type UserRideStats = Database["public"]["Views"]["user_ride_stats"]["Row"];

// ── Insert / Update helpers ──────────────────────────────

export type InsertOf<T extends keyof Tables> = Tables[T]["Insert"];
export type UpdateOf<T extends keyof Tables> = Tables[T]["Update"];

// ── Weekday schedule shape (for weekday_times jsonb) ─────

export interface DaySchedule {
  depart: string;
  return: string;
}

export type WeekdayTimes = Partial<
  Record<"mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun", DaySchedule>
>;

// ── Domain org detection ─────────────────────────────────
export interface DomainOrgResult {
  has_org: false;
}

export interface DomainOrgFound {
  has_org: true;
  org_id: string;
  org_name: string;
  org_type: "enterprise" | "community";
  plan: string | null;
  invite_code: string | null;
  admin_name: string | null;
}

export type CheckDomainOrgResult = DomainOrgResult | DomainOrgFound;
