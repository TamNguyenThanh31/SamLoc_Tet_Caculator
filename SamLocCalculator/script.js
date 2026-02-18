// --- Global State ---
const MIN_PLAYERS = 2;
const MAX_PLAYERS = 5;

function loadFromStorage(key, fallback) {
    try {
        const raw = localStorage.getItem(key);
        return raw ? JSON.parse(raw) : fallback;
    } catch (_) {
        return fallback;
    }
}

let players = loadFromStorage('samloc_players', []);
let history = loadFromStorage('samloc_history', []);
let betPerCard = Math.max(1, parseInt(localStorage.getItem('samloc_bet_per_card'), 10) || 1);
const CONG_PENALTY = 15; // 15 lá
const BAO_SAM_AMOUNT = 20; // 20 lá
const CHAT_HEO_LA = 20; // 20 lá

// --- Popup (thay alert / confirm / prompt) ---
function showAlert(message, icon = '⚠️') {
  const overlay = document.getElementById('popup-alert-overlay');
  document.getElementById('popup-alert-icon').textContent = icon;
  document.getElementById('popup-alert-message').textContent = message;
  overlay.classList.add('show');
  return new Promise(resolve => {
    const close = () => { overlay.classList.remove('show'); resolve(); };
    document.getElementById('popup-alert-ok').onclick = close;
    overlay.onclick = (e) => { if (e.target === overlay) close(); };
  });
}

function showConfirm(message, icon = '❓') {
  const overlay = document.getElementById('popup-confirm-overlay');
  document.getElementById('popup-confirm-icon').textContent = icon;
  document.getElementById('popup-confirm-message').textContent = message;
  overlay.classList.add('show');
  return new Promise(resolve => {
    const ok = () => { overlay.classList.remove('show'); resolve(true); };
    const cancel = () => { overlay.classList.remove('show'); resolve(false); };
    document.getElementById('popup-confirm-ok').onclick = ok;
    document.getElementById('popup-confirm-cancel').onclick = cancel;
    overlay.onclick = (e) => { if (e.target === overlay) cancel(); };
  });
}

function showPrompt(title, message, placeholder = 'Nhập...') {
  const overlay = document.getElementById('popup-prompt-overlay');
  const input = document.getElementById('popup-prompt-input');
  document.getElementById('popup-prompt-title').textContent = title;
  document.getElementById('popup-prompt-message').textContent = message || '';
  input.placeholder = placeholder;
  input.value = '';
  overlay.classList.add('show');
  input.focus();
  return new Promise(resolve => {
    const done = (value) => {
      overlay.classList.remove('show');
      resolve(value);
    };
    document.getElementById('popup-prompt-ok').onclick = () => done(input.value.trim());
    document.getElementById('popup-prompt-cancel').onclick = () => done(null);
    input.onkeydown = (e) => {
      if (e.key === 'Enter') done(input.value.trim());
      if (e.key === 'Escape') done(null);
    };
    overlay.onclick = (e) => { if (e.target === overlay) done(null); };
  });
}

// --- DOM Elements ---
const playerListEl = document.getElementById('player-list');
const totalBalanceEl = document.getElementById('total-balance');
const historyListEl = document.getElementById('history-list');

// Init
document.addEventListener('DOMContentLoaded', () => {
    const betInput = document.getElementById('bet-per-card');
    if (betInput) {
        betInput.value = betPerCard;
        betInput.addEventListener('change', () => {
            const v = Math.max(1, parseInt(betInput.value, 10) || 1);
            betPerCard = v;
            betInput.value = v;
            saveData();
            updateChatHeoLabels();
        });
    }
    updateChatHeoLabels();
    renderPlayers();
    renderHistory();
    setupEventListeners();
});

function updateChatHeoLabels() {
    const amt = CHAT_HEO_LA * betPerCard;
    const label1 = document.getElementById('chat-heo-label');
    const label2 = document.getElementById('chat-heo-lose-label');
    if (label1) label1.textContent = `Người Chặt (Ăn ${amt}k = 20 lá):`;
    if (label2) label2.textContent = `Bị Chặt (Mất ${amt}k = 20 lá):`;
}

