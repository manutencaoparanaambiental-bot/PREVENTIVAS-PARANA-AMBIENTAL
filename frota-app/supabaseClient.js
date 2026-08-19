import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Garante que a página só é usada por quem está logado.
// Retorna a sessão, ou redireciona para o login.
export async function requireSession(){
  const { data: { session } } = await supabase.auth.getSession();
  if(!session){
    window.location.href = './index.html';
    return null;
  }
  return session;
}

export function wireLogout(btn){
  if(!btn) return;
  btn.addEventListener('click', async () => {
    await supabase.auth.signOut();
    window.location.href = './index.html';
  });
}
