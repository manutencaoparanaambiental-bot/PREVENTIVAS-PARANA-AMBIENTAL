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
  let editingId = null;  // placa sendo editada no momento (evita perder o card durante um refresh)
  let editError = '';

  async function carregarDados(){
    if(editingId) return; // não interrompe quem está editando um card
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

  function ordemColunas(){
    return [{ id: null, rotulo: 'Não escalado' }, ...colunas];
  }

  function cardHTML(caminhao){
    const tipoClasse = caminhao.tipo === 'conjunto' ? 'conjunto' : 'truck';
    const tipoLabel = caminhao.tipo === 'conjunto' ? 'Conjunto' : 'Truck';

    if(editingId === caminhao.id){
      return `
        <div class="card ${tipoClasse} editing" data-id="${caminhao.id}">
          <div class="card-top">
            <span class="tipo-badge">${tipoLabel}</span>
          </div>
          <input class="edit-input placa-input" data-field="placa" value="${caminhao.placa}" placeholder="Placa" />
          <input class="edit-input reboque-input" data-field="reboque" value="${caminhao.reboque ?? ''}" placeholder="Reboque (vazio = truck simples)" />
          ${editError ? `<div class="edit-error">${editError}</div>` : ''}
          <div class="edit-actions">
            <button class="btn-save" data-save="${caminhao.id}">Salvar</button>
            <button class="btn-cancel" data-cancel="${caminhao.id}">Cancelar</button>
          </div>
        </div>`;
    }

    const reboqueHTML = caminhao.reboque
      ? `<div class="plate reboque">${caminhao.reboque}</div>`
      : '';
    return `
      <div class="card ${tipoClasse}" draggable="true" data-id="${caminhao.id}">
        <div class="card-top">
          <span class="tipo-badge">${tipoLabel}</span>
          <button class="edit-btn" data-edit="${caminhao.id}" title="Editar placa">✎</button>
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

  async function salvarEdicaoPlaca(caminhaoId, card){
    const placaRaw = card.querySelector('[data-field="placa"]').value.trim().toUpperCase();
    const reboqueRaw = card.querySelector('[data-field="reboque"]').value.trim().toUpperCase();

    if(!placaRaw){
      editError = 'Informe a placa.';
      render();
      return;
    }

    const tipo = reboqueRaw ? 'conjunto' : 'truck';
    const { error } = await supabase.from('caminhoes')
      .update({ placa: placaRaw, reboque: reboqueRaw || null, tipo })
      .eq('id', caminhaoId);

    if(error){
      editError = error.code === '23505' ? 'Já existe um caminhão com essa placa.' : 'Não foi possível salvar.';
      render();
      return;
    }

    editingId = null;
    editError = '';
    await carregarDados();
  }

  function wireInteracoes(){
    // Arrastar card para outra coluna
    boardEl.querySelectorAll('.card[draggable="true"]').forEach(card => {
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

    // Abrir edição da placa
    boardEl.querySelectorAll('[data-edit]').forEach(btn => {
      btn.addEventListener('click', () => {
        editingId = btn.dataset.edit;
        editError = '';
        render();
      });
    });

    // Salvar / cancelar edição
    boardEl.querySelectorAll('[data-save]').forEach(btn => {
      btn.addEventListener('click', () => {
        const card = btn.closest('.card');
        salvarEdicaoPlaca(btn.dataset.save, card);
      });
    });
    boardEl.querySelectorAll('[data-cancel]').forEach(btn => {
      btn.addEventListener('click', () => {
        editingId = null;
        editError = '';
        render();
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

  // Tempo real: se outro usuário mover ou editar uma placa, a tela atualiza sozinha
  supabase
    .channel(`posicoes-${pagina}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'posicoes', filter: `pagina=eq.${pagina}` }, carregarDados)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'colunas', filter: `pagina=eq.${pagina}` }, carregarDados)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'caminhoes' }, carregarDados)
    .subscribe();
}
