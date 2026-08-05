/**
 * Chat panel UI management.
 */

const messagesEl = document.getElementById('chat-messages');
const inputEl = document.getElementById('chat-input');
const sendBtn = document.getElementById('btn-send');

export class ChatPanel {
    constructor(onSend) {
        this.onSend = onSend;
        this._init();
    }

    _init() {
        sendBtn.addEventListener('click', () => this._handleSend());
        inputEl.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this._handleSend();
            }
        });
    }

    _handleSend() {
        const text = inputEl.value.trim();
        if (!text || this._sending) return;

        this.addUserMessage(text);
        inputEl.value = '';
        this._sending = true;
        sendBtn.disabled = true;

        if (this.onSend) this.onSend(text);
    }

    addUserMessage(text) {
        const div = document.createElement('div');
        div.className = 'message user';
        div.innerHTML = `<div class="msg-content">${this._escapeHtml(text)}</div>`;
        messagesEl.appendChild(div);
        this._scrollBottom();
    }

    addSystemMessage(text) {
        const div = document.createElement('div');
        div.className = 'message system';
        div.innerHTML = `<div class="msg-content">${text}</div>`;
        messagesEl.appendChild(div);
        this._scrollBottom();
    }

    addAffectedOrgans(organs) {
        const div = document.createElement('div');
        div.className = 'affected-organs-bar';
        div.innerHTML = '<span style="font-size:0.8rem;color:#94a3b8;">受影响器官：</span>' +
            organs.map(o =>
                `<span class="affected-tag ${o.status}">${o.name} ${'●'.repeat(o.depth + 1)}</span>`
            ).join('');
        messagesEl.appendChild(div);
        this._scrollBottom();
    }

    showTyping() {
        this._typingEl = document.createElement('div');
        this._typingEl.className = 'message system';
        this._typingEl.innerHTML = '<div class="msg-content typing-indicator"><span class="typing-dot"></span><span class="typing-dot"></span><span class="typing-dot"></span></div>';
        messagesEl.appendChild(this._typingEl);
        this._scrollBottom();
    }

    hideTyping() {
        if (this._typingEl) {
            this._typingEl.remove();
            this._typingEl = null;
        }
    }

    setSending(v) {
        this._sending = v;
        sendBtn.disabled = v;
    }

    _escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML.replace(/\n/g, '<br>');
    }

    _scrollBottom() {
        messagesEl.scrollTop = messagesEl.scrollHeight;
    }
}
