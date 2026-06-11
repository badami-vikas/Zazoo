// Bridge AI — generated from the live Supabase DB (project emtbimowmqqhixqlxhzb). DO NOT EDIT BY HAND.
// Regenerate: Supabase MCP generate_typescript_types.

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      agents: {
        Row: {
          allowed_skills: string[]
          allowed_tools: string[]
          assumes_role_id: string | null
          capability_scope: Json
          goal: string | null
          id: string
          identity_type: string
          name: string
          owner_user_id: string | null
          status: string
          workspace_id: string
        }
        Insert: {
          allowed_skills?: string[]
          allowed_tools?: string[]
          assumes_role_id?: string | null
          capability_scope?: Json
          goal?: string | null
          id?: string
          identity_type?: string
          name: string
          owner_user_id?: string | null
          status?: string
          workspace_id: string
        }
        Update: {
          allowed_skills?: string[]
          allowed_tools?: string[]
          assumes_role_id?: string | null
          capability_scope?: Json
          goal?: string | null
          id?: string
          identity_type?: string
          name?: string
          owner_user_id?: string | null
          status?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "agents_owner_user_id_fkey"
            columns: ["owner_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agents_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      communities: {
        Row: {
          archived_at: string | null
          canonical_community_id: string | null
          description_override: string | null
          id: string
          is_user_confirmed: boolean
          kind: string | null
          name_override: string | null
          primary_place_id: string | null
          source: string
          user_id: string
          visibility: string
          warmth_avg: number | null
          workspace_id: string
        }
        Insert: {
          archived_at?: string | null
          canonical_community_id?: string | null
          description_override?: string | null
          id?: string
          is_user_confirmed?: boolean
          kind?: string | null
          name_override?: string | null
          primary_place_id?: string | null
          source?: string
          user_id: string
          visibility?: string
          warmth_avg?: number | null
          workspace_id: string
        }
        Update: {
          archived_at?: string | null
          canonical_community_id?: string | null
          description_override?: string | null
          id?: string
          is_user_confirmed?: boolean
          kind?: string | null
          name_override?: string | null
          primary_place_id?: string | null
          source?: string
          user_id?: string
          visibility?: string
          warmth_avg?: number | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "communities_canonical_community_id_fkey"
            columns: ["canonical_community_id"]
            isOneToOne: false
            referencedRelation: "communities_canonical"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "communities_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "communities_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      communities_canonical: {
        Row: {
          dedup_key: string | null
          description: string | null
          headquarters_city: string | null
          headquarters_country: string | null
          id: string
          kind: string | null
          linkedin_url: string | null
          logo_url: string | null
          member_count_approx: number | null
          name: string | null
          website_url: string | null
        }
        Insert: {
          dedup_key?: string | null
          description?: string | null
          headquarters_city?: string | null
          headquarters_country?: string | null
          id?: string
          kind?: string | null
          linkedin_url?: string | null
          logo_url?: string | null
          member_count_approx?: number | null
          name?: string | null
          website_url?: string | null
        }
        Update: {
          dedup_key?: string | null
          description?: string | null
          headquarters_city?: string | null
          headquarters_country?: string | null
          id?: string
          kind?: string | null
          linkedin_url?: string | null
          logo_url?: string | null
          member_count_approx?: number | null
          name?: string | null
          website_url?: string | null
        }
        Relationships: []
      }
      community_members: {
        Row: {
          community_id: string
          confidence: number | null
          person_id: string
          role: string | null
        }
        Insert: {
          community_id: string
          confidence?: number | null
          person_id: string
          role?: string | null
        }
        Update: {
          community_id?: string
          confidence?: number | null
          person_id?: string
          role?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "community_members_community_id_fkey"
            columns: ["community_id"]
            isOneToOne: false
            referencedRelation: "communities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "community_members_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "people"
            referencedColumns: ["id"]
          },
        ]
      }
      decision_traces: {
        Row: {
          context: Json | null
          id: string
          ledger_id: string
          outcome: Json | null
          reasoning: Json | null
          signals: Json | null
        }
        Insert: {
          context?: Json | null
          id?: string
          ledger_id: string
          outcome?: Json | null
          reasoning?: Json | null
          signals?: Json | null
        }
        Update: {
          context?: Json | null
          id?: string
          ledger_id?: string
          outcome?: Json | null
          reasoning?: Json | null
          signals?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "decision_traces_ledger_id_fkey"
            columns: ["ledger_id"]
            isOneToOne: false
            referencedRelation: "ledger"
            referencedColumns: ["id"]
          },
        ]
      }
      delegations: {
        Row: {
          delegate_agent_id: string
          expires_at: string | null
          granted_by: string | null
          id: string
          principal_id: string
          principal_type: string
          revoked_at: string | null
          scope: Json
          valid_from: string
          workspace_id: string
        }
        Insert: {
          delegate_agent_id: string
          expires_at?: string | null
          granted_by?: string | null
          id?: string
          principal_id: string
          principal_type: string
          revoked_at?: string | null
          scope?: Json
          valid_from?: string
          workspace_id: string
        }
        Update: {
          delegate_agent_id?: string
          expires_at?: string | null
          granted_by?: string | null
          id?: string
          principal_id?: string
          principal_type?: string
          revoked_at?: string | null
          scope?: Json
          valid_from?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "delegations_delegate_agent_id_fkey"
            columns: ["delegate_agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "delegations_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      edges: {
        Row: {
          created_at: string
          dst_id: string
          dst_type: string
          edge_type: string
          id: string
          properties: Json
          src_id: string
          src_type: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          dst_id: string
          dst_type: string
          edge_type: string
          id?: string
          properties?: Json
          src_id: string
          src_type: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          dst_id?: string
          dst_type?: string
          edge_type?: string
          id?: string
          properties?: Json
          src_id?: string
          src_type?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "edges_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      embedding_models: {
        Row: {
          dim: number
          embedding_model: string
          is_active: boolean
          table_name: string
        }
        Insert: {
          dim: number
          embedding_model: string
          is_active?: boolean
          table_name: string
        }
        Update: {
          dim?: number
          embedding_model?: string
          is_active?: boolean
          table_name?: string
        }
        Relationships: []
      }
      embeddings: {
        Row: {
          created_at: string
          embedding: string
          embedding_model: string
          embedding_version: string
          entity_id: string
          entity_type: string
          id: string
        }
        Insert: {
          created_at?: string
          embedding: string
          embedding_model?: string
          embedding_version?: string
          entity_id: string
          entity_type: string
          id?: string
        }
        Update: {
          created_at?: string
          embedding?: string
          embedding_model?: string
          embedding_version?: string
          entity_id?: string
          entity_type?: string
          id?: string
        }
        Relationships: []
      }
      ephemeral_grants: {
        Row: {
          action: string
          actor_id: string
          actor_type: string
          consumed_at: string | null
          context_id: string
          context_type: string
          expires_at: string
          granted_by: string | null
          id: string
          resource_id: string | null
          resource_type: string
          run_id: string | null
          workspace_id: string
        }
        Insert: {
          action: string
          actor_id: string
          actor_type: string
          consumed_at?: string | null
          context_id: string
          context_type: string
          expires_at: string
          granted_by?: string | null
          id?: string
          resource_id?: string | null
          resource_type: string
          run_id?: string | null
          workspace_id: string
        }
        Update: {
          action?: string
          actor_id?: string
          actor_type?: string
          consumed_at?: string | null
          context_id?: string
          context_type?: string
          expires_at?: string
          granted_by?: string | null
          id?: string
          resource_id?: string | null
          resource_type?: string
          run_id?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ephemeral_grants_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      events: {
        Row: {
          created_at: string
          entity_id: string
          entity_type: string
          id: string
          payload: Json
          type: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          entity_id: string
          entity_type: string
          id?: string
          payload?: Json
          type: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          entity_id?: string
          entity_type?: string
          id?: string
          payload?: Json
          type?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "events_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      external_records: {
        Row: {
          created_at: string
          entity_id: string
          entity_type: string
          id: string
          source: string
          source_record_id: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          entity_id: string
          entity_type: string
          id?: string
          source: string
          source_record_id: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          entity_id?: string
          entity_type?: string
          id?: string
          source?: string
          source_record_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "external_records_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      file_refs: {
        Row: {
          entity_id: string
          entity_type: string
          file_id: string
        }
        Insert: {
          entity_id: string
          entity_type: string
          file_id: string
        }
        Update: {
          entity_id?: string
          entity_type?: string
          file_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "file_refs_file_id_fkey"
            columns: ["file_id"]
            isOneToOne: false
            referencedRelation: "files"
            referencedColumns: ["id"]
          },
        ]
      }
      files: {
        Row: {
          archived_at: string | null
          content_text: string | null
          created_at: string
          id: string
          metadata: Json
          source: string
          storage_ref: string | null
          workspace_id: string
        }
        Insert: {
          archived_at?: string | null
          content_text?: string | null
          created_at?: string
          id?: string
          metadata?: Json
          source: string
          storage_ref?: string | null
          workspace_id: string
        }
        Update: {
          archived_at?: string | null
          content_text?: string | null
          created_at?: string
          id?: string
          metadata?: Json
          source?: string
          storage_ref?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "files_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      initiative_communities: {
        Row: {
          community_id: string
          initiative_id: string
        }
        Insert: {
          community_id: string
          initiative_id: string
        }
        Update: {
          community_id?: string
          initiative_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "initiative_communities_community_id_fkey"
            columns: ["community_id"]
            isOneToOne: false
            referencedRelation: "communities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "initiative_communities_initiative_id_fkey"
            columns: ["initiative_id"]
            isOneToOne: false
            referencedRelation: "initiatives"
            referencedColumns: ["id"]
          },
        ]
      }
      initiative_participants: {
        Row: {
          initiative_id: string
          person_id: string
          role: string | null
        }
        Insert: {
          initiative_id: string
          person_id: string
          role?: string | null
        }
        Update: {
          initiative_id?: string
          person_id?: string
          role?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "initiative_participants_initiative_id_fkey"
            columns: ["initiative_id"]
            isOneToOne: false
            referencedRelation: "initiatives"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "initiative_participants_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "people"
            referencedColumns: ["id"]
          },
        ]
      }
      initiatives: {
        Row: {
          archived_at: string | null
          created_at: string
          decomposition_strategy: Json | null
          description: string | null
          goal: string | null
          id: string
          start_date: string | null
          status: string | null
          target_date: string | null
          title: string
          workspace_id: string
        }
        Insert: {
          archived_at?: string | null
          created_at?: string
          decomposition_strategy?: Json | null
          description?: string | null
          goal?: string | null
          id?: string
          start_date?: string | null
          status?: string | null
          target_date?: string | null
          title: string
          workspace_id: string
        }
        Update: {
          archived_at?: string | null
          created_at?: string
          decomposition_strategy?: Json | null
          description?: string | null
          goal?: string | null
          id?: string
          start_date?: string | null
          status?: string | null
          target_date?: string | null
          title?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "initiatives_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      integration_sync_state: {
        Row: {
          integration_id: string
          last_cursor: string | null
          source: string
          updated_at: string
        }
        Insert: {
          integration_id: string
          last_cursor?: string | null
          source: string
          updated_at?: string
        }
        Update: {
          integration_id?: string
          last_cursor?: string | null
          source?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "integration_sync_state_integration_id_fkey"
            columns: ["integration_id"]
            isOneToOne: false
            referencedRelation: "integrations"
            referencedColumns: ["id"]
          },
        ]
      }
      integrations: {
        Row: {
          auth_ref: string | null
          id: string
          provider: string
          scopes: string[] | null
          status: string
          workspace_id: string
        }
        Insert: {
          auth_ref?: string | null
          id?: string
          provider: string
          scopes?: string[] | null
          status?: string
          workspace_id: string
        }
        Update: {
          auth_ref?: string | null
          id?: string
          provider?: string
          scopes?: string[] | null
          status?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "integrations_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      ledger: {
        Row: {
          action: string
          actor_id: string
          actor_type: string
          created_at: string
          delegation_id: string | null
          diff: Json | null
          id: string
          inputs: Json | null
          on_behalf_of_id: string | null
          on_behalf_of_type: string | null
          policy_results: Json | null
          proposed_output: Json | null
          resource_id: string | null
          resource_type: string
          user_decision: string | null
          workspace_id: string
        }
        Insert: {
          action: string
          actor_id: string
          actor_type: string
          created_at?: string
          delegation_id?: string | null
          diff?: Json | null
          id?: string
          inputs?: Json | null
          on_behalf_of_id?: string | null
          on_behalf_of_type?: string | null
          policy_results?: Json | null
          proposed_output?: Json | null
          resource_id?: string | null
          resource_type: string
          user_decision?: string | null
          workspace_id: string
        }
        Update: {
          action?: string
          actor_id?: string
          actor_type?: string
          created_at?: string
          delegation_id?: string | null
          diff?: Json | null
          id?: string
          inputs?: Json | null
          on_behalf_of_id?: string | null
          on_behalf_of_type?: string | null
          policy_results?: Json | null
          proposed_output?: Json | null
          resource_id?: string | null
          resource_type?: string
          user_decision?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ledger_delegation_id_fkey"
            columns: ["delegation_id"]
            isOneToOne: false
            referencedRelation: "delegations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ledger_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      node_types: {
        Row: {
          plane: string
          type: string
        }
        Insert: {
          plane: string
          type: string
        }
        Update: {
          plane?: string
          type?: string
        }
        Relationships: []
      }
      people: {
        Row: {
          archived_at: string | null
          avatar_url_override: string | null
          bio_override: string | null
          canonical_person_id: string | null
          context_freshness_at: string | null
          created_at: string
          current_community_id: string | null
          current_title_override: string | null
          dormancy_risk: number | null
          emails_override: string[] | null
          full_name_override: string | null
          id: string
          is_muted: boolean
          is_pinned_to_inner: boolean
          last_interaction_at: string | null
          reciprocity_score: number | null
          ring_placement: number | null
          source: string | null
          user_id: string
          visibility: string
          warmth_score: number | null
          workspace_id: string
        }
        Insert: {
          archived_at?: string | null
          avatar_url_override?: string | null
          bio_override?: string | null
          canonical_person_id?: string | null
          context_freshness_at?: string | null
          created_at?: string
          current_community_id?: string | null
          current_title_override?: string | null
          dormancy_risk?: number | null
          emails_override?: string[] | null
          full_name_override?: string | null
          id?: string
          is_muted?: boolean
          is_pinned_to_inner?: boolean
          last_interaction_at?: string | null
          reciprocity_score?: number | null
          ring_placement?: number | null
          source?: string | null
          user_id: string
          visibility?: string
          warmth_score?: number | null
          workspace_id: string
        }
        Update: {
          archived_at?: string | null
          avatar_url_override?: string | null
          bio_override?: string | null
          canonical_person_id?: string | null
          context_freshness_at?: string | null
          created_at?: string
          current_community_id?: string | null
          current_title_override?: string | null
          dormancy_risk?: number | null
          emails_override?: string[] | null
          full_name_override?: string | null
          id?: string
          is_muted?: boolean
          is_pinned_to_inner?: boolean
          last_interaction_at?: string | null
          reciprocity_score?: number | null
          ring_placement?: number | null
          source?: string | null
          user_id?: string
          visibility?: string
          warmth_score?: number | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "people_canonical_person_id_fkey"
            columns: ["canonical_person_id"]
            isOneToOne: false
            referencedRelation: "people_canonical"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "people_current_community_id_fkey"
            columns: ["current_community_id"]
            isOneToOne: false
            referencedRelation: "communities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "people_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "people_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      people_canonical: {
        Row: {
          avatar_url: string | null
          bio: string | null
          current_company_name: string | null
          current_title: string | null
          dedup_key: string | null
          emails: string[] | null
          enrichment_confidence: number | null
          enrichment_source: string | null
          full_name: string | null
          github_handle: string | null
          id: string
          last_enriched_at: string | null
          linkedin_url: string | null
          location_city: string | null
          location_country: string | null
          preferred_name: string | null
          twitter_handle: string | null
          website_url: string | null
        }
        Insert: {
          avatar_url?: string | null
          bio?: string | null
          current_company_name?: string | null
          current_title?: string | null
          dedup_key?: string | null
          emails?: string[] | null
          enrichment_confidence?: number | null
          enrichment_source?: string | null
          full_name?: string | null
          github_handle?: string | null
          id?: string
          last_enriched_at?: string | null
          linkedin_url?: string | null
          location_city?: string | null
          location_country?: string | null
          preferred_name?: string | null
          twitter_handle?: string | null
          website_url?: string | null
        }
        Update: {
          avatar_url?: string | null
          bio?: string | null
          current_company_name?: string | null
          current_title?: string | null
          dedup_key?: string | null
          emails?: string[] | null
          enrichment_confidence?: number | null
          enrichment_source?: string | null
          full_name?: string | null
          github_handle?: string | null
          id?: string
          last_enriched_at?: string | null
          linkedin_url?: string | null
          location_city?: string | null
          location_country?: string | null
          preferred_name?: string | null
          twitter_handle?: string | null
          website_url?: string | null
        }
        Relationships: []
      }
      permissions: {
        Row: {
          action: string
          actor_id: string
          actor_type: string
          created_at: string
          effect: string
          expires_at: string | null
          granted_by: string | null
          id: string
          resource_id: string | null
          resource_type: string
          revoked_at: string | null
          workspace_id: string
        }
        Insert: {
          action: string
          actor_id: string
          actor_type: string
          created_at?: string
          effect?: string
          expires_at?: string | null
          granted_by?: string | null
          id?: string
          resource_id?: string | null
          resource_type: string
          revoked_at?: string | null
          workspace_id: string
        }
        Update: {
          action?: string
          actor_id?: string
          actor_type?: string
          created_at?: string
          effect?: string
          expires_at?: string | null
          granted_by?: string | null
          id?: string
          resource_id?: string | null
          resource_type?: string
          revoked_at?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "permissions_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      policies: {
        Row: {
          active: boolean
          effect: string
          evaluation_phase: string
          id: string
          name: string
          priority: number
          rule: Json
          scope_id: string | null
          scope_type: string
          workspace_id: string
        }
        Insert: {
          active?: boolean
          effect?: string
          evaluation_phase?: string
          id?: string
          name: string
          priority?: number
          rule: Json
          scope_id?: string | null
          scope_type: string
          workspace_id: string
        }
        Update: {
          active?: boolean
          effect?: string
          evaluation_phase?: string
          id?: string
          name?: string
          priority?: number
          rule?: Json
          scope_id?: string | null
          scope_type?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "policies_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      policy_params: {
        Row: {
          id: string
          param_key: string
          policy_id: string | null
          updated_at: string
          value: Json
          workspace_id: string
        }
        Insert: {
          id?: string
          param_key: string
          policy_id?: string | null
          updated_at?: string
          value: Json
          workspace_id: string
        }
        Update: {
          id?: string
          param_key?: string
          policy_id?: string | null
          updated_at?: string
          value?: Json
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "policy_params_policy_id_fkey"
            columns: ["policy_id"]
            isOneToOne: false
            referencedRelation: "policies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "policy_params_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      ritual_runs: {
        Row: {
          finished_at: string | null
          id: string
          ledger_id: string | null
          output: Json | null
          ritual_id: string
          run_id: string | null
          started_at: string
          status: string
          workspace_id: string
        }
        Insert: {
          finished_at?: string | null
          id?: string
          ledger_id?: string | null
          output?: Json | null
          ritual_id: string
          run_id?: string | null
          started_at?: string
          status?: string
          workspace_id: string
        }
        Update: {
          finished_at?: string | null
          id?: string
          ledger_id?: string | null
          output?: Json | null
          ritual_id?: string
          run_id?: string | null
          started_at?: string
          status?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ritual_runs_ritual_id_fkey"
            columns: ["ritual_id"]
            isOneToOne: false
            referencedRelation: "rituals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ritual_runs_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      rituals: {
        Row: {
          agent_ids: string[]
          archived_at: string | null
          cadence: string | null
          id: string
          is_template: boolean
          name: string
          output_surface: string | null
          policy_scope_id: string | null
          skill_pipeline: Json
          status: string
          supports_initiative: string | null
          trigger: Json
          workspace_id: string
        }
        Insert: {
          agent_ids?: string[]
          archived_at?: string | null
          cadence?: string | null
          id?: string
          is_template?: boolean
          name: string
          output_surface?: string | null
          policy_scope_id?: string | null
          skill_pipeline?: Json
          status?: string
          supports_initiative?: string | null
          trigger: Json
          workspace_id: string
        }
        Update: {
          agent_ids?: string[]
          archived_at?: string | null
          cadence?: string | null
          id?: string
          is_template?: boolean
          name?: string
          output_surface?: string | null
          policy_scope_id?: string | null
          skill_pipeline?: Json
          status?: string
          supports_initiative?: string | null
          trigger?: Json
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "rituals_supports_initiative_fkey"
            columns: ["supports_initiative"]
            isOneToOne: false
            referencedRelation: "initiatives"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rituals_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      role_permissions: {
        Row: {
          action: string
          effect: string
          id: string
          resource_id: string | null
          resource_type: string
          role_id: string
        }
        Insert: {
          action: string
          effect?: string
          id?: string
          resource_id?: string | null
          resource_type: string
          role_id: string
        }
        Update: {
          action?: string
          effect?: string
          id?: string
          resource_id?: string | null
          resource_type?: string
          role_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "role_permissions_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["id"]
          },
        ]
      }
      roles: {
        Row: {
          description: string | null
          id: string
          kind: string
          name: string
          workspace_id: string
        }
        Insert: {
          description?: string | null
          id?: string
          kind?: string
          name: string
          workspace_id: string
        }
        Update: {
          description?: string | null
          id?: string
          kind?: string
          name?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "roles_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      signal_actions: {
        Row: {
          created_at: string
          id: string
          signal_id: string
          user_id: string
          verb: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          signal_id: string
          user_id: string
          verb: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          id?: string
          signal_id?: string
          user_id?: string
          verb?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "signal_actions_signal_id_fkey"
            columns: ["signal_id"]
            isOneToOne: false
            referencedRelation: "signals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "signal_actions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "signal_actions_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      signals: {
        Row: {
          created_at: string
          id: string
          payload: Json
          recommended_action: Json
          status: string
          subject_id: string
          subject_type: string
          type: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          payload?: Json
          recommended_action: Json
          status?: string
          subject_id: string
          subject_type: string
          type: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          id?: string
          payload?: Json
          recommended_action?: Json
          status?: string
          subject_id?: string
          subject_type?: string
          type?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "signals_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      skills: {
        Row: {
          id: string
          impl_ref: string | null
          input_schema: Json | null
          name: string
          output_schema: Json | null
          status: string
          version: string
          workspace_id: string | null
        }
        Insert: {
          id?: string
          impl_ref?: string | null
          input_schema?: Json | null
          name: string
          output_schema?: Json | null
          status?: string
          version?: string
          workspace_id?: string | null
        }
        Update: {
          id?: string
          impl_ref?: string | null
          input_schema?: Json | null
          name?: string
          output_schema?: Json | null
          status?: string
          version?: string
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "skills_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      team_members: {
        Row: {
          team_id: string
          user_id: string
        }
        Insert: {
          team_id: string
          user_id: string
        }
        Update: {
          team_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "team_members_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "team_members_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      teams: {
        Row: {
          archived_at: string | null
          id: string
          name: string
          workspace_id: string
        }
        Insert: {
          archived_at?: string | null
          id?: string
          name: string
          workspace_id: string
        }
        Update: {
          archived_at?: string | null
          id?: string
          name?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "teams_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      timeline_entries: {
        Row: {
          content: string | null
          created_at: string
          created_by: string
          id: string
          occurred_at: string
          type: string
          workspace_id: string
        }
        Insert: {
          content?: string | null
          created_at?: string
          created_by: string
          id?: string
          occurred_at: string
          type: string
          workspace_id: string
        }
        Update: {
          content?: string | null
          created_at?: string
          created_by?: string
          id?: string
          occurred_at?: string
          type?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "timeline_entries_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      timeline_entry_refs: {
        Row: {
          entity_id: string
          entity_type: string
          entry_id: string
        }
        Insert: {
          entity_id: string
          entity_type: string
          entry_id: string
        }
        Update: {
          entity_id?: string
          entity_type?: string
          entry_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "timeline_entry_refs_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "timeline_entries"
            referencedColumns: ["id"]
          },
        ]
      }
      tools: {
        Row: {
          composition: Json
          id: string
          name: string
          status: string
          surface: string
          workspace_id: string
        }
        Insert: {
          composition?: Json
          id?: string
          name: string
          status?: string
          surface: string
          workspace_id: string
        }
        Update: {
          composition?: Json
          id?: string
          name?: string
          status?: string
          surface?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tools_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      touchpoints: {
        Row: {
          alignment_score: number | null
          assignee_id: string
          assignee_type: string
          context: string | null
          created_at: string
          depth: number
          due_date: string | null
          id: string
          initiative_id: string | null
          parent_touchpoint_id: string | null
          sort_order: number
          status: string
          touchpoint_kind: string | null
          workspace_id: string
        }
        Insert: {
          alignment_score?: number | null
          assignee_id: string
          assignee_type: string
          context?: string | null
          created_at?: string
          depth?: number
          due_date?: string | null
          id?: string
          initiative_id?: string | null
          parent_touchpoint_id?: string | null
          sort_order?: number
          status?: string
          touchpoint_kind?: string | null
          workspace_id: string
        }
        Update: {
          alignment_score?: number | null
          assignee_id?: string
          assignee_type?: string
          context?: string | null
          created_at?: string
          depth?: number
          due_date?: string | null
          id?: string
          initiative_id?: string | null
          parent_touchpoint_id?: string | null
          sort_order?: number
          status?: string
          touchpoint_kind?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "touchpoints_initiative_id_fkey"
            columns: ["initiative_id"]
            isOneToOne: false
            referencedRelation: "initiatives"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "touchpoints_parent_touchpoint_id_fkey"
            columns: ["parent_touchpoint_id"]
            isOneToOne: false
            referencedRelation: "touchpoints"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "touchpoints_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      users: {
        Row: {
          created_at: string
          email: string
          id: string
          name: string | null
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          name?: string | null
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          name?: string | null
        }
        Relationships: []
      }
      workspace_members: {
        Row: {
          role_id: string | null
          user_id: string
          workspace_id: string
        }
        Insert: {
          role_id?: string | null
          user_id: string
          workspace_id: string
        }
        Update: {
          role_id?: string | null
          user_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_members_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workspace_members_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_settings: {
        Row: {
          default_visibility: string
          settings: Json
          workspace_id: string
        }
        Insert: {
          default_visibility?: string
          settings?: Json
          workspace_id: string
        }
        Update: {
          default_visibility?: string
          settings?: Json
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_settings_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: true
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspaces: {
        Row: {
          archived_at: string | null
          created_at: string
          id: string
          name: string
        }
        Insert: {
          archived_at?: string | null
          created_at?: string
          id?: string
          name: string
        }
        Update: {
          archived_at?: string | null
          created_at?: string
          id?: string
          name?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      my_team_ids: { Args: never; Returns: string[] }
      my_workspace_ids: { Args: never; Returns: string[] }
      shares_team_with: { Args: { other: string }; Returns: boolean }
      shares_workspace_with: { Args: { other: string }; Returns: boolean }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
