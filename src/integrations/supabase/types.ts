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
    PostgrestVersion: "13.0.5"
  }
  public: {
    Tables: {
      cellar_items: {
        Row: {
          created_at: string
          description: string | null
          id: string
          is_preset: boolean
          name: string
          rating: number | null
          type: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          is_preset?: boolean
          name: string
          rating?: number | null
          type?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          is_preset?: boolean
          name?: string
          rating?: number | null
          type?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      device_tokens: {
        Row: {
          created_at: string
          id: string
          platform: string
          token: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          platform?: string
          token: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          platform?: string
          token?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      email_otp: {
        Row: {
          code: string
          created_at: string
          email: string
          expires_at: string
          id: string
          locked_until: string | null
          verification_attempts: number | null
          verified: boolean
        }
        Insert: {
          code: string
          created_at?: string
          email: string
          expires_at?: string
          id?: string
          locked_until?: string | null
          verification_attempts?: number | null
          verified?: boolean
        }
        Update: {
          code?: string
          created_at?: string
          email?: string
          expires_at?: string
          id?: string
          locked_until?: string | null
          verification_attempts?: number | null
          verified?: boolean
        }
        Relationships: []
      }
      folders: {
        Row: {
          color: string | null
          created_at: string
          icon: string | null
          id: string
          name: string
          user_id: string
        }
        Insert: {
          color?: string | null
          created_at?: string
          icon?: string | null
          id?: string
          name: string
          user_id: string
        }
        Update: {
          color?: string | null
          created_at?: string
          icon?: string | null
          id?: string
          name?: string
          user_id?: string
        }
        Relationships: []
      }
      follows: {
        Row: {
          created_at: string
          follower_id: string
          following_id: string
          id: string
          status: string
        }
        Insert: {
          created_at?: string
          follower_id: string
          following_id: string
          id?: string
          status?: string
        }
        Update: {
          created_at?: string
          follower_id?: string
          following_id?: string
          id?: string
          status?: string
        }
        Relationships: []
      }
      news_items: {
        Row: {
          city: string
          created_at: string
          id: string
          image_url: string | null
          published_at: string
          source_name: string | null
          source_url: string | null
          summary: string | null
          title: string
          type: string
        }
        Insert: {
          city: string
          created_at?: string
          id?: string
          image_url?: string | null
          published_at?: string
          source_name?: string | null
          source_url?: string | null
          summary?: string | null
          title: string
          type?: string
        }
        Update: {
          city?: string
          created_at?: string
          id?: string
          image_url?: string | null
          published_at?: string
          source_name?: string | null
          source_url?: string | null
          summary?: string | null
          title?: string
          type?: string
        }
        Relationships: []
      }
      news_sources: {
        Row: {
          active: boolean
          city: string
          created_at: string
          id: string
          label: string | null
          url: string
        }
        Insert: {
          active?: boolean
          city: string
          created_at?: string
          id?: string
          label?: string | null
          url: string
        }
        Update: {
          active?: boolean
          city?: string
          created_at?: string
          id?: string
          label?: string | null
          url?: string
        }
        Relationships: []
      }
      otp_rate_limits: {
        Row: {
          created_at: string | null
          email: string
          id: string
          request_count: number | null
          window_start: string | null
        }
        Insert: {
          created_at?: string | null
          email: string
          id?: string
          request_count?: number | null
          window_start?: string | null
        }
        Update: {
          created_at?: string | null
          email?: string
          id?: string
          request_count?: number | null
          window_start?: string | null
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          bio: string | null
          created_at: string
          display_name: string | null
          id: string
          is_private: boolean
          updated_at: string
          user_id: string
          username: string | null
        }
        Insert: {
          avatar_url?: string | null
          bio?: string | null
          created_at?: string
          display_name?: string | null
          id?: string
          is_private?: boolean
          updated_at?: string
          user_id: string
          username?: string | null
        }
        Update: {
          avatar_url?: string | null
          bio?: string | null
          created_at?: string
          display_name?: string | null
          id?: string
          is_private?: boolean
          updated_at?: string
          user_id?: string
          username?: string | null
        }
        Relationships: []
      }
      recipes: {
        Row: {
          cook_temp: number | null
          cook_temp_unit: string | null
          cook_time_minutes: number | null
          created_at: string
          description: string | null
          difficulty: string | null
          id: string
          image_url: string | null
          ingredients: Json | null
          instructions: Json | null
          is_public: boolean
          prep_time_minutes: number | null
          servings: number | null
          tags: string[] | null
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          cook_temp?: number | null
          cook_temp_unit?: string | null
          cook_time_minutes?: number | null
          created_at?: string
          description?: string | null
          difficulty?: string | null
          id?: string
          image_url?: string | null
          ingredients?: Json | null
          instructions?: Json | null
          is_public?: boolean
          prep_time_minutes?: number | null
          servings?: number | null
          tags?: string[] | null
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          cook_temp?: number | null
          cook_temp_unit?: string | null
          cook_time_minutes?: number | null
          created_at?: string
          description?: string | null
          difficulty?: string | null
          id?: string
          image_url?: string | null
          ingredients?: Json | null
          instructions?: Json | null
          is_public?: boolean
          prep_time_minutes?: number | null
          servings?: number | null
          tags?: string[] | null
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      restaurant_images: {
        Row: {
          caption: string | null
          created_at: string
          id: string
          image_url: string
          restaurant_id: string
          user_id: string
        }
        Insert: {
          caption?: string | null
          created_at?: string
          id?: string
          image_url: string
          restaurant_id: string
          user_id: string
        }
        Update: {
          caption?: string | null
          created_at?: string
          id?: string
          image_url?: string
          restaurant_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "restaurant_images_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      restaurants: {
        Row: {
          address: string | null
          created_at: string
          folder_id: string | null
          id: string
          latitude: number | null
          longitude: number | null
          name: string
          notes: string | null
          price_level: number | null
          rating: number | null
          status: string
          updated_at: string
          user_id: string
          visited_at: string | null
        }
        Insert: {
          address?: string | null
          created_at?: string
          folder_id?: string | null
          id?: string
          latitude?: number | null
          longitude?: number | null
          name: string
          notes?: string | null
          price_level?: number | null
          rating?: number | null
          status?: string
          updated_at?: string
          user_id: string
          visited_at?: string | null
        }
        Update: {
          address?: string | null
          created_at?: string
          folder_id?: string | null
          id?: string
          latitude?: number | null
          longitude?: number | null
          name?: string
          notes?: string | null
          price_level?: number | null
          rating?: number | null
          status?: string
          updated_at?: string
          user_id?: string
          visited_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "restaurants_folder_id_fkey"
            columns: ["folder_id"]
            isOneToOne: false
            referencedRelation: "folders"
            referencedColumns: ["id"]
          },
        ]
      }
      shared_list_items: {
        Row: {
          added_by: string
          address: string | null
          created_at: string
          id: string
          latitude: number | null
          list_id: string
          longitude: number | null
          name: string
          notes: string | null
          price_level: number | null
          rating: number | null
          status: string
          updated_at: string
          visited_at: string | null
        }
        Insert: {
          added_by: string
          address?: string | null
          created_at?: string
          id?: string
          latitude?: number | null
          list_id: string
          longitude?: number | null
          name: string
          notes?: string | null
          price_level?: number | null
          rating?: number | null
          status?: string
          updated_at?: string
          visited_at?: string | null
        }
        Update: {
          added_by?: string
          address?: string | null
          created_at?: string
          id?: string
          latitude?: number | null
          list_id?: string
          longitude?: number | null
          name?: string
          notes?: string | null
          price_level?: number | null
          rating?: number | null
          status?: string
          updated_at?: string
          visited_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "shared_list_items_list_id_fkey"
            columns: ["list_id"]
            isOneToOne: false
            referencedRelation: "shared_lists"
            referencedColumns: ["id"]
          },
        ]
      }
      shared_lists: {
        Row: {
          created_at: string
          id: string
          name: string
          updated_at: string
          user_a: string
          user_b: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          updated_at?: string
          user_a: string
          user_b: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          updated_at?: string
          user_a?: string
          user_b?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      can_view_profile: { Args: { profile_user_id: string }; Returns: boolean }
      is_shared_list_member: {
        Args: { _list_id: string; _user_id: string }
        Returns: boolean
      }
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
