// Cấu hình ID Admin đồng bộ với server.js
const ADMIN_USERNAME = "0708069602";

let currentUser = null;
let balance = 0;
let betHistory = [];
let withdrawHistory = [];
let displayedHistory = [];
let historyUpdateTimeout = null;

// Trạng thái trò chơi toàn cục
let timeLeft = 40, timerInterval = null, hasBet = false, sideBet = null, amountBet = 0;
let currentBetId = null, isOpening = false, lastPhase = 'betting', resultFetched = false;
let autoOpenTimeout = null;

// Tự động nhận diện API: 
// Nếu chạy ở localhost nhưng sai cổng (ví dụ Live Server 5500) thì trỏ về 3000.
// Nếu chạy trên Web (Render) thì dùng đường dẫn tương đối "".
const API_URL = (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1") && window.location.port !== "3000" ? "http://localhost:3000" : "";

async function fetchData(endpoint, options = {}) {
    const url = `${API_URL}${endpoint}`;
    console.log(`📡 Đang gọi API: ${url}`);
    return fetch(url, {
        method: options.method || 'GET',
        headers: { 'Content-Type': 'application/json' },
        body: options.body ? JSON.stringify(options.body) : null
    })
        .then(res => {
            if (!res.ok) throw new Error("Server trả về lỗi");
            return res.json();
        })
        .catch(error => {
            console.error("Fetch Error:", error);
            if (window.location.port !== "3000") {
                showToast("❌ Lỗi kết nối! Hãy chắc chắn bạn đang truy cập qua http://localhost:3000 thay vì Live Server.", "error");
            } else {
                showToast("❌ Server không phản hồi! Kiểm tra lại Terminal của bạn.", "error");
            }
            return { success: false, message: "Lỗi kết nối server." };
        });
}

function toggleAuth(e, isRegister) {
    if (e && e.preventDefault) e.preventDefault();
    document.getElementById('loginForm').classList.toggle('hidden', isRegister);
    document.getElementById('registerForm').classList.toggle('hidden', !isRegister);
    document.getElementById('authTitle').textContent = isRegister ? "Tạo tài khoản mới miễn phí" : "Đăng nhập để bắt đầu trải nghiệm";
}

async function handleRegister() {
    const btn = document.querySelector('#registerForm button');
    const user = document.getElementById('regUser').value.trim();
    const pass = document.getElementById('regPass').value;
    const confirm = document.getElementById('regPassConfirm').value;

    if (!user || user.length < 4) return showToast("Tên đăng nhập tối thiểu 4 ký tự", "error");
    if (pass.length < 4) return showToast("Mật khẩu tối thiểu 4 ký tự", "error");
    if (pass !== confirm) return showToast("Mật khẩu nhập lại không khớp", "error");

    btn.disabled = true;
    btn.textContent = "ĐANG XỬ LÝ...";

    const res = await fetchData('/api/register', { method: 'POST', body: { username: user, password: pass } });

    btn.disabled = false;
    btn.textContent = "ĐĂNG KÝ TÀI KHOẢN";

    if (!res.success) return showToast(res.message, "error");

    showToast("🎉 Đăng ký thành công! Hãy đăng nhập.");
    toggleAuth(false);
}

async function handleLogin() {
    const user = document.getElementById('loginUser').value.trim();
    const pass = document.getElementById('loginPass').value;
    const btn = document.querySelector('#loginForm button');
    if (!btn) return;

    if (!user || !pass) return showToast("Vui lòng nhập đầy đủ!", "error");

    btn.disabled = true;
    btn.textContent = "ĐANG ĐĂNG NHẬP...";

    const res = await fetchData('/api/login', { method: 'POST', body: { username: user, password: pass } });

    btn.disabled = false;
    btn.textContent = "ĐĂNG NHẬP";

    if (res.success) {
        currentUser = res.user.username;
        balance = res.user.balance;
        betHistory = res.user.betHistory || [];
        withdrawHistory = res.user.withdrawHistory || [];
        localStorage.setItem('sunwin_session', currentUser);
        initGame();

        if (currentUser === ADMIN_USERNAME) {
            showToast("👑 Chào mừng Admin quay trở lại!");
        }
    } else { showToast(res.message, "error"); }
}

function initGame() {
    document.getElementById('authContainer').classList.add('hidden');
    document.getElementById('gameContainer').classList.remove('hidden');
    updateBalanceDisplay();
    if (currentUser === ADMIN_USERNAME) {
        document.getElementById('adminBtn').classList.remove('hidden');
        renderAdminUserList(); renderAdminDepositList(); renderAdminWithdrawList();
    } else {
        document.getElementById('adminBtn').classList.add('hidden');
    }
    startTimer();
}

function handleLogout() { localStorage.removeItem('sunwin_session'); location.reload(); }

// Khởi tạo ứng dụng
document.addEventListener('DOMContentLoaded', async () => {
    // Gắn sự kiện cho các nút Đăng nhập/Đăng ký
    document.getElementById('loginBtn')?.addEventListener('click', (e) => {
        e.preventDefault();
        handleLogin();
    });

    document.getElementById('registerBtn')?.addEventListener('click', (e) => {
        e.preventDefault();
        handleRegister();
    });

    const playBtn = document.getElementById('playBtn');
    if (playBtn) {
        playBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopImmediatePropagation(); // Gia cố chặn mọi sự kiện khác
            placeBet(e);
        });
    }

    // Chống Enter reload trang trong ô nhập tiền
    document.getElementById('betAmount')?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            e.stopImmediatePropagation(); // Gia cố chặn mọi sự kiện khác
        }
    });

    // Ngăn chặn Enter reload trang trên toàn bộ input
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && e.target.tagName === 'INPUT') {
            e.preventDefault();
        }
    });

    const session = localStorage.getItem('sunwin_session');
    if (session) {
        const res = await fetchData(`/api/user/${session}`);
        if (res.success) {
            currentUser = res.user.username;
            balance = res.user.balance;
            betHistory = res.user.betHistory || [];
            withdrawHistory = res.user.withdrawHistory || [];

            // Khôi phục trạng thái cược đang chờ nếu có
            const pendingBet = betHistory.find(b => b.result === 'Đang chờ');
            if (pendingBet) {
                selectSide(pendingBet.side); // Đánh dấu nút đã chọn
                hasBet = true;
                currentBetId = pendingBet.id;
                sideBet = pendingBet.side;
                amountBet = pendingBet.amount;
                const sideEl = sideBet === 'left' ? 'placedBetXiu' : 'placedBetTai';
                const el = document.getElementById(sideEl);
                if (el) { el.textContent = `+${amountBet.toLocaleString()}đ`; el.classList.remove('hidden'); }
            }

            initGame();
        }
    }

    // Sự kiện mở bát
    document.getElementById('bowl')?.addEventListener('click', function () {
        if (isOpening) {
            this.classList.add('open');
            if (autoOpenTimeout) {
                clearTimeout(autoOpenTimeout);
                autoOpenTimeout = null;
            }
        }
    });
});

