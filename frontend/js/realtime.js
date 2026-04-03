function showReferralBonusToast(d) {
  // Remove existing toast if any
  const existing = document.getElementById('referralBonusToast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.id = 'referralBonusToast';
  toast.innerHTML = `
    <div style="display:flex;align-items:flex-start;gap:12px;">
      <div style="font-size:28px;flex-shrink:0;">🎉</div>
      <div>
        <div style="font-size:14px;font-weight:800;color:#111;margin-bottom:3px;">Referral Bonus Received!</div>
        <div style="font-size:13px;color:#374151;">You got <strong style="color:#7c3aed;">+$${d.bonus}</strong> (20%) from <strong>${d.from_user}</strong>'s task earning</div>
        <div style="font-size:12px;color:#6b7280;margin-top:2px;">New Balance: <strong>$${d.new_balance}</strong></div>
      </div>
      <button onclick="document.getElementById('referralBonusToast').remove()" style="background:none;border:none;font-size:18px;color:#9ca3af;cursor:pointer;flex-shrink:0;padding:0;line-height:1;">✕</button>
    </div>`;
  toast.style.cssText = `
    position:fixed;bottom:80px;left:50%;transform:translateX(-50%);
    background:#fff;border-radius:16px;padding:16px 18px;
    box-shadow:0 8px 32px rgba(124,58,237,0.25);
    border:2px solid #c4b5fd;
    width:calc(100% - 32px);max-width:400px;
    z-index:99999;animation:slideUp .3s ease;`;

  // Add animation keyframe if not already added
  if (!document.getElementById('toastStyle')) {
    const style = document.createElement('style');
    style.id = 'toastStyle';
    style.textContent = `@keyframes slideUp{from{opacity:0;transform:translateX(-50%) translateY(20px)}to{opacity:1;transform:translateX(-50%) translateY(0)}}`;
    document.head.appendChild(style);
  }

  document.body.appendChild(toast);
  // Auto-remove after 8 seconds
  setTimeout(() => { if (toast.parentNode) toast.remove(); }, 8000);
}

// Call initRealtime() on any page that needs live updates
function initRealtime(handlers) {
  const token = localStorage.getItem('token');
  if (!token) return;

  const connect = () => {
    const es = new EventSource(`/api/user/events?token=${encodeURIComponent(token)}`);

    es.addEventListener('balance_update', e => {
      const d = JSON.parse(e.data);
      handlers.onBalanceUpdate && handlers.onBalanceUpdate(d);
    });
    es.addEventListener('deposit_approved', e => {
      const d = JSON.parse(e.data);
      handlers.onDepositApproved && handlers.onDepositApproved(d);
    });
    es.addEventListener('withdrawal_update', e => {
      const d = JSON.parse(e.data);
      handlers.onWithdrawalUpdate && handlers.onWithdrawalUpdate(d);
    });
    es.addEventListener('task_completed', e => {
      const d = JSON.parse(e.data);
      handlers.onTaskCompleted && handlers.onTaskCompleted(d);
    });
    es.addEventListener('referral_bonus', e => {
      const d = JSON.parse(e.data);
      showReferralBonusToast(d);
      handlers.onReferralBonus && handlers.onReferralBonus(d);
    });

    es.onerror = () => {
      es.close();
      setTimeout(connect, 5000); // reconnect after 5s
    };

    return es;
  };

  return connect();
}
