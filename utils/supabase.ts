import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL || 'https://padezipdfcicydyncmkw.supabase.co';
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBhZGV6aXBkZmNpY3lkeW5jbWt3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE0MDM3MzIsImV4cCI6MjA4Njk3OTczMn0.B8PpSm4sa9JYeDMqSL1u93-MyQUTwfDX4j3w6mOFCvw';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

export default supabase;