function startTimer() {
    if (timerInterval) clearInterval(timerInterval);
    timerInterval = setInterval(async () => {
        const res = await fetchData(`/api/game-state?username=${currentUser}`);
        if (!res || !res.success) return;

        if (res.isLocked) {
            showToast("⚠️ Tài khoản của bạn đã bị khóa bởi Admin!", "error");
            setTimeout(() => handleLogout(), 2000);
            return;
        }

        if (res.balance !== null && res.balance !== balance) {
            const diff = res.balance - balance;
            balance = res.balance;
            updateBalanceDisplay();
            if (diff > 0) showToast(`💰 Tài khoản được cộng +${diff.toLocaleString()}đ`);
        }

        // Tự động cập nhật lịch sử để người dùng thấy trạng thái "Thắng/Thua" hoặc "Hoàn thành" nạp rút ngay lập tức
        if (res.betHistory) betHistory = res.betHistory;
        if (res.withdrawHistory) withdrawHistory = res.withdrawHistory;

        // Logic cập nhật biểu đồ soi cầu trễ 14 giây
        if (res.gameHistory) {
            if (displayedHistory.length === 0) {
                displayedHistory = [...res.gameHistory];
                renderHistoryChart(displayedHistory);
            } else {
                const serverLast = res.gameHistory[res.gameHistory.length - 1];
                const displayedLast = displayedHistory[displayedHistory.length - 1];

                if (res.gameHistory.length !== displayedHistory.length || serverLast !== displayedLast) {
                    if (!historyUpdateTimeout) {
                        historyUpdateTimeout = setTimeout(() => {
                            displayedHistory = [...res.gameHistory];
                            renderHistoryChart(displayedHistory);
                            historyUpdateTimeout = null;
                        }, 14000);
                    }
                }
            }
        }

        timeLeft = res.timeLeft;
        const currentPhase = res.phase;
        updateTimerDisplay();

        if (lastPhase === 'rolling' && currentPhase === 'betting') {
            resetGameUI();
        }

        if (lastPhase === 'betting' && currentPhase === 'rolling') {
            if (!isOpening) {
                isOpening = true;
                document.getElementById('mainPlate').classList.add('rolling');
            }
            if (!resultFetched) {
                resultFetched = true;
                setTimeout(() => sendResolveBetToServer(currentBetId), 1000);
            }
        }
        lastPhase = currentPhase;
    }, 1000);
}