// --- Core Logic ---

function syncBetFromInput() {
    const el = document.getElementById('bet-per-card');
    if (el) {
        const v = Math.max(1, parseInt(el.value, 10) || 1);
        betPerCard = v;
        el.value = v;
    }
}

function addPlayer(name) {
    if (!name.trim()) return;
    if (players.length >= MAX_PLAYERS) {
        showAlert(`Tối đa ${MAX_PLAYERS} người chơi.`, '👥');
        return;
    }
    const newPlayer = {
        id: Date.now().toString(),
        name: name.trim(),
        balance: 0
    };
    players.push(newPlayer);
    saveData();
    renderPlayers();
}

function removePlayer(id) {
    if (players.length <= MIN_PLAYERS) {
        showAlert(`Cần ít nhất ${MIN_PLAYERS} người chơi.`, '👥');
        return;
    }
    showConfirm('Xóa người chơi này? (Lịch sử sẽ bị ảnh hưởng nếu reset)', '🗑️').then(ok => {
        if (ok) {
            players = players.filter(p => p.id !== id);
            saveData();
            renderPlayers();
        }
    });
}

function updateBalance(playerId, amount) {
    const player = players.find(p => p.id === playerId);
    if (player) {
        player.balance += amount;
    }
}

function processRoundNormal(winnerId, loserData) {
    syncBetFromInput();
    if (players.length < MIN_PLAYERS) {
        showAlert(`Cần ít nhất ${MIN_PLAYERS} người chơi.`, '👥');
        return;
    }
    let totalWin = 0;
    const roundDetails = [];

    loserData.forEach(loser => {
        let penalty = 0;
        if (loser.isCong) {
            penalty = CONG_PENALTY * betPerCard;
        } else {
            penalty = loser.leaves * betPerCard;
        }
        
        // Thối heo (nếu có - chưa implement chi tiết, tạm tính vào lá)
        // Hiện tại user chỉ yêu cầu tính heo như 1 lá bình thường nếu ko chặt
        // Hoặc nhập thẳng tổng tiền phạt thì linh hoạt hơn?
        // Theo yêu cầu: đếm lá -> tính tiền. Cóng = 15k.

        updateBalance(loser.id, -penalty);
        totalWin += penalty;
        roundDetails.push({ name: getPlayerName(loser.id), amount: -penalty, note: loser.isCong ? 'Cóng' : `${loser.leaves} lá` });
    });

    updateBalance(winnerId, totalWin);
    roundDetails.push({ name: getPlayerName(winnerId), amount: totalWin, note: 'Về Nhất' });

    addHistory('Ván Thường', roundDetails);
    saveData();
    renderPlayers();
}

function processBaoSam(reporterId, isSuccess, blockerId) {
    syncBetFromInput();
    if (players.length < MIN_PLAYERS) {
        showAlert(`Cần ít nhất ${MIN_PLAYERS} người chơi.`, '👥');
        return;
    } 
    // Thành công: Ăn mỗi nhà 20 lá.
    // Thất bại: Đền làng = 20 * (N-1). Nếu có người chặn, người chặn ăn hết. Nếu không, chia đều (ít gặp).
    // User logic: "thất bại thì 20 lá nhân số người chơi còn lại... người chặn ăn"
    
    const playersCount = players.length;
    let totalAmount = BAO_SAM_AMOUNT * (playersCount - 1) * betPerCard;
    const roundDetails = [];

    if (isSuccess) {
        // Reporter win
        const perPerson = BAO_SAM_AMOUNT * betPerCard;
        players.forEach(p => {
            if (p.id !== reporterId) {
                updateBalance(p.id, -perPerson);
                roundDetails.push({ name: p.name, amount: -perPerson, note: 'Thua Sâm' });
            }
        });
        updateBalance(reporterId, totalAmount);
        roundDetails.push({ name: getPlayerName(reporterId), amount: totalAmount, note: 'Báo Sâm Thành Công' });
    } else {
        // Reporter lose (Đền Sâm)
        updateBalance(reporterId, -totalAmount);
        roundDetails.push({ name: getPlayerName(reporterId), amount: -totalAmount, note: 'Đền Sâm' });

        if (blockerId && blockerId !== 'none') {
            // Blocker takes all
            updateBalance(blockerId, totalAmount);
            roundDetails.push({ name: getPlayerName(blockerId), amount: totalAmount, note: 'Bắt Sâm' });
        } else {
            // Chia đều cho làng (trường hợp tự thú/không ai bắt mà vẫn thua?) - User bảo "người chặn được thì người báo sâm lỗi sẽ bị trừ".
            // Mặc định chia đều nếu ko có ai chặn cụ thể (fallback)
            const share = totalAmount / (playersCount - 1);
            players.forEach(p => {
                if (p.id !== reporterId) {
                    updateBalance(p.id, share);
                    roundDetails.push({ name: p.name, amount: share, note: 'Được chia tiền đền' });
                }
            });
        }
    }
    
    addHistory(isSuccess ? 'Báo Sâm TC' : 'Đền Sâm', roundDetails);
    saveData();
    renderPlayers();
}

