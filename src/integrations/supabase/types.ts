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
      approval_actions: {
        Row: {
          action: string
          approver_id: string
          comments: string | null
          created_at: string
          expense_id: string
          id: string
          level: Database["public"]["Enums"]["approval_level"]
        }
        Insert: {
          action: string
          approver_id: string
          comments?: string | null
          created_at?: string
          expense_id: string
          id?: string
          level: Database["public"]["Enums"]["approval_level"]
        }
        Update: {
          action?: string
          approver_id?: string
          comments?: string | null
          created_at?: string
          expense_id?: string
          id?: string
          level?: Database["public"]["Enums"]["approval_level"]
        }
        Relationships: [
          {
            foreignKeyName: "approval_actions_expense_id_fkey"
            columns: ["expense_id"]
            isOneToOne: false
            referencedRelation: "expenses"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_logs: {
        Row: {
          action: string
          created_at: string
          details: Json | null
          expense_id: string | null
          id: string
          user_id: string
        }
        Insert: {
          action: string
          created_at?: string
          details?: Json | null
          expense_id?: string | null
          id?: string
          user_id: string
        }
        Update: {
          action?: string
          created_at?: string
          details?: Json | null
          expense_id?: string | null
          id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "audit_logs_expense_id_fkey"
            columns: ["expense_id"]
            isOneToOne: false
            referencedRelation: "expenses"
            referencedColumns: ["id"]
          },
        ]
      }
      bank_accounts: {
        Row: {
          account_holder_name: string | null
          account_name: string | null
          account_no_masked: string | null
          account_number: string | null
          account_type: string | null
          bank_name: string | null
          created_at: string
          currency: string
          current_balance: number
          deleted_at: string | null
          entity_id: string | null
          id: string
          is_default: boolean
          normalized_account_no: string | null
          owner_entity_id: string | null
          purpose: string
          related_entity_id: string | null
          related_person_name: string | null
          remark: string | null
          status: string
          updated_at: string
          usage_type: string | null
        }
        Insert: {
          account_holder_name?: string | null
          account_name?: string | null
          account_no_masked?: string | null
          account_number?: string | null
          account_type?: string | null
          bank_name?: string | null
          created_at?: string
          currency?: string
          current_balance?: number
          deleted_at?: string | null
          entity_id?: string | null
          id?: string
          is_default?: boolean
          normalized_account_no?: string | null
          owner_entity_id?: string | null
          purpose?: string
          related_entity_id?: string | null
          related_person_name?: string | null
          remark?: string | null
          status?: string
          updated_at?: string
          usage_type?: string | null
        }
        Update: {
          account_holder_name?: string | null
          account_name?: string | null
          account_no_masked?: string | null
          account_number?: string | null
          account_type?: string | null
          bank_name?: string | null
          created_at?: string
          currency?: string
          current_balance?: number
          deleted_at?: string | null
          entity_id?: string | null
          id?: string
          is_default?: boolean
          normalized_account_no?: string | null
          owner_entity_id?: string | null
          purpose?: string
          related_entity_id?: string | null
          related_person_name?: string | null
          remark?: string | null
          status?: string
          updated_at?: string
          usage_type?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "bank_accounts_entity_id_fkey"
            columns: ["entity_id"]
            isOneToOne: false
            referencedRelation: "business_entities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bank_accounts_owner_entity_id_fkey"
            columns: ["owner_entity_id"]
            isOneToOne: false
            referencedRelation: "business_entities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bank_accounts_related_entity_id_fkey"
            columns: ["related_entity_id"]
            isOneToOne: false
            referencedRelation: "business_entities"
            referencedColumns: ["id"]
          },
        ]
      }
      business_entities: {
        Row: {
          annual_flow_limit: number
          code: string | null
          created_at: string
          deleted_at: string | null
          entity_type: Database["public"]["Enums"]["business_entity_type"]
          id: string
          legal_person: string | null
          name: string
          normalized_name: string | null
          registration_no: string | null
          remark: string | null
          status: string
          tax_no: string | null
          updated_at: string
        }
        Insert: {
          annual_flow_limit?: number
          code?: string | null
          created_at?: string
          deleted_at?: string | null
          entity_type?: Database["public"]["Enums"]["business_entity_type"]
          id?: string
          legal_person?: string | null
          name: string
          normalized_name?: string | null
          registration_no?: string | null
          remark?: string | null
          status?: string
          tax_no?: string | null
          updated_at?: string
        }
        Update: {
          annual_flow_limit?: number
          code?: string | null
          created_at?: string
          deleted_at?: string | null
          entity_type?: Database["public"]["Enums"]["business_entity_type"]
          id?: string
          legal_person?: string | null
          name?: string
          normalized_name?: string | null
          registration_no?: string | null
          remark?: string | null
          status?: string
          tax_no?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      cash_transactions: {
        Row: {
          ai_match_warnings: string[] | null
          ai_matched: boolean
          amount: number
          attachment_path: string | null
          bank_account_id: string
          category_id: string | null
          counterparty: string | null
          counterparty_account: string | null
          counterparty_bank: string | null
          created_at: string
          currency: string
          deleted_at: string | null
          direction: Database["public"]["Enums"]["cash_direction"]
          entity_id: string
          id: string
          occurred_at: string
          operator_id: string | null
          receipt_ai_confidence: Json | null
          receipt_parsed_json: Json | null
          receipt_raw_text: string | null
          remark: string | null
          shop_id: string | null
          status: string
          summary: string | null
          supplier_bill_id: string | null
          supplier_id: string | null
          transaction_serial_no: string | null
          tx_no: string | null
          updated_at: string
        }
        Insert: {
          ai_match_warnings?: string[] | null
          ai_matched?: boolean
          amount: number
          attachment_path?: string | null
          bank_account_id: string
          category_id?: string | null
          counterparty?: string | null
          counterparty_account?: string | null
          counterparty_bank?: string | null
          created_at?: string
          currency?: string
          deleted_at?: string | null
          direction: Database["public"]["Enums"]["cash_direction"]
          entity_id: string
          id?: string
          occurred_at?: string
          operator_id?: string | null
          receipt_ai_confidence?: Json | null
          receipt_parsed_json?: Json | null
          receipt_raw_text?: string | null
          remark?: string | null
          shop_id?: string | null
          status?: string
          summary?: string | null
          supplier_bill_id?: string | null
          supplier_id?: string | null
          transaction_serial_no?: string | null
          tx_no?: string | null
          updated_at?: string
        }
        Update: {
          ai_match_warnings?: string[] | null
          ai_matched?: boolean
          amount?: number
          attachment_path?: string | null
          bank_account_id?: string
          category_id?: string | null
          counterparty?: string | null
          counterparty_account?: string | null
          counterparty_bank?: string | null
          created_at?: string
          currency?: string
          deleted_at?: string | null
          direction?: Database["public"]["Enums"]["cash_direction"]
          entity_id?: string
          id?: string
          occurred_at?: string
          operator_id?: string | null
          receipt_ai_confidence?: Json | null
          receipt_parsed_json?: Json | null
          receipt_raw_text?: string | null
          remark?: string | null
          shop_id?: string | null
          status?: string
          summary?: string | null
          supplier_bill_id?: string | null
          supplier_id?: string | null
          transaction_serial_no?: string | null
          tx_no?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "cash_transactions_bank_account_id_fkey"
            columns: ["bank_account_id"]
            isOneToOne: false
            referencedRelation: "bank_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_transactions_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "cash_tx_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_transactions_entity_id_fkey"
            columns: ["entity_id"]
            isOneToOne: false
            referencedRelation: "business_entities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_transactions_operator_id_fkey"
            columns: ["operator_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_transactions_shop_id_fkey"
            columns: ["shop_id"]
            isOneToOne: false
            referencedRelation: "shops"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_transactions_supplier_bill_id_fkey"
            columns: ["supplier_bill_id"]
            isOneToOne: false
            referencedRelation: "ops_supplier_bills"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_transactions_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "ops_suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      cash_tx_categories: {
        Row: {
          code: string
          created_at: string
          deleted_at: string | null
          direction: Database["public"]["Enums"]["cash_direction"]
          id: string
          name: string
          normalized_name: string | null
          parent_id: string | null
          remark: string | null
          sort_order: number
          status: string
          updated_at: string
        }
        Insert: {
          code: string
          created_at?: string
          deleted_at?: string | null
          direction: Database["public"]["Enums"]["cash_direction"]
          id?: string
          name: string
          normalized_name?: string | null
          parent_id?: string | null
          remark?: string | null
          sort_order?: number
          status?: string
          updated_at?: string
        }
        Update: {
          code?: string
          created_at?: string
          deleted_at?: string | null
          direction?: Database["public"]["Enums"]["cash_direction"]
          id?: string
          name?: string
          normalized_name?: string | null
          parent_id?: string | null
          remark?: string | null
          sort_order?: number
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "cash_tx_categories_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "cash_tx_categories"
            referencedColumns: ["id"]
          },
        ]
      }
      expense_categories: {
        Row: {
          description: string | null
          id: string
          name: string
        }
        Insert: {
          description?: string | null
          id?: string
          name: string
        }
        Update: {
          description?: string | null
          id?: string
          name?: string
        }
        Relationships: []
      }
      expense_receipts: {
        Row: {
          expense_id: string
          file_name: string
          file_path: string
          id: string
          uploaded_at: string
        }
        Insert: {
          expense_id: string
          file_name: string
          file_path: string
          id?: string
          uploaded_at?: string
        }
        Update: {
          expense_id?: string
          file_name?: string
          file_path?: string
          id?: string
          uploaded_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "expense_receipts_expense_id_fkey"
            columns: ["expense_id"]
            isOneToOne: false
            referencedRelation: "expenses"
            referencedColumns: ["id"]
          },
        ]
      }
      expenses: {
        Row: {
          amount: number
          category_id: string | null
          cost_center: string | null
          created_at: string
          currency: string
          description: string | null
          expense_date: string
          id: string
          merchant: string | null
          status: Database["public"]["Enums"]["expense_status"]
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          amount: number
          category_id?: string | null
          cost_center?: string | null
          created_at?: string
          currency?: string
          description?: string | null
          expense_date?: string
          id?: string
          merchant?: string | null
          status?: Database["public"]["Enums"]["expense_status"]
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          amount?: number
          category_id?: string | null
          cost_center?: string | null
          created_at?: string
          currency?: string
          description?: string | null
          expense_date?: string
          id?: string
          merchant?: string | null
          status?: Database["public"]["Enums"]["expense_status"]
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "expenses_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "expense_categories"
            referencedColumns: ["id"]
          },
        ]
      }
      jst_aftersale_received_items: {
        Row: {
          amount: number
          as_id: string
          batch_no: string | null
          created_at: string
          id: string
          item_unique_key: string | null
          name: string | null
          pic: string | null
          properties_value: string | null
          qty: number
          r_qty: number
          raw_data: Json | null
          received_order_id: string
          sku_id: string | null
          supplier_id: string | null
          supplier_name: string | null
          synced_at: string
          updated_at: string
        }
        Insert: {
          amount?: number
          as_id: string
          batch_no?: string | null
          created_at?: string
          id?: string
          item_unique_key?: string | null
          name?: string | null
          pic?: string | null
          properties_value?: string | null
          qty?: number
          r_qty?: number
          raw_data?: Json | null
          received_order_id: string
          sku_id?: string | null
          supplier_id?: string | null
          supplier_name?: string | null
          synced_at?: string
          updated_at?: string
        }
        Update: {
          amount?: number
          as_id?: string
          batch_no?: string | null
          created_at?: string
          id?: string
          item_unique_key?: string | null
          name?: string | null
          pic?: string | null
          properties_value?: string | null
          qty?: number
          r_qty?: number
          raw_data?: Json | null
          received_order_id?: string
          sku_id?: string | null
          supplier_id?: string | null
          supplier_name?: string | null
          synced_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "jst_aftersale_received_items_received_order_id_fkey"
            columns: ["received_order_id"]
            isOneToOne: false
            referencedRelation: "jst_aftersale_received_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      jst_aftersale_received_orders: {
        Row: {
          as_id: string | null
          created_at: string
          id: string
          io_id: string | null
          l_id: string | null
          logistics_company: string | null
          modified_at_jst: string | null
          o_id: string | null
          outer_as_id: string | null
          raw_data: Json | null
          received_date: string | null
          received_unique_key: string | null
          shop_id: string | null
          shop_name: string | null
          so_id: string | null
          status: string | null
          synced_at: string
          updated_at: string
          warehouse: string | null
          wh_id: string | null
          wms_co_id: string | null
        }
        Insert: {
          as_id?: string | null
          created_at?: string
          id?: string
          io_id?: string | null
          l_id?: string | null
          logistics_company?: string | null
          modified_at_jst?: string | null
          o_id?: string | null
          outer_as_id?: string | null
          raw_data?: Json | null
          received_date?: string | null
          received_unique_key?: string | null
          shop_id?: string | null
          shop_name?: string | null
          so_id?: string | null
          status?: string | null
          synced_at?: string
          updated_at?: string
          warehouse?: string | null
          wh_id?: string | null
          wms_co_id?: string | null
        }
        Update: {
          as_id?: string | null
          created_at?: string
          id?: string
          io_id?: string | null
          l_id?: string | null
          logistics_company?: string | null
          modified_at_jst?: string | null
          o_id?: string | null
          outer_as_id?: string | null
          raw_data?: Json | null
          received_date?: string | null
          received_unique_key?: string | null
          shop_id?: string | null
          shop_name?: string | null
          so_id?: string | null
          status?: string | null
          synced_at?: string
          updated_at?: string
          warehouse?: string | null
          wh_id?: string | null
          wms_co_id?: string | null
        }
        Relationships: []
      }
      jst_outbound_order_items: {
        Row: {
          amount: number
          color: string | null
          created_at: string
          i_id: string | null
          id: string
          io_id: string
          ioi_id: string | null
          item_unique_key: string | null
          name: string | null
          oi_id: string | null
          outbound_order_id: string
          pic: string | null
          properties_value: string | null
          qty: number
          raw_data: Json | null
          size: string | null
          sku_id: string | null
          synced_at: string
          updated_at: string
        }
        Insert: {
          amount?: number
          color?: string | null
          created_at?: string
          i_id?: string | null
          id?: string
          io_id: string
          ioi_id?: string | null
          item_unique_key?: string | null
          name?: string | null
          oi_id?: string | null
          outbound_order_id: string
          pic?: string | null
          properties_value?: string | null
          qty?: number
          raw_data?: Json | null
          size?: string | null
          sku_id?: string | null
          synced_at?: string
          updated_at?: string
        }
        Update: {
          amount?: number
          color?: string | null
          created_at?: string
          i_id?: string | null
          id?: string
          io_id?: string
          ioi_id?: string | null
          item_unique_key?: string | null
          name?: string | null
          oi_id?: string | null
          outbound_order_id?: string
          pic?: string | null
          properties_value?: string | null
          qty?: number
          raw_data?: Json | null
          size?: string | null
          sku_id?: string | null
          synced_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "jst_outbound_order_items_outbound_order_id_fkey"
            columns: ["outbound_order_id"]
            isOneToOne: false
            referencedRelation: "jst_outbound_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      jst_outbound_orders: {
        Row: {
          consign_time: string | null
          created_at: string
          id: string
          io_date: string | null
          io_id: string
          l_id: string | null
          lc_id: string | null
          logistics_company: string | null
          modified_at_jst: string | null
          o_id: string | null
          qty: number
          raw_data: Json | null
          shop_id: string | null
          shop_name: string | null
          so_id: string | null
          status: string | null
          synced_at: string
          updated_at: string
          warehouse: string | null
          wms_co_id: string | null
        }
        Insert: {
          consign_time?: string | null
          created_at?: string
          id?: string
          io_date?: string | null
          io_id: string
          l_id?: string | null
          lc_id?: string | null
          logistics_company?: string | null
          modified_at_jst?: string | null
          o_id?: string | null
          qty?: number
          raw_data?: Json | null
          shop_id?: string | null
          shop_name?: string | null
          so_id?: string | null
          status?: string | null
          synced_at?: string
          updated_at?: string
          warehouse?: string | null
          wms_co_id?: string | null
        }
        Update: {
          consign_time?: string | null
          created_at?: string
          id?: string
          io_date?: string | null
          io_id?: string
          l_id?: string | null
          lc_id?: string | null
          logistics_company?: string | null
          modified_at_jst?: string | null
          o_id?: string | null
          qty?: number
          raw_data?: Json | null
          shop_id?: string | null
          shop_name?: string | null
          so_id?: string | null
          status?: string | null
          synced_at?: string
          updated_at?: string
          warehouse?: string | null
          wms_co_id?: string | null
        }
        Relationships: []
      }
      jst_refund_order_items: {
        Row: {
          amount: number
          as_id: string
          asi_id: string | null
          batch_no: string | null
          created_at: string
          id: string
          item_unique_key: string | null
          name: string | null
          outer_oi_id: string | null
          pic: string | null
          price: number
          properties_value: string | null
          qty: number
          r_qty: number
          raw_data: Json | null
          refund_order_id: string
          sku_id: string | null
          sku_type: string | null
          supplier_id: string | null
          supplier_name: string | null
          synced_at: string
          type: string | null
          updated_at: string
        }
        Insert: {
          amount?: number
          as_id: string
          asi_id?: string | null
          batch_no?: string | null
          created_at?: string
          id?: string
          item_unique_key?: string | null
          name?: string | null
          outer_oi_id?: string | null
          pic?: string | null
          price?: number
          properties_value?: string | null
          qty?: number
          r_qty?: number
          raw_data?: Json | null
          refund_order_id: string
          sku_id?: string | null
          sku_type?: string | null
          supplier_id?: string | null
          supplier_name?: string | null
          synced_at?: string
          type?: string | null
          updated_at?: string
        }
        Update: {
          amount?: number
          as_id?: string
          asi_id?: string | null
          batch_no?: string | null
          created_at?: string
          id?: string
          item_unique_key?: string | null
          name?: string | null
          outer_oi_id?: string | null
          pic?: string | null
          price?: number
          properties_value?: string | null
          qty?: number
          r_qty?: number
          raw_data?: Json | null
          refund_order_id?: string
          sku_id?: string | null
          sku_type?: string | null
          supplier_id?: string | null
          supplier_name?: string | null
          synced_at?: string
          type?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "jst_refund_order_items_refund_order_id_fkey"
            columns: ["refund_order_id"]
            isOneToOne: false
            referencedRelation: "jst_refund_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      jst_refund_orders: {
        Row: {
          as_date: string | null
          as_id: string
          confirm_date: string | null
          created_at: string
          created_at_jst: string | null
          freight: number
          good_status: string | null
          id: string
          l_id: string | null
          logistics_company: string | null
          modified_at_jst: string | null
          o_id: string | null
          outer_as_id: string | null
          payment_amount: number
          question_reason: string | null
          question_type: string | null
          raw_data: Json | null
          refund_amount: number
          remark: string | null
          shop_id: string | null
          shop_name: string | null
          shop_status: string | null
          so_id: string | null
          status: string | null
          synced_at: string
          type: string | null
          updated_at: string
          warehouse: string | null
        }
        Insert: {
          as_date?: string | null
          as_id: string
          confirm_date?: string | null
          created_at?: string
          created_at_jst?: string | null
          freight?: number
          good_status?: string | null
          id?: string
          l_id?: string | null
          logistics_company?: string | null
          modified_at_jst?: string | null
          o_id?: string | null
          outer_as_id?: string | null
          payment_amount?: number
          question_reason?: string | null
          question_type?: string | null
          raw_data?: Json | null
          refund_amount?: number
          remark?: string | null
          shop_id?: string | null
          shop_name?: string | null
          shop_status?: string | null
          so_id?: string | null
          status?: string | null
          synced_at?: string
          type?: string | null
          updated_at?: string
          warehouse?: string | null
        }
        Update: {
          as_date?: string | null
          as_id?: string
          confirm_date?: string | null
          created_at?: string
          created_at_jst?: string | null
          freight?: number
          good_status?: string | null
          id?: string
          l_id?: string | null
          logistics_company?: string | null
          modified_at_jst?: string | null
          o_id?: string | null
          outer_as_id?: string | null
          payment_amount?: number
          question_reason?: string | null
          question_type?: string | null
          raw_data?: Json | null
          refund_amount?: number
          remark?: string | null
          shop_id?: string | null
          shop_name?: string | null
          shop_status?: string | null
          so_id?: string | null
          status?: string | null
          synced_at?: string
          type?: string | null
          updated_at?: string
          warehouse?: string | null
        }
        Relationships: []
      }
      jst_sales_order_items: {
        Row: {
          amount: number
          created_at: string
          i_id: string | null
          id: string
          item_index: number
          item_unique_key: string
          jst_item_id: string | null
          jst_o_id: string
          paid_amount: number
          pic: string | null
          product_name: string | null
          qty: number
          raw_item_data: Json | null
          refund_status: string | null
          sale_price: number
          sales_order_id: string
          shop_id: string | null
          shop_sku_id: string | null
          sku_code: string | null
          sku_id: string | null
          sku_name: string | null
          so_id: string | null
          supplier_id: string | null
          supplier_name: string | null
          synced_at: string
          updated_at: string
        }
        Insert: {
          amount?: number
          created_at?: string
          i_id?: string | null
          id?: string
          item_index?: number
          item_unique_key: string
          jst_item_id?: string | null
          jst_o_id: string
          paid_amount?: number
          pic?: string | null
          product_name?: string | null
          qty?: number
          raw_item_data?: Json | null
          refund_status?: string | null
          sale_price?: number
          sales_order_id: string
          shop_id?: string | null
          shop_sku_id?: string | null
          sku_code?: string | null
          sku_id?: string | null
          sku_name?: string | null
          so_id?: string | null
          supplier_id?: string | null
          supplier_name?: string | null
          synced_at?: string
          updated_at?: string
        }
        Update: {
          amount?: number
          created_at?: string
          i_id?: string | null
          id?: string
          item_index?: number
          item_unique_key?: string
          jst_item_id?: string | null
          jst_o_id?: string
          paid_amount?: number
          pic?: string | null
          product_name?: string | null
          qty?: number
          raw_item_data?: Json | null
          refund_status?: string | null
          sale_price?: number
          sales_order_id?: string
          shop_id?: string | null
          shop_sku_id?: string | null
          sku_code?: string | null
          sku_id?: string | null
          sku_name?: string | null
          so_id?: string | null
          supplier_id?: string | null
          supplier_name?: string | null
          synced_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      jst_sales_orders: {
        Row: {
          buyer_message: string | null
          created_at: string
          created_time: string | null
          f_weight: number
          free_amount: number
          freight: number
          id: string
          internal_order_type: string | null
          internal_order_type_name: string | null
          internal_order_type_updated_at: string | null
          io_date: string | null
          io_id: string | null
          jst_o_id: string
          l_id: string | null
          labels: Json | null
          lc_id: string | null
          logistics_company: string | null
          merge_so_id: string | null
          modified_time: string | null
          order_type: string | null
          paid_amount: number
          pay_amount: number
          pay_time: string | null
          plan_delivery_date: string | null
          raw_data: Json | null
          receiver_city: string | null
          receiver_district: string | null
          receiver_mobile_masked: string | null
          receiver_province: string | null
          seller_remark: string | null
          shop_id: string | null
          shop_name: string | null
          so_id: string | null
          status: string | null
          sync_batch_id: string | null
          synced_at: string
          updated_at: string
          weight: number
        }
        Insert: {
          buyer_message?: string | null
          created_at?: string
          created_time?: string | null
          f_weight?: number
          free_amount?: number
          freight?: number
          id?: string
          internal_order_type?: string | null
          internal_order_type_name?: string | null
          internal_order_type_updated_at?: string | null
          io_date?: string | null
          io_id?: string | null
          jst_o_id: string
          l_id?: string | null
          labels?: Json | null
          lc_id?: string | null
          logistics_company?: string | null
          merge_so_id?: string | null
          modified_time?: string | null
          order_type?: string | null
          paid_amount?: number
          pay_amount?: number
          pay_time?: string | null
          plan_delivery_date?: string | null
          raw_data?: Json | null
          receiver_city?: string | null
          receiver_district?: string | null
          receiver_mobile_masked?: string | null
          receiver_province?: string | null
          seller_remark?: string | null
          shop_id?: string | null
          shop_name?: string | null
          so_id?: string | null
          status?: string | null
          sync_batch_id?: string | null
          synced_at?: string
          updated_at?: string
          weight?: number
        }
        Update: {
          buyer_message?: string | null
          created_at?: string
          created_time?: string | null
          f_weight?: number
          free_amount?: number
          freight?: number
          id?: string
          internal_order_type?: string | null
          internal_order_type_name?: string | null
          internal_order_type_updated_at?: string | null
          io_date?: string | null
          io_id?: string | null
          jst_o_id?: string
          l_id?: string | null
          labels?: Json | null
          lc_id?: string | null
          logistics_company?: string | null
          merge_so_id?: string | null
          modified_time?: string | null
          order_type?: string | null
          paid_amount?: number
          pay_amount?: number
          pay_time?: string | null
          plan_delivery_date?: string | null
          raw_data?: Json | null
          receiver_city?: string | null
          receiver_district?: string | null
          receiver_mobile_masked?: string | null
          receiver_province?: string | null
          seller_remark?: string | null
          shop_id?: string | null
          shop_name?: string | null
          so_id?: string | null
          status?: string | null
          sync_batch_id?: string | null
          synced_at?: string
          updated_at?: string
          weight?: number
        }
        Relationships: []
      }
      jst_sales_refund_daily_summary: {
        Row: {
          business_entity_id: string
          created_at: string
          data_source_label: string
          generated_at: string
          generated_from_run_id: string | null
          gmv_amount: number
          gsv_amount: number
          id: string
          order_count: number
          platform_id: string
          refund_amount: number
          refund_count: number
          refund_rate: number
          shop_id: string
          summary_date: string
          updated_at: string
        }
        Insert: {
          business_entity_id: string
          created_at?: string
          data_source_label?: string
          generated_at?: string
          generated_from_run_id?: string | null
          gmv_amount?: number
          gsv_amount?: number
          id?: string
          order_count?: number
          platform_id: string
          refund_amount?: number
          refund_count?: number
          refund_rate?: number
          shop_id: string
          summary_date: string
          updated_at?: string
        }
        Update: {
          business_entity_id?: string
          created_at?: string
          data_source_label?: string
          generated_at?: string
          generated_from_run_id?: string | null
          gmv_amount?: number
          gsv_amount?: number
          id?: string
          order_count?: number
          platform_id?: string
          refund_amount?: number
          refund_count?: number
          refund_rate?: number
          shop_id?: string
          summary_date?: string
          updated_at?: string
        }
        Relationships: []
      }
      jst_sales_refund_raw: {
        Row: {
          created_at: string
          id: string
          jst_order_id: string
          jst_shop_id: string
          mapping_status: string
          matched_business_entity_id: string | null
          matched_platform_id: string | null
          matched_shop_id: string | null
          order_amount: number
          order_paid_at: string | null
          order_status: string
          platform_order_id: string
          product_code: string
          product_name: string
          raw_json: Json | null
          record_type: string
          refund_amount: number
          refund_completed_at: string | null
          refund_id: string
          refund_status: string
          sku_code: string
          sku_id: string
          source_updated_at: string | null
          sync_run_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          jst_order_id?: string
          jst_shop_id?: string
          mapping_status?: string
          matched_business_entity_id?: string | null
          matched_platform_id?: string | null
          matched_shop_id?: string | null
          order_amount?: number
          order_paid_at?: string | null
          order_status?: string
          platform_order_id?: string
          product_code?: string
          product_name?: string
          raw_json?: Json | null
          record_type: string
          refund_amount?: number
          refund_completed_at?: string | null
          refund_id?: string
          refund_status?: string
          sku_code?: string
          sku_id?: string
          source_updated_at?: string | null
          sync_run_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          jst_order_id?: string
          jst_shop_id?: string
          mapping_status?: string
          matched_business_entity_id?: string | null
          matched_platform_id?: string | null
          matched_shop_id?: string | null
          order_amount?: number
          order_paid_at?: string | null
          order_status?: string
          platform_order_id?: string
          product_code?: string
          product_name?: string
          raw_json?: Json | null
          record_type?: string
          refund_amount?: number
          refund_completed_at?: string | null
          refund_id?: string
          refund_status?: string
          sku_code?: string
          sku_id?: string
          source_updated_at?: string | null
          sync_run_id?: string | null
        }
        Relationships: []
      }
      jst_shop_mapping_audit_logs: {
        Row: {
          action_type: string
          id: string
          jst_shop_id: string
          mapping_id: string
          new_business_entity_id: string | null
          new_platform_id: string | null
          new_shop_id: string | null
          new_status: string | null
          old_business_entity_id: string | null
          old_platform_id: string | null
          old_shop_id: string | null
          old_status: string | null
          operated_at: string
          operated_by: string | null
          reason: string
        }
        Insert: {
          action_type: string
          id?: string
          jst_shop_id?: string
          mapping_id: string
          new_business_entity_id?: string | null
          new_platform_id?: string | null
          new_shop_id?: string | null
          new_status?: string | null
          old_business_entity_id?: string | null
          old_platform_id?: string | null
          old_shop_id?: string | null
          old_status?: string | null
          operated_at?: string
          operated_by?: string | null
          reason?: string
        }
        Update: {
          action_type?: string
          id?: string
          jst_shop_id?: string
          mapping_id?: string
          new_business_entity_id?: string | null
          new_platform_id?: string | null
          new_shop_id?: string | null
          new_status?: string | null
          old_business_entity_id?: string | null
          old_platform_id?: string | null
          old_shop_id?: string | null
          old_status?: string | null
          operated_at?: string
          operated_by?: string | null
          reason?: string
        }
        Relationships: []
      }
      jst_shop_mappings: {
        Row: {
          auth_status: string
          bind_reason: string
          created_at: string
          id: string
          ignore_reason: string
          ignored_at: string | null
          ignored_by: string | null
          jst_shop_id: string
          jst_shop_name: string
          last_sync_at: string | null
          mapping_note: string
          mapping_status: string
          matched_business_entity_id: string | null
          matched_platform_id: string | null
          matched_shop_id: string | null
          platform_shop_id: string
          platform_type: string
          raw_json: Json | null
          shop_status: string
          updated_at: string
        }
        Insert: {
          auth_status?: string
          bind_reason?: string
          created_at?: string
          id?: string
          ignore_reason?: string
          ignored_at?: string | null
          ignored_by?: string | null
          jst_shop_id: string
          jst_shop_name?: string
          last_sync_at?: string | null
          mapping_note?: string
          mapping_status?: string
          matched_business_entity_id?: string | null
          matched_platform_id?: string | null
          matched_shop_id?: string | null
          platform_shop_id?: string
          platform_type?: string
          raw_json?: Json | null
          shop_status?: string
          updated_at?: string
        }
        Update: {
          auth_status?: string
          bind_reason?: string
          created_at?: string
          id?: string
          ignore_reason?: string
          ignored_at?: string | null
          ignored_by?: string | null
          jst_shop_id?: string
          jst_shop_name?: string
          last_sync_at?: string | null
          mapping_note?: string
          mapping_status?: string
          matched_business_entity_id?: string | null
          matched_platform_id?: string | null
          matched_shop_id?: string | null
          platform_shop_id?: string
          platform_type?: string
          raw_json?: Json | null
          shop_status?: string
          updated_at?: string
        }
        Relationships: []
      }
      jst_suppliers_raw: {
        Row: {
          created_at: string
          id: string
          jst_supplier_id: string
          last_sync_at: string | null
          matched_ops_supplier_id: string | null
          raw_json: Json | null
          skip_reason: string
          status: string
          supplier_code: string
          supplier_name: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          jst_supplier_id: string
          last_sync_at?: string | null
          matched_ops_supplier_id?: string | null
          raw_json?: Json | null
          skip_reason?: string
          status?: string
          supplier_code?: string
          supplier_name?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          jst_supplier_id?: string
          last_sync_at?: string | null
          matched_ops_supplier_id?: string | null
          raw_json?: Json | null
          skip_reason?: string
          status?: string
          supplier_code?: string
          supplier_name?: string
          updated_at?: string
        }
        Relationships: []
      }
      jst_sync_errors: {
        Row: {
          error_level: string
          error_message: string
          first_seen_at: string
          id: string
          last_seen_at: string
          module_key: string
          resolved_at: string | null
          retry_count: number
          status: string
        }
        Insert: {
          error_level?: string
          error_message?: string
          first_seen_at?: string
          id?: string
          last_seen_at?: string
          module_key: string
          resolved_at?: string | null
          retry_count?: number
          status?: string
        }
        Update: {
          error_level?: string
          error_message?: string
          first_seen_at?: string
          id?: string
          last_seen_at?: string
          module_key?: string
          resolved_at?: string | null
          retry_count?: number
          status?: string
        }
        Relationships: []
      }
      jst_sync_jobs: {
        Row: {
          auto_continue: boolean
          cancel_requested: boolean
          cancelled_at: string | null
          created_at: string
          created_by: string | null
          current_page_index: number
          current_window_from: string | null
          current_window_index: number
          current_window_to: string | null
          ended_at: string | null
          error_detail: string
          has_next: boolean
          heartbeat_at: string | null
          id: string
          last_success_at: string | null
          lock_owner: string | null
          locked_until: string | null
          max_pages_per_run: number
          max_window_days: number
          message: string
          metadata: Json
          next_page_index: number
          next_tick_at: string | null
          page_size: number
          parent_log_id: string | null
          requested_from: string
          requested_range: string
          requested_to: string
          started_at: string
          status: string
          sync_type: string
          time_budget_seconds: number
          total_api_count: number
          total_failed: number
          total_item_upserted: number
          total_order_upserted: number
          total_windows: number
          trigger_type: string
          updated_at: string
          windows: Json
        }
        Insert: {
          auto_continue?: boolean
          cancel_requested?: boolean
          cancelled_at?: string | null
          created_at?: string
          created_by?: string | null
          current_page_index?: number
          current_window_from?: string | null
          current_window_index?: number
          current_window_to?: string | null
          ended_at?: string | null
          error_detail?: string
          has_next?: boolean
          heartbeat_at?: string | null
          id?: string
          last_success_at?: string | null
          lock_owner?: string | null
          locked_until?: string | null
          max_pages_per_run?: number
          max_window_days?: number
          message?: string
          metadata?: Json
          next_page_index?: number
          next_tick_at?: string | null
          page_size?: number
          parent_log_id?: string | null
          requested_from: string
          requested_range?: string
          requested_to: string
          started_at?: string
          status?: string
          sync_type: string
          time_budget_seconds?: number
          total_api_count?: number
          total_failed?: number
          total_item_upserted?: number
          total_order_upserted?: number
          total_windows?: number
          trigger_type?: string
          updated_at?: string
          windows?: Json
        }
        Update: {
          auto_continue?: boolean
          cancel_requested?: boolean
          cancelled_at?: string | null
          created_at?: string
          created_by?: string | null
          current_page_index?: number
          current_window_from?: string | null
          current_window_index?: number
          current_window_to?: string | null
          ended_at?: string | null
          error_detail?: string
          has_next?: boolean
          heartbeat_at?: string | null
          id?: string
          last_success_at?: string | null
          lock_owner?: string | null
          locked_until?: string | null
          max_pages_per_run?: number
          max_window_days?: number
          message?: string
          metadata?: Json
          next_page_index?: number
          next_tick_at?: string | null
          page_size?: number
          parent_log_id?: string | null
          requested_from?: string
          requested_range?: string
          requested_to?: string
          started_at?: string
          status?: string
          sync_type?: string
          time_budget_seconds?: number
          total_api_count?: number
          total_failed?: number
          total_item_upserted?: number
          total_order_upserted?: number
          total_windows?: number
          trigger_type?: string
          updated_at?: string
          windows?: Json
        }
        Relationships: []
      }
      jst_sync_log_details: {
        Row: {
          api_count: number
          created_at: string
          duration_ms: number
          error_detail: string
          error_type: string | null
          failed_count: number
          first_io_date: string | null
          first_modified_at: string | null
          has_next: boolean
          id: string
          item_upserted: number
          job_id: string | null
          last_io_date: string | null
          last_modified_at: string | null
          log_id: string | null
          main_upserted: number
          page_index: number
          page_size: number
          request_body: Json
          response_code: string | null
          response_msg: string | null
          sync_type: string
          window_from: string | null
          window_index: number
          window_to: string | null
        }
        Insert: {
          api_count?: number
          created_at?: string
          duration_ms?: number
          error_detail?: string
          error_type?: string | null
          failed_count?: number
          first_io_date?: string | null
          first_modified_at?: string | null
          has_next?: boolean
          id?: string
          item_upserted?: number
          job_id?: string | null
          last_io_date?: string | null
          last_modified_at?: string | null
          log_id?: string | null
          main_upserted?: number
          page_index: number
          page_size?: number
          request_body?: Json
          response_code?: string | null
          response_msg?: string | null
          sync_type: string
          window_from?: string | null
          window_index?: number
          window_to?: string | null
        }
        Update: {
          api_count?: number
          created_at?: string
          duration_ms?: number
          error_detail?: string
          error_type?: string | null
          failed_count?: number
          first_io_date?: string | null
          first_modified_at?: string | null
          has_next?: boolean
          id?: string
          item_upserted?: number
          job_id?: string | null
          last_io_date?: string | null
          last_modified_at?: string | null
          log_id?: string | null
          main_upserted?: number
          page_index?: number
          page_size?: number
          request_body?: Json
          response_code?: string | null
          response_msg?: string | null
          sync_type?: string
          window_from?: string | null
          window_index?: number
          window_to?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "jst_sync_log_details_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jst_sync_jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      jst_sync_logs: {
        Row: {
          cursor_from: string | null
          cursor_to: string | null
          ended_at: string | null
          error_detail: string | null
          fetched_items_count: number | null
          fetched_orders_count: number | null
          fetched_receipts_count: number | null
          heartbeat_at: string | null
          id: string
          job_id: string | null
          message: string | null
          metadata: Json
          started_at: string
          status: string
          sync_type: string
        }
        Insert: {
          cursor_from?: string | null
          cursor_to?: string | null
          ended_at?: string | null
          error_detail?: string | null
          fetched_items_count?: number | null
          fetched_orders_count?: number | null
          fetched_receipts_count?: number | null
          heartbeat_at?: string | null
          id?: string
          job_id?: string | null
          message?: string | null
          metadata?: Json
          started_at?: string
          status: string
          sync_type: string
        }
        Update: {
          cursor_from?: string | null
          cursor_to?: string | null
          ended_at?: string | null
          error_detail?: string | null
          fetched_items_count?: number | null
          fetched_orders_count?: number | null
          fetched_receipts_count?: number | null
          heartbeat_at?: string | null
          id?: string
          job_id?: string | null
          message?: string | null
          metadata?: Json
          started_at?: string
          status?: string
          sync_type?: string
        }
        Relationships: []
      }
      jst_sync_metrics: {
        Row: {
          data_source_label: string
          id: string
          last_sync_at: string | null
          metric_extra: Json
          metric_key: string
          metric_name: string
          metric_value: string
          time_range_label: string
          updated_at: string
        }
        Insert: {
          data_source_label?: string
          id?: string
          last_sync_at?: string | null
          metric_extra?: Json
          metric_key: string
          metric_name: string
          metric_value?: string
          time_range_label?: string
          updated_at?: string
        }
        Update: {
          data_source_label?: string
          id?: string
          last_sync_at?: string | null
          metric_extra?: Json
          metric_key?: string
          metric_name?: string
          metric_value?: string
          time_range_label?: string
          updated_at?: string
        }
        Relationships: []
      }
      jst_sync_modules: {
        Row: {
          category: string
          created_at: string
          enabled: boolean
          id: string
          last_result_summary: string
          last_sync_at: string | null
          module_key: string
          module_name: string
          next_sync_at: string | null
          priority: number
          retry_count: number
          status: string
          sync_content: string
          sync_frequency: string
          updated_at: string
        }
        Insert: {
          category: string
          created_at?: string
          enabled?: boolean
          id?: string
          last_result_summary?: string
          last_sync_at?: string | null
          module_key: string
          module_name: string
          next_sync_at?: string | null
          priority?: number
          retry_count?: number
          status?: string
          sync_content?: string
          sync_frequency?: string
          updated_at?: string
        }
        Update: {
          category?: string
          created_at?: string
          enabled?: boolean
          id?: string
          last_result_summary?: string
          last_sync_at?: string | null
          module_key?: string
          module_name?: string
          next_sync_at?: string | null
          priority?: number
          retry_count?: number
          status?: string
          sync_content?: string
          sync_frequency?: string
          updated_at?: string
        }
        Relationships: []
      }
      jst_sync_runs: {
        Row: {
          created_at: string
          created_by: string | null
          current_total_summary: string
          duration_ms: number | null
          error_message: string
          failed_count: number
          finished_at: string | null
          id: string
          inserted_count: number
          module_key: string
          started_at: string
          status: string
          trigger_type: string
          updated_count: number
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          current_total_summary?: string
          duration_ms?: number | null
          error_message?: string
          failed_count?: number
          finished_at?: string | null
          id?: string
          inserted_count?: number
          module_key: string
          started_at?: string
          status?: string
          trigger_type?: string
          updated_count?: number
        }
        Update: {
          created_at?: string
          created_by?: string | null
          current_total_summary?: string
          duration_ms?: number | null
          error_message?: string
          failed_count?: number
          finished_at?: string | null
          id?: string
          inserted_count?: number
          module_key?: string
          started_at?: string
          status?: string
          trigger_type?: string
          updated_count?: number
        }
        Relationships: []
      }
      jst_sync_state: {
        Row: {
          key: string
          updated_at: string
          value: Json
        }
        Insert: {
          key: string
          updated_at?: string
          value?: Json
        }
        Update: {
          key?: string
          updated_at?: string
          value?: Json
        }
        Relationships: []
      }
      jst_tokens: {
        Row: {
          access_token: string
          expires_at: string | null
          id: string
          refresh_token: string | null
          scope: string | null
          updated_at: string
        }
        Insert: {
          access_token: string
          expires_at?: string | null
          id?: string
          refresh_token?: string | null
          scope?: string | null
          updated_at?: string
        }
        Update: {
          access_token?: string
          expires_at?: string | null
          id?: string
          refresh_token?: string | null
          scope?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      jst_warehouses: {
        Row: {
          created_at: string
          id: string
          jst_wms_co_id: string
          last_synced_at: string | null
          name: string
          raw_jst_json: Json | null
          remark: string
          status: string
          type: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          jst_wms_co_id: string
          last_synced_at?: string | null
          name?: string
          raw_jst_json?: Json | null
          remark?: string
          status?: string
          type?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          jst_wms_co_id?: string
          last_synced_at?: string | null
          name?: string
          raw_jst_json?: Json | null
          remark?: string
          status?: string
          type?: string
          updated_at?: string
        }
        Relationships: []
      }
      ops_arrival_items: {
        Row: {
          arrival_id: string
          id: string
          qty_expected: number
          qty_received: number
          sku_id: string
          unit_price: number | null
        }
        Insert: {
          arrival_id: string
          id?: string
          qty_expected?: number
          qty_received?: number
          sku_id: string
          unit_price?: number | null
        }
        Update: {
          arrival_id?: string
          id?: string
          qty_expected?: number
          qty_received?: number
          sku_id?: string
          unit_price?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "ops_arrival_items_arrival_id_fkey"
            columns: ["arrival_id"]
            isOneToOne: false
            referencedRelation: "ops_arrivals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ops_arrival_items_sku_id_fkey"
            columns: ["sku_id"]
            isOneToOne: false
            referencedRelation: "ops_skus"
            referencedColumns: ["id"]
          },
        ]
      }
      ops_arrivals: {
        Row: {
          arrival_no: string
          arrived_at: string
          created_at: string
          id: string
          operator_id: string | null
          remark: string | null
          status: string
          supplier_id: string
          updated_at: string
        }
        Insert: {
          arrival_no: string
          arrived_at?: string
          created_at?: string
          id?: string
          operator_id?: string | null
          remark?: string | null
          status?: string
          supplier_id: string
          updated_at?: string
        }
        Update: {
          arrival_no?: string
          arrived_at?: string
          created_at?: string
          id?: string
          operator_id?: string | null
          remark?: string | null
          status?: string
          supplier_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ops_arrivals_operator_id_fkey"
            columns: ["operator_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ops_arrivals_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "ops_suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      ops_products: {
        Row: {
          age_range: string | null
          brand: string | null
          category: string | null
          code: string
          cost_price: number | null
          created_at: string
          external_image_url: string | null
          gender: string | null
          id: string
          image_storage_path: string | null
          is_active: boolean | null
          jst_product_id: string | null
          last_synced_at: string | null
          main_image_url: string | null
          name: string
          product_name: string | null
          raw_jst_json: Json | null
          remark: string | null
          sale_price: number | null
          season: string | null
          status: string
          style_no: string | null
          supplier_id: string | null
          supplier_name_snapshot: string | null
          updated_at: string
          year: number | null
        }
        Insert: {
          age_range?: string | null
          brand?: string | null
          category?: string | null
          code: string
          cost_price?: number | null
          created_at?: string
          external_image_url?: string | null
          gender?: string | null
          id?: string
          image_storage_path?: string | null
          is_active?: boolean | null
          jst_product_id?: string | null
          last_synced_at?: string | null
          main_image_url?: string | null
          name: string
          product_name?: string | null
          raw_jst_json?: Json | null
          remark?: string | null
          sale_price?: number | null
          season?: string | null
          status?: string
          style_no?: string | null
          supplier_id?: string | null
          supplier_name_snapshot?: string | null
          updated_at?: string
          year?: number | null
        }
        Update: {
          age_range?: string | null
          brand?: string | null
          category?: string | null
          code?: string
          cost_price?: number | null
          created_at?: string
          external_image_url?: string | null
          gender?: string | null
          id?: string
          image_storage_path?: string | null
          is_active?: boolean | null
          jst_product_id?: string | null
          last_synced_at?: string | null
          main_image_url?: string | null
          name?: string
          product_name?: string | null
          raw_jst_json?: Json | null
          remark?: string | null
          sale_price?: number | null
          season?: string | null
          status?: string
          style_no?: string | null
          supplier_id?: string | null
          supplier_name_snapshot?: string | null
          updated_at?: string
          year?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "ops_products_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "ops_suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      ops_roles: {
        Row: {
          code: Database["public"]["Enums"]["ops_role_code"]
          description: string | null
          name: string
        }
        Insert: {
          code: Database["public"]["Enums"]["ops_role_code"]
          description?: string | null
          name: string
        }
        Update: {
          code?: Database["public"]["Enums"]["ops_role_code"]
          description?: string | null
          name?: string
        }
        Relationships: []
      }
      ops_sku_aliases: {
        Row: {
          alias_type: string
          barcode: string | null
          created_at: string
          external_product_id: string | null
          external_sku_code: string | null
          external_sku_id: string | null
          id: string
          is_primary: boolean | null
          jst_sku_id: string | null
          platform: string | null
          shop_id: string | null
          sku_id: string | null
          updated_at: string
        }
        Insert: {
          alias_type: string
          barcode?: string | null
          created_at?: string
          external_product_id?: string | null
          external_sku_code?: string | null
          external_sku_id?: string | null
          id?: string
          is_primary?: boolean | null
          jst_sku_id?: string | null
          platform?: string | null
          shop_id?: string | null
          sku_id?: string | null
          updated_at?: string
        }
        Update: {
          alias_type?: string
          barcode?: string | null
          created_at?: string
          external_product_id?: string | null
          external_sku_code?: string | null
          external_sku_id?: string | null
          id?: string
          is_primary?: boolean | null
          jst_sku_id?: string | null
          platform?: string | null
          shop_id?: string | null
          sku_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ops_sku_aliases_sku_id_fkey"
            columns: ["sku_id"]
            isOneToOne: false
            referencedRelation: "ops_skus"
            referencedColumns: ["id"]
          },
        ]
      }
      ops_skus: {
        Row: {
          barcode: string | null
          color: string | null
          cost_price: number | null
          created_at: string
          external_image_url: string | null
          id: string
          image_storage_path: string | null
          is_active: boolean | null
          jst_sku_id: string | null
          last_synced_at: string | null
          product_id: string
          raw_jst_json: Json | null
          sale_price: number | null
          size: string | null
          sku_code: string
          sku_image_url: string | null
          sku_name: string | null
          spec: string | null
          spec_name: string | null
          status: string
          stock: number
          supplier_id: string | null
          updated_at: string
        }
        Insert: {
          barcode?: string | null
          color?: string | null
          cost_price?: number | null
          created_at?: string
          external_image_url?: string | null
          id?: string
          image_storage_path?: string | null
          is_active?: boolean | null
          jst_sku_id?: string | null
          last_synced_at?: string | null
          product_id: string
          raw_jst_json?: Json | null
          sale_price?: number | null
          size?: string | null
          sku_code: string
          sku_image_url?: string | null
          sku_name?: string | null
          spec?: string | null
          spec_name?: string | null
          status?: string
          stock?: number
          supplier_id?: string | null
          updated_at?: string
        }
        Update: {
          barcode?: string | null
          color?: string | null
          cost_price?: number | null
          created_at?: string
          external_image_url?: string | null
          id?: string
          image_storage_path?: string | null
          is_active?: boolean | null
          jst_sku_id?: string | null
          last_synced_at?: string | null
          product_id?: string
          raw_jst_json?: Json | null
          sale_price?: number | null
          size?: string | null
          sku_code?: string
          sku_image_url?: string | null
          sku_name?: string | null
          spec?: string | null
          spec_name?: string | null
          status?: string
          stock?: number
          supplier_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ops_skus_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "ops_products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ops_skus_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "ops_suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      ops_supplier_bills: {
        Row: {
          amount: number
          audited_at: string | null
          auditor_id: string | null
          bill_no: string
          created_at: string
          id: string
          period: string
          remark: string | null
          status: string
          supplier_id: string
          updated_at: string
        }
        Insert: {
          amount?: number
          audited_at?: string | null
          auditor_id?: string | null
          bill_no: string
          created_at?: string
          id?: string
          period: string
          remark?: string | null
          status?: string
          supplier_id: string
          updated_at?: string
        }
        Update: {
          amount?: number
          audited_at?: string | null
          auditor_id?: string | null
          bill_no?: string
          created_at?: string
          id?: string
          period?: string
          remark?: string | null
          status?: string
          supplier_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ops_supplier_bills_auditor_id_fkey"
            columns: ["auditor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ops_supplier_bills_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "ops_suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      ops_supplier_confirm_audit_logs: {
        Row: {
          id: string
          new_confirm_status: string
          old_confirm_status: string
          operated_at: string
          operated_by: string | null
          reason: string
          supplier_id: string
        }
        Insert: {
          id?: string
          new_confirm_status: string
          old_confirm_status?: string
          operated_at?: string
          operated_by?: string | null
          reason?: string
          supplier_id: string
        }
        Update: {
          id?: string
          new_confirm_status?: string
          old_confirm_status?: string
          operated_at?: string
          operated_by?: string | null
          reason?: string
          supplier_id?: string
        }
        Relationships: []
      }
      ops_suppliers: {
        Row: {
          address: string | null
          archived_at: string | null
          archived_by: string | null
          archived_reason: string
          code: string
          confirm_status: string
          confirmed_at: string | null
          confirmed_by: string | null
          contact: string | null
          created_at: string
          email: string | null
          id: string
          jst_supplier_id: string | null
          last_synced_at: string | null
          manual_address: string
          manual_contact_name: string
          manual_contact_phone: string
          name: string
          owner_user_id: string | null
          phone: string | null
          raw_jst_json: Json | null
          remark: string | null
          status: string
          updated_at: string
        }
        Insert: {
          address?: string | null
          archived_at?: string | null
          archived_by?: string | null
          archived_reason?: string
          code: string
          confirm_status?: string
          confirmed_at?: string | null
          confirmed_by?: string | null
          contact?: string | null
          created_at?: string
          email?: string | null
          id?: string
          jst_supplier_id?: string | null
          last_synced_at?: string | null
          manual_address?: string
          manual_contact_name?: string
          manual_contact_phone?: string
          name: string
          owner_user_id?: string | null
          phone?: string | null
          raw_jst_json?: Json | null
          remark?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          address?: string | null
          archived_at?: string | null
          archived_by?: string | null
          archived_reason?: string
          code?: string
          confirm_status?: string
          confirmed_at?: string | null
          confirmed_by?: string | null
          contact?: string | null
          created_at?: string
          email?: string | null
          id?: string
          jst_supplier_id?: string | null
          last_synced_at?: string | null
          manual_address?: string
          manual_contact_name?: string
          manual_contact_phone?: string
          name?: string
          owner_user_id?: string | null
          phone?: string | null
          raw_jst_json?: Json | null
          remark?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      ops_user_roles: {
        Row: {
          created_at: string
          id: string
          role_code: Database["public"]["Enums"]["ops_role_code"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role_code: Database["public"]["Enums"]["ops_role_code"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role_code?: Database["public"]["Enums"]["ops_role_code"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ops_user_roles_role_code_fkey"
            columns: ["role_code"]
            isOneToOne: false
            referencedRelation: "ops_roles"
            referencedColumns: ["code"]
          },
        ]
      }
      platforms: {
        Row: {
          code: string
          created_at: string
          deleted_at: string | null
          id: string
          name: string
          remark: string | null
          status: string
          updated_at: string
        }
        Insert: {
          code: string
          created_at?: string
          deleted_at?: string | null
          id?: string
          name: string
          remark?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          code?: string
          created_at?: string
          deleted_at?: string | null
          id?: string
          name?: string
          remark?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          account_type: Database["public"]["Enums"]["ops_account_type"]
          created_at: string
          department: string
          full_name: string
          id: string
          manager_id: string | null
          phone: string | null
          supplier_id: string | null
          updated_at: string
          user_type: Database["public"]["Enums"]["user_type"]
          username: string | null
        }
        Insert: {
          account_type?: Database["public"]["Enums"]["ops_account_type"]
          created_at?: string
          department?: string
          full_name?: string
          id: string
          manager_id?: string | null
          phone?: string | null
          supplier_id?: string | null
          updated_at?: string
          user_type?: Database["public"]["Enums"]["user_type"]
          username?: string | null
        }
        Update: {
          account_type?: Database["public"]["Enums"]["ops_account_type"]
          created_at?: string
          department?: string
          full_name?: string
          id?: string
          manager_id?: string | null
          phone?: string | null
          supplier_id?: string | null
          updated_at?: string
          user_type?: Database["public"]["Enums"]["user_type"]
          username?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "profiles_manager_id_fkey"
            columns: ["manager_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profiles_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "ops_suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      purchase_order_items: {
        Row: {
          amount: number
          color: string | null
          created_at: string
          delivery_date: string | null
          external_po_id: string
          external_poi_id: string | null
          id: string
          item_remark: string | null
          product_id: string | null
          product_image_url: string | null
          product_name: string | null
          properties_value: string | null
          purchase_order_id: string
          purchase_qty: number
          raw: Json | null
          received_qty: number
          size: string | null
          sku_id: string | null
          sku_no: string | null
          spec: string | null
          style_no: string | null
          unit_price: number
          unreceived_qty: number
          updated_at: string
        }
        Insert: {
          amount?: number
          color?: string | null
          created_at?: string
          delivery_date?: string | null
          external_po_id: string
          external_poi_id?: string | null
          id?: string
          item_remark?: string | null
          product_id?: string | null
          product_image_url?: string | null
          product_name?: string | null
          properties_value?: string | null
          purchase_order_id: string
          purchase_qty?: number
          raw?: Json | null
          received_qty?: number
          size?: string | null
          sku_id?: string | null
          sku_no?: string | null
          spec?: string | null
          style_no?: string | null
          unit_price?: number
          unreceived_qty?: number
          updated_at?: string
        }
        Update: {
          amount?: number
          color?: string | null
          created_at?: string
          delivery_date?: string | null
          external_po_id?: string
          external_poi_id?: string | null
          id?: string
          item_remark?: string | null
          product_id?: string | null
          product_image_url?: string | null
          product_name?: string | null
          properties_value?: string | null
          purchase_order_id?: string
          purchase_qty?: number
          raw?: Json | null
          received_qty?: number
          size?: string | null
          sku_id?: string | null
          sku_no?: string | null
          spec?: string | null
          style_no?: string | null
          unit_price?: number
          unreceived_qty?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "purchase_order_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "ops_products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_order_items_purchase_order_id_fkey"
            columns: ["purchase_order_id"]
            isOneToOne: false
            referencedRelation: "purchase_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_order_items_sku_id_fkey"
            columns: ["sku_id"]
            isOneToOne: false
            referencedRelation: "ops_skus"
            referencedColumns: ["id"]
          },
        ]
      }
      purchase_orders: {
        Row: {
          created_at: string
          expected_delivery_date: string | null
          external_po_id: string
          id: string
          jst_modified_at: string | null
          jst_supplier_id: string | null
          latest_receipt_at: string | null
          po_date: string | null
          raw: Json | null
          raw_receive_status: string | null
          remark: string | null
          status: string | null
          status_label: string | null
          supplier_id: string | null
          supplier_name: string | null
          total_amount: number
          total_purchase_qty: number
          total_received_qty: number
          total_unreceived_qty: number
          updated_at: string
          warehouse_status: string | null
        }
        Insert: {
          created_at?: string
          expected_delivery_date?: string | null
          external_po_id: string
          id?: string
          jst_modified_at?: string | null
          jst_supplier_id?: string | null
          latest_receipt_at?: string | null
          po_date?: string | null
          raw?: Json | null
          raw_receive_status?: string | null
          remark?: string | null
          status?: string | null
          status_label?: string | null
          supplier_id?: string | null
          supplier_name?: string | null
          total_amount?: number
          total_purchase_qty?: number
          total_received_qty?: number
          total_unreceived_qty?: number
          updated_at?: string
          warehouse_status?: string | null
        }
        Update: {
          created_at?: string
          expected_delivery_date?: string | null
          external_po_id?: string
          id?: string
          jst_modified_at?: string | null
          jst_supplier_id?: string | null
          latest_receipt_at?: string | null
          po_date?: string | null
          raw?: Json | null
          raw_receive_status?: string | null
          remark?: string | null
          status?: string | null
          status_label?: string | null
          supplier_id?: string | null
          supplier_name?: string | null
          total_amount?: number
          total_purchase_qty?: number
          total_received_qty?: number
          total_unreceived_qty?: number
          updated_at?: string
          warehouse_status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "purchase_orders_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "ops_suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      purchase_receipt_items: {
        Row: {
          cost_amount: number
          cost_price: number
          created_at: string
          external_io_id: string
          external_ioi_id: string | null
          external_po_id: string | null
          id: string
          product_id: string | null
          product_name: string | null
          purchase_order_id: string | null
          raw: Json | null
          receipt_id: string
          received_qty: number
          remark: string | null
          sku_id: string | null
          sku_no: string | null
          updated_at: string
        }
        Insert: {
          cost_amount?: number
          cost_price?: number
          created_at?: string
          external_io_id: string
          external_ioi_id?: string | null
          external_po_id?: string | null
          id?: string
          product_id?: string | null
          product_name?: string | null
          purchase_order_id?: string | null
          raw?: Json | null
          receipt_id: string
          received_qty?: number
          remark?: string | null
          sku_id?: string | null
          sku_no?: string | null
          updated_at?: string
        }
        Update: {
          cost_amount?: number
          cost_price?: number
          created_at?: string
          external_io_id?: string
          external_ioi_id?: string | null
          external_po_id?: string | null
          id?: string
          product_id?: string | null
          product_name?: string | null
          purchase_order_id?: string | null
          raw?: Json | null
          receipt_id?: string
          received_qty?: number
          remark?: string | null
          sku_id?: string | null
          sku_no?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "purchase_receipt_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "ops_products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_receipt_items_purchase_order_id_fkey"
            columns: ["purchase_order_id"]
            isOneToOne: false
            referencedRelation: "purchase_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_receipt_items_receipt_id_fkey"
            columns: ["receipt_id"]
            isOneToOne: false
            referencedRelation: "purchase_receipts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_receipt_items_sku_id_fkey"
            columns: ["sku_id"]
            isOneToOne: false
            referencedRelation: "ops_skus"
            referencedColumns: ["id"]
          },
        ]
      }
      purchase_receipts: {
        Row: {
          created_at: string
          external_io_id: string
          external_po_id: string | null
          id: string
          io_date: string | null
          jst_modified_at: string | null
          jst_supplier_id: string | null
          purchase_order_id: string | null
          raw: Json | null
          remark: string | null
          status: string | null
          supplier_name: string | null
          updated_at: string
          warehouse_name: string | null
        }
        Insert: {
          created_at?: string
          external_io_id: string
          external_po_id?: string | null
          id?: string
          io_date?: string | null
          jst_modified_at?: string | null
          jst_supplier_id?: string | null
          purchase_order_id?: string | null
          raw?: Json | null
          remark?: string | null
          status?: string | null
          supplier_name?: string | null
          updated_at?: string
          warehouse_name?: string | null
        }
        Update: {
          created_at?: string
          external_io_id?: string
          external_po_id?: string | null
          id?: string
          io_date?: string | null
          jst_modified_at?: string | null
          jst_supplier_id?: string | null
          purchase_order_id?: string | null
          raw?: Json | null
          remark?: string | null
          status?: string | null
          supplier_name?: string | null
          updated_at?: string
          warehouse_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "purchase_receipts_purchase_order_id_fkey"
            columns: ["purchase_order_id"]
            isOneToOne: false
            referencedRelation: "purchase_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      shop_bank_account_bindings: {
        Row: {
          bank_account_id: string
          binding_type: string
          created_at: string
          effective_from: string
          effective_to: string | null
          id: string
          is_default: boolean
          platform_id: string | null
          remark: string
          shop_id: string
          status: string
          updated_at: string
        }
        Insert: {
          bank_account_id: string
          binding_type?: string
          created_at?: string
          effective_from?: string
          effective_to?: string | null
          id?: string
          is_default?: boolean
          platform_id?: string | null
          remark?: string
          shop_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          bank_account_id?: string
          binding_type?: string
          created_at?: string
          effective_from?: string
          effective_to?: string | null
          id?: string
          is_default?: boolean
          platform_id?: string | null
          remark?: string
          shop_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "shop_bank_account_bindings_bank_account_id_fkey"
            columns: ["bank_account_id"]
            isOneToOne: false
            referencedRelation: "bank_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shop_bank_account_bindings_platform_id_fkey"
            columns: ["platform_id"]
            isOneToOne: false
            referencedRelation: "platforms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shop_bank_account_bindings_shop_id_fkey"
            columns: ["shop_id"]
            isOneToOne: false
            referencedRelation: "shops"
            referencedColumns: ["id"]
          },
        ]
      }
      shops: {
        Row: {
          auth_status: string | null
          code: string | null
          created_at: string
          default_bank_account_id: string | null
          deleted_at: string | null
          entity_id: string | null
          external_shop_id: string | null
          id: string
          is_ignored: boolean
          jst_shop_id: string | null
          last_synced_at: string | null
          name: string
          normalized_name: string | null
          platform_id: string | null
          platform_type: string | null
          raw_jst_json: Json | null
          remark: string | null
          shop_status_raw: string | null
          status: string
          updated_at: string
        }
        Insert: {
          auth_status?: string | null
          code?: string | null
          created_at?: string
          default_bank_account_id?: string | null
          deleted_at?: string | null
          entity_id?: string | null
          external_shop_id?: string | null
          id?: string
          is_ignored?: boolean
          jst_shop_id?: string | null
          last_synced_at?: string | null
          name: string
          normalized_name?: string | null
          platform_id?: string | null
          platform_type?: string | null
          raw_jst_json?: Json | null
          remark?: string | null
          shop_status_raw?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          auth_status?: string | null
          code?: string | null
          created_at?: string
          default_bank_account_id?: string | null
          deleted_at?: string | null
          entity_id?: string | null
          external_shop_id?: string | null
          id?: string
          is_ignored?: boolean
          jst_shop_id?: string | null
          last_synced_at?: string | null
          name?: string
          normalized_name?: string | null
          platform_id?: string | null
          platform_type?: string | null
          raw_jst_json?: Json | null
          remark?: string | null
          shop_status_raw?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "shops_entity_id_fkey"
            columns: ["entity_id"]
            isOneToOne: false
            referencedRelation: "business_entities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shops_platform_id_fkey"
            columns: ["platform_id"]
            isOneToOne: false
            referencedRelation: "platforms"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      v_purchase_order_items_with_image: {
        Row: {
          amount: number | null
          color: string | null
          created_at: string | null
          delivery_date: string | null
          external_po_id: string | null
          external_poi_id: string | null
          id: string | null
          item_remark: string | null
          product_image_url: string | null
          product_name: string | null
          properties_value: string | null
          purchase_order_id: string | null
          purchase_qty: number | null
          raw: Json | null
          received_qty: number | null
          resolved_image_url: string | null
          resolved_product_name: string | null
          resolved_style_no: string | null
          size: string | null
          sku_color: string | null
          sku_no: string | null
          sku_size: string | null
          spec: string | null
          style_no: string | null
          unit_price: number | null
          unreceived_qty: number | null
          updated_at: string | null
        }
        Relationships: [
          {
            foreignKeyName: "purchase_order_items_purchase_order_id_fkey"
            columns: ["purchase_order_id"]
            isOneToOne: false
            referencedRelation: "purchase_orders"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      can_read_finance: { Args: { _uid: string }; Returns: boolean }
      can_write_finance: { Args: { _uid: string }; Returns: boolean }
      classify_jst_sales_order: {
        Args: {
          _has_refund?: boolean
          _io_date: string
          _io_id: string
          _l_id: string
          _paid_amount: number
          _pay_time: string
          _status: string
        }
        Returns: {
          code: string
          name: string
        }[]
      }
      get_email_by_identifier: {
        Args: { _identifier: string }
        Returns: string
      }
      has_ops_role: {
        Args: {
          _code: Database["public"]["Enums"]["ops_role_code"]
          _uid: string
        }
        Returns: boolean
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_manager_of: {
        Args: { _employee_id: string; _manager_id: string }
        Returns: boolean
      }
      is_ops_internal: { Args: { _uid: string }; Returns: boolean }
      jst_cancel_all_running_syncs: {
        Args: never
        Returns: {
          cancelled_jobs: number
          cancelled_logs: number
        }[]
      }
      jst_release_job_lock: {
        Args: { _job_id: string; _owner: string }
        Returns: undefined
      }
      jst_resync_shop_mappings_from_shops: {
        Args: never
        Returns: {
          ignored_after: number
          mapped_after: number
          unmapped_after: number
          updated_count: number
        }[]
      }
      jst_try_lock_job: {
        Args: { _job_id: string; _owner: string; _ttl_seconds?: number }
        Returns: boolean
      }
      recalc_purchase_order_aggregates: {
        Args: { _po_id: string }
        Returns: undefined
      }
      reclassify_jst_sales_orders_by_keys: {
        Args: { _o_ids?: string[]; _so_ids?: string[] }
        Returns: number
      }
      refresh_jst_sales_order_classification: {
        Args: { _limit?: number }
        Returns: number
      }
      supplier_id_of: { Args: { _uid: string }; Returns: string }
    }
    Enums: {
      app_role: "employee" | "manager" | "finance"
      approval_level: "manager" | "finance"
      business_entity_type: "individual" | "company"
      cash_direction: "in" | "out" | "transfer"
      expense_status:
        | "draft"
        | "submitted"
        | "manager_approved"
        | "approved"
        | "rejected"
        | "reimbursed"
      ops_account_type: "internal" | "supplier" | "pending"
      ops_role_code: "admin" | "ops" | "finance" | "warehouse" | "supplier"
      user_type: "internal" | "supplier"
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
    Enums: {
      app_role: ["employee", "manager", "finance"],
      approval_level: ["manager", "finance"],
      business_entity_type: ["individual", "company"],
      cash_direction: ["in", "out", "transfer"],
      expense_status: [
        "draft",
        "submitted",
        "manager_approved",
        "approved",
        "rejected",
        "reimbursed",
      ],
      ops_account_type: ["internal", "supplier", "pending"],
      ops_role_code: ["admin", "ops", "finance", "warehouse", "supplier"],
      user_type: ["internal", "supplier"],
    },
  },
} as const