function renderHistoryChart(history) {
    const container = document.getElementById('gameHistoryChart');
    const statsEl = document.getElementById('historyStats');
    if (!container) return;

    let taiCount = 0;
    let xiuCount = 0;

    container.innerHTML = history.map(res => {
        const isTai = res === 'tai';
        if (isTai) taiCount++; else xiuCount++;

        const bgColor = isTai ? 'bg-red-500' : 'bg-white';
        const textColor = isTai ? 'text-white' : 'text-black';
        const label = isTai ? 'T' : 'X';

        return `<div class="w-6 h-6 rounded-full ${bgColor} ${textColor} flex items-center justify-center text-[10px] font-bold shadow-sm ring-1 ring-black/20">${label}</div>`;
    }).join('');

    // Cập nhật thống kê
    if (statsEl) {
        statsEl.textContent = `Tài: ${taiCount} | Xỉu: ${xiuCount}`;
    }
}

function resetGameUI() {
    if (autoOpenTimeout) { clearTimeout(autoOpenTimeout); autoOpenTimeout = null; }
    isOpening = false; hasBet = false; sideBet = null; selectedSide = null; currentBetId = null; resultFetched = false;

    // Đảm bảo biểu đồ được cập nhật ngay khi reset UI (nếu có dữ liệu)
    // if (lastHistoryData.length > 0) {
    //     renderHistoryChart(lastHistoryData);
    // }

    const btn = document.getElementById('playBtn');
    if (btn) {
        btn.disabled = false;
        btn.textContent = "ĐẶT CƯỢC";
        btn.classList.remove('opacity-50');
    }

    document.getElementById('btnLeft').className = 'bet-button py-4 rounded-2xl font-black text-xl text-gray-400';
    document.getElementById('btnRight').className = 'bet-button py-4 rounded-2xl font-black text-xl text-gray-400';
    document.getElementById('result').textContent = "";
    ['dice1', 'dice2', 'dice3'].forEach(id => document.getElementById(id).style.transform = `rotateX(0deg) rotateY(0deg)`);
    document.getElementById('bowl').classList.remove('open');
    document.getElementById('placedBetXiu').classList.add('hidden');
    document.getElementById('placedBetTai').classList.add('hidden');
    document.getElementById('mainPlate').classList.remove('rolling');
}

function updateTimerDisplay() {
    const el = document.getElementById('countdown');
    el.textContent = timeLeft; el.classList.toggle('text-red-500', timeLeft <= 5);
}