function processChatHeo(chopperId, victimId) {
    syncBetFromInput();
    if (players.length < MIN_PLAYERS) {
        showAlert(`Cần ít nhất ${MIN_PLAYERS} người chơi.`, '👥');
        return;
    }
    const amount = CHAT_HEO_LA * betPerCard;
    updateBalance(victimId, -amount);
    updateBalance(chopperId, amount);
    
    addHistory('Chặt Heo', [
        { name: getPlayerName(chopperId), amount, note: 'Chặt' },
        { name: getPlayerName(victimId), amount: -amount, note: 'Bị Chặt' }
    ]);
    saveData();
    renderPlayers();
}

// --- Helpers ---

function getPlayerName(id) {
    const p = players.find(p => p.id === id);
    return p ? p.name : 'Unknown';
}

function addHistory(type, details) {
    history.unshift({
        id: Date.now(),
        time: new Date().toLocaleTimeString(),
        type: type,
        details: details
    });
    renderHistory();
}

function saveData() {
    try {
        localStorage.setItem('samloc_players', JSON.stringify(players));
        localStorage.setItem('samloc_history', JSON.stringify(history));
        localStorage.setItem('samloc_bet_per_card', String(betPerCard));
    } catch (_) {
        console.warn('Không thể lưu dữ liệu vào localStorage');
    }
}

function resetGame() {
    showConfirm('Bạn có chắc chắn muốn xóa hết dữ liệu và chơi lại từ đầu?', '🔄').then(ok => {
        if (ok) {
            players.forEach(p => p.balance = 0);
            history = [];
            saveData();
            renderPlayers();
            renderHistory();
        }
    });
}

// --- UI Rendering ---

function renderPlayers() {
    playerListEl.innerHTML = '';
    const addBtn = document.getElementById('add-player-btn');
    if (addBtn) addBtn.disabled = players.length >= MAX_PLAYERS;
    
    // Dropdowns update
    updatePlayerSelects();

    players.forEach(p => {
        const div = document.createElement('div');
        div.className = 'player-item';
        div.innerHTML = `
            <span class="player-name">${p.name}</span>
            <div>
                <span class="player-balance ${p.balance >= 0 ? 'balance-positive' : 'balance-negative'}">
                    ${p.balance}k
                </span>
                <button onclick="removePlayer('${p.id}')" style="margin-left:10px; padding: 2px 6px; background:#444; font-size:0.8em">x</button>
            </div>
        `;
        playerListEl.appendChild(div);
    });
}

