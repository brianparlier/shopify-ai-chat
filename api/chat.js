{%- comment -%}
AI Chat launcher + modal dialog (self-contained)
- Launcher uses your CDN image (transparent)
- Sends prompts to your Vercel endpoint
- Formats product lists in replies
- Include with: {% render 'ai-chat' %}
{%- endcomment -%}

{%- assign dotty_url = 'https://cdn.shopify.com/s/files/1/0554/0236/4972/files/chat-bubble-dotty.png?v=1755357752' -%}

<button id="tps-chat-launcher" class="tps-chat-launcher" aria-label="Open chat">
  <img src="{{ dotty_url }}" alt="Chat" width="64" height="64" />
  <span class="visually-hidden">Chat</span>
</button>

<dialog id="tps-chat-dialog" class="tps-chat-dialog" aria-label="Chat dialog">
  <div class="tps-chat-card">
    <header class="tps-chat-header">
      <h3 class="tps-chat-title">Chat</h3>
      <button class="tps-chat-close" type="button" data-tps-chat-close aria-label="Close">×</button>
    </header>

    <div id="tps-chat-messages" class="tps-chat-messages" role="log" aria-live="polite" aria-relevant="additions"></div>

    <form id="tps-chat-form" class="tps-chat-form" autocomplete="off">
      <input id="tps-chat-input" class="tps-chat-input" type="text" placeholder="Ask a question…" required />
      <button class="tps-chat-send" type="submit">Send</button>
    </form>
  </div>
</dialog>