let selectedSide = null;
function selectSide(side) {
    if (isOpening || hasBet) return;
    const input = document.getElementById('betAmount');
    let currentBet = parseInt(input.value) || 10000;
    selectedSide = side;
    document.getElementById('btnLeft').className = side === 'left' ? 'bet-button active py-4 rounded-2xl font-black text-xl text-yellow-400' : 'bet-button py-4 rounded-2xl font-black text-xl text-gray-400';
    document.getElementById('btnRight').className = side === 'right' ? 'bet-button active py-4 rounded-2xl font-black text-xl text-yellow-400' : 'bet-button py-4 rounded-2xl font-black text-xl text-gray-400';
}

async function placeBet(e) {
    if (e) {
        e.preventDefault(); // Chặn reload trang ngay lập tức
        e.stopImmediatePropagation(); // Gia cố chặn mọi sự kiện khác
    }

    const btn = document.getElementById('playBtn');
    const originalText = btn.textContent;

    try {
        if (isOpening || timeLeft <= 3 || hasBet) return;

        const amount = parseInt(document.getElementById('betAmount').value);
        if (!selectedSide || isNaN(amount) || amount < 1000) {
            showToast("Kiểm tra lại lựa chọn!", "error");
            return;
        }
        if (balance < amount) {
            showToast("Số dư không đủ!", "error");
            return;
        }

        btn.disabled = true;
        btn.textContent = "ĐANG XỬ LÝ...";

        hasBet = true;
        sideBet = selectedSide;
        amountBet = amount;

        const res = await fetchData('/api/place-bet', {
            method: 'POST',
            body: { username: currentUser, side: selectedSide, amount }
        });

        if (res.success) {
            balance = res.balance;
            betHistory = res.betHistory || betHistory;
            currentBetId = res.betId;
            updateBalanceDisplay();

            const sideEl = selectedSide === 'left' ? 'placedBetXiu' : 'placedBetTai';
            document.getElementById(sideEl).textContent = `+${amount.toLocaleString()}đ`;
            document.getElementById(sideEl).classList.remove('hidden');
            showToast("✅ Đặt cược thành công!");
        } else {
            hasBet = false;
            showToast(res.message || "Đặt cược thất bại", "error");
        }
    } catch (error) {
        console.error("PlaceBet Error:", error);
        showToast("❌ Lỗi khi đặt cược!", "error");
        hasBet = false;
    } finally {
        btn.disabled = false;
        btn.textContent = "ĐẶT CƯỢC";
    }
}

async function sendResolveBetToServer(bid) {
    const r = await fetchData('/api/resolve-bet', { method: 'POST', body: { username: currentUser, betId: bid } });
    if (r.success) {
        const { dice, total, balance: newBal, betHistory: newHist } = r;

        document.getElementById('mainPlate').classList.remove('rolling');

        dice.forEach((v, i) => {
            let rX = 0, rY = 0;
            if (v === 1) { rX = 0; rY = 0; } else if (v === 2) { rX = 0; rY = -90; } else if (v === 3) { rX = -90; rY = 0; }
            else if (v === 4) { rX = 90; rY = 0; } else if (v === 5) { rX = 0; rY = 90; } else if (v === 6) { rX = 0; rY = 180; }
            const diceEl = document.getElementById(`dice${i + 1}`);
            if (diceEl) diceEl.style.transform = `rotateX(${rX + 720}deg) rotateY(${rY + 720}deg)`;
        });

        // Tự động mở bát sau 5s
        autoOpenTimeout = setTimeout(() => {
            const bowl = document.getElementById('bowl');
            if (bowl && !bowl.classList.contains('open')) bowl.classList.add('open');
        }, 6000); // Trễ 6 giây sau khi có kết quả để khớp với hiệu ứng lắc

        balance = newBal;
        betHistory = newHist;
        updateBalanceDisplay();

        // Hiển thị kết quả số ngay dưới chỗ đặt cược sau khi mở bát (6 giây)
        setTimeout(() => {
            const resultEl = document.getElementById('result');
            if (!resultEl) return;

            let resultText = `<div class="text-yellow-400 font-black text-3xl animate-bounce">TỔNG: ${total}</div>`;

            if (hasBet) {
                const lastBet = newHist.find(b => b.id == bid);
                if (lastBet && lastBet.result === 'Thắng') {
                    resultText += `<div class="text-green-400 font-bold mt-1">🎉 CHÚC MỪNG +${lastBet.winAmount.toLocaleString()}đ</div>`;
                } else {
                    resultText += `<div class="text-red-500 font-bold mt-1">HẸN BẠN PHIÊN SAU!</div>`;
                }
            }
            resultEl.innerHTML = resultText;
        }, 6000);
    }
}

