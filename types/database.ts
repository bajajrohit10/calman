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
      assignments: {
        Row: {
          assigned_by: string
          bucket: Database["public"]["Enums"]["assignment_bucket"]
          counsellor_id: string
          created_at: string
          date: string
          enquiry_id: number
          id: string
        }
        Insert: {
          assigned_by: string
          bucket: Database["public"]["Enums"]["assignment_bucket"]
          counsellor_id: string
          created_at?: string
          date: string
          enquiry_id: number
          id?: string
        }
        Update: {
          assigned_by?: string
          bucket?: Database["public"]["Enums"]["assignment_bucket"]
          counsellor_id?: string
          created_at?: string
          date?: string
          enquiry_id?: number
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "assignments_assigned_by_fkey"
            columns: ["assigned_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assignments_counsellor_id_fkey"
            columns: ["counsellor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assignments_enquiry_id_fkey"
            columns: ["enquiry_id"]
            isOneToOne: false
            referencedRelation: "enquiries"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_log: {
        Row: {
          action: string
          actor_id: string | null
          actor_source: string
          at: string
          changed_fields: string[] | null
          id: number
          new_data: Json | null
          old_data: Json | null
          row_pk: string
          table_name: string
        }
        Insert: {
          action: string
          actor_id?: string | null
          actor_source: string
          at?: string
          changed_fields?: string[] | null
          id?: never
          new_data?: Json | null
          old_data?: Json | null
          row_pk: string
          table_name: string
        }
        Update: {
          action?: string
          actor_id?: string | null
          actor_source?: string
          at?: string
          changed_fields?: string[] | null
          id?: never
          new_data?: Json | null
          old_data?: Json | null
          row_pk?: string
          table_name?: string
        }
        Relationships: []
      }
      calls: {
        Row: {
          call_date: string
          called_at: string
          called_by: string
          discussion: string | null
          enquiry_id: number
          enquiry_type: Database["public"]["Enums"]["enquiry_type"]
          id: number
          issue_category: Database["public"]["Enums"]["issue_category"] | null
          next_follow_up_date: string | null
          order_id: string | null
          outcome: Database["public"]["Enums"]["call_outcome"]
          whatsapp_sent: boolean
        }
        Insert: {
          call_date: string
          called_at?: string
          called_by: string
          discussion?: string | null
          enquiry_id: number
          enquiry_type: Database["public"]["Enums"]["enquiry_type"]
          id?: never
          issue_category?: Database["public"]["Enums"]["issue_category"] | null
          next_follow_up_date?: string | null
          order_id?: string | null
          outcome: Database["public"]["Enums"]["call_outcome"]
          whatsapp_sent?: boolean
        }
        Update: {
          call_date?: string
          called_at?: string
          called_by?: string
          discussion?: string | null
          enquiry_id?: number
          enquiry_type?: Database["public"]["Enums"]["enquiry_type"]
          id?: never
          issue_category?: Database["public"]["Enums"]["issue_category"] | null
          next_follow_up_date?: string | null
          order_id?: string | null
          outcome?: Database["public"]["Enums"]["call_outcome"]
          whatsapp_sent?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "calls_called_by_fkey"
            columns: ["called_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "calls_enquiry_id_enquiry_type_fkey"
            columns: ["enquiry_id", "enquiry_type"]
            isOneToOne: false
            referencedRelation: "enquiries"
            referencedColumns: ["id", "type"]
          },
          {
            foreignKeyName: "calls_enquiry_id_fkey"
            columns: ["enquiry_id"]
            isOneToOne: false
            referencedRelation: "enquiries"
            referencedColumns: ["id"]
          },
        ]
      }
      contents: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          name: string
          priority: number
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          priority: number
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          priority?: number
        }
        Relationships: []
      }
      courses: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          name: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
        }
        Relationships: []
      }
      enquiries: {
        Row: {
          close_reason: Database["public"]["Enums"]["close_reason"] | null
          closed_at: string | null
          created_at: string
          created_by: string | null
          follow_up_slots_used: number
          fresh_call_date: string | null
          id: number
          importance: Database["public"]["Enums"]["importance"] | null
          last_slot_date: string | null
          lead_verification:
            | Database["public"]["Enums"]["lead_verification"]
            | null
          lost_reason: Database["public"]["Enums"]["lost_reason"] | null
          next_follow_up_date: string | null
          product_text: string | null
          source_id: string | null
          status: Database["public"]["Enums"]["enquiry_status"]
          student_id: string
          term_id: string | null
          top_content_priority: number | null
          type: Database["public"]["Enums"]["enquiry_type"]
        }
        Insert: {
          close_reason?: Database["public"]["Enums"]["close_reason"] | null
          closed_at?: string | null
          created_at?: string
          created_by?: string | null
          follow_up_slots_used?: number
          fresh_call_date?: string | null
          id?: never
          importance?: Database["public"]["Enums"]["importance"] | null
          last_slot_date?: string | null
          lead_verification?:
            | Database["public"]["Enums"]["lead_verification"]
            | null
          lost_reason?: Database["public"]["Enums"]["lost_reason"] | null
          next_follow_up_date?: string | null
          product_text?: string | null
          source_id?: string | null
          status?: Database["public"]["Enums"]["enquiry_status"]
          student_id: string
          term_id?: string | null
          top_content_priority?: number | null
          type: Database["public"]["Enums"]["enquiry_type"]
        }
        Update: {
          close_reason?: Database["public"]["Enums"]["close_reason"] | null
          closed_at?: string | null
          created_at?: string
          created_by?: string | null
          follow_up_slots_used?: number
          fresh_call_date?: string | null
          id?: never
          importance?: Database["public"]["Enums"]["importance"] | null
          last_slot_date?: string | null
          lead_verification?:
            | Database["public"]["Enums"]["lead_verification"]
            | null
          lost_reason?: Database["public"]["Enums"]["lost_reason"] | null
          next_follow_up_date?: string | null
          product_text?: string | null
          source_id?: string | null
          status?: Database["public"]["Enums"]["enquiry_status"]
          student_id?: string
          term_id?: string | null
          top_content_priority?: number | null
          type?: Database["public"]["Enums"]["enquiry_type"]
        }
        Relationships: [
          {
            foreignKeyName: "enquiries_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "enquiries_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "sources"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "enquiries_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "enquiries_term_id_fkey"
            columns: ["term_id"]
            isOneToOne: false
            referencedRelation: "terms"
            referencedColumns: ["id"]
          },
        ]
      }
      enquiry_items: {
        Row: {
          amount: number | null
          content_id: string | null
          course_id: string
          created_at: string
          created_by: string | null
          enquiry_id: number
          id: string
          order_id: string | null
          status: Database["public"]["Enums"]["item_status"]
          subject_id: string | null
          teacher_id: string
        }
        Insert: {
          amount?: number | null
          content_id?: string | null
          course_id: string
          created_at?: string
          created_by?: string | null
          enquiry_id: number
          id?: string
          order_id?: string | null
          status?: Database["public"]["Enums"]["item_status"]
          subject_id?: string | null
          teacher_id: string
        }
        Update: {
          amount?: number | null
          content_id?: string | null
          course_id?: string
          created_at?: string
          created_by?: string | null
          enquiry_id?: number
          id?: string
          order_id?: string | null
          status?: Database["public"]["Enums"]["item_status"]
          subject_id?: string | null
          teacher_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "enquiry_items_content_id_fkey"
            columns: ["content_id"]
            isOneToOne: false
            referencedRelation: "contents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "enquiry_items_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "enquiry_items_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "enquiry_items_enquiry_id_fkey"
            columns: ["enquiry_id"]
            isOneToOne: false
            referencedRelation: "enquiries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "enquiry_items_subject_id_course_id_fkey"
            columns: ["subject_id", "course_id"]
            isOneToOne: false
            referencedRelation: "subjects"
            referencedColumns: ["id", "course_id"]
          },
          {
            foreignKeyName: "enquiry_items_teacher_id_fkey"
            columns: ["teacher_id"]
            isOneToOne: false
            referencedRelation: "teachers"
            referencedColumns: ["id"]
          },
        ]
      }
      holidays: {
        Row: {
          created_at: string
          date: string
          name: string
        }
        Insert: {
          created_at?: string
          date: string
          name: string
        }
        Update: {
          created_at?: string
          date?: string
          name?: string
        }
        Relationships: []
      }
      import_batches: {
        Row: {
          filename: string | null
          id: string
          total_rows: number | null
          uploaded_at: string
          uploaded_by: string | null
        }
        Insert: {
          filename?: string | null
          id?: string
          total_rows?: number | null
          uploaded_at?: string
          uploaded_by?: string | null
        }
        Update: {
          filename?: string | null
          id?: string
          total_rows?: number | null
          uploaded_at?: string
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "import_batches_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      import_rows: {
        Row: {
          batch_id: string
          enquiry_id: number | null
          id: number
          normalised_mobile: string | null
          outcome: Database["public"]["Enums"]["import_outcome"]
          raw: Json
          resolved_at: string | null
          resolved_by: string | null
          row_number: number
          skip_reason: string | null
          student_id: string | null
        }
        Insert: {
          batch_id: string
          enquiry_id?: number | null
          id?: never
          normalised_mobile?: string | null
          outcome: Database["public"]["Enums"]["import_outcome"]
          raw: Json
          resolved_at?: string | null
          resolved_by?: string | null
          row_number: number
          skip_reason?: string | null
          student_id?: string | null
        }
        Update: {
          batch_id?: string
          enquiry_id?: number | null
          id?: never
          normalised_mobile?: string | null
          outcome?: Database["public"]["Enums"]["import_outcome"]
          raw?: Json
          resolved_at?: string | null
          resolved_by?: string | null
          row_number?: number
          skip_reason?: string | null
          student_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "import_rows_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "import_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "import_rows_enquiry_id_fkey"
            columns: ["enquiry_id"]
            isOneToOne: false
            referencedRelation: "enquiries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "import_rows_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "import_rows_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
        ]
      }
      offer_contents: {
        Row: {
          content_id: string
          offer_id: string
        }
        Insert: {
          content_id: string
          offer_id: string
        }
        Update: {
          content_id?: string
          offer_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "offer_contents_content_id_fkey"
            columns: ["content_id"]
            isOneToOne: false
            referencedRelation: "contents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "offer_contents_offer_id_fkey"
            columns: ["offer_id"]
            isOneToOne: false
            referencedRelation: "offers"
            referencedColumns: ["id"]
          },
        ]
      }
      offer_courses: {
        Row: {
          course_id: string
          offer_id: string
        }
        Insert: {
          course_id: string
          offer_id: string
        }
        Update: {
          course_id?: string
          offer_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "offer_courses_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "offer_courses_offer_id_fkey"
            columns: ["offer_id"]
            isOneToOne: false
            referencedRelation: "offers"
            referencedColumns: ["id"]
          },
        ]
      }
      offer_subjects: {
        Row: {
          offer_id: string
          subject_id: string
        }
        Insert: {
          offer_id: string
          subject_id: string
        }
        Update: {
          offer_id?: string
          subject_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "offer_subjects_offer_id_fkey"
            columns: ["offer_id"]
            isOneToOne: false
            referencedRelation: "offers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "offer_subjects_subject_id_fkey"
            columns: ["subject_id"]
            isOneToOne: false
            referencedRelation: "subjects"
            referencedColumns: ["id"]
          },
        ]
      }
      offer_teachers: {
        Row: {
          offer_id: string
          teacher_id: string
        }
        Insert: {
          offer_id: string
          teacher_id: string
        }
        Update: {
          offer_id?: string
          teacher_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "offer_teachers_offer_id_fkey"
            columns: ["offer_id"]
            isOneToOne: false
            referencedRelation: "offers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "offer_teachers_teacher_id_fkey"
            columns: ["teacher_id"]
            isOneToOne: false
            referencedRelation: "teachers"
            referencedColumns: ["id"]
          },
        ]
      }
      offers: {
        Row: {
          created_at: string
          created_by: string | null
          end_date: string
          id: string
          is_active: boolean
          name: string
          reminder_days: number
          start_date: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          end_date: string
          id?: string
          is_active?: boolean
          name: string
          reminder_days?: number
          start_date: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          end_date?: string
          id?: string
          is_active?: boolean
          name?: string
          reminder_days?: number
          start_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "offers_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      overdue_dismissals: {
        Row: {
          date: string
          dismissed_at: string
          dismissed_by: string
        }
        Insert: {
          date: string
          dismissed_at?: string
          dismissed_by: string
        }
        Update: {
          date?: string
          dismissed_at?: string
          dismissed_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "overdue_dismissals_dismissed_by_fkey"
            columns: ["dismissed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          full_name: string
          id: string
          is_active: boolean
          role: Database["public"]["Enums"]["user_role"]
        }
        Insert: {
          created_at?: string
          full_name: string
          id: string
          is_active?: boolean
          role: Database["public"]["Enums"]["user_role"]
        }
        Update: {
          created_at?: string
          full_name?: string
          id?: string
          is_active?: boolean
          role?: Database["public"]["Enums"]["user_role"]
        }
        Relationships: []
      }
      sources: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          name: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
        }
        Relationships: []
      }
      students: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          mobile: string
          name: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          mobile: string
          name?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          mobile?: string
          name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "students_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      subjects: {
        Row: {
          course_id: string
          created_at: string
          id: string
          is_active: boolean
          name: string
        }
        Insert: {
          course_id: string
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
        }
        Update: {
          course_id?: string
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
        }
        Relationships: [
          {
            foreignKeyName: "subjects_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
        ]
      }
      teachers: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          name: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
        }
        Relationships: []
      }
      terms: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          name: string
          sort_order: number
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          sort_order?: number
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          sort_order?: number
        }
        Relationships: []
      }
      whatsapp_templates: {
        Row: {
          body: string
          created_at: string
          id: string
          is_active: boolean
          name: string
          sort_order: number
        }
        Insert: {
          body: string
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          sort_order?: number
        }
        Update: {
          body?: string
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          sort_order?: number
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      assignment_bucket:
        | "follow_up"
        | "fresh"
        | "campaign"
        | "call_back"
        | "offer"
      call_outcome:
        | "follow_up"
        | "call_back"
        | "purchased"
        | "competitor"
        | "closed"
        | "noted"
        | "escalated"
        | "resolved"
      close_reason: "wrong_number" | "superseded"
      enquiry_status: "open" | "won" | "lost" | "closed" | "escalated"
      enquiry_type: "purchase" | "after_sale"
      import_outcome:
        | "imported"
        | "duplicate_updated"
        | "duplicate_new_enquiry"
        | "skipped"
      importance: "a" | "b" | "c" | "d"
      issue_category:
        | "video_access"
        | "book_delivery"
        | "refund"
        | "wrong_course"
        | "other"
      item_status: "open" | "won" | "competitor" | "closed"
      lead_verification: "yes_with_proof" | "yes_without_proof" | "no"
      lost_reason: "competitor" | "max_followups" | "dropped"
      user_role: "super_admin" | "manager" | "counsellor" | "ticket_team"
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
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
      assignment_bucket: [
        "follow_up",
        "fresh",
        "campaign",
        "call_back",
        "offer",
      ],
      call_outcome: [
        "follow_up",
        "call_back",
        "purchased",
        "competitor",
        "closed",
        "noted",
        "escalated",
        "resolved",
      ],
      close_reason: ["wrong_number", "superseded"],
      enquiry_status: ["open", "won", "lost", "closed", "escalated"],
      enquiry_type: ["purchase", "after_sale"],
      import_outcome: [
        "imported",
        "duplicate_updated",
        "duplicate_new_enquiry",
        "skipped",
      ],
      importance: ["a", "b", "c", "d"],
      issue_category: [
        "video_access",
        "book_delivery",
        "refund",
        "wrong_course",
        "other",
      ],
      item_status: ["open", "won", "competitor", "closed"],
      lead_verification: ["yes_with_proof", "yes_without_proof", "no"],
      lost_reason: ["competitor", "max_followups", "dropped"],
      user_role: ["super_admin", "manager", "counsellor", "ticket_team"],
    },
  },
} as const
