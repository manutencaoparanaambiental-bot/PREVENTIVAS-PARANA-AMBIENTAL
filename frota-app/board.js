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
  let editingColunaId = null; // coluna (data/responsável) sendo editada no momento
  let colunaEditError = '';

  function formatarDataBR(iso){
    if(!iso) return null;
    const [ano, mes, dia] = iso.split('-');
    return `${dia}/${mes}/${ano}`;
  }

  async function carregarDados(){
    if(editingId || editingColunaId) return; // não interrompe quem está editando
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
    const rotuloPool = pagina === 'lubrificacao' ? 'Indisponível' : 'Não escalado';
    return [{ id: null, rotulo: rotuloPool }, ...colunas];
  }

  function listaDaColuna(key){
    const linha = [];
    caminhoes.forEach(cam => {
      const p = posicoesMap[cam.id];
      const k = p ? p.coluna_id : 'pool';
      if(k === key) linha.push({ cam, ordem: p ? p.ordem : 0 });
    });
    linha.sort((a,b) => a.ordem - b.ordem);
    return linha.map(x => x.cam);
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
          <input class="edit-input placa-input" data-field="placa" value="${caminhao.placa}" placeholder="Placa do caminhão" />
          <input class="edit-input reboque-input" data-field="reboque" value="${caminhao.reboque ?? ''}" placeholder="Placa do implemento (vazio = truck simples)" />
          ${editError ? `<div class="edit-error">${editError}</div>` : ''}
          <div class="edit-actions">
            <button class="btn-save" data-save="${caminhao.id}">Salvar</button>
            <button class="btn-cancel" data-cancel="${caminhao.id}">Cancelar</button>
          </div>
        </div>`;
    }

    const corpoHTML = caminhao.tipo === 'conjunto'
      ? `<div class="card-field"><span class="card-field-label">Caminhão</span><span class="plate placa">${caminhao.placa}</span></div>
         <div class="card-field"><span class="card-field-label">Implemento</span><span class="plate reboque">${caminhao.reboque ?? ''}</span></div>`
      : `<div class="card-field"><span class="card-field-label">Placa</span><span class="plate placa">${caminhao.placa}</span></div>`;

    return `
      <div class="card ${tipoClasse}" draggable="true" data-id="${caminhao.id}">
        <div class="card-top">
          <span class="tipo-badge">${tipoLabel}</span>
          <button class="edit-btn" data-edit="${caminhao.id}" title="Editar placa">✎</button>
        </div>
        ${corpoHTML}
      </div>`;
  }

  const WA_ICON = `<svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor"><path d="M12 2a10 10 0 0 0-8.94 14.5L2 22l5.66-1.48A10 10 0 1 0 12 2zm0 18.2a8.17 8.17 0 0 1-4.17-1.14l-.3-.18-3.1.81.83-3.02-.2-.31A8.2 8.2 0 1 1 12 20.2zm4.52-6.13c-.25-.12-1.47-.72-1.7-.8-.23-.08-.4-.12-.57.12-.17.25-.65.8-.8.96-.15.17-.29.19-.54.06-.25-.12-1.04-.38-1.98-1.22-.73-.65-1.22-1.45-1.37-1.7-.14-.25-.02-.38.11-.5.11-.11.25-.29.37-.44.12-.15.16-.25.25-.42.08-.17.04-.31-.02-.44-.06-.12-.57-1.37-.78-1.87-.2-.49-.41-.42-.57-.43h-.49c-.17 0-.44.06-.67.31-.23.25-.87.85-.87 2.08 0 1.23.9 2.42 1.02 2.59.12.17 1.77 2.7 4.29 3.79.6.26 1.07.42 1.44.53.6.19 1.15.16 1.58.1.48-.07 1.47-.6 1.68-1.18.21-.58.21-1.08.15-1.18-.06-.1-.23-.17-.48-.29z"/></svg>`;

  function colunaHeaderHTML(c, count, key){
    const isPool = c.id === null;

    if(isPool){
      // "Indisponível"/"Não escalado": sem data, sem responsável, sem WhatsApp
      // (não representa programação, então não faz sentido gerar mensagem daqui)
      return `
        <div class="col-head-top">
          <span>${c.rotulo}</span>
          <span class="count">${count}</span>
        </div>`;
    }

    if(editingColunaId === c.id){
      return `
        <div class="col-edit-form">
          <input type="date" class="col-edit-input" data-col-field="data" value="${c.data_lubrificacao ?? ''}" />
          <input type="text" class="col-edit-input" data-col-field="responsavel" placeholder="Responsável" value="${c.responsavel ?? ''}" />
          ${colunaEditError ? `<div class="edit-error">${colunaEditError}</div>` : ''}
          <div class="col-edit-actions">
            <button class="btn-save" data-col-save="${c.id}">Salvar</button>
            <button class="btn-cancel" data-col-cancel="${c.id}">Cancelar</button>
          </div>
        </div>`;
    }

    const dataLabel = formatarDataBR(c.data_lubrificacao) || 'Definir data';
    return `
      <div class="col-head-top">
        <span class="col-date">${dataLabel}</span>
        <div class="col-head-actions">
          <button class="wa-btn" data-wa-coluna="${key}" title="Copiar mensagem para o WhatsApp">${WA_ICON}</button>
          <button class="col-edit-btn" data-col-edit="${c.id}" title="Editar data e responsável">✎</button>
          <span class="count">${count}</span>
        </div>
      </div>
      <div class="col-resp">Responsável: ${c.responsavel || '—'}</div>`;
  }

  function render(){
    const seq = ordemColunas();

    boardEl.innerHTML = seq.map(c => {
      const key = c.id ?? 'pool';
      const lista = listaDaColuna(key);
      const isPool = c.id === null;
      return `
        <div class="column ${isPool ? 'pool' : ''}" data-coluna-id="${key}">
          <div class="column-header">
            ${colunaHeaderHTML(c, lista.length, key)}
          </div>
          <div class="column-body" data-coluna-id="${key}">
            ${lista.map(cam => cardHTML(cam)).join('')}
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

  async function salvarEdicaoColuna(colunaId, form){
    const data = form.querySelector('[data-col-field="data"]').value; // 'YYYY-MM-DD' ou ''
    const responsavel = form.querySelector('[data-col-field="responsavel"]').value.trim();

    const { error } = await supabase.from('colunas')
      .update({ data_lubrificacao: data || null, responsavel: responsavel || null })
      .eq('id', colunaId);

    if(error){
      colunaEditError = 'Não foi possível salvar.';
      render();
      return;
    }

    editingColunaId = null;
    colunaEditError = '';
    await carregarDados();
  }

  function mostrarToast(msg, isError){
    const el = document.createElement('div');
    el.className = 'toast' + (isError ? ' toast-error' : '');
    el.textContent = msg;
    document.body.appendChild(el);
    requestAnimationFrame(() => el.classList.add('show'));
    setTimeout(() => {
      el.classList.remove('show');
      setTimeout(() => el.remove(), 300);
    }, 3000);
  }

  function montarMensagemColuna(coluna, lista){
    const tituloEmoji = pagina === 'lubrificacao' ? '🛠️ LUBRIFICAÇÃO' : '🛞 CALIBRAGEM';
    const dataLabel = formatarDataBR(coluna.data_lubrificacao) || 'Data não definida';
    const responsavel = coluna.responsavel || 'Não definido';

    const linhas = [
      tituloEmoji,
      '',
      `📅 Data: ${dataLabel}`,
      `👤 Responsável: ${responsavel}`,
      '',
      'Veículos programados:',
      '',
    ];

    lista.forEach(cam => {
      linhas.push(`🚛 Caminhão: ${cam.placa}`);
      if(cam.tipo === 'conjunto' && cam.reboque){
        linhas.push(`🔧 Implemento: ${cam.reboque}`);
      }
      linhas.push('');
    });

    linhas.push(`Total: ${lista.length} veículo${lista.length === 1 ? '' : 's'}`);
    return linhas.join('\n').trim();
  }

  async function copiarMensagemColuna(colunaId){
    const coluna = colunas.find(c => c.id === colunaId);
    if(!coluna) return;
    const lista = listaDaColuna(colunaId);
    const mensagem = montarMensagemColuna(coluna, lista);

    try{
      await navigator.clipboard.writeText(mensagem);
      mostrarToast('✓ Mensagem copiada! Agora é só colar no WhatsApp.');
    }catch(err){
      console.error(err);
      mostrarToast('Não foi possível copiar. Tente novamente.', true);
    }
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

    // Botão do WhatsApp: copia a mensagem da coluna para a área de transferência
    boardEl.querySelectorAll('[data-wa-coluna]').forEach(btn => {
      btn.addEventListener('click', () => {
        copiarMensagemColuna(btn.dataset.waColuna);
      });
    });

    // Edição de data/responsável da coluna (lubrificação)
    boardEl.querySelectorAll('[data-col-edit]').forEach(btn => {
      btn.addEventListener('click', () => {
        editingColunaId = btn.dataset.colEdit;
        colunaEditError = '';
        render();
      });
    });
    boardEl.querySelectorAll('[data-col-save]').forEach(btn => {
      btn.addEventListener('click', () => {
        const form = btn.closest('.col-edit-form');
        salvarEdicaoColuna(btn.dataset.colSave, form);
      });
    });
    boardEl.querySelectorAll('[data-col-cancel]').forEach(btn => {
      btn.addEventListener('click', () => {
        editingColunaId = null;
        colunaEditError = '';
        render();
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