function updateBalanceDisplay() {
    document.getElementById('balance').textContent = balance.toLocaleString();
    const bal2 = document.getElementById('balance2');
    if (bal2) bal2.textContent = balance.toLocaleString();
}

function openModal(id) {
    document.getElementById(id).classList.remove('hidden');
    if (id === 'profileModal') loadProfileData();
    else if (id === 'historyModal') renderHistory();
    else if (id === 'adminModal') { renderAdminDepositList(); renderAdminUserList(); renderAdminWithdrawList(); }
}

function closeModal(id) {
    document.getElementById(id).classList.add('hidden');
}

function loadProfileData() {
    document.getElementById('profileUsername').textContent = currentUser;
    document.getElementById('profileBalance').textContent = balance.toLocaleString();
    fetchData(`/api/user/${currentUser}`).then(res => {
        if (res.success) {
            document.getElementById('profileFullName').value = res.user.fullName || "";
            document.getElementById('profilePhone').value = res.user.phone || "";
            if (res.user.avatar) {
                document.getElementById('profileAvatarPreview').src = res.user.avatar;
            }
        }
    });
}

async function refreshAdminData(showMsg = true) {
    const btn = document.querySelector('#adminModal .fa-rotate');
    if (btn) btn.classList.add('fa-spin');
    // Cập nhật tất cả các danh sách cùng lúc
    await Promise.all([
        renderAdminDepositList(),
        renderAdminWithdrawList(),
        renderAdminUserList()
    ]);
    if (btn) btn.classList.remove('fa-spin');
    if (showMsg) showToast("🔄 Đã cập nhật dữ liệu mới nhất");
}

function showTransferInfo(e) {
    if (e) e.preventDefault();
    const amount = document.getElementById('depositAmount').value;
    if (!amount || amount < 10000) return showToast("Số tiền tối thiểu 10,000đ", "error");

    document.getElementById('displayDepositAmount').textContent = parseInt(amount).toLocaleString() + "đ";

    const bankID = "VCCB";
    const accountNo = "99ZP24249M42049701";
    const template = "compact2";
    const description = "99ZP24249M42049701";
    const accountName = "PHAM HUU HIEU";

    const qrUrl = `https://img.vietqr.io/image/${bankID}-${accountNo}-${template}.png?amount=${amount}&addInfo=${description}&accountName=${encodeURIComponent(accountName)}`;
    document.getElementById('qrCodeImg').src = qrUrl;

    document.getElementById('depositStep1').classList.add('hidden');
    document.getElementById('depositStep2').classList.remove('hidden');
}

function showToast(msg, type = 'success') {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.style.backgroundColor = type === 'success' ? '#10b981' : '#ef4444';
    t.classList.remove('hidden');
    t.classList.add('toast-active');
    setTimeout(() => {
        t.classList.add('hidden');
        t.classList.remove('toast-active');
    }, 3000);
}

let tempAvatarBase64 = null;
function previewAvatar(input) {
    if (input.files && input.files[0]) {
        const reader = new FileReader();
        reader.onload = function (e) {
            document.getElementById('profileAvatarPreview').src = e.target.result;
            tempAvatarBase64 = e.target.result;
        };
        reader.readAsDataURL(input.files[0]);
    }
}

