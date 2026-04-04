(async function() {
  // Skip check on login and register pages
  const path = window.location.pathname;
  if (path.endsWith('login.html') || path.endsWith('register.html') || path.endsWith('index.html') || path === '/') return;

  try {
    const res = await fetch('/api/public/settings?t=' + Date.now(), { cache: 'no-store' });
    const data = await res.json();
    if (data.success && data.data.maintenance_mode === 'true') {
      showMaintenance();
    }
  } catch(e) {}

  function showMaintenance() {
    const now = new Date();
    const hours = now.getHours();
    const minutes = now.getMinutes().toString().padStart(2,'0');
    const ampm = hours >= 12 ? 'PM' : 'AM';
    const h12 = ((hours % 12) || 12);
    const currentTime = `${h12}:${minutes} ${ampm}`;

    document.body.innerHTML = `
      <div style="
        min-height:100vh;
        background:linear-gradient(135deg,#0f0c29 0%,#1a1a4e 50%,#24243e 100%);
        display:flex;align-items:center;justify-content:center;
        font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
        padding:24px;box-sizing:border-box;
      ">
        <div style="text-align:center;max-width:400px;width:100%;">
          <!-- Moon icon -->
          <div style="
            width:90px;height:90px;
            background:linear-gradient(135deg,#1e3a5f,#0d2137);
            border-radius:50%;
            display:flex;align-items:center;justify-content:center;
            margin:0 auto 28px;
            box-shadow:0 0 0 12px rgba(255,200,50,0.08), 0 0 0 24px rgba(255,200,50,0.04);
          ">
            <svg viewBox="0 0 24 24" fill="#F59E0B" style="width:44px;height:44px;">
              <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
            </svg>
          </div>

          <!-- Closed badge -->
          <div style="display:inline-flex;align-items:center;gap:6px;background:rgba(239,68,68,0.15);border:1px solid rgba(239,68,68,0.35);border-radius:20px;padding:5px 14px;margin-bottom:20px;">
            <div style="width:7px;height:7px;border-radius:50%;background:#EF4444;animation:pulse 1.5s infinite;"></div>
            <span style="font-size:11px;font-weight:700;color:#EF4444;letter-spacing:1px;">PLATFORM CLOSED</span>
          </div>

          <h1 style="font-size:28px;font-weight:900;color:#fff;margin:0 0 12px;line-height:1.2;">We're Closed<br>Right Now</h1>
          <p style="font-size:14px;color:rgba(255,255,255,0.5);line-height:1.8;margin:0 0 28px;">
            Our platform is currently closed.<br>Please check back later.
          </p>

          <p style="font-size:12px;color:rgba(255,255,255,0.25);margin:0;">Thank you for your patience. See you tomorrow!</p>
        </div>
      </div>
      <style>@keyframes pulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:0.4;transform:scale(1.3)}}</style>
    `;
  }
})();
