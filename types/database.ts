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
      archive_batches: {
        Row: {
          call_count: number
          created_at: string
          created_by: string
          enquiry_count: number
          exported_at: string | null
          filter: Json
          id: string
          item_count: number
          purged_assignments: number | null
          purged_at: string | null
          purged_by: string | null
          purged_calls: number | null
          purged_enquiries: number | null
          purged_import_rows: number | null
          purged_items: number | null
          purged_whatsapp_sends: number | null
          removed_assignments: Json
        }
        Insert: {
          call_count: number
          created_at?: string
          created_by: string
          enquiry_count: number
          exported_at?: string | null
          filter: Json
          id?: string
          item_count: number
          purged_assignments?: number | null
          purged_at?: string | null
          purged_by?: string | null
          purged_calls?: number | null
          purged_enquiries?: number | null
          purged_import_rows?: number | null
          purged_items?: number | null
          purged_whatsapp_sends?: number | null
          removed_assignments?: Json
        }
        Update: {
          call_count?: number
          created_at?: string
          created_by?: string
          enquiry_count?: number
          exported_at?: string | null
          filter?: Json
          id?: string
          item_count?: number
          purged_assignments?: number | null
          purged_at?: string | null
          purged_by?: string | null
          purged_calls?: number | null
          purged_enquiries?: number | null
          purged_import_rows?: number | null
          purged_items?: number | null
          purged_whatsapp_sends?: number | null
          removed_assignments?: Json
        }
        Relationships: [
          {
            foreignKeyName: "archive_batches_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "archive_batches_purged_by_fkey"
            columns: ["purged_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
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
          {
            foreignKeyName: "assignments_enquiry_id_fkey"
            columns: ["enquiry_id"]
            isOneToOne: false
            referencedRelation: "live_enquiries"
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
          call_date?: string
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
            foreignKeyName: "calls_enquiry_id_enquiry_type_fkey"
            columns: ["enquiry_id", "enquiry_type"]
            isOneToOne: false
            referencedRelation: "live_enquiries"
            referencedColumns: ["id", "type"]
          },
          {
            foreignKeyName: "calls_enquiry_id_fkey"
            columns: ["enquiry_id"]
            isOneToOne: false
            referencedRelation: "enquiries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "calls_enquiry_id_fkey"
            columns: ["enquiry_id"]
            isOneToOne: false
            referencedRelation: "live_enquiries"
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
          archive_batch_id: string | null
          archived_at: string | null
          archived_by: string | null
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
          re_enquired_at: string | null
          source_id: string | null
          status: Database["public"]["Enums"]["enquiry_status"]
          student_id: string
          term_id: string | null
          top_content_priority: number | null
          type: Database["public"]["Enums"]["enquiry_type"]
        }
        Insert: {
          archive_batch_id?: string | null
          archived_at?: string | null
          archived_by?: string | null
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
          re_enquired_at?: string | null
          source_id?: string | null
          status?: Database["public"]["Enums"]["enquiry_status"]
          student_id: string
          term_id?: string | null
          top_content_priority?: number | null
          type: Database["public"]["Enums"]["enquiry_type"]
        }
        Update: {
          archive_batch_id?: string | null
          archived_at?: string | null
          archived_by?: string | null
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
          re_enquired_at?: string | null
          source_id?: string | null
          status?: Database["public"]["Enums"]["enquiry_status"]
          student_id?: string
          term_id?: string | null
          top_content_priority?: number | null
          type?: Database["public"]["Enums"]["enquiry_type"]
        }
        Relationships: [
          {
            foreignKeyName: "enquiries_archive_batch_id_fkey"
            columns: ["archive_batch_id"]
            isOneToOne: false
            referencedRelation: "archive_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "enquiries_archived_by_fkey"
            columns: ["archived_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
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
          won_at: string | null
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
          won_at?: string | null
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
          won_at?: string | null
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
            foreignKeyName: "enquiry_items_enquiry_id_fkey"
            columns: ["enquiry_id"]
            isOneToOne: false
            referencedRelation: "live_enquiries"
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
      enquiry_sources: {
        Row: {
          enquiry_id: number
          id: string
          import_batch_id: string | null
          note: string | null
          occurred_at: string
          source_id: string | null
        }
        Insert: {
          enquiry_id: number
          id?: string
          import_batch_id?: string | null
          note?: string | null
          occurred_at?: string
          source_id?: string | null
        }
        Update: {
          enquiry_id?: number
          id?: string
          import_batch_id?: string | null
          note?: string | null
          occurred_at?: string
          source_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "enquiry_sources_enquiry_id_fkey"
            columns: ["enquiry_id"]
            isOneToOne: false
            referencedRelation: "enquiries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "enquiry_sources_enquiry_id_fkey"
            columns: ["enquiry_id"]
            isOneToOne: false
            referencedRelation: "live_enquiries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "enquiry_sources_import_batch_id_fkey"
            columns: ["import_batch_id"]
            isOneToOne: false
            referencedRelation: "import_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "enquiry_sources_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "sources"
            referencedColumns: ["id"]
          },
        ]
      }
      holidays: {
        Row: {
          created_at: string
          date: string
          is_active: boolean
          name: string
        }
        Insert: {
          created_at?: string
          date: string
          is_active?: boolean
          name: string
        }
        Update: {
          created_at?: string
          date?: string
          is_active?: boolean
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
      import_column_maps: {
        Row: {
          fingerprint: string
          headers: string[]
          mapping: Json
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          fingerprint: string
          headers: string[]
          mapping: Json
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          fingerprint?: string
          headers?: string[]
          mapping?: Json
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "import_column_maps_updated_by_fkey"
            columns: ["updated_by"]
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
            foreignKeyName: "import_rows_enquiry_id_fkey"
            columns: ["enquiry_id"]
            isOneToOne: false
            referencedRelation: "live_enquiries"
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
      institutes: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          is_active: boolean
          name: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          name: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          name?: string
        }
        Relationships: [
          {
            foreignKeyName: "institutes_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
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
          institute_id: string | null
          is_active: boolean
          name: string
        }
        Insert: {
          created_at?: string
          id?: string
          institute_id?: string | null
          is_active?: boolean
          name: string
        }
        Update: {
          created_at?: string
          id?: string
          institute_id?: string | null
          is_active?: boolean
          name?: string
        }
        Relationships: [
          {
            foreignKeyName: "teachers_institute_id_fkey"
            columns: ["institute_id"]
            isOneToOne: false
            referencedRelation: "institutes"
            referencedColumns: ["id"]
          },
        ]
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
      whatsapp_sends: {
        Row: {
          enquiry_id: number
          id: number
          message_text: string
          sent_at: string
          sent_by: string
          template_id: string | null
        }
        Insert: {
          enquiry_id: number
          id?: never
          message_text: string
          sent_at?: string
          sent_by: string
          template_id?: string | null
        }
        Update: {
          enquiry_id?: number
          id?: never
          message_text?: string
          sent_at?: string
          sent_by?: string
          template_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_sends_enquiry_id_fkey"
            columns: ["enquiry_id"]
            isOneToOne: false
            referencedRelation: "enquiries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_sends_enquiry_id_fkey"
            columns: ["enquiry_id"]
            isOneToOne: false
            referencedRelation: "live_enquiries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_sends_sent_by_fkey"
            columns: ["sent_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_sends_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_templates: {
        Row: {
          body: string
          created_at: string
          id: string
          is_active: boolean
          name: string
          sort_order: number
          stage: Database["public"]["Enums"]["template_stage"]
        }
        Insert: {
          body: string
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          sort_order?: number
          stage?: Database["public"]["Enums"]["template_stage"]
        }
        Update: {
          body?: string
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          sort_order?: number
          stage?: Database["public"]["Enums"]["template_stage"]
        }
        Relationships: []
      }
    }
    Views: {
      live_enquiries: {
        Row: {
          archive_batch_id: string | null
          archived_at: string | null
          archived_by: string | null
          close_reason: Database["public"]["Enums"]["close_reason"] | null
          closed_at: string | null
          created_at: string | null
          created_by: string | null
          follow_up_slots_used: number | null
          fresh_call_date: string | null
          id: number | null
          importance: Database["public"]["Enums"]["importance"] | null
          last_slot_date: string | null
          lead_verification:
            | Database["public"]["Enums"]["lead_verification"]
            | null
          lost_reason: Database["public"]["Enums"]["lost_reason"] | null
          next_follow_up_date: string | null
          product_text: string | null
          source_id: string | null
          status: Database["public"]["Enums"]["enquiry_status"] | null
          student_id: string | null
          term_id: string | null
          top_content_priority: number | null
          type: Database["public"]["Enums"]["enquiry_type"] | null
        }
        Insert: {
          archive_batch_id?: string | null
          archived_at?: string | null
          archived_by?: string | null
          close_reason?: Database["public"]["Enums"]["close_reason"] | null
          closed_at?: string | null
          created_at?: string | null
          created_by?: string | null
          follow_up_slots_used?: number | null
          fresh_call_date?: string | null
          id?: number | null
          importance?: Database["public"]["Enums"]["importance"] | null
          last_slot_date?: string | null
          lead_verification?:
            | Database["public"]["Enums"]["lead_verification"]
            | null
          lost_reason?: Database["public"]["Enums"]["lost_reason"] | null
          next_follow_up_date?: string | null
          product_text?: string | null
          source_id?: string | null
          status?: Database["public"]["Enums"]["enquiry_status"] | null
          student_id?: string | null
          term_id?: string | null
          top_content_priority?: number | null
          type?: Database["public"]["Enums"]["enquiry_type"] | null
        }
        Update: {
          archive_batch_id?: string | null
          archived_at?: string | null
          archived_by?: string | null
          close_reason?: Database["public"]["Enums"]["close_reason"] | null
          closed_at?: string | null
          created_at?: string | null
          created_by?: string | null
          follow_up_slots_used?: number | null
          fresh_call_date?: string | null
          id?: number | null
          importance?: Database["public"]["Enums"]["importance"] | null
          last_slot_date?: string | null
          lead_verification?:
            | Database["public"]["Enums"]["lead_verification"]
            | null
          lost_reason?: Database["public"]["Enums"]["lost_reason"] | null
          next_follow_up_date?: string | null
          product_text?: string | null
          source_id?: string | null
          status?: Database["public"]["Enums"]["enquiry_status"] | null
          student_id?: string | null
          term_id?: string | null
          top_content_priority?: number | null
          type?: Database["public"]["Enums"]["enquiry_type"] | null
        }
        Relationships: [
          {
            foreignKeyName: "enquiries_archive_batch_id_fkey"
            columns: ["archive_batch_id"]
            isOneToOne: false
            referencedRelation: "archive_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "enquiries_archived_by_fkey"
            columns: ["archived_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
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
    }
    Functions: {
      archive_enquiries: {
        Args: { p_filter: Json; p_ids: number[] }
        Returns: string
      }
      archive_ids: {
        Args: {
          p_archived?: boolean
          p_created_from?: string
          p_created_to?: string
          p_lost_reason?: Database["public"]["Enums"]["lost_reason"]
          p_statuses?: Database["public"]["Enums"]["enquiry_status"][]
          p_type?: Database["public"]["Enums"]["enquiry_type"]
        }
        Returns: {
          enquiry_id: number
        }[]
      }
      archive_preview: {
        Args: {
          p_archived?: boolean
          p_created_from?: string
          p_created_to?: string
          p_lost_reason?: Database["public"]["Enums"]["lost_reason"]
          p_statuses?: Database["public"]["Enums"]["enquiry_status"][]
          p_type?: Database["public"]["Enums"]["enquiry_type"]
        }
        Returns: {
          assignment_count: number
          call_count: number
          enquiry_count: number
          item_count: number
          whatsapp_count: number
        }[]
      }
      archive_surface_check: {
        Args: { p_enquiry_id: number }
        Returns: {
          sees_it: boolean
          surface: string
        }[]
      }
      confirm_batch_export: { Args: { p_batch_id: string }; Returns: undefined }
      daily_counsellor_report: {
        Args: { p_counsellor_id?: string; p_from: string; p_to: string }
        Returns: {
          call_backs: number
          calls_made: number
          closed: number
          competitor: number
          counsellor_id: string
          counsellor_name: string
          day: string
          follow_ups_done: number
          fresh_handled: number
          overdue_carried_forward: number
          pli_issued: number
          purchased_amount: number
          purchased_calls: number
        }[]
      }
      daily_stage_report: {
        Args: { p_counsellor_id?: string; p_from: string; p_to: string }
        Returns: {
          after_sale_calls: number
          call_backs: number
          closed: number
          competitor: number
          counsellor_id: string
          counsellor_name: string
          day: string
          follow_up_1: number
          follow_up_2: number
          follow_up_3: number
          fresh_calls: number
          purchased: number
          total_calls: number
        }[]
      }
      enquiries_table: {
        Args: {
          p_close_reason?: Database["public"]["Enums"]["close_reason"]
          p_content_id?: string
          p_counsellor_id?: string
          p_course_id?: string
          p_created_from?: string
          p_created_to?: string
          p_dir?: string
          p_discussion?: string
          p_follow_up_from?: string
          p_follow_up_to?: string
          p_importance?: Database["public"]["Enums"]["importance"]
          p_include_archived?: boolean
          p_limit?: number
          p_lost_reason?: Database["public"]["Enums"]["lost_reason"]
          p_mobile?: string
          p_offset?: number
          p_sort?: string
          p_source_id?: string
          p_status?: Database["public"]["Enums"]["enquiry_status"]
          p_subject_id?: string
          p_teacher_id?: string
          p_term_id?: string
          p_type?: Database["public"]["Enums"]["enquiry_type"]
        }
        Returns: {
          assigned_date: string
          assigned_to_name: string
          close_reason: Database["public"]["Enums"]["close_reason"]
          closed_at: string
          created_at: string
          enquiry_id: number
          follow_up_slots_used: number
          fresh_call_date: string
          importance: Database["public"]["Enums"]["importance"]
          item_count: number
          last_call_at: string
          last_discussion: string
          last_outcome: Database["public"]["Enums"]["call_outcome"]
          lead_verification: Database["public"]["Enums"]["lead_verification"]
          lost_reason: Database["public"]["Enums"]["lost_reason"]
          mobile: string
          next_follow_up_date: string
          product_text: string
          source_name: string
          status: Database["public"]["Enums"]["enquiry_status"]
          student_id: string
          student_name: string
          teacher_names: string
          term_name: string
          total_count: number
          type: Database["public"]["Enums"]["enquiry_type"]
        }[]
      }
      export_calls: {
        Args: { p_ids: number[] }
        Returns: {
          call_date: string
          called_at: string
          called_by_name: string
          discussion: string
          enquiry_id: number
          issue_category: Database["public"]["Enums"]["issue_category"]
          mobile: string
          next_follow_up_date: string
          order_id: string
          outcome: Database["public"]["Enums"]["call_outcome"]
          student_name: string
        }[]
      }
      export_enquiries: {
        Args: { p_ids: number[] }
        Returns: {
          amount_total: number
          assigned_date: string
          assigned_to_name: string
          close_reason: Database["public"]["Enums"]["close_reason"]
          closed_at: string
          contents: string
          courses: string
          created_at: string
          enquiry_id: number
          follow_up_slots_used: number
          fresh_call_date: string
          importance: Database["public"]["Enums"]["importance"]
          item_statuses: string
          last_call_at: string
          last_discussion: string
          last_outcome: Database["public"]["Enums"]["call_outcome"]
          lead_verification: Database["public"]["Enums"]["lead_verification"]
          lost_reason: Database["public"]["Enums"]["lost_reason"]
          mobile: string
          next_follow_up_date: string
          order_ids: string
          product_text: string
          source_name: string
          status: Database["public"]["Enums"]["enquiry_status"]
          student_name: string
          subjects: string
          teachers: string
          term_name: string
          type: Database["public"]["Enums"]["enquiry_type"]
        }[]
      }
      import_lookup: {
        Args: { p_mobiles: string[] }
        Returns: {
          enquiry_count: number
          last_call_at: string
          last_call_by: string
          last_call_date: string
          mobile: string
          open_enquiry_id: number
          state: string
          student_id: string
          student_name: string
        }[]
      }
      import_re_enquire: {
        Args: {
          p_clear_follow_up?: boolean
          p_enquiry_id: number
          p_import_batch_id?: string
          p_importance?: Database["public"]["Enums"]["importance"]
          p_lead_verification?: Database["public"]["Enums"]["lead_verification"]
          p_product_text?: string
          p_source_id?: string
          p_term_id?: string
        }
        Returns: undefined
      }
      new_calls_facets: {
        Args: {
          p_course_id?: string
          p_created_from?: string
          p_created_to?: string
          p_importance?: Database["public"]["Enums"]["importance"]
          p_institute_id?: string
          p_product_text?: string
          p_source_ids?: string[]
          p_teacher_id?: string
          p_term_id?: string
        }
        Returns: {
          facet: string
          items: number
          numbers: number
          value_id: string
        }[]
      }
      new_calls_pool: {
        Args: {
          p_course_id?: string
          p_created_from?: string
          p_created_to?: string
          p_importance?: Database["public"]["Enums"]["importance"]
          p_institute_id?: string
          p_limit?: number
          p_offset?: number
          p_product_text?: string
          p_source_ids?: string[]
          p_teacher_id?: string
          p_term_id?: string
        }
        Returns: {
          created_at: string
          enquiry_id: number
          importance: Database["public"]["Enums"]["importance"]
          item_count: number
          mobile: string
          product_text: string
          source_name: string
          student_id: string
          student_name: string
          teacher_names: string
          term_name: string
          total_count: number
        }[]
      }
      purge_archived: {
        Args: { p_expected_count: number; p_ids: number[] }
        Returns: {
          purged_assignments: number
          purged_calls: number
          purged_enquiries: number
          purged_import_rows: number
          purged_items: number
          purged_whatsapp_sends: number
        }[]
      }
      recommended_calls: {
        Args: {
          p_content_id?: string
          p_counsellor_id?: string
          p_course_id?: string
          p_created_from?: string
          p_created_to?: string
          p_date?: string
          p_discussion?: string
          p_follow_up_from?: string
          p_follow_up_to?: string
          p_importance?: Database["public"]["Enums"]["importance"]
          p_include_not_due?: boolean
          p_institute_id?: string
          p_limit?: number
          p_offset?: number
          p_source_id?: string
          p_status?: Database["public"]["Enums"]["enquiry_status"]
          p_subject_id?: string
          p_teacher_id?: string
          p_term_id?: string
          p_type?: Database["public"]["Enums"]["enquiry_type"]
        }
        Returns: {
          assigned_to: string
          assigned_to_name: string
          bucket: Database["public"]["Enums"]["assignment_bucket"]
          bucket_rank: number
          created_at: string
          due_date: string
          enquiry_id: number
          follow_up_slots_used: number
          importance: Database["public"]["Enums"]["importance"]
          is_overdue: boolean
          item_count: number
          mobile: string
          next_follow_up_date: string
          product_text: string
          source_id: string
          source_name: string
          status: Database["public"]["Enums"]["enquiry_status"]
          student_id: string
          student_name: string
          teacher_names: string[]
          term_id: string
          term_name: string
          top_content_priority: number
          total_count: number
          type: Database["public"]["Enums"]["enquiry_type"]
        }[]
      }
      recommended_facets: {
        Args: {
          p_content_id?: string
          p_counsellor_id?: string
          p_course_id?: string
          p_created_from?: string
          p_created_to?: string
          p_date?: string
          p_discussion?: string
          p_follow_up_from?: string
          p_follow_up_to?: string
          p_importance?: Database["public"]["Enums"]["importance"]
          p_include_not_due?: boolean
          p_institute_id?: string
          p_source_id?: string
          p_status?: Database["public"]["Enums"]["enquiry_status"]
          p_subject_id?: string
          p_teacher_id?: string
          p_term_id?: string
          p_type?: Database["public"]["Enums"]["enquiry_type"]
        }
        Returns: {
          facet: string
          items: number
          numbers: number
          value_id: string
        }[]
      }
      supersede_enquiry: { Args: { p_enquiry_id: number }; Returns: undefined }
      tickets_list: {
        Args: {
          p_counsellor_id?: string
          p_dir?: string
          p_from?: string
          p_include_resolved?: boolean
          p_issue_category?: Database["public"]["Enums"]["issue_category"]
          p_limit?: number
          p_offset?: number
          p_sort?: string
          p_status?: Database["public"]["Enums"]["enquiry_status"]
          p_to?: string
        }
        Returns: {
          call_count: number
          created_at: string
          enquiry_id: number
          issue_category: Database["public"]["Enums"]["issue_category"]
          last_call_at: string
          last_caller_id: string
          last_caller_name: string
          last_discussion: string
          last_outcome: Database["public"]["Enums"]["call_outcome"]
          mobile: string
          order_id: string
          reminder_date: string
          status: Database["public"]["Enums"]["enquiry_status"]
          student_id: string
          student_name: string
          total_count: number
        }[]
      }
      unarchive_batch: { Args: { p_batch_id: string }; Returns: number }
      unarchive_enquiry: { Args: { p_id: number }; Returns: undefined }
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
        | "re_enquired"
        | "dismissed"
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
      template_stage:
        | "fresh"
        | "followup_1"
        | "followup_2"
        | "followup_3"
        | "after_sale"
        | "any"
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
        "re_enquired",
        "dismissed",
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
      template_stage: [
        "fresh",
        "followup_1",
        "followup_2",
        "followup_3",
        "after_sale",
        "any",
      ],
      user_role: ["super_admin", "manager", "counsellor", "ticket_team"],
    },
  },
} as const