<style>
  .visually-hidden{position:absolute!important;width:1px;height:1px;margin:-1px;padding:0;border:0;clip:rect(0 0 0 0);overflow:hidden;white-space:nowrap;}

  /* Launcher (image only, no black background) */
  #tps-chat-launcher{
    position:fixed;right:18px;bottom:18px;width:64px;height:64px;border:0;border-radius:50%;
    cursor:pointer;z-index:9999;background:transparent;padding:0;display:inline-flex;align-items:center;justify-content:center;
    box-shadow:0 10px 24px rgba(0,0,0,.18);transition:transform .12s ease, box-shadow .12s ease;
  }
  #tps-chat-launcher img{display:block;width:64px;height:64px}
  #tps-chat-launcher:hover{transform:translateY(-1px)}
  #tps-chat-launcher:active{transform:translateY(0);box-shadow:0 6px 16px rgba(0,0,0,.18)}

  /* Dialog */
  .tps-chat-dialog::backdrop{background:rgba(0,0,0,.35)}
  .tps-chat-card{width:min(680px, calc(100vw - 32px));max-height:min(80vh, 680px);
    background:#fff;border-radius:12px;overflow:hidden;display:flex;flex-direction:column;
    box-shadow:0 24px 56px rgba(0,0,0,.35)}
  .tps-chat-header{display:flex;align-items:center;justify-content:space-between;
    padding:14px 16px;border-bottom:1px solid rgba(0,0,0,.08)}
  .tps-chat-title{margin:0;font-size:1.6rem}
  .tps-chat-close{background:transparent;border:0;font-size:1.8rem;cursor:pointer;line-height:1}

  .tps-chat-messages{padding:14px 16px;overflow:auto;gap:10px;display:flex;flex-direction:column;min-height:180px}
  .tps-msg{max-width:85%;padding:10px 12px;border-radius:12px;line-height:1.5;font-size:1.4rem}
  .tps-msg.user{align-self:flex-end;background:#1f2937;color:#fff;border-bottom-right-radius:4px}
  .tps-msg.bot{align-self:flex-start;background:#f3f4f6;border-bottom-left-radius:4px}

  .tps-chat-form{display:flex;gap:8px;padding:12px 12px;border-top:1px solid rgba(0,0,0,.08)}
  .tps-chat-input{flex:1;border:1px solid rgba(0,0,0,.18);border-radius:10px;padding:10px 12px;font-size:1.4rem}
  .tps-chat-send{border:0;border-radius:10px;padding:10px 14px;background:#111;color:#fff;cursor:pointer}

  /* Text & product list formatting */
  .tps-text { white-space:pre-wrap; word-break:break-word; }
  .tps-list { list-style:disc; padding-left:1.6rem; margin:.5rem 0 0; }
  .tps-list li { margin:.25rem 0; }
  .tps-list a { text-decoration:underline; }
</style>

<script>
(function(){
  const API_BASE = 'https://shopify-ai-chat-liard.vercel.app/api/chat';

  const btn   = document.getElementById('tps-chat-launcher');
  const dlg   = document.getElementById('tps-chat-dialog');
  const close = dlg.querySelector('[data-tps-chat-close]');
  const form  = document.getElementById('tps-chat-form');
  const input = document.getElementById('tps-chat-input');
  const log   = document.getElementById('tps-chat-messages');
  if(!btn || !dlg || !form || !input || !log) return;

  const openChat  = () => { if(typeof dlg.showModal==='function'){ dlg.showModal(); input.focus(); } };
  const closeChat = () => { if(dlg.open) dlg.close(); };

  btn.addEventListener('click', openChat);
  close.addEventListener('click', closeChat);

  // ------- Formatting helpers (product lists & links) -------
  const esc = (s) => String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
  const autoLink = (s) => s.replace(/https?:\/\/[^\s)]+/g, (m) => `<a href="${m}" target="_blank" rel="noopener">${m}</a>`);

  function formatProductList(text) {
    const lines = text.split(/\r?\n/);
    const firstListIdx = lines.findIndex(l => l.trim().startsWith('- '));
    const items = lines
      .map(l => l.trim())
      .filter(l => l.startsWith('- '))
      .map(l => l.replace(/^- /,'').trim());

    if (!items.length) {
      return `<div class="tps-text">${autoLink(esc(text))}</div>`;
    }

    const intro = firstListIdx > 0 ? lines.slice(0, firstListIdx).join('\n').trim() : '';
    const li = items.map(row => {
      const parts = row.split('—').map(s => s.trim());
      if (parts.length >= 3) {
        const title = esc(parts[0]);
        const sku   = esc(parts[1]);
        const url   = parts.slice(2).join('—').trim();
        return `<li><strong>${title}</strong> — ${sku} — ${autoLink(esc(url))}</li>`;
      }
      return `<li>${autoLink(esc(row))}</li>`;
    }).join('');

    const introHtml = intro ? `<div class="tps-text">${autoLink(esc(intro))}</div>` : '';
    return `${introHtml}<ul class="tps-list">${li}</ul>`;
  }

  // ------- Rendering -------
  const addUser = (txt)=>{
    const div = document.createElement('div');
    div.className = 'tps-msg user';
    div.textContent = txt;
    log.appendChild(div);
    log.scrollTop = log.scrollHeight;
  };

  const addBot = (html)=>{
    const div = document.createElement('div');
    div.className = 'tps-msg bot';
    div.innerHTML = html;
    log.appendChild(div);
    log.scrollTop = log.scrollHeight;
  };

  // ------- Submit -------
  form.addEventListener('submit', async (e)=>{
    e.preventDefault();
    const prompt = input.value.trim();
    if(!prompt) return;

    addUser(prompt);
    input.value = '';
    const typing = document.createElement('div');
    typing.className = 'tps-msg bot';
    typing.textContent = '…';
    log.appendChild(typing);
    log.scrollTop = log.scrollHeight;

    try{
      const r = await fetch(API_BASE, {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ prompt })
      });
      const data = await r.json().catch(()=>({}));
      typing.remove();

      if(r.ok && data && data.text){
        addBot(formatProductList(data.text));
      }else{
        addBot('Sorry—something went wrong.');
        console.warn('Chat error', data);
      }
    }catch(err){
      typing.remove();
      addBot('Sorry—something went wrong.');
      console.error(err);
    }
  });
})();
</script>
