import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

let client = null;
try {
  if (supabaseUrl && supabaseAnonKey) {
    client = createClient(supabaseUrl, supabaseAnonKey);
  }
} catch (error) {
  console.warn("Supabase initialization failed. Check your NEXT_PUBLIC_SUPABASE_URL format. It must include https://");
}

export const supabase = client;
export const isSupabaseActive = !!supabase;