async function confirmDeposit(e) {
    if (e) e.preventDefault();
    const amount = document.getElementById('depositAmount').value;
    const code = document.getElementById('transferCode').textContent;
    const res = await fetchData('/api/deposit', { method: 'POST', body: { username: currentUser, amount, code } });
    if (res.success) {
        showToast(res.message);
        // Chuyển về bước 1 cho lần sau
        document.getElementById('depositStep1').classList.remove('hidden');
        document.getElementById('depositStep2').classList.add('hidden');
        document.getElementById('depositAmount').value = "";
        closeModal('depositModal');
    } else { showToast(res.message, "error"); }
}

async function saveProfile(e) {
    if (e) e.preventDefault();
    const fullName = document.getElementById('profileFullName').value.trim();
    const phone = document.getElementById('profilePhone').value.trim();
    if (fullName.length < 2) return showToast("Họ tên quá ngắn!", "error");
    if (!/^\d{10,11}$/.test(phone)) return showToast("SĐT không hợp lệ!", "error");
    const res = await fetchData('/api/update-profile', { method: 'POST', body: { username: currentUser, fullName, phone, avatar: tempAvatarBase64 } });
    if (res.success) { showToast("✅ Thành công!"); closeModal('profileModal'); }
}

async function handleWithdraw(e) {
    if (e) e.preventDefault();
    const amt = parseInt(document.getElementById('withdrawAmount').value);
    const bank = document.getElementById('withdrawBank').value;
    const num = document.getElementById('withdrawNumber').value;
    const holder = document.getElementById('withdrawHolder').value;
    if (!amt || amt < 50000) return showToast("Tối thiểu 50k", "error");
    const res = await fetchData('/api/withdraw', { method: 'POST', body: { username: currentUser, amount: amt, bankName: bank, accountNumber: num, accountHolder: holder } });
    if (res.success) {
        balance = res.balance;
        withdrawHistory = res.withdrawHistory;
        updateBalanceDisplay();
        closeModal('withdrawModal');
        showToast("🚀 Đã gửi lệnh rút!");
    }
}

function switchHistoryTab(tab) {
    const isBet = tab === 'bet';
    document.getElementById('tabBet').className = isBet ? 'flex-1 py-3 text-sm font-bold border-b-2 border-yellow-400 text-yellow-400' : 'flex-1 py-3 text-sm font-bold border-b-2 border-transparent text-gray-500';
    document.getElementById('tabWithdraw').className = !isBet ? 'flex-1 py-3 text-sm font-bold border-b-2 border-yellow-400 text-yellow-400' : 'flex-1 py-3 text-sm font-bold border-b-2 border-transparent text-gray-500';
    document.getElementById('betHistoryList').classList.toggle('hidden', !isBet);
    document.getElementById('withdrawHistoryList').classList.toggle('hidden', isBet);
}

function renderHistory() {
    const bList = document.getElementById('betHistoryList');
    bList.innerHTML = betHistory.length ? '' : '<p class="text-center text-gray-500 py-4">Chưa có lịch sử</p>';
    betHistory.forEach(h => {
        const d = document.createElement('div');
        d.className = 'bg-black/40 p-3 rounded-xl border border-white/5 flex justify-between text-xs';
        const statusCls = h.result === 'Thắng' ? 'text-green-400' : 'text-red-400';
        d.innerHTML = `<div>${h.side === 'left' ? 'XỈU' : 'TÀI'} - ${h.amount.toLocaleString()}đ</div><div class="${statusCls}">${h.result}</div>`;
        bList.appendChild(d);
    });

    const wList = document.getElementById('withdrawHistoryList');
    wList.innerHTML = withdrawHistory.length ? '' : '<p class="text-center text-gray-500 py-4">Chưa có lịch sử</p>';
    withdrawHistory.forEach(h => {
        const d = document.createElement('div');
        d.className = 'bg-black/40 p-3 rounded-xl border border-white/5 flex justify-between text-xs';
        const sCls = h.status === 'Hoàn thành' ? 'text-green-400' : 'text-blue-400 animate-pulse';
        d.innerHTML = `<div>Rút ${h.amount.toLocaleString()}đ</div><div class="${sCls}">${h.status}</div>`;
        wList.appendChild(d);
    });
}

