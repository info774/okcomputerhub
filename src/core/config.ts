// Proyecto Supabase del hub: `okcomputer-hub` (ref adomalsxsymxzuozksmt),
// compartido con Breeze. La anon key no es secreta (se sirve a cualquiera);
// lo que protege los datos es la RLS del esquema `hub`.
export const SUPABASE_URL = 'https://adomalsxsymxzuozksmt.supabase.co';
export const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFkb21hbHN4c3lteHp1b3prc210Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc5NDk0MTgsImV4cCI6MjEwMzUyNTQxOH0.6rmj9dYyvGTNhFhuHVmREbDJcaUsh1Z0V78AJ7_pYwk';

// Todo lo del hub vive en este esquema (nunca `public`, que es de Breeze).
export const ESQUEMA = 'hub';

// La app actual, para todo lo que el hub aún no tiene.
export const APP_ACTUAL_URL = 'https://okcomputertenerife.web.app';

export const FUNCIONES_URL = `${SUPABASE_URL}/functions/v1`;

// Panel de Breeze (RMM): lo que el usuario de servicio del hub no puede hacer
// (resolver alertas, escritorio y terminal remotos) se abre allí.
export const BREEZE_URL = 'https://breeze.oksistemas.online';

// Google Places (buscar un negocio en Google Maps al dar de alta una sede): la
// MISMA clave de navegador que la app (proyecto 508620194342), no es secreta;
// la protege la lista de webs permitidas de la clave en Google Cloud, que tiene
// que incluir okhub-tenerife.web.app (docs/PENDIENTE_FRAN.md §2 bis).
export const PLACES_API_KEY = 'AIzaSyCVo9d6iECPX2L5zzgQ7Azo2TXyaOLQ09U';
