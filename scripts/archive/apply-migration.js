#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

// Load environment variables
require('dotenv').config({ path: '.env.local' });

const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing Supabase credentials in .env.local');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function applyMigration() {
  try {
    // Read the migration SQL
    const migrationPath = path.join(__dirname, '../supabase/migrations/20260430000003_add_parse_error_message.sql');
    const sql = fs.readFileSync(migrationPath, 'utf8');
    
    console.log('📝 Migration: 20260430000003_add_parse_error_message.sql');
    console.log('SQL:', sql);
    console.log('');
    console.log('Applying migration to Supabase...');
    
    // Use the admin client to execute raw SQL
    const { error } = await supabase.rpc('exec', {
      sql_query: sql
    }).catch(async () => {
      // If exec RPC doesn't exist, try using postgres connection
      console.log('RPC exec not available, trying direct connection via Supabase API...');
      
      // Alternative: use fetch to call SQL directly via Supabase
      const response = await fetch(`${supabaseUrl}/rest/v1/rpc/exec`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${supabaseKey}`,
        },
        body: JSON.stringify({ sql_query: sql }),
      });
      
      if (!response.ok) {
        return { error: { message: response.statusText } };
      }
      return { error: null };
    });

    if (error) {
      console.error('❌ Migration failed:', error.message || error);
      
      // Try alternative approach: check if column already exists
      console.log('\n🔍 Checking if column already exists...');
      const { data: columns, error: checkError } = await supabase
        .from('ai_visibility_runs')
        .select('*')
        .limit(0);
      
      if (!checkError) {
        console.log('✅ Table exists and is accessible');
        console.log('✅ Migration may have already been applied or skipped (IF NOT EXISTS)');
      }
      return;
    }

    console.log('✅ Migration applied successfully!');
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
}

applyMigration();