async function renderAdminDepositList() {
    const d = await fetchData('/api/admin/data');
    if (!d || !d.success) return;

    // Danh sách chờ duyệt
    const el = document.getElementById('adminDepositList');
    const pending = d.deposits ? d.deposits.filter(r => r.status === 'Pending') : [];
    el.innerHTML = pending.length ? '' : '<p class="text-gray-500 text-xs italic">Không có yêu cầu mới</p>';
    pending.forEach(r => {
        const dv = document.createElement('div');
        dv.className = 'bg-black p-3 rounded-xl flex justify-between border border-red-900/30 text-xs';
        dv.innerHTML = `
            <div>${r.user} - <span class="text-yellow-400">${r.amount.toLocaleString()}đ</span></div>
            <div class="flex gap-2">
                <button onclick="approveDeposit('${r.id}')" class="text-green-400 font-bold">Duyệt</button>
                <button onclick="rejectDeposit('${r.id}')" class="text-red-500">Hủy</button>
            </div>`;
        el.appendChild(dv);
    });

    // Lịch sử đã xử lý
    const hEl = document.getElementById('adminDepositHistory');
    if (hEl) {
        const history = d.deposits ? d.deposits.filter(r => r.status !== 'Pending') : [];
        hEl.innerHTML = history.length ? '' : '<p class="text-gray-600 text-[10px] italic text-center">Chưa có lịch sử</p>';
        history.slice(-10).reverse().forEach(r => {
            const dv = document.createElement('div');
            dv.className = 'bg-zinc-900/50 p-2 rounded-lg flex justify-between text-[10px] border border-white/5 opacity-60';
            const statusColor = r.status === 'Success' ? 'text-green-500' : 'text-red-500';
            dv.innerHTML = `<div>${r.user} - ${r.amount.toLocaleString()}đ</div><div class="${statusColor}">${r.status}</div>`;
            hEl.appendChild(dv);
        });
    }
}

async function approveDeposit(id) {
    const res = await fetchData('/api/admin/action', { method: 'POST', body: { type: 'approveDeposit', reqId: id } });
    if (res.success) {
        showToast("✅ Đã duyệt nạp!");
        refreshAdminData(false);
    }
}

async function rejectDeposit(id) {
    if (!confirm("Bạn có chắc chắn muốn hủy yêu cầu nạp này?")) return;
    const res = await fetchData('/api/admin/action', { method: 'POST', body: { type: 'rejectDeposit', reqId: id } });
    if (res.success) {
        showToast("❌ Đã hủy yêu cầu nạp");
        refreshAdminData(false);
    }
}

async function rejectWithdraw(id) {
    if (!confirm("Bạn có chắc chắn muốn hủy và hoàn tiền cho yêu cầu này?")) return;
    const res = await fetchData('/api/admin/action', { method: 'POST', body: { type: 'rejectWithdraw', reqId: id } });
    if (res.success) {
        showToast("❌ Đã hủy và hoàn tiền!");
        refreshAdminData(false);
    }
}


function setAdminResult(mode) {
    fetchData('/api/admin/action', { method: 'POST', body: { type: 'setResult', mode } })
        .then(r => { if (r.success) showToast(`🎯 Admin: ${mode.toUpperCase()}`); });

    document.getElementById('ctrlLeft').className = mode === 'left' ? 'bg-red-600 py-3 rounded-xl text-xs font-bold border border-red-400' : 'bg-zinc-800 py-3 rounded-xl text-xs font-bold border border-zinc-700';
    document.getElementById('ctrlRandom').className = mode === 'random' ? 'bg-blue-600 py-3 rounded-xl text-xs font-bold border border-blue-400' : 'bg-zinc-800 py-3 rounded-xl text-xs font-bold border border-zinc-700';
    document.getElementById('ctrlRight').className = mode === 'right' ? 'bg-red-600 py-3 rounded-xl text-xs font-bold border border-red-400' : 'bg-zinc-800 py-3 rounded-xl text-xs font-bold border border-zinc-700';
}