function renderHistory() {
    historyListEl.innerHTML = '';
    history.forEach(h => {
        const item = document.createElement('div');
        item.className = 'history-item';
        let detailHtml = '';
        h.details.forEach(d => {
            const cls = d.amount > 0 ? 'positive' : 'negative';
            detailHtml += `<div class="${cls}">
                <span>${d.name} (${d.note})</span>
                <span>${d.amount > 0 ? '+' : ''}${d.amount}k</span>
            </div>`;
        });
        
        item.innerHTML = `
            <div class="history-header">
                <strong>${h.type}</strong>
                <span>${h.time}</span>
            </div>
            <div class="history-details">
                ${detailHtml}
            </div>
        `;
        historyListEl.appendChild(item);
    });
}

function updatePlayerSelects() {
    const selects = document.querySelectorAll('.player-select');
    selects.forEach(sel => {
        const currentVal = sel.value;
        sel.innerHTML = '<option value="">-- Chọn --</option>';
        if (sel.dataset.allowNone === 'true') {
             sel.innerHTML = '<option value="none">Không có (Làng ăn)</option>';
        }
        players.forEach(p => {
            const opt = document.createElement('option');
            opt.value = p.id;
            opt.textContent = p.name;
            sel.appendChild(opt);
        });
        sel.value = currentVal; // preserve selection if possible
    });

    // Update Loser Inputs for Normal Win
    renderLoserInputs();
}

// --- Specific Modal UI Logic ---
function openModal(id) {
    document.getElementById(id).style.display = 'flex';
    updatePlayerSelects();
    updateChatHeoLabels();
    if(id === 'round-modal') openTab(event, 'NormalWin');
}

function closeModal(id) {
    document.getElementById(id).style.display = 'none';
}

function openTab(evt, tabName) {
    const tabcontent = document.getElementsByClassName("tabcontent");
    for (let i = 0; i < tabcontent.length; i++) {
        tabcontent[i].style.display = "none";
    }
    const tablinks = document.getElementsByClassName("tablinks");
    for (let i = 0; i < tablinks.length; i++) {
        tablinks[i].className = tablinks[i].className.replace(" active", "");
    }
    document.getElementById(tabName).style.display = "block";
    if (evt) evt.currentTarget.className += " active";
}

// Render inputs for losers based on selected winner
function renderLoserInputs() {
    const winnerId = document.getElementById('winner-select').value;
    const container = document.getElementById('losers-container');
    container.innerHTML = '';

    if (!winnerId) return;

    players.forEach(p => {
        if (p.id !== winnerId) {
            const div = document.createElement('div');
            div.style.marginBottom = '10px';
            div.style.padding = '10px';
            div.style.background = '#333';
            div.style.borderRadius = '5px';
            div.innerHTML = `
                <div style="font-weight:bold; margin-bottom:5px;">${p.name}</div>
                <div class="flex-row">
                    <label style="flex:1; display:flex; align-items:center;">
                        <input type="checkbox" class="is-cong-checkbox" data-id="${p.id}" style="width:auto; margin-right:5px;"> Cóng (15 lá)
                    </label>
                    <input type="number" class="w-full loser-leaves" data-id="${p.id}" placeholder="Số lá (1-10)" min="1" max="10" style="flex:2;">
                </div>
            `;
            container.appendChild(div);
        }
    });
}

