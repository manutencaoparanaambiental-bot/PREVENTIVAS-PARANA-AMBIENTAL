import { supabase, requireSession, wireLogout } from './supabaseClient.js';

/**
 * Inicializa um quadro (lubrificação ou calibragem).
 * @param {string} pagina - 'lubrificacao' | 'calibragem'
 */
export async function initBoard(pagina){
  const session = await requireSession();
  if(!session) return;

  wireLogout(document.getElementById('btn-logout'));
  const userEl = document.getElementById('user-email');
  if(userEl) userEl.textContent = session.user.email;

  const boardEl = document.getElementById('board');
  let colunas = [];
  let caminhoes = [];
  let posicoesMap = {}; // caminhao_id -> { coluna_id, ordem }

  async function carregarDados(){
    const [{ data: cols, error: e1 }, { data: cams, error: e2 }, { data: pos, error: e3 }] = await Promise.all([
      supabase.from('colunas').select('*').eq('pagina', pagina).order('posicao'),
      supabase.from('caminhoes').select('*').order('placa'),
      supabase.from('posicoes').select('*').eq('pagina', pagina),
    ]);
    if(e1 || e2 || e3){
      console.error(e1 || e2 || e3);
      boardEl.innerHTML = `<p style="padding:20px;color:#FF5C5C">Erro ao carregar dados. Confira a configuração do Supabase em config.js.</p>`;
      return;
    }
    colunas = cols || [];
    caminhoes = cams || [];
    posicoesMap = {};
    (pos || []).forEach(p => { posicoesMap[p.caminhao_id] = p; });
    render();
  }

  // Ordem lógica para os botões ‹ › : pool (null) + colunas em sequência
  function ordemColunas(){
    return [{ id: null, rotulo: 'Não escalado' }, ...colunas];
  }

  function cardHTML(caminhao){
    const tipoClasse = caminhao.tipo === 'conjunto' ? 'conjunto' : 'truck';
    const tipoLabel = caminhao.tipo === 'conjunto' ? 'Conjunto' : 'Truck';
    const reboqueHTML = caminhao.reboque
      ? `<div class="plate reboque">${caminhao.reboque}</div>`
      : '';
    const seq = ordemColunas();
    const atualId = posicoesMap[caminhao.id]?.coluna_id ?? null;
    const options = seq.map(c =>
      `<option value="${c.id ?? ''}" ${c.id === atualId ? 'selected' : ''}>${c.rotulo}</option>`
    ).join('');
    return `
      <div class="card ${tipoClasse}" draggable="true" data-id="${caminhao.id}">
        <div class="card-top">
          <span class="tipo-badge">${tipoLabel}</span>
          <div class="move-menu">
            <button class="mv-btn" data-move="-1" title="Mover para a coluna anterior">‹</button>
            <select class="mv-select" data-move-select>${options}</select>
            <button class="mv-btn" data-move="1" title="Mover para a próxima coluna">›</button>
          </div>
        </div>
        <div class="plate placa">${caminhao.placa}</div>
        ${reboqueHTML}
      </div>`;
  }

  function render(){
    const seq = ordemColunas();
    const porColuna = {};
    seq.forEach(c => { porColuna[c.id ?? 'pool'] = []; });

    caminhoes.forEach(cam => {
      const p = posicoesMap[cam.id];
      const key = p ? p.coluna_id : 'pool';
      if(!porColuna[key]) porColuna[key] = [];
      porColuna[key].push({ cam, ordem: p ? p.ordem : 0 });
    });
    Object.values(porColuna).forEach(list => list.sort((a,b) => a.ordem - b.ordem));

    boardEl.innerHTML = seq.map(c => {
      const key = c.id ?? 'pool';
      const lista = porColuna[key] || [];
      const isPool = c.id === null;
      const rotuloHTML = isPool
        ? `<span>${c.rotulo}</span>`
        : `<input class="rotulo-edit" data-coluna-id="${c.id}" value="${c.rotulo}" />`;
      return `
        <div class="column ${isPool ? 'pool' : ''}" data-coluna-id="${key}">
          <div class="column-header">
            ${rotuloHTML}
            <span class="count">${lista.length}</span>
          </div>
          <div class="column-body" data-coluna-id="${key}">
            ${lista.map(x => cardHTML(x.cam)).join('')}
          </div>
        </div>`;
    }).join('');

    wireInteracoes();
  }

  async function moverCaminhao(caminhaoId, novaColunaId){
    if(novaColunaId === null || novaColunaId === '' || novaColunaId === undefined){
      await supabase.from('posicoes').delete()
        .eq('caminhao_id', caminhaoId).eq('pagina', pagina);
    } else {
      await supabase.from('posicoes')
        .upsert({
          caminhao_id: caminhaoId,
          pagina,
          coluna_id: novaColunaId,
          ordem: Date.now(),
          updated_at: new Date().toISOString(),
        }, { onConflict: 'caminhao_id,pagina' });
    }
    await carregarDados();
  }

  function wireInteracoes(){
    // Drag and drop (desktop)
    boardEl.querySelectorAll('.card').forEach(card => {
      card.addEventListener('dragstart', e => {
        card.classList.add('dragging');
        e.dataTransfer.setData('text/plain', card.dataset.id);
      });
      card.addEventListener('dragend', () => card.classList.remove('dragging'));
    });

    boardEl.querySelectorAll('.column-body').forEach(colBody => {
      colBody.addEventListener('dragover', e => {
        e.preventDefault();
        colBody.closest('.column').classList.add('drag-over');
      });
      colBody.addEventListener('dragleave', () => {
        colBody.closest('.column').classList.remove('drag-over');
      });
      colBody.addEventListener('drop', e => {
        e.preventDefault();
        colBody.closest('.column').classList.remove('drag-over');
        const id = e.dataTransfer.getData('text/plain');
        const destino = colBody.dataset.colunaId;
        moverCaminhao(id, destino === 'pool' ? null : destino);
      });
    });

    // Botões ‹ › e select (funciona em qualquer dispositivo, inclusive celular)
    boardEl.querySelectorAll('.mv-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const card = btn.closest('.card');
        const id = card.dataset.id;
        const seq = ordemColunas();
        const atualId = posicoesMap[id]?.coluna_id ?? null;
        const idxAtual = seq.findIndex(c => c.id === atualId);
        const dir = parseInt(btn.dataset.move, 10);
        const novoIdx = Math.min(Math.max(idxAtual + dir, 0), seq.length - 1);
        moverCaminhao(id, seq[novoIdx].id);
      });
    });
    boardEl.querySelectorAll('[data-move-select]').forEach(sel => {
      sel.addEventListener('change', () => {
        const card = sel.closest('.card');
        const id = card.dataset.id;
        moverCaminhao(id, sel.value === '' ? null : sel.value);
      });
    });

    // Edição do rótulo da coluna (ex: trocar "Sábado 1" pela data real)
    boardEl.querySelectorAll('.rotulo-edit').forEach(input => {
      input.addEventListener('change', async () => {
        await supabase.from('colunas')
          .update({ rotulo: input.value })
          .eq('id', input.dataset.colunaId);
      });
    });
  }

  await carregarDados();

  // Tempo real: se outro usuário mover uma placa, a tela atualiza sozinha
  supabase
    .channel(`posicoes-${pagina}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'posicoes', filter: `pagina=eq.${pagina}` }, carregarDados)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'colunas', filter: `pagina=eq.${pagina}` }, carregarDados)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'caminhoes' }, carregarDados)
    .subscribe();
}