async function renderAdminWithdrawList() {
    const d = await fetchData('/api/admin/data');
    if (!d || !d.success) return;

    // Chờ duyệt
    const el = document.getElementById('adminWithdrawList');
    const pending = d.withdraws ? d.withdraws.filter(r => r.status !== 'Hoàn thành' && r.status !== 'Bị từ chối') : [];
    el.innerHTML = pending.length ? '' : '<p class="text-gray-500 text-xs italic">Không có yêu cầu mới</p>';
    pending.forEach(r => {
        const dv = document.createElement('div');
        dv.className = 'bg-black p-3 rounded-xl flex justify-between border border-blue-900/30 text-xs';
        const btnLabel = r.status === 'Đang xử lý' ? 'XÁC NHẬN' : 'HOÀN THÀNH';
        dv.innerHTML = `
                        <div>
                            <div class="font-bold text-blue-400">${r.user} - ${r.amount.toLocaleString()}đ</div>
                            <div class="text-[10px] text-gray-500">${r.bankName} | ${r.accountNumber}</div>
                        </div>
                        <div class="flex gap-2 items-center">
                            <button onclick="approveWithdraw('${r.id}')" class="text-green-400 font-bold">${btnLabel}</button>
                            <button onclick="rejectWithdraw('${r.id}')" class="text-red-500 text-[10px]">Hủy</button>
                        </div>`;
        el.appendChild(dv);
    });

    // Lịch sử rút
    const hEl = document.getElementById('adminWithdrawHistory');
    if (hEl) {
        const history = d.withdraws ? d.withdraws.filter(r => r.status === 'Hoàn thành' || r.status === 'Bị từ chối') : [];
        hEl.innerHTML = history.length ? '' : '<p class="text-gray-600 text-[10px] italic text-center">Chưa có lịch sử</p>';
        history.slice(-10).reverse().forEach(r => {
            const dv = document.createElement('div');
            dv.className = 'bg-zinc-900/50 p-2 rounded-lg flex justify-between text-[10px] border border-white/5 opacity-60';
            const sColor = r.status === 'Hoàn thành' ? 'text-green-500' : 'text-red-500';
            dv.innerHTML = `<div>${r.user} - ${r.amount.toLocaleString()}đ</div><div class="${sColor}">${r.status}</div>`;
            hEl.appendChild(dv);
        });
    }
}

async function approveWithdraw(id) {
    const res = await fetchData('/api/admin/action', { method: 'POST', body: { type: 'approveWithdraw', reqId: id } });
    if (res.success) { showToast("✅ Cập nhật trạng thái!"); refreshAdminData(false); }
}

async function renderAdminUserList() {
    const d = await fetchData('/api/admin/data');
    if (!d || !d.success) return;
    const el = document.getElementById('adminUserList');
    el.innerHTML = '';
    if (d.users) Object.keys(d.users).forEach(u => {
        if (u === ADMIN_USERNAME) return;
        const usr = d.users[u];
        const dv = document.createElement('div');
        dv.className = 'bg-black p-3 rounded-xl flex justify-between border border-zinc-800 text-xs';
        dv.innerHTML = `
                        <div>
                            <div class="font-bold ${usr.isLocked ? 'text-red-500' : 'text-white'} uppercase">${u}</div>
                            <div class="text-gray-500">${usr.balance.toLocaleString()}đ</div>
                        </div>
                        <button onclick="toggleLock('${u}', ${!usr.isLocked})" class="${usr.isLocked ? 'text-green-500' : 'text-red-500'}">
                            <i class="fa-solid ${usr.isLocked ? 'fa-unlock' : 'fa-lock'}"></i>
                        </button>`;
        el.appendChild(dv);
    });
}

async function toggleLock(t, l) {
    await fetchData('/api/admin/action', { method: 'POST', body: { type: 'lock', target: t, value: l } });
    showToast(`Đã ${l ? 'khóa' : 'mở'} tài khoản ${t}`);
    renderAdminUserList();
}