function setupEventListeners() {
    // Add Player
    document.getElementById('add-player-btn').addEventListener('click', () => {
        showPrompt('Thêm người chơi', 'Nhập tên người chơi', 'Tên người chơi').then(name => {
            if (name) addPlayer(name);
        });
    });

    // Reset Game
    document.getElementById('reset-game-btn').addEventListener('click', resetGame);

    // Chặt Heo Logic
    document.getElementById('chat-heo-btn').addEventListener('click', () => {
        if (players.length < MIN_PLAYERS || players.length > MAX_PLAYERS) {
            showAlert(`Cần từ ${MIN_PLAYERS} đến ${MAX_PLAYERS} người chơi.`, '👥');
            return;
        }
        openModal('chat-modal');
    });

    document.getElementById('confirm-chat').addEventListener('click', () => {
        if (players.length < MIN_PLAYERS || players.length > MAX_PLAYERS) {
            showAlert(`Cần từ ${MIN_PLAYERS} đến ${MAX_PLAYERS} người chơi.`, '👥');
            return;
        }
        const chopperId = document.getElementById('chat-winner').value;
        const victimId = document.getElementById('chat-loser').value;
        if (chopperId && victimId && chopperId !== victimId) {
            processChatHeo(chopperId, victimId);
            closeModal('chat-modal');
        } else {
            showAlert('Chọn người chặt và bị chặt hợp lệ!', '🃏');
        }
    });

    // Round Results
    document.getElementById('new-round-btn').addEventListener('click', () => {
        if (players.length < MIN_PLAYERS || players.length > MAX_PLAYERS) {
            showAlert(`Cần từ ${MIN_PLAYERS} đến ${MAX_PLAYERS} người chơi để nhập kết quả.`, '👥');
            return;
        }
        openModal('round-modal');
    });

    // Cóng checkbox: disable ô số lá khi chọn Cóng
    document.getElementById('losers-container').addEventListener('change', (e) => {
        if (e.target.classList.contains('is-cong-checkbox')) {
            const flexRow = e.target.closest('.flex-row');
            const input = flexRow?.querySelector('.loser-leaves');
            if (input) {
                input.disabled = e.target.checked;
                if (e.target.checked) input.value = '';
            }
        }
    });

    document.getElementById('winner-select').addEventListener('change', renderLoserInputs);

    // Submit Normal Win
    document.getElementById('submit-normal').addEventListener('click', () => {
        const winnerId = document.getElementById('winner-select').value;
        if (!winnerId) { showAlert('Chọn người nhất!', '🏆'); return; }
        if (players.length < MIN_PLAYERS || players.length > MAX_PLAYERS) {
            showAlert(`Cần từ ${MIN_PLAYERS} đến ${MAX_PLAYERS} người chơi.`, '👥');
            return;
        }

        const loserInputs = document.querySelectorAll('.loser-leaves');
        const congCheckboxes = document.querySelectorAll('.is-cong-checkbox');
        const loserData = [];

        for (let i = 0; i < loserInputs.length; i++) {
            const id = loserInputs[i].dataset.id;
            const isCong = congCheckboxes[i].checked;
            const leaves = parseInt(loserInputs[i].value) || 0;

            if (!isCong && leaves <= 0) {
                showAlert('Vui lòng nhập số lá cho người thua (hoặc chọn Cóng)', '📋');
                return;
            }
            if (!isCong && leaves > 10) {
                showAlert('Số lá tối đa 10 (1–10 lá). Cóng = 15 lá.', '📋');
                return;
            }
            loserData.push({ id, leaves, isCong });
        }

        processRoundNormal(winnerId, loserData);
        closeModal('round-modal');
    });

    // Submit Bao Sam
    document.getElementById('submit-sam').addEventListener('click', () => {
        const reporterId = document.getElementById('sam-reporter').value;
        const result = document.getElementById('sam-result').value;
        const blockerId = document.getElementById('sam-blocker').value;

        if (!reporterId) { showAlert('Chọn người Báo Sâm!', '🎴'); return; }
        
        const isSuccess = result === 'success';
        if (!isSuccess && !blockerId) {
            showAlert('Vui lòng chọn ai bắt sâm (hoặc chọn Làng ăn)', '🎴');
            return;
        }
        if (!isSuccess && blockerId && blockerId !== 'none' && blockerId === reporterId) {
            showAlert('Người báo sâm không thể tự bắt sâm mình.', '🎴');
            return;
        }
        if (players.length < MIN_PLAYERS || players.length > MAX_PLAYERS) {
            showAlert(`Cần từ ${MIN_PLAYERS} đến ${MAX_PLAYERS} người chơi.`, '👥');
            return;
        }

        processBaoSam(reporterId, isSuccess, blockerId);
        closeModal('round-modal');
    });

    // Close Modals
    document.querySelectorAll('.close').forEach(btn => {
        btn.onclick = function() {
            btn.closest('.modal').style.display = 'none';
        }
    });
    
    window.onclick = function(event) {
        if (event.target.classList.contains('modal')) {
            event.target.style.display = "none";
        }
    }
}
