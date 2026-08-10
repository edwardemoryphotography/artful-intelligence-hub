/**
 * The single Supabase client for the hub.
 *
 * This is the PUBLISHABLE key and the project is foundry-console
 * (pkydkbuodikttfeawqsw). A publishable key is designed to ship in a browser
 * bundle — it grants only what RLS and function grants allow, which here is:
 * execute on the two constellation functions, and whatever an authenticated
 * owner session is separately permitted.
 *
 * There is no service-role key in this bundle and there must never be one.
 * The hub is a static SPA with no server to hold a secret. Anything requiring
 * elevated privilege goes through an Edge Function (see supabase/functions).
 *
 * Values are read from Vite env when present so a fork or a preview
 * deployment can point at a different project without editing source; the
 * committed defaults keep the hub working with no .env at all.
 */
import { createClient } from '@supabase/supabase-js'

const FALLBACK_URL = 'https://pkydkbuodikttfeawqsw.supabase.co'
const FALLBACK_PUBLISHABLE_KEY = 'sb_publishable_obr-7Y0u02p5c5pD-5f3Sw_zda5lWTa'

export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL ?? FALLBACK_URL
export const SUPABASE_PUBLISHABLE_KEY =
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? FALLBACK_PUBLISHABLE_KEY

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    // The hub uses magic links; the redirect lands back with tokens in the URL.
    detectSessionInUrl: true,
    persistSession: true,
    autoRefreshToken: true,
  },
})
