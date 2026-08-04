export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      amenity_types: {
        Row: {
          grp: Database["public"]["Enums"]["amenity_group"]
          id: string
          is_filterable: boolean
          label: string
          slug: string
          sort_order: number
        }
        Insert: {
          grp: Database["public"]["Enums"]["amenity_group"]
          id?: string
          is_filterable?: boolean
          label: string
          slug: string
          sort_order?: number
        }
        Update: {
          grp?: Database["public"]["Enums"]["amenity_group"]
          id?: string
          is_filterable?: boolean
          label?: string
          slug?: string
          sort_order?: number
        }
        Relationships: []
      }
      cash_games: {
        Row: {
          big_bet: number | null
          big_blind: number | null
          bring_in: number | null
          created_at: string
          fetched_at: string | null
          game: Database["public"]["Enums"]["game_kind"]
          id: string
          is_spread_limit: boolean
          is_uncapped: boolean
          jackpot_drop: number | null
          max_buy_in: number | null
          min_buy_in: number | null
          must_post: boolean | null
          rake_cap: number | null
          rake_fetched_at: string | null
          rake_percent: number | null
          rake_source_url: string | null
          rake_type: Database["public"]["Enums"]["rake_kind"] | null
          rake_verified_at: string | null
          room_id: string
          small_bet: number | null
          small_blind: number | null
          source_id: string | null
          source_url: string | null
          spread_max: number | null
          spread_min: number | null
          stakes_label: string
          straddle_rule: string | null
          structure_note: string | null
          table_count: number | null
          time_charge: number | null
          time_interval_min: number | null
          typical_hours: string | null
          updated_at: string
          verified_at: string | null
        }
        Insert: {
          big_bet?: number | null
          big_blind?: number | null
          bring_in?: number | null
          created_at?: string
          fetched_at?: string | null
          game: Database["public"]["Enums"]["game_kind"]
          id?: string
          is_spread_limit?: boolean
          is_uncapped?: boolean
          jackpot_drop?: number | null
          max_buy_in?: number | null
          min_buy_in?: number | null
          must_post?: boolean | null
          rake_cap?: number | null
          rake_fetched_at?: string | null
          rake_percent?: number | null
          rake_source_url?: string | null
          rake_type?: Database["public"]["Enums"]["rake_kind"] | null
          rake_verified_at?: string | null
          room_id: string
          small_bet?: number | null
          small_blind?: number | null
          source_id?: string | null
          source_url?: string | null
          spread_max?: number | null
          spread_min?: number | null
          stakes_label: string
          straddle_rule?: string | null
          structure_note?: string | null
          table_count?: number | null
          time_charge?: number | null
          time_interval_min?: number | null
          typical_hours?: string | null
          updated_at?: string
          verified_at?: string | null
        }
        Update: {
          big_bet?: number | null
          big_blind?: number | null
          bring_in?: number | null
          created_at?: string
          fetched_at?: string | null
          game?: Database["public"]["Enums"]["game_kind"]
          id?: string
          is_spread_limit?: boolean
          is_uncapped?: boolean
          jackpot_drop?: number | null
          max_buy_in?: number | null
          min_buy_in?: number | null
          must_post?: boolean | null
          rake_cap?: number | null
          rake_fetched_at?: string | null
          rake_percent?: number | null
          rake_source_url?: string | null
          rake_type?: Database["public"]["Enums"]["rake_kind"] | null
          rake_verified_at?: string | null
          room_id?: string
          small_bet?: number | null
          small_blind?: number | null
          source_id?: string | null
          source_url?: string | null
          spread_max?: number | null
          spread_min?: number | null
          stakes_label?: string
          straddle_rule?: string | null
          structure_note?: string | null
          table_count?: number | null
          time_charge?: number | null
          time_interval_min?: number | null
          typical_hours?: string | null
          updated_at?: string
          verified_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "cash_games_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "room_freshness"
            referencedColumns: ["room_id"]
          },
          {
            foreignKeyName: "cash_games_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_games_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "sources"
            referencedColumns: ["id"]
          },
        ]
      }
      change_log: {
        Row: {
          agent: string | null
          applied_at: string
          applied_by: string | null
          field: string | null
          id: string
          new_value: Json | null
          old_value: Json | null
          operation: Database["public"]["Enums"]["change_op"]
          room_id: string | null
          source_id: string | null
          source_url: string | null
          target_id: string | null
          target_table: string
        }
        Insert: {
          agent?: string | null
          applied_at?: string
          applied_by?: string | null
          field?: string | null
          id?: string
          new_value?: Json | null
          old_value?: Json | null
          operation: Database["public"]["Enums"]["change_op"]
          room_id?: string | null
          source_id?: string | null
          source_url?: string | null
          target_id?: string | null
          target_table: string
        }
        Update: {
          agent?: string | null
          applied_at?: string
          applied_by?: string | null
          field?: string | null
          id?: string
          new_value?: Json | null
          old_value?: Json | null
          operation?: Database["public"]["Enums"]["change_op"]
          room_id?: string | null
          source_id?: string | null
          source_url?: string | null
          target_id?: string | null
          target_table?: string
        }
        Relationships: [
          {
            foreignKeyName: "change_log_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "sources"
            referencedColumns: ["id"]
          },
        ]
      }
      corrections: {
        Row: {
          contact: string | null
          created_at: string
          handled: boolean
          id: string
          message: string
          room_id: string | null
          target_id: string | null
          target_table: string | null
        }
        Insert: {
          contact?: string | null
          created_at?: string
          handled?: boolean
          id?: string
          message: string
          room_id?: string | null
          target_id?: string | null
          target_table?: string | null
        }
        Update: {
          contact?: string | null
          created_at?: string
          handled?: boolean
          id?: string
          message?: string
          room_id?: string | null
          target_id?: string | null
          target_table?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "corrections_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "room_freshness"
            referencedColumns: ["room_id"]
          },
          {
            foreignKeyName: "corrections_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
        ]
      }
      house_rules: {
        Row: {
          fetched_at: string | null
          id: string
          label: string
          room_id: string
          sort_order: number
          source_id: string | null
          source_url: string | null
          value: string
          verified_at: string | null
        }
        Insert: {
          fetched_at?: string | null
          id?: string
          label: string
          room_id: string
          sort_order?: number
          source_id?: string | null
          source_url?: string | null
          value: string
          verified_at?: string | null
        }
        Update: {
          fetched_at?: string | null
          id?: string
          label?: string
          room_id?: string
          sort_order?: number
          source_id?: string | null
          source_url?: string | null
          value?: string
          verified_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "house_rules_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "room_freshness"
            referencedColumns: ["room_id"]
          },
          {
            foreignKeyName: "house_rules_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "house_rules_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "sources"
            referencedColumns: ["id"]
          },
        ]
      }
      markets: {
        Row: {
          created_at: string
          id: string
          name: string
          slug: string
          timezone: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          slug: string
          timezone?: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          slug?: string
          timezone?: string
        }
        Relationships: []
      }
      pending_changes: {
        Row: {
          agent: string | null
          confidence: number | null
          created_at: string
          fetched_at: string
          field: string | null
          id: string
          new_value: Json
          note: string | null
          old_value: Json | null
          operation: Database["public"]["Enums"]["change_op"]
          reviewed_at: string | null
          reviewed_by: string | null
          room_id: string | null
          source_id: string | null
          source_url: string | null
          state: Database["public"]["Enums"]["change_state"]
          target_id: string | null
          target_table: string
        }
        Insert: {
          agent?: string | null
          confidence?: number | null
          created_at?: string
          fetched_at?: string
          field?: string | null
          id?: string
          new_value: Json
          note?: string | null
          old_value?: Json | null
          operation?: Database["public"]["Enums"]["change_op"]
          reviewed_at?: string | null
          reviewed_by?: string | null
          room_id?: string | null
          source_id?: string | null
          source_url?: string | null
          state?: Database["public"]["Enums"]["change_state"]
          target_id?: string | null
          target_table: string
        }
        Update: {
          agent?: string | null
          confidence?: number | null
          created_at?: string
          fetched_at?: string
          field?: string | null
          id?: string
          new_value?: Json
          note?: string | null
          old_value?: Json | null
          operation?: Database["public"]["Enums"]["change_op"]
          reviewed_at?: string | null
          reviewed_by?: string | null
          room_id?: string | null
          source_id?: string | null
          source_url?: string | null
          state?: Database["public"]["Enums"]["change_state"]
          target_id?: string | null
          target_table?: string
        }
        Relationships: [
          {
            foreignKeyName: "pending_changes_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "room_freshness"
            referencedColumns: ["room_id"]
          },
          {
            foreignKeyName: "pending_changes_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pending_changes_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "sources"
            referencedColumns: ["id"]
          },
        ]
      }
      promotions: {
        Row: {
          amount: number | null
          amount_note: string | null
          created_at: string
          eligibility: string | null
          ends_on: string | null
          fetched_at: string | null
          id: string
          is_active: boolean
          kind: Database["public"]["Enums"]["promo_kind"]
          name: string
          room_id: string
          schedule_note: string | null
          source_id: string | null
          source_url: string | null
          starts_on: string | null
          updated_at: string
          verified_at: string | null
        }
        Insert: {
          amount?: number | null
          amount_note?: string | null
          created_at?: string
          eligibility?: string | null
          ends_on?: string | null
          fetched_at?: string | null
          id?: string
          is_active?: boolean
          kind: Database["public"]["Enums"]["promo_kind"]
          name: string
          room_id: string
          schedule_note?: string | null
          source_id?: string | null
          source_url?: string | null
          starts_on?: string | null
          updated_at?: string
          verified_at?: string | null
        }
        Update: {
          amount?: number | null
          amount_note?: string | null
          created_at?: string
          eligibility?: string | null
          ends_on?: string | null
          fetched_at?: string | null
          id?: string
          is_active?: boolean
          kind?: Database["public"]["Enums"]["promo_kind"]
          name?: string
          room_id?: string
          schedule_note?: string | null
          source_id?: string | null
          source_url?: string | null
          starts_on?: string | null
          updated_at?: string
          verified_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "promotions_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "room_freshness"
            referencedColumns: ["room_id"]
          },
          {
            foreignKeyName: "promotions_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "promotions_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "sources"
            referencedColumns: ["id"]
          },
        ]
      }
      room_amenities: {
        Row: {
          amenity_id: string
          available: boolean
          detail: string | null
          fetched_at: string | null
          menu_url: string | null
          rate: number | null
          room_id: string
          source_id: string | null
          source_url: string | null
          verified_at: string | null
        }
        Insert: {
          amenity_id: string
          available?: boolean
          detail?: string | null
          fetched_at?: string | null
          menu_url?: string | null
          rate?: number | null
          room_id: string
          source_id?: string | null
          source_url?: string | null
          verified_at?: string | null
        }
        Update: {
          amenity_id?: string
          available?: boolean
          detail?: string | null
          fetched_at?: string | null
          menu_url?: string | null
          rate?: number | null
          room_id?: string
          source_id?: string | null
          source_url?: string | null
          verified_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "room_amenities_amenity_id_fkey"
            columns: ["amenity_id"]
            isOneToOne: false
            referencedRelation: "amenity_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "room_amenities_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "room_freshness"
            referencedColumns: ["room_id"]
          },
          {
            foreignKeyName: "room_amenities_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "room_amenities_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "sources"
            referencedColumns: ["id"]
          },
        ]
      }
      rooms: {
        Row: {
          area: Database["public"]["Enums"]["area_kind"]
          closed_on: string | null
          comp_notes: string | null
          comp_rate_hourly: number | null
          created_at: string
          dress_code: string | null
          drinks_note: string | null
          fetched_at: string | null
          hours_note: string | null
          id: string
          is_24h: boolean | null
          is_seasonal: boolean
          latitude: number
          longitude: number
          loyalty_program: string | null
          market_id: string
          min_age: number | null
          name: string
          phone: string | null
          property: string | null
          season_end: string | null
          season_start: string | null
          slug: string
          source_id: string | null
          source_url: string | null
          status: Database["public"]["Enums"]["room_status"]
          table_count: number | null
          updated_at: string
          verified_at: string | null
          website_url: string | null
        }
        Insert: {
          area: Database["public"]["Enums"]["area_kind"]
          closed_on?: string | null
          comp_notes?: string | null
          comp_rate_hourly?: number | null
          created_at?: string
          dress_code?: string | null
          drinks_note?: string | null
          fetched_at?: string | null
          hours_note?: string | null
          id?: string
          is_24h?: boolean | null
          is_seasonal?: boolean
          latitude: number
          longitude: number
          loyalty_program?: string | null
          market_id: string
          min_age?: number | null
          name: string
          phone?: string | null
          property?: string | null
          season_end?: string | null
          season_start?: string | null
          slug: string
          source_id?: string | null
          source_url?: string | null
          status?: Database["public"]["Enums"]["room_status"]
          table_count?: number | null
          updated_at?: string
          verified_at?: string | null
          website_url?: string | null
        }
        Update: {
          area?: Database["public"]["Enums"]["area_kind"]
          closed_on?: string | null
          comp_notes?: string | null
          comp_rate_hourly?: number | null
          created_at?: string
          dress_code?: string | null
          drinks_note?: string | null
          fetched_at?: string | null
          hours_note?: string | null
          id?: string
          is_24h?: boolean | null
          is_seasonal?: boolean
          latitude?: number
          longitude?: number
          loyalty_program?: string | null
          market_id?: string
          min_age?: number | null
          name?: string
          phone?: string | null
          property?: string | null
          season_end?: string | null
          season_start?: string | null
          slug?: string
          source_id?: string | null
          source_url?: string | null
          status?: Database["public"]["Enums"]["room_status"]
          table_count?: number | null
          updated_at?: string
          verified_at?: string | null
          website_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "rooms_market_id_fkey"
            columns: ["market_id"]
            isOneToOne: false
            referencedRelation: "markets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rooms_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "sources"
            referencedColumns: ["id"]
          },
        ]
      }
      sources: {
        Row: {
          cadence_hours: number
          content_hash: string | null
          created_at: string
          data_type: string
          id: string
          label: string | null
          last_error: string | null
          last_fetched_at: string | null
          last_ok_at: string | null
          parser: string | null
          room_id: string | null
          status: Database["public"]["Enums"]["source_status"]
          url: string
        }
        Insert: {
          cadence_hours?: number
          content_hash?: string | null
          created_at?: string
          data_type: string
          id?: string
          label?: string | null
          last_error?: string | null
          last_fetched_at?: string | null
          last_ok_at?: string | null
          parser?: string | null
          room_id?: string | null
          status?: Database["public"]["Enums"]["source_status"]
          url: string
        }
        Update: {
          cadence_hours?: number
          content_hash?: string | null
          created_at?: string
          data_type?: string
          id?: string
          label?: string | null
          last_error?: string | null
          last_fetched_at?: string | null
          last_ok_at?: string | null
          parser?: string | null
          room_id?: string | null
          status?: Database["public"]["Enums"]["source_status"]
          url?: string
        }
        Relationships: [
          {
            foreignKeyName: "sources_room_fk"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "room_freshness"
            referencedColumns: ["room_id"]
          },
          {
            foreignKeyName: "sources_room_fk"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
        ]
      }
      tournament_instances: {
        Row: {
          cancel_note: string | null
          created_at: string
          id: string
          is_cancelled: boolean
          starts_at: string
          template_id: string
        }
        Insert: {
          cancel_note?: string | null
          created_at?: string
          id?: string
          is_cancelled?: boolean
          starts_at: string
          template_id: string
        }
        Update: {
          cancel_note?: string | null
          created_at?: string
          id?: string
          is_cancelled?: boolean
          starts_at?: string
          template_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tournament_instances_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "tournament_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      tournament_levels: {
        Row: {
          ante: number | null
          big_blind: number
          is_break: boolean
          level_number: number
          minutes: number
          small_blind: number
          template_id: string
        }
        Insert: {
          ante?: number | null
          big_blind: number
          is_break?: boolean
          level_number: number
          minutes: number
          small_blind: number
          template_id: string
        }
        Update: {
          ante?: number | null
          big_blind?: number
          is_break?: boolean
          level_number?: number
          minutes?: number
          small_blind?: number
          template_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tournament_levels_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "tournament_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      tournament_series: {
        Row: {
          ends_on: string | null
          fetched_at: string | null
          id: string
          name: string
          room_id: string | null
          slug: string
          source_id: string | null
          source_url: string | null
          starts_on: string | null
          verified_at: string | null
        }
        Insert: {
          ends_on?: string | null
          fetched_at?: string | null
          id?: string
          name: string
          room_id?: string | null
          slug: string
          source_id?: string | null
          source_url?: string | null
          starts_on?: string | null
          verified_at?: string | null
        }
        Update: {
          ends_on?: string | null
          fetched_at?: string | null
          id?: string
          name?: string
          room_id?: string | null
          slug?: string
          source_id?: string | null
          source_url?: string | null
          starts_on?: string | null
          verified_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tournament_series_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "room_freshness"
            referencedColumns: ["room_id"]
          },
          {
            foreignKeyName: "tournament_series_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tournament_series_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "sources"
            referencedColumns: ["id"]
          },
        ]
      }
      tournament_templates: {
        Row: {
          bounty_amount: number | null
          created_at: string
          days_of_week: number[] | null
          entry_amount: number
          fee_amount: number
          fee_percent: number | null
          fetched_at: string | null
          game: Database["public"]["Enums"]["game_kind"]
          guarantee_amount: number | null
          guarantee_is_estimated: boolean
          id: string
          is_active: boolean
          late_reg_close: string | null
          late_reg_level: number | null
          level_minutes: number | null
          name: string
          pace: number | null
          reentry_allowed: boolean | null
          reentry_note: string | null
          reliability: Database["public"]["Enums"]["run_reliability"]
          reliability_note: string | null
          room_id: string
          series_id: string | null
          slug: string
          source_id: string | null
          source_url: string | null
          staff_amount: number | null
          start_time: string
          starting_stack: number | null
          structure_fetched_at: string | null
          structure_pdf_url: string | null
          total_buy_in: number | null
          updated_at: string
          verified_at: string | null
        }
        Insert: {
          bounty_amount?: number | null
          created_at?: string
          days_of_week?: number[] | null
          entry_amount: number
          fee_amount: number
          fee_percent?: number | null
          fetched_at?: string | null
          game?: Database["public"]["Enums"]["game_kind"]
          guarantee_amount?: number | null
          guarantee_is_estimated?: boolean
          id?: string
          is_active?: boolean
          late_reg_close?: string | null
          late_reg_level?: number | null
          level_minutes?: number | null
          name: string
          pace?: number | null
          reentry_allowed?: boolean | null
          reentry_note?: string | null
          reliability?: Database["public"]["Enums"]["run_reliability"]
          reliability_note?: string | null
          room_id: string
          series_id?: string | null
          slug: string
          source_id?: string | null
          source_url?: string | null
          staff_amount?: number | null
          start_time: string
          starting_stack?: number | null
          structure_fetched_at?: string | null
          structure_pdf_url?: string | null
          total_buy_in?: number | null
          updated_at?: string
          verified_at?: string | null
        }
        Update: {
          bounty_amount?: number | null
          created_at?: string
          days_of_week?: number[] | null
          entry_amount?: number
          fee_amount?: number
          fee_percent?: number | null
          fetched_at?: string | null
          game?: Database["public"]["Enums"]["game_kind"]
          guarantee_amount?: number | null
          guarantee_is_estimated?: boolean
          id?: string
          is_active?: boolean
          late_reg_close?: string | null
          late_reg_level?: number | null
          level_minutes?: number | null
          name?: string
          pace?: number | null
          reentry_allowed?: boolean | null
          reentry_note?: string | null
          reliability?: Database["public"]["Enums"]["run_reliability"]
          reliability_note?: string | null
          room_id?: string
          series_id?: string | null
          slug?: string
          source_id?: string | null
          source_url?: string | null
          staff_amount?: number | null
          start_time?: string
          starting_stack?: number | null
          structure_fetched_at?: string | null
          structure_pdf_url?: string | null
          total_buy_in?: number | null
          updated_at?: string
          verified_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tournament_templates_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "room_freshness"
            referencedColumns: ["room_id"]
          },
          {
            foreignKeyName: "tournament_templates_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tournament_templates_series_id_fkey"
            columns: ["series_id"]
            isOneToOne: false
            referencedRelation: "tournament_series"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tournament_templates_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "sources"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      room_freshness: {
        Row: {
          room_id: string | null
          slug: string | null
          verified_at: string | null
          verified_days: number | null
        }
        Insert: {
          room_id?: string | null
          slug?: string | null
          verified_at?: string | null
          verified_days?: never
        }
        Update: {
          room_id?: string | null
          slug?: string | null
          verified_at?: string | null
          verified_days?: never
        }
        Relationships: []
      }
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      amenity_group: "games" | "food_drink" | "parking" | "comfort" | "services"
      area_kind: "strip" | "downtown" | "off_strip" | "locals"
      change_op: "insert" | "update" | "delete"
      change_state: "pending" | "approved" | "rejected" | "superseded"
      game_kind: "nlh" | "plo" | "plo5" | "lhe" | "mixed" | "stud" | "other"
      promo_kind:
        | "high_hand"
        | "bad_beat"
        | "splash_pot"
        | "freeroll"
        | "locals_rate"
        | "other"
      rake_kind: "pot" | "time"
      room_status: "open" | "temporarily_closed" | "closed" | "seasonal"
      run_reliability:
        | "typically_runs"
        | "often_cancels"
        | "series_only"
        | "unknown"
      source_status: "ok" | "partial" | "failing" | "idle"
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
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      amenity_group: ["games", "food_drink", "parking", "comfort", "services"],
      area_kind: ["strip", "downtown", "off_strip", "locals"],
      change_op: ["insert", "update", "delete"],
      change_state: ["pending", "approved", "rejected", "superseded"],
      game_kind: ["nlh", "plo", "plo5", "lhe", "mixed", "stud", "other"],
      promo_kind: [
        "high_hand",
        "bad_beat",
        "splash_pot",
        "freeroll",
        "locals_rate",
        "other",
      ],
      rake_kind: ["pot", "time"],
      room_status: ["open", "temporarily_closed", "closed", "seasonal"],
      run_reliability: [
        "typically_runs",
        "often_cancels",
        "series_only",
        "unknown",
      ],
      source_status: ["ok", "partial", "failing", "idle"],
    },
  },
} as const

